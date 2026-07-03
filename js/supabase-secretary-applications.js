(function () {
    "use strict";

    const DEFAULT_PAGE_SIZE = 10;
    const MAX_PAGE_SIZE = 100;
    const PROFILE_BATCH_SIZE = 120;
    const SUPABASE_FETCH_LIMIT = 1000;
    const SECONDARY_LOAD_DELAY_MS = 80;
    const SETTINGS_STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const VERIFICATION_QUEUE_STORAGE_KEY = "ldss:secretary-verification-queue:v1";
    const WALK_IN_API_PATH = "/api/secretary/walk-in-intake";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const NO_BARANGAY_FILTER_VALUE = "__no_barangay__";
    const NO_BARANGAY_FILTER_LABEL = "No Barangay";
    const NO_REQUIREMENTS_BATCH_FILTER_VALUE = "__no_requirements_batch__";
    const REQUIREMENTS_VIEW = "requirements";
    const LEGACY_SUBMITTED_REQUIREMENTS_VIEW = "submitted_requirements";
    const HARD_COPY_REQUIREMENTS_PAYLOAD_KEY = "hard_copy_requirements";
    const REQUIREMENTS_STATUS_PENDING = "pending";
    const REQUIREMENTS_STATUS_RECEIVED = "received";
    const REQUIREMENTS_STATUS_NEEDS_CORRECTION = "needs_correction";
    const REQUIREMENTS_STATUS_MISSING = "missing";
    const REQUIREMENTS_STATUS_VALUES = new Set([
        REQUIREMENTS_STATUS_PENDING,
        REQUIREMENTS_STATUS_RECEIVED,
        REQUIREMENTS_STATUS_NEEDS_CORRECTION,
        REQUIREMENTS_STATUS_MISSING
    ]);
    const REQUIREMENTS_STATUS_META = {
        pending: { label: "For Review", chipClass: "ldss-chip-accent" },
        received: { label: "Received", chipClass: "ldss-chip-success" },
        needs_correction: { label: "Needs Correction", chipClass: "ldss-chip-danger" },
        missing: { label: "Missing", chipClass: "ldss-chip-danger" }
    };
    const HARD_COPY_REQUIREMENTS = [
        { key: "application_form", label: "Application Form" },
        { key: "birth_certificate", label: "Birth Certificate" },
        { key: "certification_of_residency", label: "Certification of Residency", fallbackDocumentType: "barangay_certificate" },
        { key: "comelec_voters_certification", label: "COMELEC Voter's Certification" },
        { key: "good_moral_character", label: "Good Moral Character (Certified True Copy)" },
        { key: "form_138", label: "Form 138 (Certified True Copy)", fallbackDocumentType: "report_card" },
        { key: "mswd_certification", label: "Certified True Copy of MSWD" },
        { key: "bir_income_tax_or_tax_exemption", label: "BIR Income Tax Return / Tax Exemption", fallbackDocumentType: "income_certificate" },
        { key: "notarized_sworn_affidavit", label: "Notarized Sworn Affidavit" }
    ];
    const REQUIREMENTS_SAVE_LABEL_IDLE = "Save Checklist";
    const REQUIREMENTS_SAVE_LABEL_BUSY = "Saving...";
    const DEFAULT_WALK_IN_SCHOLARSHIP_TYPE = "Revised Daet Expanded Scholarship Program";
    const DEFAULT_WORKFLOW_CONTROLS = {
        allow_secretary_draft_completion: false,
        allow_secretary_walk_in_intake: false
    };
    const DAET_BARANGAYS = [
        "Alawihao",
        "Awitan",
        "Bagasbas",
        "Barangay I",
        "Barangay II",
        "Barangay III",
        "Barangay IV",
        "Barangay V",
        "Barangay VI",
        "Barangay VII",
        "Barangay VIII",
        "Bibirao",
        "Borabod",
        "Calasgasan",
        "Camambugan",
        "Cobangbang",
        "Dogongan",
        "Gahonon",
        "Gubat",
        "Lag-on",
        "Magang",
        "Mambalite",
        "Mancruz",
        "Pamorangon",
        "San Isidro"
    ];
    const DAET_BARANGAY_ALIASES = {
        "Barangay I": ["BRGY I", "BRGY 1", "BARANGAY 1"],
        "Barangay II": ["BRGY II", "BRGY 2", "BARANGAY 2"],
        "Barangay III": ["BRGY III", "BRGY 3", "BARANGAY 3"],
        "Barangay IV": ["BRGY IV", "BRGY 4", "BARANGAY 4"],
        "Barangay V": ["BRGY V", "BRGY 5", "BARANGAY 5"],
        "Barangay VI": ["BRGY VI", "BRGY 6", "BARANGAY 6"],
        "Barangay VII": ["BRGY VII", "BRGY 7", "BARANGAY 7"],
        "Barangay VIII": ["BRGY VIII", "BRGY 8", "BARANGAY 8"]
    };
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let pageSize = DEFAULT_PAGE_SIZE;
    let barangayLookup = null;
    let authContext = null;
    let workflowControls = Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
    let walkInModalInstance = null;
    let bulkForExamModalInstance = null;
    let walkInSubmitting = false;
    let bulkForExamSubmitting = false;
    let applicationsLoadToken = 0;
    let selectedRequirementsApplicationId = "";
    let requirementsDocumentsByApplicationId = {};
    let requirementsAuxPayloadByApplicationId = {};
    let requirementsSavingApplicationId = "";
    let requirementsPrintModalInstance = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function currentView() {
        try {
            const params = new URLSearchParams(window.location.search || "");
            return (params.get("view") || "").toString().trim().toLowerCase();
        } catch (_error) {
            return "";
        }
    }

    function isSubmittedRequirementsView() {
        const view = currentView();
        return view === REQUIREMENTS_VIEW
            || view === LEGACY_SUBMITTED_REQUIREMENTS_VIEW
            || view === "submitted_applications";
    }

    function upperText(value) {
        return (value || "").toString().trim().toUpperCase();
    }

    function bindUppercaseInput(inputId) {
        const input = byId(inputId);
        if (!input) {
            return;
        }

        input.addEventListener("input", function () {
            const upperValue = (input.value || "").toString().toUpperCase();
            if (input.value !== upperValue) {
                input.value = upperValue;
            }
        });
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: status || "-", chipClass: "ldss-chip-neutral" }; }
        };
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function cleanupLookupKey(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function cleanupBarangayKey(value) {
        return cleanupLookupKey((value || "")
            .toString()
            .replace(/,\s*daet$/i, ""));
    }

    function getBarangayLookup() {
        if (barangayLookup) {
            return barangayLookup;
        }

        barangayLookup = {};
        DAET_BARANGAYS.forEach(function (barangay) {
            const variants = [barangay].concat(DAET_BARANGAY_ALIASES[barangay] || []);
            if (!/^barangay\s+/i.test(barangay)) {
                variants.push("Barangay " + barangay);
            }
            variants.forEach(function (variant) {
                barangayLookup[cleanupBarangayKey(variant)] = barangay;
                barangayLookup[cleanupBarangayKey(variant + ", Daet")] = barangay;
            });
        });
        return barangayLookup;
    }

    function normalizeBarangay(value) {
        const key = cleanupBarangayKey(value);
        if (!key) {
            return "";
        }
        return getBarangayLookup()[key] || "";
    }

    function showStatus(message, type) {
        const alert = byId("secretaryApplicationsStatus");
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

    function applyViewMeta() {
        if (!isSubmittedRequirementsView()) {
            return;
        }

        document.body.classList.add("ldss-secretary-requirements-view");

        const pageTitle = byId("secretaryApplicationsPageTitle");
        const pageSubtitle = byId("secretaryApplicationsPageSubtitle");
        const breadcrumbCurrent = byId("secretaryApplicationsBreadcrumbCurrent");
        const queueTitle = byId("secretaryApplicationsQueueTitle");
        const queueHeading = queueTitle && queueTitle.parentElement
            ? queueTitle.parentElement
            : null;
        const bulkButton = byId("secretaryBulkForExamBtn");
        const bulkMeta = byId("secretaryBulkForExamMeta");
        const actionShell = byId("secretaryApplicationsActionShell");
        const filterShell = byId("secretaryApplicationsFilterShell");
        const requirementsFilterShell = byId("secretaryRequirementsFilterShell");
        const requirementsSummaryShell = byId("secretaryRequirementsSummaryShell");
        const queueMainCol = byId("secretaryApplicationsQueueMainCol");
        const queueShell = byId("secretaryApplicationsQueueShell");

        document.title = "LDSP | Requirements";

        if (pageTitle) {
            pageTitle.innerHTML = '<div class="page-header-icon"><i data-feather="layers"></i></div>Requirements';
        }
        if (pageSubtitle) {
            pageSubtitle.textContent = "Track hard-copy requirement progress at a glance.";
        }
        if (breadcrumbCurrent) {
            breadcrumbCurrent.textContent = "Requirements";
        }
        if (queueHeading) {
            queueHeading.classList.add("d-none");
        }
        if (bulkButton) {
            bulkButton.classList.add("d-none");
        }
        if (bulkMeta) {
            bulkMeta.textContent = "";
            bulkMeta.classList.add("d-none");
        }
        if (actionShell) {
            actionShell.classList.add("d-none");
        }
        if (filterShell) {
            filterShell.classList.add("d-none");
        }
        if (requirementsFilterShell) {
            requirementsFilterShell.classList.remove("d-none");
        }
        if (requirementsSummaryShell) {
            requirementsSummaryShell.classList.remove("d-none");
        }
        if (queueMainCol) {
            queueMainCol.classList.remove("col-xl-12");
            queueMainCol.classList.remove("col-xl-9");
            queueMainCol.classList.add("col-xl-8");
        }
        if (queueShell) {
            queueShell.classList.remove("d-none");
        }

        if (window.feather && typeof window.feather.replace === "function") {
            window.feather.replace();
        }
    }

    function renderTableHead() {
        const thead = byId("secretaryApplicationsTableHead");
        if (!thead) {
            return;
        }

        if (isSubmittedRequirementsView()) {
            thead.innerHTML = (
                "<tr>" +
                "<th>Applicant</th>" +
                "<th>Sector Classification</th>" +
                "<th>Status</th>" +
                "<th>View Data</th>" +
                "</tr>"
            );
            return;
        }

        thead.innerHTML = (
            "<tr>" +
            "<th>Applicant</th>" +
            "<th>Application ID</th>" +
            "<th>Sector Classification</th>" +
            "<th>Submitted</th>" +
            "<th>Status</th>" +
            "<th>Action</th>" +
            "</tr>"
        );
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
        });
    }

    function getStoredRankingSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function readFallbackWorkflowControls() {
        const settings = getStoredRankingSettings();
        const controls = settings && settings.ranking_basis && settings.ranking_basis.controls
            ? settings.ranking_basis.controls
            : {};
        return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS, controls);
    }

    function readFallbackSchoolYear() {
        const settings = getStoredRankingSettings();
        return settings && settings.school_year
            ? (settings.school_year || "").toString().trim()
            : "";
    }

    async function loadWorkflowControls(context) {
        const fallback = readFallbackWorkflowControls();
        const rpcResult = await context.client.rpc("active_workflow_controls");
        if (!rpcResult.error && rpcResult.data && typeof rpcResult.data === "object") {
            workflowControls = Object.assign({}, fallback, rpcResult.data);
            return workflowControls;
        }

        if (rpcResult.error && !/does not exist|function|permission/i.test(rpcResult.error.message || "")) {
            throw new Error("Failed to load workflow controls: " + rpcResult.error.message);
        }

        workflowControls = fallback;
        return workflowControls;
    }

    async function getAccessToken() {
        if (!authContext || !authContext.client || !authContext.client.auth || typeof authContext.client.auth.getSession !== "function") {
            throw new Error("Supabase session is not available.");
        }

        const result = await authContext.client.auth.getSession();
        const session = result && result.data ? result.data.session : null;
        const token = session && session.access_token ? session.access_token : "";
        if (!token) {
            throw new Error("No active access token found. Please sign in again.");
        }
        return token;
    }

    async function requestJson(path, options) {
        const token = await getAccessToken();
        const fetchOptions = Object.assign({ method: "GET" }, options || {});
        const headers = new Headers(fetchOptions.headers || {});
        headers.set("Authorization", "Bearer " + token);
        fetchOptions.headers = headers;

        const response = await fetch(path, fetchOptions);
        const responseText = await response.text();
        let payload = null;

        if (responseText) {
            try {
                payload = JSON.parse(responseText);
            } catch (_error) {
                payload = null;
            }
        }

        if (!response.ok) {
            const fallbackMessage = response.status === 404
                ? "Walk-in intake API route was not found. Open the site through the Node server."
                : "Request failed.";
            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
    }

    function getWalkInModal() {
        if (!walkInModalInstance) {
            const modalEl = byId("secretaryWalkInModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                walkInModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return walkInModalInstance;
    }

    function getBulkForExamModal() {
        if (!bulkForExamModalInstance) {
            const modalEl = byId("secretaryBulkForExamModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                bulkForExamModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return bulkForExamModalInstance;
    }

    function buildPersonName(person) {
        const first = upperText(person && person.first_name ? person.first_name : person && person.firstName ? person.firstName : "");
        const middle = upperText(person && person.middle_name ? person.middle_name : person && person.middleName ? person.middleName : "");
        const last = upperText(person && person.last_name ? person.last_name : person && person.lastName ? person.lastName : "");
        return [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    function setWalkInStatus(message, type) {
        const box = byId("secretaryWalkInStatus");
        if (!box) {
            return;
        }
        if (!message) {
            box.className = "alert d-none";
            box.textContent = "";
            return;
        }
        box.className = "alert " + (type || "alert-info");
        box.textContent = message;
    }

    function setWalkInResultMarkup(markup) {
        const box = byId("secretaryWalkInResult");
        if (!box) {
            return;
        }
        if (!markup) {
            box.className = "d-none";
            box.innerHTML = "";
            return;
        }
        box.className = "border rounded-3 p-3 bg-light";
        box.innerHTML = markup;
    }

    function syncWalkInAction() {
        const actionButton = byId("secretaryWalkInBtn");
        const actionLead = byId("secretaryWalkInLead");
        const isEnabled = workflowControls.allow_secretary_walk_in_intake === true;

        if (actionButton) {
            actionButton.classList.toggle("d-none", !isEnabled);
            actionButton.disabled = !isEnabled || walkInSubmitting;
        }
        if (actionLead) {
            actionLead.classList.toggle("d-none", !isEnabled);
        }
    }

    function applyWalkInDefaults() {
        const schoolYearInput = byId("secretaryWalkInSchoolYear");
        const scholarshipInput = byId("secretaryWalkInScholarshipType");
        const sectorSelect = byId("secretaryWalkInSectorClassification");

        if (schoolYearInput && !schoolYearInput.value.trim()) {
            schoolYearInput.value = readFallbackSchoolYear();
        }
        if (scholarshipInput && !scholarshipInput.value.trim()) {
            scholarshipInput.value = DEFAULT_WALK_IN_SCHOLARSHIP_TYPE;
        }
        if (sectorSelect && !sectorSelect.value) {
            sectorSelect.value = "";
        }
    }

    function setWalkInBusy(isBusy) {
        const form = byId("secretaryWalkInForm");
        const submitButton = byId("secretaryWalkInSubmitBtn");
        walkInSubmitting = Boolean(isBusy);

        if (form) {
            Array.from(form.querySelectorAll("input, select, textarea")).forEach(function (control) {
                control.disabled = walkInSubmitting;
            });
        }
        if (submitButton) {
            submitButton.disabled = walkInSubmitting;
            submitButton.textContent = walkInSubmitting ? "Creating Walk-In Record..." : "Create Walk-In Record";
        }

        syncWalkInAction();
    }

    function resetWalkInForm() {
        const form = byId("secretaryWalkInForm");
        if (form) {
            form.reset();
        }
        setWalkInBusy(false);
        setWalkInStatus("");
        setWalkInResultMarkup("");
        applyWalkInDefaults();
    }

    function collectWalkInPayload() {
        const payload = {
            firstName: upperText(byId("secretaryWalkInFirstName") && byId("secretaryWalkInFirstName").value || ""),
            middleName: upperText(byId("secretaryWalkInMiddleName") && byId("secretaryWalkInMiddleName").value || ""),
            lastName: upperText(byId("secretaryWalkInLastName") && byId("secretaryWalkInLastName").value || ""),
            email: (byId("secretaryWalkInEmail") && byId("secretaryWalkInEmail").value || "").trim().toLowerCase(),
            mobileNumber: (byId("secretaryWalkInMobile") && byId("secretaryWalkInMobile").value || "").trim(),
            schoolYear: (byId("secretaryWalkInSchoolYear") && byId("secretaryWalkInSchoolYear").value || "").trim(),
            scholarshipType: (byId("secretaryWalkInScholarshipType") && byId("secretaryWalkInScholarshipType").value || "").trim(),
            sectorClassification: (byId("secretaryWalkInSectorClassification") && byId("secretaryWalkInSectorClassification").value || "").trim(),
            officeNote: (byId("secretaryWalkInOfficeNote") && byId("secretaryWalkInOfficeNote").value || "").trim()
        };

        if (!payload.firstName || !payload.lastName || !payload.email || !payload.mobileNumber) {
            throw new Error("First name, last name, email, and mobile number are required.");
        }
        if (payload.schoolYear && !/^\d{4}-\d{4}$/.test(payload.schoolYear)) {
            throw new Error("School year must follow YYYY-YYYY format.");
        }
        if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
            throw new Error("Enter a valid email address.");
        }

        payload.scholarshipType = payload.scholarshipType || DEFAULT_WALK_IN_SCHOLARSHIP_TYPE;
        return payload;
    }

    function renderWalkInResult(payload) {
        const response = payload && typeof payload === "object" ? payload : {};
        const applicant = response.applicant && typeof response.applicant === "object" ? response.applicant : {};
        const application = response.application && typeof response.application === "object" ? response.application : {};
        const applicantName = buildPersonName(applicant) || "Applicant";
        const actionLabel = response.user_created ? "New applicant account created" : "Existing applicant account reused";
        const temporaryPassword = (response.temporary_password || "").toString().trim();
        const verificationHref = application.id
            ? ("secretary-interview-verification.html?id=" + encodeURIComponent(application.id))
            : "";
        const temporaryPasswordMarkup = temporaryPassword
            ? (
                '<div class="border rounded-3 bg-white p-3 mt-3">' +
                '<div class="small text-muted">Temporary Password</div>' +
                '<div class="fw-semibold font-monospace mt-1">' + escapeHtml(temporaryPassword) + "</div>" +
                '<div class="small text-muted mt-2">Share this securely with the applicant so they can sign in later and change the password. If the office forgets it later, System Administrator can generate a new office temporary password until the account is claimed.</div>' +
                "</div>"
            )
            : '<div class="small text-muted mt-3">No temporary password was generated because this walk-in used an existing applicant account.</div>';

        setWalkInResultMarkup(
            '<div class="d-flex flex-column flex-lg-row align-items-lg-start justify-content-between gap-3">' +
                '<div>' +
                    '<div class="small text-uppercase text-muted fw-semibold">' + escapeHtml(actionLabel) + "</div>" +
                    '<div class="h5 mb-1">' + escapeHtml(applicantName) + "</div>" +
                    '<div class="small text-muted">Application No.: ' + escapeHtml(application.application_no || "-") + "</div>" +
                    '<div class="small text-muted">School Year: ' + escapeHtml(application.school_year || "-") + "</div>" +
                    '<div class="small text-muted">Email: ' + escapeHtml(applicant.email || "-") + "</div>" +
                    '<div class="small text-muted">Mobile: ' + escapeHtml(applicant.mobile_number || "-") + "</div>" +
                "</div>" +
                (verificationHref
                    ? ('<a class="btn btn-dark btn-sm" href="' + escapeHtml(verificationHref) + '">Open Verification Record</a>')
                    : "") +
            "</div>" +
            temporaryPasswordMarkup
        );
    }

    function handleOpenWalkInModal() {
        if (workflowControls.allow_secretary_walk_in_intake !== true) {
            showStatus("Walk-in intake is currently disabled by Scholarship Settings.", "alert-warning");
            return;
        }

        resetWalkInForm();
        const modal = getWalkInModal();
        if (!modal) {
            showStatus("Walk-in intake modal could not be opened on this page.", "alert-danger");
            return;
        }
        modal.show();
    }

    async function handleWalkInSubmit(event) {
        event.preventDefault();
        if (walkInSubmitting) {
            return;
        }

        try {
            const payload = collectWalkInPayload();
            setWalkInStatus("");
            setWalkInResultMarkup("");
            setWalkInBusy(true);

            const result = await requestJson(WALK_IN_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            renderWalkInResult(result);
            setWalkInStatus("Walk-in application created. Save any login details below before closing this window.", "alert-success");

            await loadApplications(authContext);
            showStatus("Walk-in application created for " + (buildPersonName(result.applicant || payload) || "the applicant") + ".", "alert-success");
        } catch (error) {
            setWalkInStatus(error && error.message ? error.message : "Walk-in intake failed.", "alert-danger");
        } finally {
            setWalkInBusy(false);
        }
    }

    function isCorrectionNotification(row) {
        const title = (row && row.title ? row.title : "").toString().trim().toLowerCase();
        const message = (row && row.message ? row.message : "").toString().trim().toLowerCase();
        return title.indexOf("returned for correction") !== -1 ||
            title.indexOf("compliance notice") !== -1 ||
            title.indexOf("photo needs change") !== -1 ||
            message.indexOf("returned for correction") !== -1 ||
            message.indexOf("need to comply") !== -1 ||
            message.indexOf("replace your applicant 1x1 photo") !== -1;
    }

    function correctionNoticeLabel(notice, row) {
        const title = (notice && notice.title ? notice.title : "").toString().trim().toLowerCase();
        const status = normalizeStatus(row && row.status);

        if (title.indexOf("photo needs change") !== -1) {
            return "Photo Change";
        }
        if (title.indexOf("compliance notice") !== -1) {
            return "Compliance Notice";
        }
        if (title.indexOf("returned for correction") !== -1 || status === "returned_for_correction") {
            return "Returned for Correction";
        }
        return "Correction Notice";
    }

    async function loadLatestCorrectionNoticesByApplicationIds(context, applicationIds) {
        const noticeMap = {};
        let lastErrorMessage = "";

        for (let start = 0; start < applicationIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicationIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const result = await context.client
                .from("notifications")
                .select("related_application_id, notification_type, title, message, created_at")
                .in("related_application_id", batchIds)
                .in("notification_type", ["application", "reminder"])
                .order("created_at", { ascending: false });

            if (result.error) {
                lastErrorMessage = result.error.message || "";
                continue;
            }

            (result.data || []).forEach(function (row) {
                const applicationId = (row.related_application_id || "").toString().trim();
                if (!applicationId || !isCorrectionNotification(row)) {
                    return;
                }

                const existing = noticeMap[applicationId];
                const currentTime = row.created_at ? new Date(row.created_at).getTime() : 0;
                const existingTime = existing && existing.created_at ? new Date(existing.created_at).getTime() : 0;
                if (!existing || currentTime > existingTime) {
                    noticeMap[applicationId] = row;
                }
            });
        }

        return {
            noticeMap: noticeMap,
            errorMessage: lastErrorMessage
        };
    }

    function hasApplicationUpdatedSinceNotice(application, notice) {
        const status = normalizeStatus(application && application.status);
        const noticeAt = new Date(notice && notice.created_at ? notice.created_at : 0).getTime();
        const applicationUpdatedAt = new Date(
            (application && (application.updated_at || application.created_at)) || 0
        ).getTime();

        return !!(
            notice &&
            noticeAt &&
            applicationUpdatedAt &&
            applicationUpdatedAt > noticeAt &&
            status !== "returned_for_correction"
        );
    }

    function isResubmittedForCheck(application, notice) {
        return normalizeStatus(application && application.status) === "submitted" &&
            hasApplicationUpdatedSinceNotice(application, notice);
    }

    function storeVerificationQueue(rows) {
        try {
            const ids = (rows || []).map(function (row) {
                return row && row.id ? row.id : "";
            }).filter(Boolean);
            sessionStorage.setItem(VERIFICATION_QUEUE_STORAGE_KEY, JSON.stringify({
                ids: ids,
                stored_at: new Date().toISOString()
            }));
        } catch (_error) {
            // Non-fatal: sessionStorage may be unavailable.
        }
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function buildApplicantName(profile) {
        const first = upperText(profile && profile.first_name ? profile.first_name : "");
        const middle = upperText(profile && profile.middle_name ? profile.middle_name : "");
        const last = upperText(profile && profile.last_name ? profile.last_name : "");
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        return "Unknown Applicant";
    }

    async function loadProfilesByIds(context, applicantIds) {
        const profileMap = {};
        let failedBatchCount = 0;
        let lastErrorMessage = "";

        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, barangay")
                .in("id", batchIds);

            if (profileResult.error) {
                failedBatchCount += 1;
                lastErrorMessage = profileResult.error.message || "";
                continue;
            }

            (profileResult.data || []).forEach(function (profile) {
                profileMap[profile.id] = profile;
            });
        }

        return {
            profileMap: profileMap,
            failedBatchCount: failedBatchCount,
            lastErrorMessage: lastErrorMessage
        };
    }

    async function fetchAllApplications(context) {
        const rows = [];
        const includeDrafts = workflowControls.allow_secretary_draft_completion === true;

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            let query = context.client
                .from("applications")
                .select("id, application_no, applicant_id, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (isSubmittedRequirementsView()) {
                query = query.neq("status", "draft");
            } else {
                const queueStatuses = includeDrafts
                    ? ["draft", "submitted", "returned_for_correction"]
                    : ["submitted", "returned_for_correction"];
                query = query.in("status", queueStatuses);
            }

            const result = await query;

            if (result.error) {
                return {
                    data: rows,
                    error: result.error
                };
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        return {
            data: rows,
            error: null
        };
    }

    async function loadExamBatchLabelsByApplicationIds(context, applicationIds) {
        const recordBatchMap = {};
        const batchLabelLookup = {};
        let lastErrorMessage = "";

        for (let start = 0; start < applicationIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicationIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const recordResult = await context.client
                .from("exam_records")
                .select("application_id, batch_id")
                .in("application_id", batchIds);

            if (recordResult.error) {
                lastErrorMessage = recordResult.error.message || "";
                continue;
            }

            (recordResult.data || []).forEach(function (record) {
                const applicationId = (record && record.application_id ? record.application_id : "").toString().trim();
                if (!applicationId) {
                    return;
                }
                recordBatchMap[applicationId] = record.batch_id || "";
            });
        }

        const uniqueBatchIds = Array.from(new Set(
            Object.keys(recordBatchMap)
                .map(function (applicationId) {
                    return recordBatchMap[applicationId];
                })
                .filter(Boolean)
        ));

        for (let start = 0; start < uniqueBatchIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = uniqueBatchIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const batchResult = await context.client
                .from("exam_batches")
                .select("id, batch_label")
                .in("id", batchIds);

            if (batchResult.error) {
                lastErrorMessage = batchResult.error.message || "";
                continue;
            }

            (batchResult.data || []).forEach(function (batch) {
                const batchId = (batch && batch.id ? batch.id : "").toString().trim();
                if (!batchId) {
                    return;
                }
                batchLabelLookup[batchId] = (batch.batch_label || "").toString().trim();
            });
        }

        const batchLabelMap = {};
        Object.keys(recordBatchMap).forEach(function (applicationId) {
            const batchId = recordBatchMap[applicationId];
            batchLabelMap[applicationId] = batchId ? (batchLabelLookup[batchId] || "") : "";
        });

        return {
            batchLabelMap: batchLabelMap,
            errorMessage: lastErrorMessage
        };
    }

    function buildQueueRows(rawRows, profileMap, correctionNoticeMap, examBatchLabelMap) {
        const safeProfileMap = profileMap || {};
        const safeNoticeMap = correctionNoticeMap || {};
        const safeExamBatchLabelMap = examBatchLabelMap || {};

        return (rawRows || []).map(function (row) {
            const profile = safeProfileMap[row.applicant_id] || null;
            const latestCorrectionNotice = safeNoticeMap[row.id] || null;
            const requirementsPayload = requirementsAuxPayloadByApplicationId[row.id] || {};
            const requirementsStatusMap = buildRequirementsStatusMap(requirementsPayload, null);
            const requirementsSummary = summarizeRequirementsStatusMap(requirementsStatusMap);
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile),
                barangay: profile && profile.barangay ? profile.barangay : "",
                sector_classification: row.sector_classification || "",
                exam_batch_label: safeExamBatchLabelMap[row.id] || "",
                requirements_payload: requirementsPayload,
                requirements_status_map: requirementsStatusMap,
                requirements_complete: requirementsSummary.complete,
                requirements_received_count: requirementsSummary.receivedCount,
                requirements_total_count: requirementsSummary.totalCount,
                latest_correction_notice: latestCorrectionNotice,
                resubmitted_for_check: isResubmittedForCheck(row, latestCorrectionNotice),
                resubmitted_notice_label: latestCorrectionNotice ? correctionNoticeLabel(latestCorrectionNotice, row) : ""
            });
        });
    }

    function normalizeRequirementsPayload(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return {};
        }
        return payload;
    }

    function normalizeRequirementStatus(value) {
        const normalized = (value || "").toString().trim().toLowerCase();
        return REQUIREMENTS_STATUS_VALUES.has(normalized)
            ? normalized
            : REQUIREMENTS_STATUS_PENDING;
    }

    function requirementPayloadEntryStatus(entry) {
        if (!entry) {
            return "";
        }
        if (typeof entry === "string") {
            return normalizeRequirementStatus(entry);
        }
        if (typeof entry === "object" && !Array.isArray(entry)) {
            return normalizeRequirementStatus(entry.status || "");
        }
        return "";
    }

    function documentStatusToRequirementStatus(status) {
        const normalized = normalizeStatus(status || "");
        if (normalized === "verified") {
            return REQUIREMENTS_STATUS_RECEIVED;
        }
        if (normalized === "rejected" || normalized === "needs_reupload") {
            return REQUIREMENTS_STATUS_NEEDS_CORRECTION;
        }
        if (normalized === "pending") {
            return REQUIREMENTS_STATUS_PENDING;
        }
        return "";
    }

    function buildRequirementsStatusMap(payload, documents) {
        const normalizedPayload = normalizeRequirementsPayload(payload);
        const payloadChecklist = normalizeRequirementsPayload(normalizedPayload[HARD_COPY_REQUIREMENTS_PAYLOAD_KEY]);
        const latestDocuments = latestRequirementDocStatusByType(documents || []);
        const statusMap = {};

        HARD_COPY_REQUIREMENTS.forEach(function (requirement) {
            const savedStatus = requirementPayloadEntryStatus(payloadChecklist[requirement.key]);
            if (savedStatus) {
                statusMap[requirement.key] = savedStatus;
                return;
            }

            const fallbackType = requirement.fallbackDocumentType || "";
            const fallbackDocument = fallbackType ? latestDocuments[fallbackType] : null;
            const fallbackStatus = fallbackDocument
                ? documentStatusToRequirementStatus(fallbackDocument.verification_status)
                : "";

            statusMap[requirement.key] = fallbackStatus || REQUIREMENTS_STATUS_PENDING;
        });

        return statusMap;
    }

    function summarizeRequirementsStatusMap(statusMap) {
        let receivedCount = 0;
        HARD_COPY_REQUIREMENTS.forEach(function (requirement) {
            if (normalizeRequirementStatus(statusMap && statusMap[requirement.key]) === REQUIREMENTS_STATUS_RECEIVED) {
                receivedCount += 1;
            }
        });
        return {
            receivedCount: receivedCount,
            totalCount: HARD_COPY_REQUIREMENTS.length,
            complete: HARD_COPY_REQUIREMENTS.length > 0 && receivedCount === HARD_COPY_REQUIREMENTS.length
        };
    }

    async function loadRequirementsAuxByApplicationIds(context, rows) {
        const payloadMap = {};
        const sourceRows = Array.isArray(rows) ? rows : [];

        for (let start = 0; start < sourceRows.length; start += PROFILE_BATCH_SIZE) {
            const batchRows = sourceRows.slice(start, start + PROFILE_BATCH_SIZE);
            const batchIds = batchRows.map(function (row) {
                return row && row.id ? row.id : "";
            }).filter(Boolean);

            if (!batchIds.length) {
                continue;
            }

            const result = await context.client
                .from(APPLICATION_AUX_DATA_TABLE)
                .select("application_id, payload")
                .in("application_id", batchIds);

            if (result.error) {
                return {
                    payloadMap: payloadMap,
                    errorMessage: result.error.message || ""
                };
            }

            (result.data || []).forEach(function (entry) {
                const applicationId = (entry && entry.application_id ? entry.application_id : "").toString().trim();
                if (!applicationId) {
                    return;
                }
                payloadMap[applicationId] = normalizeRequirementsPayload(entry.payload);
            });
        }

        return {
            payloadMap: payloadMap,
            errorMessage: ""
        };
    }

    function latestRequirementDocStatusByType(documents) {
        const map = {};
        const rows = Array.isArray(documents) ? documents : [];
        rows.forEach(function (doc) {
            const key = (doc && doc.document_type ? doc.document_type : "").toString().trim();
            if (!key) {
                return;
            }
            const existing = map[key];
            if (!existing) {
                map[key] = doc;
                return;
            }
            const existingTime = new Date(existing.created_at || 0).getTime();
            const currentTime = new Date(doc.created_at || 0).getTime();
            if (currentTime > existingTime) {
                map[key] = doc;
            }
        });
        return map;
    }

    async function fetchRequirementDocuments(applicationId) {
        const key = (applicationId || "").toString().trim();
        if (!key || !authContext || !authContext.client) {
            return [];
        }
        if (Object.prototype.hasOwnProperty.call(requirementsDocumentsByApplicationId, key)) {
            return requirementsDocumentsByApplicationId[key] || [];
        }

        const result = await authContext.client
            .from("application_documents")
            .select("document_type, verification_status, original_filename, created_at")
            .eq("application_id", key)
            .order("created_at", { ascending: false });

        if (result.error) {
            throw new Error(result.error.message || "Failed to load requirement documents.");
        }

        requirementsDocumentsByApplicationId[key] = result.data || [];
        return requirementsDocumentsByApplicationId[key];
    }

    function isRequirementsCompleteRow(row) {
        return !!(row && row.requirements_complete === true);
    }

    function fillRequirementsFilters(rows) {
        const batchFilter = byId("secretaryRequirementsBatchFilter");
        const completionFilter = byId("secretaryRequirementsCompletionFilter");
        if (!batchFilter || !completionFilter) {
            return;
        }

        const selectedBatch = batchFilter.value || "";
        const selectedCompletion = completionFilter.value || "incomplete";
        const batchLabels = Array.from(
            new Set(
                (rows || [])
                    .map(function (row) {
                        return (row && row.exam_batch_label ? row.exam_batch_label : "").toString().trim();
                    })
                    .filter(Boolean)
            )
        ).sort(function (left, right) {
            return left.localeCompare(right);
        });
        const hasRowsWithoutBatch = (rows || []).some(function (row) {
            return !(row && row.exam_batch_label ? row.exam_batch_label : "").toString().trim();
        });

        batchFilter.innerHTML = "";
        if (!batchLabels.length && !hasRowsWithoutBatch) {
            batchFilter.innerHTML = '<option value="all">No exam batches found</option>';
            batchFilter.value = "all";
        } else {
            const allOption = document.createElement("option");
            allOption.value = "all";
            allOption.textContent = "All Exam Batches";
            batchFilter.appendChild(allOption);

            batchLabels.forEach(function (batchLabel) {
                const option = document.createElement("option");
                option.value = batchLabel;
                option.textContent = batchLabel;
                batchFilter.appendChild(option);
            });

            if (hasRowsWithoutBatch) {
                const noBatchOption = document.createElement("option");
                noBatchOption.value = NO_REQUIREMENTS_BATCH_FILTER_VALUE;
                noBatchOption.textContent = "No Batch Assigned";
                batchFilter.appendChild(noBatchOption);
            }

            if (selectedBatch === "all") {
                batchFilter.value = "all";
            } else if (selectedBatch === NO_REQUIREMENTS_BATCH_FILTER_VALUE && hasRowsWithoutBatch) {
                batchFilter.value = NO_REQUIREMENTS_BATCH_FILTER_VALUE;
            } else if (batchLabels.includes(selectedBatch)) {
                batchFilter.value = selectedBatch;
            } else if (batchLabels.length) {
                batchFilter.value = batchLabels[0];
            } else if (hasRowsWithoutBatch) {
                batchFilter.value = NO_REQUIREMENTS_BATCH_FILTER_VALUE;
            } else {
                batchFilter.value = "all";
            }
        }

        completionFilter.innerHTML = [
            '<option value="incomplete">Incomplete Requirements</option>',
            '<option value="complete">Complete Requirements</option>'
        ].join("");
        completionFilter.value = selectedCompletion === "complete" ? "complete" : "incomplete";
    }

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / pageSize);
    }

    function fillFilters(rows) {
        if (isSubmittedRequirementsView()) {
            fillRequirementsFilters(rows);
            return;
        }

        const barangayFilter = byId("secretaryApplicationsBarangayFilter");
        const sectorFilter = byId("secretaryApplicationsSectorFilter");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        if (!barangayFilter || !sectorFilter || !statusFilter || !yearFilter) {
            return;
        }

        const selectedBarangayRaw = barangayFilter.value || "all";
        const selectedBarangay = selectedBarangayRaw === "all"
            ? "all"
            : (selectedBarangayRaw === NO_BARANGAY_FILTER_VALUE
                ? NO_BARANGAY_FILTER_VALUE
                : (normalizeBarangay(selectedBarangayRaw) || "all"));
        const selectedSector = sectorFilter.value || "all";
        const selectedStatus = isSubmittedRequirementsView()
            ? "hard_copy_verified"
            : (statusFilter.value || "submitted");
        const selectedYear = yearFilter.value || "all";

        const observedBarangays = new Set(
            rows
                .map(function (row) {
                    return normalizeBarangay(row.barangay || "");
                })
                .filter(Boolean)
        );
        const barangays = DAET_BARANGAYS.filter(function (barangay) {
            return observedBarangays.has(barangay);
        });
        const hasRowsWithoutBarangay = rows.some(function (row) {
            return !normalizeBarangay(row.barangay || "");
        });

        const sectors = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return (row.sector_classification || "").toString().trim();
                    })
                    .filter(Boolean)
            )
        ).sort(function (left, right) {
            return left.localeCompare(right);
        });

        const observedStatuses = rows
            .map(function (row) {
                return normalizeStatus(row.status || "");
            })
            .filter(Boolean);
        const statusSet = new Set(observedStatuses);
        if (workflowControls.allow_secretary_draft_completion === true) {
            statusSet.add("draft");
        }
        const statuses = Array.from(statusSet).sort(function (left, right) {
            if (left === "draft" && right !== "draft") {
                return -1;
            }
            if (right === "draft" && left !== "draft") {
                return 1;
            }
            return statusMeta(left).label.localeCompare(statusMeta(right).label);
        });

        const years = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return row.school_year || "";
                    })
                    .filter(Boolean)
            )
        ).sort().reverse();

        barangayFilter.innerHTML = '<option value="all">ALL BARANGAY</option>';
        if (hasRowsWithoutBarangay) {
            const noBarangayOption = document.createElement("option");
            noBarangayOption.value = NO_BARANGAY_FILTER_VALUE;
            noBarangayOption.textContent = NO_BARANGAY_FILTER_LABEL;
            barangayFilter.appendChild(noBarangayOption);
        }
        barangays.forEach(function (barangay) {
            const option = document.createElement("option");
            option.value = barangay;
            option.textContent = barangay;
            barangayFilter.appendChild(option);
        });
        barangayFilter.value = selectedBarangay === NO_BARANGAY_FILTER_VALUE && hasRowsWithoutBarangay
            ? NO_BARANGAY_FILTER_VALUE
            : (barangays.includes(selectedBarangay) ? selectedBarangay : "all");

        sectorFilter.innerHTML = '<option value="all">ALL SECTOR</option>';
        sectors.forEach(function (sector) {
            const option = document.createElement("option");
            option.value = sector;
            option.textContent = sector;
            sectorFilter.appendChild(option);
        });
        sectorFilter.value = sectors.includes(selectedSector) ? selectedSector : "all";

        if (isSubmittedRequirementsView()) {
            statusFilter.innerHTML = '<option value="hard_copy_verified">Hard Copy Verified</option>';
            statusFilter.value = "hard_copy_verified";
        } else {
            statusFilter.innerHTML = '<option value="all">STATUS ALL</option>';
            statuses.forEach(function (status) {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = statusMeta(status).label;
                statusFilter.appendChild(option);
            });
            statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "all";
        }

        yearFilter.innerHTML = '<option value="all">YEAR ALL</option>';
        years.forEach(function (year) {
            const option = document.createElement("option");
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        });
        yearFilter.value = years.includes(selectedYear) ? selectedYear : "all";
    }

    function isExamStage(status) {
        const normalized = normalizeStatus(status);
        return ["submitted", "pending_exam", "exam_scheduled", "exam_completed", "passed_exam", "failed_exam", "special_endorsement_review"].includes(normalized);
    }

    function isInterviewStage(status) {
        const normalized = normalizeStatus(status);
        return ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified"].includes(normalized);
    }

    function updateKpis(rows) {
        const queueTotal = rows.length;
        const forVerification = rows.filter(function (row) {
            return isExamStage(row.status);
        }).length;
        const interviewStage = rows.filter(function (row) {
            return isInterviewStage(row.status);
        }).length;
        const forwarded = rows.filter(function (row) {
            return normalizeStatus(row.status) === "for_approval";
        }).length;

        const queueEl = byId("secretaryApplicationsQueueTotal");
        const verifyEl = byId("secretaryApplicationsForVerification");
        const interviewEl = byId("secretaryApplicationsInterviewStage");
        const forwardedEl = byId("secretaryApplicationsForwarded");

        if (queueEl) {
            queueEl.textContent = String(queueTotal);
        }
        if (verifyEl) {
            verifyEl.textContent = String(forVerification);
        }
        if (interviewEl) {
            interviewEl.textContent = String(interviewStage);
        }
        if (forwardedEl) {
            forwardedEl.textContent = String(forwarded);
        }
    }

    function applyFilterRows() {
        if (isSubmittedRequirementsView()) {
            const batchSelection = byId("secretaryRequirementsBatchFilter")
                ? byId("secretaryRequirementsBatchFilter").value
                : "all";
            const completion = byId("secretaryRequirementsCompletionFilter")
                ? byId("secretaryRequirementsCompletionFilter").value
                : "incomplete";
            const searchQuery = byId("secretaryRequirementsSearchInput")
                ? byId("secretaryRequirementsSearchInput").value.toLowerCase().trim()
                : "";

            return allRows.filter(function (row) {
                const normalizedStatus = normalizeStatus(row.status);
                if (!normalizedStatus || normalizedStatus === "draft") {
                    return false;
                }

                const rowBatchLabel = (row.exam_batch_label || "").toString().trim();
                const matchesBatch = batchSelection === "all"
                    || (batchSelection === NO_REQUIREMENTS_BATCH_FILTER_VALUE
                        ? !rowBatchLabel
                        : rowBatchLabel === batchSelection);
                const matchesCompletion = completion === "complete"
                    ? isRequirementsCompleteRow(row)
                    : !isRequirementsCompleteRow(row);
                const applicantName = (row.applicant_name || "").toLowerCase();
                const matchesSearch = !searchQuery || applicantName.indexOf(searchQuery) !== -1;
                return matchesBatch && matchesCompletion && matchesSearch;
            });
        }

        const barangay = byId("secretaryApplicationsBarangayFilter") ? byId("secretaryApplicationsBarangayFilter").value : "all";
        const sector = byId("secretaryApplicationsSectorFilter") ? byId("secretaryApplicationsSectorFilter").value : "all";
        const status = isSubmittedRequirementsView()
            ? "hard_copy_verified"
            : (byId("secretaryApplicationsStatusFilter") ? byId("secretaryApplicationsStatusFilter").value : "all");
        const schoolYear = byId("secretaryApplicationsYearFilter") ? byId("secretaryApplicationsYearFilter").value : "all";
        const searchQuery = byId("secretaryApplicationsSearchInput")
            ? byId("secretaryApplicationsSearchInput").value.toLowerCase().trim()
            : "";

        return allRows.filter(function (row) {
            const rowBarangay = normalizeBarangay(row.barangay || "");
            const matchesBarangay = barangay === "all"
                || (barangay === NO_BARANGAY_FILTER_VALUE
                    ? !rowBarangay
                    : rowBarangay === barangay);
            const rowSector = (row.sector_classification || "").toString().trim();
            const matchesSector = sector === "all" || rowSector === sector;
            const normalized = normalizeStatus(row.status);
            const matchesStatus = status === "all" || normalized === status;
            const matchesYear = schoolYear === "all" || row.school_year === schoolYear;
            const applicantName = (row.applicant_name || "").toLowerCase();
            const matchesSearch = !searchQuery || applicantName.indexOf(searchQuery) !== -1;
            return matchesBarangay && matchesSector && matchesStatus && matchesYear && matchesSearch;
        });
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("secretaryApplicationsPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function renderPagination(totalRows) {
        const pagination = byId("secretaryApplicationsPagination");
        if (!pagination) {
            return;
        }

        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", currentPage - 1, currentPage <= 1, false, "Previous page"));

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(pageCount, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === currentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", currentPage + 1, currentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function actionForStatus(_status, appId) {
        const href = "secretary-interview-verification.html?id=" + encodeURIComponent(appId);
        if (normalizeStatus(_status) === "draft") {
            return {
                type: "draft",
                viewHref: href + "&draft_mode=view",
                finishHref: href
            };
        }
        return {
            type: "default",
            label: "View Data",
            href: href
        };
    }

    function renderActionMarkup(action, appId) {
        if (!action || action.type !== "draft") {
            return '<a class="btn btn-outline-dark btn-sm" href="' + escapeHtml((action && action.href) || "#") + '">' + escapeHtml((action && action.label) || "View Data") + "</a>";
        }

        const buttonId = "secretaryDraftActionBtn-" + String(appId || "")
            .replace(/[^a-z0-9_-]/gi, "")
            .toLowerCase();

        return (
            '<div class="dropdown">' +
            '<button class="btn btn-outline-dark btn-sm dropdown-toggle" id="' + escapeHtml(buttonId) + '" type="button" data-bs-toggle="dropdown" aria-expanded="false">Draft Action</button>' +
            '<div class="dropdown-menu dropdown-menu-end" aria-labelledby="' + escapeHtml(buttonId) + '">' +
            '<a class="dropdown-item" href="' + escapeHtml(action.viewHref) + '">View Draft</a>' +
            '<a class="dropdown-item" href="' + escapeHtml(action.finishHref) + '">Finish Draft</a>' +
            "</div>" +
            "</div>"
        );
    }

    function renderTable(rows) {
        const tbody = byId("secretaryApplicationsTableBody");
        if (!tbody) {
            return;
        }
        const requirementsMode = isSubmittedRequirementsView();
        const tableColspan = requirementsMode ? 4 : 6;
        if (!rows.length) {
            const requirementsCompletion = byId("secretaryRequirementsCompletionFilter")
                ? byId("secretaryRequirementsCompletionFilter").value
                : "complete";
            tbody.innerHTML = requirementsMode
                ? (
                    requirementsCompletion === "incomplete"
                        ? '<tr><td colspan="' + String(tableColspan) + '"><div class="ldss-table-empty-state"><div class="ldss-table-empty-title">No incomplete requirement records yet</div><div class="ldss-table-empty-copy">Applicants with pending hard-copy requirements for the selected exam batch will appear here.</div></div></td></tr>'
                        : '<tr><td colspan="' + String(tableColspan) + '"><div class="ldss-table-empty-state"><div class="ldss-table-empty-title">No complete requirement records yet</div><div class="ldss-table-empty-copy">Applicants with completed hard-copy requirements for the selected exam batch will appear here.</div></div></td></tr>'
                )
                : '<tr><td colspan="' + String(tableColspan) + '"><div class="ldss-table-empty-state"><div class="ldss-table-empty-title">No application records found</div><div class="ldss-table-empty-copy">Try adjusting the current search or filters to see more records.</div></div></td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (row) {
            const normalized = normalizeStatus(row.status);
            const meta = requirementsMode
                ? {
                    label: row.requirements_complete ? "Complete Requirements" : "Incomplete Requirements",
                    chipClass: row.requirements_complete ? "ldss-chip-success" : "ldss-chip-danger"
                }
                : statusMeta(normalized);
            const action = actionForStatus(normalized, row.id);
            const applicantName = row.applicant_name || "Unknown";
            const applicationNo = row.application_no || "-";
            const sectorClassification = row.sector_classification || "-";
            const applicantNameMarkup = requirementsMode
                ? (
                    '<button class="btn btn-link p-0 text-start ldss-requirements-applicant-trigger" type="button" data-requirements-application="' + escapeHtml(row.id || "") + '">' +
                    escapeHtml(applicantName) +
                    "</button>"
                )
                : ('<span class="ldss-queue-applicant-name ldss-table-ellipsis" title="' + escapeHtml(applicantName) + '">' + escapeHtml(applicantName) + "</span>");
            const resubmittedMarkup = row.resubmitted_for_check
                ? '<div class="ldss-queue-applicant-meta">' +
                    '<span class="ldss-chip ldss-chip-accent">Resubmitted</span>' +
                    '<span class="ldss-queue-applicant-note">After ' + escapeHtml(row.resubmitted_notice_label || "Correction Notice") + "</span>" +
                    "</div>"
                : "";
            return (
                '<tr class="ldss-secretary-app-row' + (requirementsMode && row.id === selectedRequirementsApplicationId ? ' ldss-secretary-app-row-active' : '') + '" tabindex="0">' +
                '<td data-label="Applicant">' +
                '<div class="ldss-queue-applicant">' +
                '<div class="ldss-queue-applicant-body">' +
                applicantNameMarkup +
                (
                    requirementsMode
                        ? ('<div class="ldss-queue-applicant-submeta">Application ID: ' + escapeHtml(applicationNo) + "</div>")
                        : ""
                ) +
                resubmittedMarkup +
                "</div>" +
                "</div>" +
                "</td>" +
                (
                    requirementsMode
                        ? (
                            '<td data-label="Sector Classification"><span class="ldss-table-ellipsis" title="' + escapeHtml(sectorClassification) + '">' + escapeHtml(sectorClassification) + "</span></td>" +
                            '<td data-label="Status"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                            '<td data-label="View Data">' + renderActionMarkup(action, row.id) + "</td>"
                        )
                        : (
                            '<td data-label="Application ID">' + escapeHtml(applicationNo) + "</td>" +
                            '<td data-label="Sector Classification"><span class="ldss-table-ellipsis" title="' + escapeHtml(sectorClassification) + '">' + escapeHtml(sectorClassification) + "</span></td>" +
                            '<td data-label="Submitted">' + escapeHtml(formatDate(row.submitted_at || row.created_at)) + "</td>" +
                            '<td data-label="Status"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                            '<td data-label="Action">' + renderActionMarkup(action, row.id) + "</td>"
                        )
                ) +
                "</tr>"
            );
        }).join("");
    }

    function bulkPendingExamRows() {
        return filteredRows.filter(function (row) {
            return normalizeStatus(row.status) === "submitted" && row.id && row.applicant_id;
        });
    }

    function renderBulkForExamAction() {
        const button = byId("secretaryBulkForExamBtn");
        const meta = byId("secretaryBulkForExamMeta");
        const rows = bulkPendingExamRows();

        if (isSubmittedRequirementsView()) {
            const batchFilter = byId("secretaryRequirementsBatchFilter");
            const completionFilter = byId("secretaryRequirementsCompletionFilter");
            const selectedBatchLabel = batchFilter && batchFilter.selectedIndex >= 0
                ? batchFilter.options[batchFilter.selectedIndex].textContent
                : "selected exam batch";
            const completionLabel = completionFilter && completionFilter.value === "incomplete"
                ? "incomplete"
                : "complete";
            if (button) {
                button.classList.add("d-none");
            }
            if (meta) {
                meta.textContent = "Showing " + completionLabel + " requirements for " + selectedBatchLabel + ".";
            }
            return;
        }

        if (button) {
            button.disabled = bulkForExamSubmitting || rows.length === 0;
            button.textContent = bulkForExamSubmitting ? "Moving..." : "Mass Set to Examination";
        }

        if (!meta) {
            return;
        }

        if (!rows.length) {
            meta.textContent = "Mass set uses currently filtered Submitted applications only.";
            return;
        }

        meta.textContent = String(rows.length) + " currently filtered submitted application(s) can be moved to Pending Exam at once.";
    }

    function renderRequirementsSaveControls(applicationId, disabled, helperText, isBusy) {
        const actionsEl = byId("secretaryRequirementsInspectorActions");
        const saveMetaEl = byId("secretaryRequirementsInspectorSaveMeta");
        const saveBtn = byId("secretaryRequirementsSaveBtn");
        const hasSelection = !!(applicationId || "").toString().trim();

        if (actionsEl) {
            actionsEl.classList.toggle("d-none", !hasSelection);
        }
        if (saveMetaEl) {
            saveMetaEl.textContent = helperText || "Save checklist updates here to reflect them on the applicant tracking page.";
        }
        if (saveBtn) {
            saveBtn.disabled = !hasSelection || disabled === true;
            saveBtn.textContent = isBusy ? REQUIREMENTS_SAVE_LABEL_BUSY : REQUIREMENTS_SAVE_LABEL_IDLE;
        }
    }

    function requirementStatusSelectMarkup(requirement, currentStatus) {
        const currentValue = normalizeRequirementStatus(currentStatus);
        const options = [
            { value: REQUIREMENTS_STATUS_PENDING, label: "Pending Review" },
            { value: REQUIREMENTS_STATUS_RECEIVED, label: "Received" },
            { value: REQUIREMENTS_STATUS_NEEDS_CORRECTION, label: "Needs Correction" },
            { value: REQUIREMENTS_STATUS_MISSING, label: "Missing" }
        ];

        return (
            '<select class="form-select form-select-sm ldss-secretary-requirements-status-select" data-requirement-key="' + escapeHtml(requirement.key) + '" aria-label="' + escapeHtml(requirement.label) + '">' +
            options.map(function (option) {
                return '<option value="' + escapeHtml(option.value) + '"' + (option.value === currentValue ? " selected" : "") + '>' + escapeHtml(option.label) + "</option>";
            }).join("") +
            "</select>"
        );
    }

    function requirementsPrintFormUrl(applicationId, embedMode) {
        const id = (applicationId || "").toString().trim();
        if (!id) {
            return "";
        }
        const params = new URLSearchParams();
        params.set("id", id);
        if (embedMode === true) {
            params.set("embed", "1");
        }
        return "secretary-print-form.html?" + params.toString();
    }

    function requirementsPrintTitleMarkup(requirement, applicationId) {
        const label = escapeHtml(requirement.label);
        const appId = (applicationId || "").toString().trim();
        if (requirement.key !== "application_form" || !appId) {
            return '<div class="ldss-secretary-requirements-inspector-item-title">' + label + "</div>";
        }

        return (
            '<button class="btn btn-link p-0 text-start ldss-secretary-requirements-doc-trigger" type="button" data-requirements-print-application="' + escapeHtml(appId) + '">' +
            label +
            "</button>"
        );
    }

    function requirementsPrintModal() {
        const modalEl = byId("secretaryRequirementsPrintModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        if (!requirementsPrintModalInstance) {
            requirementsPrintModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
        }
        return requirementsPrintModalInstance;
    }

    function resetRequirementsPrintModal() {
        const frame = byId("secretaryRequirementsPrintFrame");
        const loading = byId("secretaryRequirementsPrintModalLoading");
        const openTab = byId("secretaryRequirementsPrintOpenTab");
        const title = byId("secretaryRequirementsPrintModalTitle");

        if (frame) {
            frame.classList.add("d-none");
            frame.removeAttribute("src");
        }
        if (loading) {
            loading.classList.remove("d-none");
            loading.textContent = "Loading printable application form...";
        }
        if (openTab) {
            openTab.setAttribute("href", "secretary-print-form.html");
        }
        if (title) {
            title.textContent = "Printable Application Form";
        }
    }

    function openRequirementsPrintModal(applicationId) {
        const appId = (applicationId || "").toString().trim();
        if (!appId) {
            return;
        }

        const row = allRows.find(function (entry) {
            return entry && entry.id === appId;
        }) || null;
        const previewUrl = requirementsPrintFormUrl(appId, true);
        const openTabUrl = requirementsPrintFormUrl(appId, false);
        const modal = requirementsPrintModal();
        const frame = byId("secretaryRequirementsPrintFrame");
        const loading = byId("secretaryRequirementsPrintModalLoading");
        const openTab = byId("secretaryRequirementsPrintOpenTab");
        const title = byId("secretaryRequirementsPrintModalTitle");

        if (!modal || !frame || !loading) {
            if (openTabUrl) {
                window.open(openTabUrl, "_blank", "noopener");
            }
            return;
        }

        if (title) {
            title.textContent = row && row.applicant_name
                ? ("Application Form - " + row.applicant_name)
                : "Printable Application Form";
        }
        if (openTab) {
            openTab.setAttribute("href", openTabUrl || "secretary-print-form.html");
        }

        frame.classList.add("d-none");
        loading.classList.remove("d-none");
        loading.textContent = "Loading printable application form...";
        frame.src = previewUrl;
        modal.show();
    }

    function renderRequirementsInspectorState(applicationRow, documents) {
        if (!isSubmittedRequirementsView()) {
            return;
        }

        const nameEl = byId("secretaryRequirementsInspectorName");
        const metaEl = byId("secretaryRequirementsInspectorMeta");
        const checklistEl = byId("secretaryRequirementsInspectorChecklist");

        if (!nameEl || !metaEl || !checklistEl) {
            return;
        }

        if (!applicationRow) {
            nameEl.textContent = "No applicant selected";
            metaEl.textContent = "Click an applicant name to review the submitted requirements.";
            checklistEl.innerHTML = '<div class="ldss-secretary-requirements-inspector-empty">Select an applicant from the table to show the requirement checklist for this applicant.</div>';
            renderRequirementsSaveControls("", true, "Save checklist updates here to reflect them on the applicant tracking page.", false);
            return;
        }

        const latest = latestRequirementDocStatusByType(documents || []);
        const payload = requirementsAuxPayloadByApplicationId[applicationRow.id] || {};
        const checklistMap = buildRequirementsStatusMap(payload, latest);
        const summary = summarizeRequirementsStatusMap(checklistMap);
        const status = statusMeta(applicationRow.status || "");
        const submittedAt = applicationRow.submitted_at || applicationRow.created_at;

        nameEl.textContent = applicationRow.applicant_name || "Unknown Applicant";
        metaEl.textContent = "Application ID: " + (applicationRow.application_no || "-")
            + " | " + String(summary.receivedCount) + "/" + String(summary.totalCount) + " received"
            + " | Status: " + (status.label || "-")
            + " | Submitted: " + formatDate(submittedAt);

        checklistEl.innerHTML = HARD_COPY_REQUIREMENTS.map(function (requirement) {
            const currentStatus = checklistMap[requirement.key];
            return (
                '<div class="ldss-secretary-requirements-inspector-item ldss-secretary-requirements-editor-item">' +
                '<div class="ldss-secretary-requirements-editor-row">' +
                requirementsPrintTitleMarkup(requirement, applicationRow.id) +
                '<div class="ldss-secretary-requirements-editor-select">' + requirementStatusSelectMarkup(requirement, currentStatus) + "</div>" +
                "</div>" +
                "</div>"
            );
        }).join("");

        renderRequirementsSaveControls(
            applicationRow.id,
            requirementsSavingApplicationId === applicationRow.id,
            "Save checklist updates here to reflect them on the applicant tracking page.",
            requirementsSavingApplicationId === applicationRow.id
        );
    }

    function renderRequirementsInspectorLoading(applicationRow) {
        if (!isSubmittedRequirementsView()) {
            return;
        }

        const nameEl = byId("secretaryRequirementsInspectorName");
        const metaEl = byId("secretaryRequirementsInspectorMeta");
        const checklistEl = byId("secretaryRequirementsInspectorChecklist");

        if (!nameEl || !metaEl || !checklistEl) {
            return;
        }

        if (!applicationRow) {
            renderRequirementsInspectorState(null, []);
            return;
        }

        nameEl.textContent = applicationRow.applicant_name || "Unknown Applicant";
        metaEl.textContent = "Loading requirement checklist...";
        checklistEl.innerHTML = '<div class="ldss-secretary-requirements-inspector-empty">Loading requirement checklist for this applicant.</div>';
        renderRequirementsSaveControls(applicationRow.id, true, "Loading current checklist values...", true);
    }

    function readRequirementsChecklistFromDom() {
        const values = {};
        document.querySelectorAll(".ldss-secretary-requirements-status-select").forEach(function (select) {
            const key = select.getAttribute("data-requirement-key") || "";
            if (!key) {
                return;
            }
            values[key] = normalizeRequirementStatus(select.value || "");
        });
        return values;
    }

    function mergeRequirementsChecklistIntoPayload(payload, checklistMap) {
        const normalizedPayload = normalizeRequirementsPayload(payload);
        const nextPayload = Object.assign({}, normalizedPayload);
        const previousChecklist = normalizeRequirementsPayload(nextPayload[HARD_COPY_REQUIREMENTS_PAYLOAD_KEY]);
        const nextChecklist = Object.assign({}, previousChecklist);
        const nowIso = new Date().toISOString();

        HARD_COPY_REQUIREMENTS.forEach(function (requirement) {
            nextChecklist[requirement.key] = {
                status: normalizeRequirementStatus(checklistMap[requirement.key]),
                updated_at: nowIso,
                updated_by: authContext && authContext.user ? authContext.user.id : null
            };
        });

        nextPayload[HARD_COPY_REQUIREMENTS_PAYLOAD_KEY] = nextChecklist;
        return nextPayload;
    }

    async function saveRequirementsChecklist() {
        const applicationId = (selectedRequirementsApplicationId || "").toString().trim();
        if (!applicationId || !authContext || !authContext.client) {
            return;
        }

        const applicationRow = allRows.find(function (row) {
            return row && row.id === applicationId;
        }) || null;

        if (!applicationRow || !applicationRow.applicant_id) {
            showStatus("Select an applicant first before saving the checklist.", "alert-warning");
            return;
        }

        const checklistMap = readRequirementsChecklistFromDom();
        const mergedPayload = mergeRequirementsChecklistIntoPayload(
            requirementsAuxPayloadByApplicationId[applicationId] || {},
            checklistMap
        );

        requirementsSavingApplicationId = applicationId;
        renderRequirementsSaveControls(applicationId, true, "Saving checklist updates...", true);

        const result = await authContext.client
            .from(APPLICATION_AUX_DATA_TABLE)
            .upsert({
                application_id: applicationId,
                applicant_id: applicationRow.applicant_id,
                payload: mergedPayload
            }, { onConflict: "application_id" });

        requirementsSavingApplicationId = "";

        if (result.error) {
            renderRequirementsSaveControls(applicationId, false, "Checklist save failed. Please try again.", false);
            throw new Error(result.error.message || "Failed to save requirement checklist.");
        }

        requirementsAuxPayloadByApplicationId[applicationId] = mergedPayload;

        allRows = allRows.map(function (row) {
            if (!row || row.id !== applicationId) {
                return row;
            }
            const statusMap = buildRequirementsStatusMap(mergedPayload, null);
            const summary = summarizeRequirementsStatusMap(statusMap);
            return Object.assign({}, row, {
                requirements_payload: mergedPayload,
                requirements_status_map: statusMap,
                requirements_complete: summary.complete,
                requirements_received_count: summary.receivedCount,
                requirements_total_count: summary.totalCount
            });
        });

        applyFiltersAndRender(false);
        if (selectedRequirementsApplicationId === applicationId) {
            const nextSelectedRow = allRows.find(function (row) {
                return row && row.id === applicationId;
            }) || applicationRow;
            renderRequirementsInspectorState(nextSelectedRow, requirementsDocumentsByApplicationId[applicationId] || []);
        }
        showStatus("Requirement checklist saved successfully.", "alert-success");
    }

    async function handleRequirementsApplicantSelection(applicationId) {
        const key = (applicationId || "").toString().trim();
        if (!key) {
            return;
        }

        const row = allRows.find(function (entry) {
            return entry && entry.id === key;
        }) || null;

        if (!row) {
            renderRequirementsInspectorState(null, []);
            return;
        }

        selectedRequirementsApplicationId = key;
        renderTable(filteredRows.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize));
        renderRequirementsInspectorLoading(row);

        try {
            const documents = await fetchRequirementDocuments(key);
            if (selectedRequirementsApplicationId !== key) {
                return;
            }

            renderRequirementsInspectorState(row, documents);
        } catch (error) {
            const nameEl = byId("secretaryRequirementsInspectorName");
            const metaEl = byId("secretaryRequirementsInspectorMeta");
            const checklistEl = byId("secretaryRequirementsInspectorChecklist");
            if (nameEl) {
                nameEl.textContent = row.applicant_name || "Unknown Applicant";
            }
            if (metaEl) {
                metaEl.textContent = "Could not load the requirement checklist right now.";
            }
            if (checklistEl) {
                checklistEl.innerHTML = '<div class="ldss-secretary-requirements-inspector-empty">Try clicking the applicant again after refreshing the page.</div>';
            }
            renderRequirementsSaveControls(key, true, "Checklist loading failed. Refresh and try again.", false);
            showStatus(error && error.message ? error.message : "Failed to load requirement checklist.", "alert-warning");
        }
    }

    function populateBulkForExamModal(rows) {
        const count = byId("secretaryBulkForExamCount");
        const note = byId("secretaryBulkForExamNote");
        if (count) {
            count.textContent = String((rows || []).length);
        }
        if (note) {
            note.textContent = "Only applications still in Submitted status at save time will be updated. Applicant notifications will be created after the bulk move succeeds.";
        }
    }

    async function bulkMoveApplicationsToPendingExam(rows) {
        const movedRows = [];
        const sourceRows = Array.isArray(rows) ? rows : [];

        for (let start = 0; start < sourceRows.length; start += 100) {
            const chunk = sourceRows.slice(start, start + 100);
            const applicationIds = chunk.map(function (row) {
                return row.id;
            }).filter(Boolean);

            if (!applicationIds.length) {
                continue;
            }

            const result = await authContext.client
                .from("applications")
                .update({
                    status: "pending_exam",
                    secretary_reviewer_id: authContext.user.id
                })
                .in("id", applicationIds)
                .eq("status", "submitted")
                .select("id, applicant_id, application_no");

            if (result.error) {
                throw new Error("Failed to move applications to Pending Exam: " + result.error.message);
            }

            movedRows.push.apply(movedRows, result.data || []);
        }

        return movedRows;
    }

    async function bulkNotifyPendingExamApplicants(rows) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        let notificationCount = 0;

        for (let start = 0; start < sourceRows.length; start += 100) {
            const chunk = sourceRows.slice(start, start + 100)
                .filter(function (row) {
                    return row && row.id && row.applicant_id;
                })
                .map(function (row) {
                    return {
                        recipient_user_id: row.applicant_id,
                        sender_user_id: authContext.user.id,
                        notification_type: "application",
                        title: "Application Ready for Examination",
                        message: "Your application passed secretary checking and is now waiting for examination scheduling.",
                        related_application_id: row.id,
                        related_url: "application-detail.html?id=" + encodeURIComponent(row.id)
                    };
                });

            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("notifications")
                .insert(chunk);

            if (result.error) {
                throw new Error(result.error.message || "Failed to notify applicants.");
            }

            notificationCount += chunk.length;
        }

        return notificationCount;
    }

    function openBulkForExamModal() {
        const rows = bulkPendingExamRows();
        if (!rows.length) {
            showStatus("No currently filtered submitted applications are ready for bulk move to Pending Exam.", "alert-warning");
            return;
        }

        populateBulkForExamModal(rows);
        const modal = getBulkForExamModal();
        if (modal) {
            modal.show();
        }
    }

    async function handleBulkForExamConfirm() {
        if (bulkForExamSubmitting) {
            return;
        }

        const rows = bulkPendingExamRows();
        if (!rows.length) {
            showStatus("No currently filtered submitted applications are ready for bulk move to Pending Exam.", "alert-warning");
            return;
        }

        const proceedBtn = byId("secretaryBulkForExamProceedBtn");
        const cancelBtn = byId("secretaryBulkForExamCancelBtn");
        bulkForExamSubmitting = true;
        renderBulkForExamAction();
        showStatus("");

        if (proceedBtn) {
            proceedBtn.disabled = true;
            proceedBtn.textContent = "Moving...";
        }
        if (cancelBtn) {
            cancelBtn.disabled = true;
        }

        try {
            const movedRows = await bulkMoveApplicationsToPendingExam(rows);
            if (!movedRows.length) {
                throw new Error("No filtered submitted applications were still eligible to move. Refresh the queue and try again.");
            }

            let notificationCount = 0;
            let notificationWarning = "";
            try {
                notificationCount = await bulkNotifyPendingExamApplicants(movedRows);
            } catch (notificationError) {
                notificationWarning = notificationError && notificationError.message
                    ? notificationError.message
                    : "Applicant notification failed.";
            }

            const modal = getBulkForExamModal();
            if (modal) {
                modal.hide();
            }

            await loadApplications(authContext);
            if (notificationWarning) {
                showStatus(
                    String(movedRows.length) + " application(s) moved to Pending Exam, but notification failed: " + notificationWarning,
                    "alert-warning"
                );
            } else {
                showStatus(
                    String(movedRows.length) + " application(s) moved to Pending Exam and " + String(notificationCount) + " applicant notification(s) were sent.",
                    "alert-success"
                );
            }
        } catch (error) {
            showStatus(error && error.message ? error.message : "Bulk move to Pending Exam failed.", "alert-danger");
        } finally {
            bulkForExamSubmitting = false;
            renderBulkForExamAction();
            if (proceedBtn) {
                proceedBtn.disabled = false;
                proceedBtn.textContent = "Move to Pending Exam";
            }
            if (cancelBtn) {
                cancelBtn.disabled = false;
            }
        }
    }

    function applyFiltersAndRender(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }

        filteredRows = applyFilterRows();
        storeVerificationQueue(filteredRows);

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        let autoSelectRequirementsRowId = "";

        if (isSubmittedRequirementsView()) {
            const selectedVisibleOnCurrentPage = pageRows.some(function (row) {
                return row && row.id === selectedRequirementsApplicationId;
            });

            if (!selectedVisibleOnCurrentPage) {
                selectedRequirementsApplicationId = "";
            }

            if (!selectedRequirementsApplicationId && pageRows.length) {
                autoSelectRequirementsRowId = pageRows[0] && pageRows[0].id
                    ? pageRows[0].id
                    : "";
                selectedRequirementsApplicationId = autoSelectRequirementsRowId;
            }

            if (!pageRows.length) {
                renderRequirementsInspectorState(null, []);
            }
        } else if (selectedRequirementsApplicationId) {
            selectedRequirementsApplicationId = "";
        } else {
            renderRequirementsInspectorState(null, []);
        }

        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
        renderBulkForExamAction();

        if (autoSelectRequirementsRowId) {
            handleRequirementsApplicantSelection(autoSelectRequirementsRowId);
        }
    }

    async function loadApplications(context) {
        const loadToken = applicationsLoadToken + 1;
        applicationsLoadToken = loadToken;
        showStatus("");

        const appResult = await fetchAllApplications(context);

        if (appResult.error) {
            showStatus("Failed to load application queue: " + appResult.error.message, "alert-danger");
            return;
        }

        const rows = appResult.data || [];
        const applicantIds = Array.from(new Set(rows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));
        const applicationIds = Array.from(new Set(rows.map(function (row) {
            return row.id;
        }).filter(Boolean)));

        const profileLoadPromise = applicantIds.length > 0
            ? loadProfilesByIds(context, applicantIds)
            : Promise.resolve({ profileMap: {}, failedBatchCount: 0, lastErrorMessage: "" });
        const examBatchLoadPromise = isSubmittedRequirementsView() && applicationIds.length > 0
            ? loadExamBatchLabelsByApplicationIds(context, applicationIds)
            : Promise.resolve({ batchLabelMap: {}, errorMessage: "" });
        const requirementsAuxLoadPromise = isSubmittedRequirementsView() && rows.length > 0
            ? loadRequirementsAuxByApplicationIds(context, rows)
            : Promise.resolve({ payloadMap: {}, errorMessage: "" });
        const correctionNoticeLoadPromise = applicationIds.length > 0
            ? loadLatestCorrectionNoticesByApplicationIds(context, applicationIds)
            : Promise.resolve({ noticeMap: {}, errorMessage: "" });

        const profileLoad = await profileLoadPromise;
        const examBatchLoad = await examBatchLoadPromise;
        const requirementsAuxLoad = await requirementsAuxLoadPromise;
        if (loadToken !== applicationsLoadToken) {
            return;
        }

        const profileMap = profileLoad.profileMap;
        const examBatchLabelMap = examBatchLoad.batchLabelMap || {};
        requirementsAuxPayloadByApplicationId = requirementsAuxLoad.payloadMap || {};
        allRows = buildQueueRows(rows, profileMap, {}, examBatchLabelMap);

        if (profileLoad.failedBatchCount > 0) {
            showStatus(
                "Loaded application queue, but some applicant profiles could not be loaded. " +
                (profileLoad.lastErrorMessage ? ("Last error: " + profileLoad.lastErrorMessage) : "Please refresh and try again."),
                "alert-warning"
            );
        }
        if (isSubmittedRequirementsView() && examBatchLoad.errorMessage) {
            showStatus(
                "Requirements queue loaded, but some exam batch labels could not be loaded. " +
                "Filtering by saved exam batches may be incomplete.",
                "alert-warning"
            );
        }
        if (isSubmittedRequirementsView() && requirementsAuxLoad.errorMessage) {
            showStatus(
                "Requirements queue loaded, but some saved checklist statuses could not be loaded. " +
                "Applicants may default to pending review until you refresh.",
                "alert-warning"
            );
        }

        updateKpis(allRows);
        fillFilters(allRows);
        applyFiltersAndRender(false);

        if (applicationIds.length) {
            await delay(SECONDARY_LOAD_DELAY_MS);
        }
        if (loadToken !== applicationsLoadToken) {
            return;
        }

        const correctionNoticeLoad = await correctionNoticeLoadPromise;
        if (loadToken !== applicationsLoadToken) {
            return;
        }

        if (correctionNoticeLoad.errorMessage) {
            showStatus(
                "Application queue loaded, but some correction history markers could not be loaded. " +
                "Showing available queue data only.",
                "alert-warning"
            );
            return;
        }

        allRows = buildQueueRows(rows, profileMap, correctionNoticeLoad.noticeMap || {}, examBatchLabelMap);
        applyFiltersAndRender(false);
    }

    function bindEvents() {
        const applyBtn = byId("secretaryApplicationsApplyFilterBtn");
        const searchInput = byId("secretaryApplicationsSearchInput");
        const barangayFilter = byId("secretaryApplicationsBarangayFilter");
        const sectorFilter = byId("secretaryApplicationsSectorFilter");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        const requirementsSearchInput = byId("secretaryRequirementsSearchInput");
        const requirementsBatchFilter = byId("secretaryRequirementsBatchFilter");
        const requirementsCompletionFilter = byId("secretaryRequirementsCompletionFilter");
        const requirementsSaveBtn = byId("secretaryRequirementsSaveBtn");
        const requirementsPrintModalEl = byId("secretaryRequirementsPrintModal");
        const requirementsPrintFrame = byId("secretaryRequirementsPrintFrame");
        const pagination = byId("secretaryApplicationsPagination");
        const pageSizeSelect = byId("secretaryApplicationsPageSize");
        const tableBody = byId("secretaryApplicationsTableBody");
        const bulkForExamBtn = byId("secretaryBulkForExamBtn");
        const bulkForExamProceedBtn = byId("secretaryBulkForExamProceedBtn");
        const bulkForExamModalEl = byId("secretaryBulkForExamModal");
        const walkInBtn = byId("secretaryWalkInBtn");
        const walkInForm = byId("secretaryWalkInForm");
        const walkInModalEl = byId("secretaryWalkInModal");

        bindUppercaseInput("secretaryWalkInFirstName");
        bindUppercaseInput("secretaryWalkInMiddleName");
        bindUppercaseInput("secretaryWalkInLastName");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFiltersAndRender(true);
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", function () {
                applyFiltersAndRender(true);
            });
            searchInput.addEventListener("keydown", function (event) {
                if (event.key !== "Enter") {
                    return;
                }
                event.preventDefault();
                applyFiltersAndRender(true);
            });
        }

        if (requirementsSearchInput) {
            requirementsSearchInput.addEventListener("input", function () {
                applyFiltersAndRender(true);
            });
            requirementsSearchInput.addEventListener("keydown", function (event) {
                if (event.key !== "Enter") {
                    return;
                }
                event.preventDefault();
                applyFiltersAndRender(true);
            });
        }

        if (barangayFilter) {
            barangayFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (sectorFilter) {
            sectorFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (yearFilter) {
            yearFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (requirementsBatchFilter) {
            requirementsBatchFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (requirementsCompletionFilter) {
            requirementsCompletionFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (requirementsSaveBtn) {
            requirementsSaveBtn.addEventListener("click", async function () {
                try {
                    await saveRequirementsChecklist();
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Failed to save requirement checklist.", "alert-danger");
                }
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.value = String(pageSize);
            pageSizeSelect.addEventListener("change", function () {
                const nextValue = Number(pageSizeSelect.value);
                if (Number.isNaN(nextValue) || nextValue < 1) {
                    pageSizeSelect.value = String(pageSize);
                    return;
                }
                pageSize = Math.min(MAX_PAGE_SIZE, nextValue);
                pageSizeSelect.value = String(pageSize);
                applyFiltersAndRender(true);
            });
        }

        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }
                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(filteredRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }
                currentPage = nextPage;
                applyFiltersAndRender(false);
            });
        }

        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-requirements-application]");
                if (!trigger) {
                    return;
                }
                event.preventDefault();
                handleRequirementsApplicantSelection(trigger.getAttribute("data-requirements-application") || "");
            });
        }

        document.addEventListener("click", function (event) {
            const trigger = event.target.closest("[data-requirements-print-application]");
            if (!trigger) {
                return;
            }
            event.preventDefault();
            openRequirementsPrintModal(trigger.getAttribute("data-requirements-print-application") || "");
        });

        if (requirementsPrintFrame) {
            requirementsPrintFrame.addEventListener("load", function () {
                const loading = byId("secretaryRequirementsPrintModalLoading");
                requirementsPrintFrame.classList.remove("d-none");
                if (loading) {
                    loading.classList.add("d-none");
                }
            });
        }

        if (requirementsPrintModalEl) {
            requirementsPrintModalEl.addEventListener("hidden.bs.modal", function () {
                resetRequirementsPrintModal();
            });
        }

        if (bulkForExamBtn) {
            bulkForExamBtn.addEventListener("click", openBulkForExamModal);
        }

        if (bulkForExamProceedBtn) {
            bulkForExamProceedBtn.addEventListener("click", handleBulkForExamConfirm);
        }

        if (bulkForExamModalEl) {
            bulkForExamModalEl.addEventListener("hidden.bs.modal", function () {
                if (bulkForExamSubmitting) {
                    return;
                }
                const proceedBtn = byId("secretaryBulkForExamProceedBtn");
                const cancelBtn = byId("secretaryBulkForExamCancelBtn");
                if (proceedBtn) {
                    proceedBtn.disabled = false;
                    proceedBtn.textContent = "Move to Pending Exam";
                }
                if (cancelBtn) {
                    cancelBtn.disabled = false;
                }
            });
        }

        if (walkInBtn) {
            walkInBtn.addEventListener("click", handleOpenWalkInModal);
        }

        if (walkInForm) {
            walkInForm.addEventListener("submit", handleWalkInSubmit);
        }

        if (walkInModalEl) {
            walkInModalEl.addEventListener("hidden.bs.modal", function () {
                resetWalkInForm();
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        authContext = context;
        applyViewMeta();
        renderTableHead();
        try {
            await loadWorkflowControls(context);
        } catch (error) {
            workflowControls = readFallbackWorkflowControls();
            showStatus(error && error.message ? error.message : "Failed to load workflow controls.", "alert-warning");
        }

        bindEvents();
        applyWalkInDefaults();
        renderBulkForExamAction();
        syncWalkInAction();
        await loadApplications(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
