(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const TAX_DOC_TYPE = "income_certificate";
    const PHOTO_DOC_TYPE = "applicant_photo";

    const STATUS_LABELS = {
        draft: "Draft",
        submitted: "Submitted",
        under_secretary_review: "Under Secretary Review",
        interview_scheduled: "Interview Scheduled",
        recommended: "Recommended",
        for_admin_approval: "For Admin Approval",
        approved: "Approved",
        waitlisted: "Waitlisted",
        rejected: "Rejected",
        returned_for_correction: "Returned for Correction",
        certification_ready: "Certification Ready",
        release_scheduled: "Release Scheduled",
        released: "Released"
    };

    const TAX_DOC_STATUS_META = {
        pending: { label: "For Review", chipClass: "ldss-chip-accent" },
        verified: { label: "Verified", chipClass: "ldss-chip-success" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        needs_reupload: { label: "Needs Reupload", chipClass: "ldss-chip-danger" },
        missing: { label: "Missing", chipClass: "ldss-chip-neutral" }
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function valueOrDash(value) {
        const text = (value || "").toString().trim();
        return text || "-";
    }

    function setText(id, value) {
        const target = byId(id);
        if (!target) {
            return;
        }
        target.textContent = valueOrDash(value);
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function formatMoney(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "-";
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return valueOrDash(value);
        }
        return "PHP " + numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function showStatus(message, type) {
        const alert = byId("certStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.className = "alert d-none";
            alert.textContent = "";
            return;
        }
        alert.className = "alert " + (type || "alert-info");
        alert.textContent = message;
    }

    function buildApplicantName(profile) {
        const firstName = (profile && profile.first_name ? profile.first_name : "").toString().trim();
        const middleName = (profile && profile.middle_name ? profile.middle_name : "").toString().trim();
        const lastName = (profile && profile.last_name ? profile.last_name : "").toString().trim();
        const trailingNames = [firstName, middleName].filter(function (value) {
            return value.length > 0;
        }).join(" ");

        if (lastName && trailingNames) {
            return lastName + ", " + trailingNames;
        }

        return lastName || trailingNames || (profile && profile.email ? profile.email : "-");
    }

    function normalizeAddressSegment(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\.+$/g, "")
            .toLowerCase();
    }

    function cleanupAddressDisplay(value) {
        return (value || "")
            .toString()
            .replace(/\s*,\s*/g, ", ")
            .replace(/,\s*,+/g, ", ")
            .replace(/\s{2,}/g, " ")
            .replace(/^[,\s]+|[,\s]+$/g, "")
            .trim();
    }

    function dedupeAddressSegments(value) {
        const seen = new Set();
        return cleanupAddressDisplay(value)
            .split(",")
            .map(function (segment) {
                return cleanupAddressDisplay(segment);
            })
            .filter(function (segment) {
                const key = normalizeAddressSegment(segment);
                if (!key || seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
            .join(", ");
    }

    function normalizeBarangayDisplay(value) {
        const seen = new Set();
        return cleanupAddressDisplay(value)
            .split(",")
            .map(function (segment) {
                return cleanupAddressDisplay(segment);
            })
            .filter(function (segment) {
                const key = normalizeAddressSegment(segment);
                if (!key || key === "daet" || seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
            .join(", ");
    }

    function buildAddress(profile) {
        const address = dedupeAddressSegments(profile && profile.address ? profile.address : "");
        const barangay = normalizeBarangayDisplay(profile && profile.barangay ? profile.barangay : "");
        if (!address && !barangay) {
            return "-";
        }
        if (!address) {
            return barangay || "-";
        }
        if (!barangay) {
            return address;
        }

        const addressSegments = address
            .split(",")
            .map(normalizeAddressSegment)
            .filter(Boolean);
        const barangayKey = normalizeAddressSegment(barangay);
        if (barangayKey && addressSegments.includes(barangayKey)) {
            return address;
        }

        return cleanupAddressDisplay([address, barangay].filter(Boolean).join(", ")) || "-";
    }

    function statusLabel(status) {
        return STATUS_LABELS[status] || valueOrDash(status);
    }

    function applicationTypeLabel(type) {
        if (type === "renewal") {
            return "Renewal";
        }
        if (type === "new") {
            return "New Applicant";
        }
        return valueOrDash(type);
    }

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        return {
            id: params.get("id"),
            applicationNo: params.get("application_no")
        };
    }

    function normalizedLookup(raw) {
        const text = (raw || "").toString().trim();
        if (!text) {
            return { id: "", applicationNo: "" };
        }
        if (/^ldss-/i.test(text)) {
            return { id: "", applicationNo: text };
        }
        return { id: text, applicationNo: "" };
    }

    function setTaxChip(status) {
        const chip = byId("certTaxStatusChip");
        if (!chip) {
            return;
        }

        const meta = TAX_DOC_STATUS_META[status] || TAX_DOC_STATUS_META.missing;
        chip.className = "ldss-chip " + meta.chipClass;
        chip.textContent = meta.label;
    }

    function setTaxFileLink(url) {
        const link = byId("certTaxFileLink");
        if (!link) {
            return;
        }
        if (!url) {
            link.removeAttribute("href");
            link.classList.add("d-none");
            return;
        }
        link.href = url;
        link.classList.remove("d-none");
    }

    function setPhoto(url) {
        const image = byId("certApplicantPhoto");
        const placeholder = byId("certApplicantPhotoPlaceholder");
        if (!image || !placeholder) {
            return;
        }

        if (!url) {
            image.src = "";
            image.classList.add("d-none");
            placeholder.classList.remove("d-none");
            return;
        }

        image.src = url;
        image.classList.remove("d-none");
        placeholder.classList.add("d-none");
    }

    async function createSignedUrl(context, path) {
        if (!path) {
            return "";
        }
        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        return window.ldssUploads.createObjectUrl(context, path);
    }

    function latestDocumentsByType(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            const key = row.document_type;
            if (!key) {
                return;
            }
            if (!map[key]) {
                map[key] = row;
                return;
            }
            const existingTs = new Date(map[key].created_at || 0).getTime();
            const currentTs = new Date(row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[key] = row;
            }
        });
        return map;
    }

    async function fetchApplication(context, lookup) {
        const selectFields = "id, application_no, applicant_id, application_type, scholarship_type, school_year, status, submitted_at, created_at, updated_at";

        if (lookup && lookup.id) {
            const idResult = await context.client
                .from("applications")
                .select(selectFields)
                .eq("id", lookup.id)
                .maybeSingle();
            if (!idResult.error && idResult.data) {
                return idResult.data;
            }
        }

        if (lookup && lookup.applicationNo) {
            const noResult = await context.client
                .from("applications")
                .select(selectFields)
                .eq("application_no", lookup.applicationNo)
                .maybeSingle();
            if (!noResult.error && noResult.data) {
                return noResult.data;
            }
        }

        const latestNonDraft = await context.client
            .from("applications")
            .select(selectFields)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(1);

        if (!latestNonDraft.error && latestNonDraft.data && latestNonDraft.data.length > 0) {
            return latestNonDraft.data[0];
        }

        const latestAny = await context.client
            .from("applications")
            .select(selectFields)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (latestAny.error || !latestAny.data || latestAny.data.length === 0) {
            return null;
        }

        return latestAny.data[0];
    }

    async function fetchProfile(context, userId) {
        if (!userId) {
            return null;
        }

        const result = await context.client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, sex, civil_status, date_of_birth, barangay, address, email, mobile_number, school_name, course_or_strand, year_level, student_number, guardian_name, guardian_occupation, monthly_income, applicant_photo_path")
            .eq("id", userId)
            .maybeSingle();

        if (result.error) {
            return null;
        }

        return result.data || null;
    }

    async function fetchDocuments(context, applicationId) {
        if (!applicationId) {
            return [];
        }

        const result = await context.client
            .from("application_documents")
            .select("document_type, storage_path, original_filename, verification_status, created_at")
            .eq("application_id", applicationId)
            .in("document_type", [TAX_DOC_TYPE, PHOTO_DOC_TYPE]);

        if (result.error || !result.data) {
            return [];
        }

        return result.data;
    }

    function renderMeta(application, profile, taxDoc) {
        setText("certMetaApplicationNo", application ? application.application_no : "-");
        setText("certMetaApplicantName", profile ? buildApplicantName(profile) : "-");
        setText("certMetaUpdatedAt", application ? formatDateTime(application.updated_at) : "-");
        setTaxChip(taxDoc ? taxDoc.verification_status : "missing");
    }

    function renderPrintableData(application, profile, taxDoc) {
        setText("certApplicationNo", application ? application.application_no : "-");
        setText("certSubmittedAt", application ? formatDate(application.submitted_at || application.created_at) : "-");
        setText("certApplicationType", application ? applicationTypeLabel(application.application_type) : "-");
        setText("certApplicationStatus", application ? statusLabel(application.status) : "-");
        setText("certScholarshipType", application ? application.scholarship_type : "-");
        setText("certSchoolYear", application ? application.school_year : "-");

        setText("certFullName", profile ? buildApplicantName(profile) : "-");
        setText("certDateOfBirth", profile ? formatDate(profile.date_of_birth) : "-");
        setText("certSex", profile ? profile.sex : "-");
        setText("certCivilStatus", profile ? profile.civil_status : "-");
        setText("certEmail", profile ? profile.email : "-");
        setText("certMobileNumber", profile ? profile.mobile_number : "-");
        setText("certAddress", profile ? buildAddress(profile) : "-");

        setText("certSchoolName", profile ? profile.school_name : "-");
        setText("certStudentNumber", profile ? profile.student_number : "-");
        setText("certCourse", profile ? profile.course_or_strand : "-");
        setText("certYearLevel", profile ? profile.year_level : "-");
        setText("certGuardianName", profile ? profile.guardian_name : "-");
        setText("certGuardianOccupation", profile ? profile.guardian_occupation : "-");
        setText("certMonthlyIncome", profile ? formatMoney(profile.monthly_income) : "-");
        setText("certBarangay", profile ? profile.barangay : "-");

        if (!taxDoc) {
            setText("certTaxRequirementValue", "Not uploaded");
            setText("certTaxRequirementStatus", "Missing");
            return;
        }

        const uploadLabel = taxDoc.original_filename
            ? ("Uploaded: " + taxDoc.original_filename)
            : "Uploaded";
        setText("certTaxRequirementValue", uploadLabel);
        setText("certTaxRequirementStatus", TAX_DOC_STATUS_META[taxDoc.verification_status]
            ? TAX_DOC_STATUS_META[taxDoc.verification_status].label
            : valueOrDash(taxDoc.verification_status));
    }

    async function loadRecord(context, lookup, requestedByUser) {
        showStatus("Loading application record...", "alert-info");

        const application = await fetchApplication(context, lookup || {});
        if (!application) {
            renderMeta(null, null, null);
            renderPrintableData(null, null, null);
            setTaxFileLink("");
            setPhoto("");
            showStatus("No application records found.", "alert-warning");
            return;
        }

        const [profile, docs] = await Promise.all([
            fetchProfile(context, application.applicant_id),
            fetchDocuments(context, application.id)
        ]);

        const latestDocs = latestDocumentsByType(docs);
        const taxDoc = latestDocs[TAX_DOC_TYPE] || null;
        const photoDoc = latestDocs[PHOTO_DOC_TYPE] || null;

        const applicantPhotoPath = (profile && profile.applicant_photo_path)
            || (photoDoc ? photoDoc.storage_path : "");
        const taxFilePath = taxDoc ? taxDoc.storage_path : "";

        const [photoUrl, taxFileUrl] = await Promise.all([
            createSignedUrl(context, applicantPhotoPath),
            createSignedUrl(context, taxFilePath)
        ]);

        renderMeta(application, profile, taxDoc);
        renderPrintableData(application, profile, taxDoc);
        setPhoto(photoUrl);
        setTaxFileLink(taxFileUrl);

        if (requestedByUser) {
            showStatus("Loaded " + application.application_no + " successfully.", "alert-success");
        } else {
            showStatus("");
        }
    }

    function bindActions(context) {
        const loadBtn = byId("certLoadBtn");
        const latestBtn = byId("certLoadLatestBtn");
        const printBtn = byId("certPrintBtn");
        const searchInput = byId("certSearchInput");

        if (loadBtn) {
            loadBtn.addEventListener("click", function () {
                const lookup = normalizedLookup(searchInput ? searchInput.value : "");
                if (!lookup.id && !lookup.applicationNo) {
                    showStatus("Enter an application ID or number, or use Load Latest.", "alert-warning");
                    return;
                }
                loadRecord(context, lookup, true);
            });
        }

        if (latestBtn) {
            latestBtn.addEventListener("click", function () {
                if (searchInput) {
                    searchInput.value = "";
                }
                loadRecord(context, {}, true);
            });
        }

        if (printBtn) {
            printBtn.addEventListener("click", function () {
                window.print();
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client) {
            return;
        }

        bindActions(context);

        const query = parseQuery();
        const autoLookup = query.id
            ? { id: query.id, applicationNo: "" }
            : (query.applicationNo ? { id: "", applicationNo: query.applicationNo } : {});

        if (autoLookup.id || autoLookup.applicationNo) {
            const input = byId("certSearchInput");
            if (input) {
                input.value = autoLookup.id || autoLookup.applicationNo;
            }
            await loadRecord(context, autoLookup, false);
            return;
        }

        await loadRecord(context, {}, false);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
