(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const TAX_DOC_TYPE = "income_certificate";
    const PHOTO_DOC_TYPE = "applicant_photo";
    const PRINT_READY_STATUSES = [
        "passed_exam",
        "failed_exam",
        "special_endorsement_review",
        "for_interview",
        "interview_scheduled",
        "interview_completed",
        "hard_copy_verified",
        "for_approval",
        "approved",
        "waitlisted",
        "rejected",
        "for_release",
        "released"
    ];

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

    function workflow() {
        return window.LDSS_WORKFLOW || {
            statusMeta: function (status) {
                return {
                    label: (status || "-").toString().replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); }),
                    chipClass: "ldss-chip-neutral"
                };
            }
        };
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
        const alert = byId("secretaryPrintStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.className = "alert d-none ldss-print-hide";
            alert.textContent = "";
            return;
        }
        alert.className = "alert ldss-print-hide " + (type || "alert-info");
        alert.textContent = message;
    }

    function buildApplicantName(profile) {
        const parts = [profile && profile.first_name, profile && profile.middle_name, profile && profile.last_name]
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });
        const fullName = parts.join(" ");
        return fullName || (profile && profile.email ? profile.email : "-");
    }

    function buildAddress(profile) {
        const address = profile && profile.address ? profile.address : "";
        const barangay = profile && profile.barangay ? profile.barangay : "";
        return [address, barangay].filter(Boolean).join(", ") || "-";
    }

    function statusLabel(status) {
        return workflow().statusMeta(status || "").label;
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
        const chip = byId("secretaryPrintTaxChip");
        if (!chip) {
            return;
        }
        const meta = TAX_DOC_STATUS_META[status] || TAX_DOC_STATUS_META.missing;
        chip.className = "ldss-chip " + meta.chipClass;
        chip.textContent = meta.label;
    }

    function setTaxFileLink(url) {
        const link = byId("secretaryPrintTaxLink");
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
        const image = byId("secretarySheetPhoto");
        const placeholder = byId("secretarySheetPhotoPlaceholder");
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

    function setPrintAvailability(status) {
        const printBtn = byId("secretaryPrintBtn");
        if (!printBtn) {
            return;
        }

        const ready = PRINT_READY_STATUSES.includes(status || "");
        printBtn.disabled = !ready;
        if (ready) {
            printBtn.removeAttribute("title");
            return;
        }
        printBtn.title = "Printing is enabled after exam or interview stage onward.";
    }

    async function createSignedUrl(context, path) {
        if (!path) {
            return "";
        }
        const result = await context.client.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(path, 60 * 30);

        if (result.error || !result.data || !result.data.signedUrl) {
            return "";
        }
        return result.data.signedUrl;
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

        const latestResult = await context.client
            .from("applications")
            .select(selectFields)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (latestResult.error || !latestResult.data || latestResult.data.length === 0) {
            return null;
        }

        return latestResult.data[0];
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
        setText("secretaryPrintApplicationNo", application ? application.application_no : "-");
        setText("secretaryPrintApplicantName", profile ? buildApplicantName(profile) : "-");
        setText("secretaryPrintUpdatedAt", application ? formatDateTime(application.updated_at) : "-");
        setTaxChip(taxDoc ? taxDoc.verification_status : "missing");
        setPrintAvailability(application ? application.status : "");
    }

    function renderSheet(application, profile, taxDoc) {
        setText("sheetApplicationNo", application ? application.application_no : "-");
        setText("sheetDateFiled", application ? formatDate(application.submitted_at || application.created_at) : "-");
        setText("sheetScholarshipType", application ? application.scholarship_type : "-");
        setText("sheetSchoolYear", application ? application.school_year : "-");
        setText("sheetApplicationType", application ? applicationTypeLabel(application.application_type) : "-");
        setText("sheetCurrentStatus", application ? statusLabel(application.status) : "-");

        setText("sheetFullName", profile ? buildApplicantName(profile) : "-");
        setText("sheetDateOfBirth", profile ? formatDate(profile.date_of_birth) : "-");
        setText("sheetSex", profile ? profile.sex : "-");
        setText("sheetCivilStatus", profile ? profile.civil_status : "-");
        setText("sheetAddress", profile ? buildAddress(profile) : "-");
        setText("sheetContact", profile ? profile.mobile_number : "-");
        setText("sheetEmail", profile ? profile.email : "-");

        setText("sheetSchoolName", profile ? profile.school_name : "-");
        setText("sheetYearLevel", profile ? profile.year_level : "-");
        setText("sheetCourse", profile ? profile.course_or_strand : "-");
        setText("sheetStudentNumber", profile ? profile.student_number : "-");

        setText("sheetFatherGuardian", profile ? profile.guardian_name : "-");
        setText("sheetFatherOccupation", profile ? profile.guardian_occupation : "-");
        setText("sheetGrossIncome", profile ? formatMoney(profile.monthly_income) : "-");

        if (!taxDoc) {
            setText("sheetTaxRequirement", "Not uploaded");
            setText("sheetTaxStatus", "Missing");
            return;
        }

        const fileLabel = taxDoc.original_filename ? ("Uploaded: " + taxDoc.original_filename) : "Uploaded";
        setText("sheetTaxRequirement", fileLabel);
        setText("sheetTaxStatus", TAX_DOC_STATUS_META[taxDoc.verification_status]
            ? TAX_DOC_STATUS_META[taxDoc.verification_status].label
            : valueOrDash(taxDoc.verification_status));
    }

    async function loadRecord(context, lookup, requestedByUser) {
        showStatus("Loading application record...", "alert-info");

        const application = await fetchApplication(context, lookup || {});
        if (!application) {
            renderMeta(null, null, null);
            renderSheet(null, null, null);
            setPhoto("");
            setTaxFileLink("");
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

        const applicantPhotoPath = (profile && profile.applicant_photo_path) || (photoDoc ? photoDoc.storage_path : "");
        const taxFilePath = taxDoc ? taxDoc.storage_path : "";

        const [photoUrl, taxUrl] = await Promise.all([
            createSignedUrl(context, applicantPhotoPath),
            createSignedUrl(context, taxFilePath)
        ]);

        renderMeta(application, profile, taxDoc);
        renderSheet(application, profile, taxDoc);
        setPhoto(photoUrl);
        setTaxFileLink(taxUrl);

        if (!PRINT_READY_STATUSES.includes(application.status || "")) {
            showStatus(
                "This record is still before exam/interview flow. Print is enabled once exam stage begins.",
                "alert-warning"
            );
            return;
        }

        if (requestedByUser) {
            showStatus("Loaded " + application.application_no + " successfully.", "alert-success");
        } else {
            showStatus("");
        }
    }

    function bindActions(context) {
        const loadBtn = byId("secretaryPrintLoadBtn");
        const latestBtn = byId("secretaryPrintLoadLatestBtn");
        const printBtn = byId("secretaryPrintBtn");
        const searchInput = byId("secretaryPrintSearchInput");

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
                if (printBtn.disabled) {
                    return;
                }
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
            const input = byId("secretaryPrintSearchInput");
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
