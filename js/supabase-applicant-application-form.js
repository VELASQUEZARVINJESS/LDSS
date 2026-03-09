(function () {
    "use strict";

    const EDITABLE_STATUSES = ["draft", "returned_for_correction"];
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
    const PROFILE_CACHE_PREFIX = "ldss:profile-cache:";
    const ALLOWED_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
    const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];

    const DOC_FIELDS = [
        { inputId: "reqEnrollment", docType: "proof_of_enrollment", label: "Proof of Enrollment" },
        { inputId: "reqReportCard", docType: "report_card", label: "Latest Report Card" },
        { inputId: "reqBarangay", docType: "barangay_certificate", label: "Barangay Certificate" },
        { inputId: "reqIncome", docType: "income_certificate", label: "Income Certificate" }
    ];

    const DOC_LABELS = {
        proof_of_enrollment: "Proof of Enrollment",
        report_card: "Latest Report Card",
        barangay_certificate: "Barangay Certificate",
        income_certificate: "Income Certificate"
    };

    let currentApplication = null;
    let isSaving = false;
    let isSubmitting = false;

    function byId(id) {
        return document.getElementById(id);
    }

    function nullIfBlank(value) {
        const normalized = (value || "").toString().trim();
        return normalized ? normalized : null;
    }

    function setStatus(message, type, isHtml) {
        const target = byId("applicationFormStatus");
        if (!target) {
            return;
        }
        if (!message) {
            target.className = "alert d-none";
            target.textContent = "";
            return;
        }
        target.className = "alert " + (type || "alert-info");
        if (isHtml) {
            target.innerHTML = message;
        } else {
            target.textContent = message;
        }
    }

    function setApplicationIdDisplay(applicationNo) {
        const target = byId("applicationFormIdDisplay");
        if (!target) {
            return;
        }
        if (!applicationNo) {
            target.textContent = "Application ID: New draft (not yet saved)";
            return;
        }
        target.textContent = "Application ID: " + applicationNo;
    }

    function sanitizeFileName(name) {
        return (name || "document")
            .replace(/[^a-zA-Z0-9.\-_]/g, "_")
            .replace(/_+/g, "_")
            .slice(0, 120);
    }

    function isBucketNotFoundMessage(message) {
        return /bucket not found/i.test((message || "").toString());
    }

    function isStoragePolicyMessage(message) {
        const text = (message || "").toString().toLowerCase();
        return text.includes("row-level security") || text.includes("permission") || text.includes("not allowed");
    }

    function setSelectValue(id, value) {
        const select = byId(id);
        if (!select) {
            return;
        }
        const normalized = (value || "").toString().trim();
        if (!normalized) {
            return;
        }
        const found = Array.from(select.options).find(function (opt) {
            return opt.value.toLowerCase() === normalized.toLowerCase();
        });
        if (found) {
            select.value = found.value;
            return;
        }
        const dynamicOption = document.createElement("option");
        dynamicOption.value = normalized;
        dynamicOption.textContent = normalized;
        select.appendChild(dynamicOption);
        select.value = normalized;
    }

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        return {
            applicationId: params.get("application_id")
        };
    }

    function profileCacheKey(userId) {
        return PROFILE_CACHE_PREFIX + userId;
    }

    function writeProfileCache(userId, profile) {
        if (!userId || !profile) {
            return;
        }
        try {
            localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
        } catch (error) {
            // Non-fatal: browser storage may be disabled.
        }
    }

    function readProfileCache(userId) {
        if (!userId) {
            return null;
        }
        try {
            const raw = localStorage.getItem(profileCacheKey(userId));
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function auxMetaKey(userId, applicationId) {
        return "ldss:application-form-meta:" + userId + ":" + (applicationId || "new");
    }

    function readAuxMeta(userId, applicationId) {
        try {
            const raw = localStorage.getItem(auxMetaKey(userId, applicationId));
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return typeof parsed === "object" && parsed ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function writeAuxMeta(userId, applicationId) {
        if (!userId || !applicationId) {
            return;
        }
        // TODO(Supabase): move these auxiliary fields to a dedicated application details table.
        const payload = {
            gwa: nullIfBlank(byId("gwa") ? byId("gwa").value : ""),
            addressSchool: nullIfBlank(byId("addressSchool") ? byId("addressSchool").value : ""),
            financialNotes: nullIfBlank(byId("financialNotes") ? byId("financialNotes").value : "")
        };
        try {
            localStorage.setItem(auxMetaKey(userId, applicationId), JSON.stringify(payload));
        } catch (error) {
            // Non-fatal: browser storage may be disabled.
        }
    }

    function applyAuxMeta(userId, applicationId) {
        const payload = readAuxMeta(userId, applicationId);
        if (byId("gwa")) {
            byId("gwa").value = payload.gwa || "";
        }
        if (byId("addressSchool")) {
            byId("addressSchool").value = payload.addressSchool || "";
        }
        if (byId("financialNotes")) {
            byId("financialNotes").value = payload.financialNotes || "";
        }
    }

    function collectApplicationPayload() {
        return {
            school_year: nullIfBlank(byId("schoolYear") ? byId("schoolYear").value : ""),
            scholarship_type: nullIfBlank(byId("scholarshipType") ? byId("scholarshipType").value : ""),
            application_type: (byId("applicantCategory") && byId("applicantCategory").value === "renewal") ? "renewal" : "new"
        };
    }

    function collectProfilePayload() {
        const monthlyIncomeRaw = byId("monthlyIncome") ? byId("monthlyIncome").value : "";
        const monthlyIncomeParsed = monthlyIncomeRaw === "" ? null : Number(monthlyIncomeRaw);
        return {
            school_name: nullIfBlank(byId("schoolName") ? byId("schoolName").value : ""),
            course_or_strand: nullIfBlank(byId("course") ? byId("course").value : ""),
            year_level: nullIfBlank(byId("yearLevel") ? byId("yearLevel").value : ""),
            guardian_name: nullIfBlank(byId("guardianName") ? byId("guardianName").value : ""),
            guardian_occupation: nullIfBlank(byId("guardianOccupation") ? byId("guardianOccupation").value : ""),
            monthly_income: Number.isNaN(monthlyIncomeParsed) ? null : monthlyIncomeParsed
        };
    }

    function setInputValidity(inputId, isInvalid) {
        const input = byId(inputId);
        if (!input) {
            return;
        }
        input.classList.toggle("is-invalid", !!isInvalid);
    }

    function setFileFeedback(inputId, message, isError) {
        const feedback = byId(inputId + "Feedback");
        if (!feedback) {
            return;
        }
        feedback.textContent = message || "";
        feedback.className = "form-text " + (isError ? "text-danger" : "text-muted");
    }

    function clearFileFeedback() {
        DOC_FIELDS.forEach(function (doc) {
            setFileFeedback(doc.inputId, "", false);
        });
    }

    function fileExtension(fileName) {
        const text = (fileName || "").toLowerCase();
        const index = text.lastIndexOf(".");
        if (index < 0) {
            return "";
        }
        return text.slice(index);
    }

    function validateSelectedFiles() {
        const errors = [];
        clearFileFeedback();

        DOC_FIELDS.forEach(function (doc) {
            const input = byId(doc.inputId);
            if (!input || !input.files || input.files.length === 0) {
                return;
            }

            const file = input.files[0];
            if (!file) {
                return;
            }

            const extension = fileExtension(file.name);
            const type = (file.type || "").toLowerCase();
            const extensionAllowed = ALLOWED_FILE_EXTENSIONS.includes(extension);
            const mimeAllowed = !type || ALLOWED_MIME_TYPES.includes(type);

            if (!extensionAllowed || !mimeAllowed) {
                const typeMessage = "Invalid file type. Use JPG, PNG, or PDF only.";
                setFileFeedback(doc.inputId, typeMessage, true);
                errors.push(doc.label + ": " + typeMessage);
                return;
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
                const sizeMessage = "File exceeds 10MB limit.";
                setFileFeedback(doc.inputId, sizeMessage, true);
                errors.push(doc.label + ": " + sizeMessage);
                return;
            }

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            setFileFeedback(doc.inputId, "Selected: " + file.name + " (" + sizeMb + " MB)", false);
        });

        return errors;
    }

    function validateFormFields(mode) {
        const errors = [];

        const schoolYear = byId("schoolYear") ? byId("schoolYear").value.trim() : "";
        const scholarshipType = byId("scholarshipType") ? byId("scholarshipType").value.trim() : "";
        const schoolName = byId("schoolName") ? byId("schoolName").value.trim() : "";
        const course = byId("course") ? byId("course").value.trim() : "";
        const yearLevel = byId("yearLevel") ? byId("yearLevel").value.trim() : "";
        const guardianName = byId("guardianName") ? byId("guardianName").value.trim() : "";
        const guardianOccupation = byId("guardianOccupation") ? byId("guardianOccupation").value.trim() : "";
        const monthlyIncomeRaw = byId("monthlyIncome") ? byId("monthlyIncome").value.trim() : "";
        const gwaRaw = byId("gwa") ? byId("gwa").value.trim() : "";

        setInputValidity("schoolYear", !schoolYear);
        setInputValidity("scholarshipType", !scholarshipType);

        if (!schoolYear) {
            errors.push("School Year is required.");
        }
        if (schoolYear && !/^\d{4}-\d{4}$/.test(schoolYear)) {
            errors.push("School Year format must be YYYY-YYYY.");
            setInputValidity("schoolYear", true);
        }
        if (!scholarshipType) {
            errors.push("Scholarship Type is required.");
        }

        const submitting = mode === "submit";
        const requiredChecks = [
            { id: "schoolName", label: "School Name", value: schoolName },
            { id: "course", label: "Course / Strand", value: course },
            { id: "yearLevel", label: "Year Level", value: yearLevel },
            { id: "guardianName", label: "Guardian Name", value: guardianName },
            { id: "guardianOccupation", label: "Guardian Occupation", value: guardianOccupation }
        ];

        requiredChecks.forEach(function (item) {
            const missing = submitting && !item.value;
            setInputValidity(item.id, missing);
            if (missing) {
                errors.push(item.label + " is required before submission.");
            }
        });

        if (submitting && !monthlyIncomeRaw) {
            setInputValidity("monthlyIncome", true);
            errors.push("Monthly Income is required before submission.");
        } else if (monthlyIncomeRaw) {
            const income = Number(monthlyIncomeRaw);
            const invalidIncome = Number.isNaN(income) || income < 0;
            setInputValidity("monthlyIncome", invalidIncome);
            if (invalidIncome) {
                errors.push("Monthly Income must be a valid non-negative number.");
            }
        } else {
            setInputValidity("monthlyIncome", false);
        }

        if (gwaRaw) {
            const gwa = Number(gwaRaw);
            const invalidGwa = Number.isNaN(gwa) || gwa < 1 || gwa > 5;
            setInputValidity("gwa", invalidGwa);
            if (invalidGwa) {
                errors.push("Latest GWA must be a number between 1.00 and 5.00.");
            }
        } else {
            setInputValidity("gwa", false);
        }

        return errors;
    }

    function applyProfileToForm(profile) {
        if (!profile) {
            return;
        }
        if (byId("schoolName")) {
            byId("schoolName").value = profile.school_name || "";
        }
        if (byId("course")) {
            byId("course").value = profile.course_or_strand || "";
        }
        if (byId("yearLevel")) {
            setSelectValue("yearLevel", profile.year_level || "");
        }
        if (byId("guardianName")) {
            byId("guardianName").value = profile.guardian_name || "";
        }
        if (byId("guardianOccupation")) {
            byId("guardianOccupation").value = profile.guardian_occupation || "";
        }
        if (byId("monthlyIncome")) {
            byId("monthlyIncome").value = profile.monthly_income || "";
        }
    }

    function applyApplicationToForm(application) {
        if (!application) {
            return;
        }
        setSelectValue("schoolYear", application.school_year || "");
        setSelectValue("scholarshipType", application.scholarship_type || "");
        setSelectValue("applicantCategory", application.application_type || "new");
        setApplicationIdDisplay(application.application_no || "");
    }

    function isEditable(application) {
        if (!application) {
            return true;
        }
        if (application.is_locked) {
            return false;
        }
        return EDITABLE_STATUSES.includes(application.status);
    }

    function setFormEditableState(editable) {
        const fieldIds = [
            "schoolYear",
            "scholarshipType",
            "applicantCategory",
            "schoolName",
            "course",
            "yearLevel",
            "gwa",
            "addressSchool",
            "guardianName",
            "guardianOccupation",
            "monthlyIncome",
            "financialNotes",
            "reqEnrollment",
            "reqReportCard",
            "reqBarangay",
            "reqIncome",
            "declaration",
            "saveDraftBtn",
            "submitApplicationBtn"
        ];
        fieldIds.forEach(function (id) {
            const el = byId(id);
            if (el) {
                el.disabled = !editable;
            }
        });
    }

    function setActionLoading(mode, isLoading) {
        const saveBtn = byId("saveDraftBtn");
        const submitBtn = byId("submitApplicationBtn");
        if (!saveBtn || !submitBtn) {
            return;
        }
        if (!isLoading) {
            saveBtn.disabled = false;
            submitBtn.disabled = false;
            saveBtn.textContent = "Save Draft";
            submitBtn.textContent = "Submit Application";
            if (!isEditable(currentApplication)) {
                setFormEditableState(false);
            }
            return;
        }

        saveBtn.disabled = true;
        submitBtn.disabled = true;
        if (mode === "submit") {
            submitBtn.textContent = "Submitting...";
        } else {
            saveBtn.textContent = "Saving...";
        }
    }

    async function loadProfile(context) {
        const result = await context.client
            .from("profiles")
            .select("school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income")
            .eq("id", context.user.id)
            .single();

        if (result.error || !result.data) {
            return readProfileCache(context.user.id);
        }
        writeProfileCache(context.user.id, result.data);
        return result.data;
    }

    async function loadApplication(context, applicationId) {
        const result = await context.client
            .from("applications")
            .select("id, application_no, application_type, scholarship_type, school_year, status, submitted_at, is_locked, created_at, updated_at")
            .eq("id", applicationId)
            .eq("applicant_id", context.user.id)
            .single();

        if (result.error) {
            return null;
        }
        return result.data;
    }

    async function findLatestEditableDraft(context) {
        const result = await context.client
            .from("applications")
            .select("id, application_no, status")
            .eq("applicant_id", context.user.id)
            .in("status", EDITABLE_STATUSES)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
    }

    async function saveProfile(context) {
        const patch = collectProfilePayload();
        const result = await context.client
            .from("profiles")
            .update(patch)
            .eq("id", context.user.id)
            .select("school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income")
            .single();

        if (result.error) {
            return result.error.message;
        }
        if (result.data) {
            writeProfileCache(context.user.id, result.data);
        }
        return "";
    }

    async function saveOrCreateDraft(context) {
        const payload = collectApplicationPayload();
        if (!payload.school_year || !payload.scholarship_type) {
            throw new Error("School Year and Scholarship Type are required.");
        }

        if (currentApplication) {
            if (!isEditable(currentApplication)) {
                throw new Error("This application is no longer editable.");
            }
            const updateResult = await context.client
                .from("applications")
                .update({
                    school_year: payload.school_year,
                    scholarship_type: payload.scholarship_type,
                    application_type: payload.application_type
                })
                .eq("id", currentApplication.id)
                .eq("applicant_id", context.user.id)
                .select("id, application_no, application_type, scholarship_type, school_year, status, submitted_at, is_locked, created_at, updated_at")
                .single();

            if (updateResult.error) {
                throw new Error(updateResult.error.message);
            }
            currentApplication = updateResult.data;
            setApplicationIdDisplay(currentApplication.application_no || "");
            return currentApplication;
        }

        const insertResult = await context.client
            .from("applications")
            .insert({
                applicant_id: context.user.id,
                school_year: payload.school_year,
                scholarship_type: payload.scholarship_type,
                application_type: payload.application_type,
                status: "draft"
            })
            .select("id, application_no, application_type, scholarship_type, school_year, status, submitted_at, is_locked, created_at, updated_at")
            .single();

        if (insertResult.error) {
            throw new Error(insertResult.error.message);
        }

        currentApplication = insertResult.data;
        setApplicationIdDisplay(currentApplication.application_no || "");
        window.history.replaceState({}, "", "applicant-application-form.html?application_id=" + encodeURIComponent(currentApplication.id));
        return currentApplication;
    }

    async function submitApplication(context) {
        if (!currentApplication || !currentApplication.id) {
            throw new Error("No draft application found to submit.");
        }
        if (!isEditable(currentApplication)) {
            throw new Error("This application is no longer editable.");
        }

        const result = await context.client
            .from("applications")
            .update({
                status: "submitted",
                submitted_at: new Date().toISOString()
            })
            .eq("id", currentApplication.id)
            .eq("applicant_id", context.user.id)
            .select("id, application_no, application_type, scholarship_type, school_year, status, submitted_at, is_locked, created_at, updated_at")
            .single();

        if (result.error) {
            throw new Error(result.error.message);
        }

        currentApplication = result.data;
        setApplicationIdDisplay(currentApplication.application_no || "");
        return currentApplication;
    }

    async function upsertDocumentRow(context, applicationId, docType, storagePath, file) {
        const existing = await context.client
            .from("application_documents")
            .select("id")
            .eq("application_id", applicationId)
            .eq("document_type", docType)
            .order("created_at", { ascending: false })
            .limit(1);

        if (existing.error) {
            return existing.error.message;
        }

        const payload = {
            application_id: applicationId,
            document_type: docType,
            storage_path: storagePath,
            original_filename: file.name,
            mime_type: file.type || "application/octet-stream",
            file_size_bytes: file.size,
            verification_status: "pending",
            verification_notes: null,
            uploaded_by: context.user.id
        };

        if (existing.data && existing.data.length > 0) {
            const updateResult = await context.client
                .from("application_documents")
                .update(payload)
                .eq("id", existing.data[0].id);
            return updateResult.error ? updateResult.error.message : "";
        }

        const insertResult = await context.client
            .from("application_documents")
            .insert(payload);
        return insertResult.error ? insertResult.error.message : "";
    }

    async function uploadSelectedDocuments(context, applicationId) {
        const uploaded = [];
        const errors = [];
        let fatalCode = "";

        for (const doc of DOC_FIELDS) {
            const input = byId(doc.inputId);
            if (!input || !input.files || input.files.length === 0) {
                continue;
            }

            const file = input.files[0];
            if (!file) {
                continue;
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                errors.push(doc.label + ": file exceeds 10MB limit.");
                continue;
            }

            const randomSuffix = Date.now().toString() + "-" + Math.floor(Math.random() * 100000).toString();
            const path = "applications/" + context.user.id + "/" + applicationId + "/" + doc.docType + "/" + randomSuffix + "-" + sanitizeFileName(file.name);

            const uploadResult = await context.client.storage
                .from(STORAGE_BUCKET)
                .upload(path, file, { contentType: file.type || "application/octet-stream" });

            if (uploadResult.error) {
                const uploadMessage = uploadResult.error.message || "Unknown storage upload error.";
                if (isBucketNotFoundMessage(uploadMessage)) {
                    fatalCode = "bucket_missing";
                    errors.push("Storage bucket '" + STORAGE_BUCKET + "' was not found.");
                    break;
                }
                if (isStoragePolicyMessage(uploadMessage)) {
                    fatalCode = "policy_blocked";
                }
                errors.push(doc.label + ": " + uploadMessage);
                continue;
            }

            const rowErrorMessage = await upsertDocumentRow(context, applicationId, doc.docType, path, file);
            if (rowErrorMessage) {
                errors.push(doc.label + ": " + rowErrorMessage);
                continue;
            }

            uploaded.push(doc.label);
            input.value = "";
        }

        return {
            uploaded: uploaded,
            errors: errors,
            fatalCode: fatalCode
        };
    }

    async function getMissingRequiredDocuments(context, applicationId) {
        const result = await context.client
            .from("application_documents")
            .select("document_type")
            .eq("application_id", applicationId);

        if (result.error) {
            throw new Error(result.error.message);
        }

        const present = new Set((result.data || []).map(function (row) { return row.document_type; }));
        return DOC_FIELDS
            .filter(function (doc) {
                return !present.has(doc.docType);
            })
            .map(function (doc) {
                return DOC_LABELS[doc.docType] || doc.docType;
            });
    }

    async function handleSaveDraft(context) {
        if (isSaving || isSubmitting) {
            return;
        }
        isSaving = true;
        setStatus("", "");
        setActionLoading("draft", true);

        try {
            const fieldErrors = validateFormFields("draft");
            const fileErrors = validateSelectedFiles();
            const validationErrors = fieldErrors.concat(fileErrors);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join(" | "));
            }

            const application = await saveOrCreateDraft(context);
            writeAuxMeta(context.user.id, application.id);
            const profileErrorMessage = await saveProfile(context);
            const uploadResult = await uploadSelectedDocuments(context, application.id);

            if (uploadResult.errors.length > 0 || profileErrorMessage) {
                const details = [];
                if (profileErrorMessage) {
                    details.push("Profile update warning: " + profileErrorMessage);
                }
                if (uploadResult.errors.length > 0) {
                    details.push("Upload warnings: " + uploadResult.errors.join(" | "));
                    if (uploadResult.fatalCode === "bucket_missing") {
                        details.push("Create bucket '" + STORAGE_BUCKET + "' and run storage policies from supabase/ldss_phase1_schema_rls.sql.");
                    } else if (uploadResult.fatalCode === "policy_blocked") {
                        details.push("Run/update storage RLS policies from supabase/ldss_phase1_schema_rls.sql.");
                    }
                }
                setStatus("Draft saved (" + (application.application_no || application.id) + "). " + details.join(" "), "alert-warning");
                return;
            }

            if (uploadResult.uploaded.length > 0) {
                setStatus(
                    "Draft saved (" + (application.application_no || application.id) + "). Uploaded: " + uploadResult.uploaded.join(", ") + ".",
                    "alert-success"
                );
            } else {
                setStatus("Draft saved (" + (application.application_no || application.id) + ").", "alert-success");
            }
        } catch (error) {
            setStatus("Failed to save draft: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            isSaving = false;
            setActionLoading("draft", false);
        }
    }

    async function handleSubmit(context) {
        if (isSubmitting || isSaving) {
            return;
        }
        isSubmitting = true;
        setStatus("", "");
        setActionLoading("submit", true);

        try {
            const fieldErrors = validateFormFields("submit");
            const fileErrors = validateSelectedFiles();
            const validationErrors = fieldErrors.concat(fileErrors);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join(" | "));
            }

            const declarationChecked = !!(byId("declaration") && byId("declaration").checked);
            if (!declarationChecked) {
                throw new Error("Please confirm the declaration checkbox before submitting.");
            }

            const application = await saveOrCreateDraft(context);
            writeAuxMeta(context.user.id, application.id);
            const profileErrorMessage = await saveProfile(context);

            const uploadResult = await uploadSelectedDocuments(context, application.id);
            if (uploadResult.errors.length > 0) {
                if (uploadResult.fatalCode === "bucket_missing") {
                    throw new Error(
                        "Storage bucket '" +
                            STORAGE_BUCKET +
                            "' not found. Run the storage section in supabase/ldss_phase1_schema_rls.sql, then retry."
                    );
                }
                if (uploadResult.fatalCode === "policy_blocked") {
                    throw new Error(
                        "Storage upload blocked by policy. Run/update storage RLS policies from supabase/ldss_phase1_schema_rls.sql, then retry."
                    );
                }
                throw new Error(
                    "Unable to submit because some uploads failed. " +
                    uploadResult.errors.join(" | ")
                );
            }

            const missingDocs = await getMissingRequiredDocuments(context, application.id);
            if (missingDocs.length > 0) {
                throw new Error("Missing required uploads: " + missingDocs.join(", ") + ".");
            }

            const submitted = await submitApplication(context);
            setFormEditableState(false);
            if (profileErrorMessage) {
                setStatus(
                    "Application submitted (" + (submitted.application_no || submitted.id) + "). Profile warning: " + profileErrorMessage,
                    "alert-warning"
                );
            } else {
                setStatus("Application submitted (" + (submitted.application_no || submitted.id) + "). Redirecting to tracking page...", "alert-success");
            }

            window.setTimeout(function () {
                window.location.href = "application-detail.html?id=" + encodeURIComponent(submitted.id);
            }, 1200);
        } catch (error) {
            setStatus("Submission failed: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            isSubmitting = false;
            setActionLoading("submit", false);
        }
    }

    function bindInlineValidation() {
        const inputIds = ["schoolYear", "scholarshipType", "schoolName", "course", "yearLevel", "guardianName", "guardianOccupation", "monthlyIncome", "gwa"];
        inputIds.forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", function () {
                input.classList.remove("is-invalid");
            });
            input.addEventListener("change", function () {
                input.classList.remove("is-invalid");
            });
        });

        DOC_FIELDS.forEach(function (doc) {
            const input = byId(doc.inputId);
            if (!input) {
                return;
            }
            input.addEventListener("change", function () {
                validateSelectedFiles();
            });
        });
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        const profile = await loadProfile(context);
        applyProfileToForm(profile);

        const query = parseQuery();
        if (query.applicationId) {
            const existing = await loadApplication(context, query.applicationId);
            if (!existing) {
                setStatus("Requested draft was not found. You can create a new application below.", "alert-warning");
            } else {
                currentApplication = existing;
                applyApplicationToForm(existing);
                applyAuxMeta(context.user.id, existing.id);

                if (!isEditable(existing)) {
                    setFormEditableState(false);
                    const detailLink = "application-detail.html?id=" + encodeURIComponent(existing.id);
                    setStatus(
                        "This application is already submitted or locked. Use tracking page instead: <a href=\"" + detailLink + "\">Open Tracking</a>.",
                        "alert-warning",
                        true
                    );
                    return;
                }
            }
        } else {
            const latestDraft = await findLatestEditableDraft(context);
            if (latestDraft) {
                const continueLink = "applicant-application-form.html?application_id=" + encodeURIComponent(latestDraft.id);
                setStatus(
                    "You have an existing draft (" + latestDraft.application_no + "). <a href=\"" + continueLink + "\">Continue Draft</a> or start a new one below.",
                    "alert-info",
                    true
                );
            }
            applyAuxMeta(context.user.id, "new");
        }

        const saveBtn = byId("saveDraftBtn");
        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                handleSaveDraft(context);
            });
        }

        const submitBtn = byId("submitApplicationBtn");
        if (submitBtn) {
            submitBtn.addEventListener("click", function () {
                handleSubmit(context);
            });
        }

        bindInlineValidation();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
