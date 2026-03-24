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
    const NO_BARANGAY_FILTER_VALUE = "__no_barangay__";
    const NO_BARANGAY_FILTER_LABEL = "No Barangay";
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
    let walkInSubmitting = false;
    let applicationsLoadToken = 0;

    function byId(id) {
        return document.getElementById(id);
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

    function buildPersonName(person) {
        const first = (person && person.first_name ? person.first_name : person && person.firstName ? person.firstName : "").trim();
        const middle = (person && person.middle_name ? person.middle_name : person && person.middleName ? person.middleName : "").trim();
        const last = (person && person.last_name ? person.last_name : person && person.lastName ? person.lastName : "").trim();
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
            firstName: (byId("secretaryWalkInFirstName") && byId("secretaryWalkInFirstName").value || "").trim(),
            middleName: (byId("secretaryWalkInMiddleName") && byId("secretaryWalkInMiddleName").value || "").trim(),
            lastName: (byId("secretaryWalkInLastName") && byId("secretaryWalkInLastName").value || "").trim(),
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
                '<div class="small text-muted mt-2">Share this securely with the applicant so they can sign in later and change the password.</div>' +
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
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
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
        const queueStatuses = includeDrafts
            ? ["draft", "submitted", "returned_for_correction"]
            : ["submitted", "returned_for_correction"];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const query = context.client
                .from("applications")
                .select("id, application_no, applicant_id, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
                .order("updated_at", { ascending: false })
                .in("status", queueStatuses)
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

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

    function buildQueueRows(rawRows, profileMap, correctionNoticeMap) {
        const safeProfileMap = profileMap || {};
        const safeNoticeMap = correctionNoticeMap || {};

        return (rawRows || []).map(function (row) {
            const profile = safeProfileMap[row.applicant_id] || null;
            const latestCorrectionNotice = safeNoticeMap[row.id] || null;
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile),
                barangay: profile && profile.barangay ? profile.barangay : "",
                sector_classification: row.sector_classification || "",
                latest_correction_notice: latestCorrectionNotice,
                resubmitted_for_check: isResubmittedForCheck(row, latestCorrectionNotice),
                resubmitted_notice_label: latestCorrectionNotice ? correctionNoticeLabel(latestCorrectionNotice, row) : ""
            });
        });
    }

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / pageSize);
    }

    function fillFilters(rows) {
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
        const selectedStatus = statusFilter.value || "submitted";
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

        statusFilter.innerHTML = '<option value="all">STATUS ALL</option>';
        statuses.forEach(function (status) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = statusMeta(status).label;
            statusFilter.appendChild(option);
        });
        statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "all";

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
        const barangay = byId("secretaryApplicationsBarangayFilter") ? byId("secretaryApplicationsBarangayFilter").value : "all";
        const sector = byId("secretaryApplicationsSectorFilter") ? byId("secretaryApplicationsSectorFilter").value : "all";
        const status = byId("secretaryApplicationsStatusFilter") ? byId("secretaryApplicationsStatusFilter").value : "all";
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
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No application records found.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (row) {
            const normalized = normalizeStatus(row.status);
            const meta = statusMeta(normalized);
            const submitted = row.submitted_at || row.created_at;
            const action = actionForStatus(normalized, row.id);
            const applicantName = row.applicant_name || "Unknown";
            const sectorClassification = row.sector_classification || "-";
            const resubmittedMarkup = row.resubmitted_for_check
                ? '<div class="ldss-queue-applicant-flags"><span class="ldss-chip ldss-chip-accent">Resubmitted</span></div>' +
                    '<span class="ldss-queue-applicant-note">After ' + escapeHtml(row.resubmitted_notice_label || "Correction Notice") + "</span>"
                : "";
            return (
                '<tr class="ldss-secretary-app-row" tabindex="0">' +
                '<td data-label="Applicant">' +
                '<div class="ldss-queue-applicant">' +
                '<div class="ldss-queue-applicant-body">' +
                '<span class="ldss-queue-applicant-name ldss-table-ellipsis" title="' + escapeHtml(applicantName) + '">' + escapeHtml(applicantName) + "</span>" +
                resubmittedMarkup +
                "</div>" +
                "</div>" +
                "</td>" +
                '<td data-label="Application ID">' + escapeHtml(row.application_no || "-") + "</td>" +
                '<td data-label="Sector Classification"><span class="ldss-table-ellipsis" title="' + escapeHtml(sectorClassification) + '">' + escapeHtml(sectorClassification) + "</span></td>" +
                '<td data-label="Submitted">' + escapeHtml(formatDate(submitted)) + "</td>" +
                '<td data-label="Status"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                '<td data-label="Action">' + renderActionMarkup(action, row.id) + "</td>" +
                "</tr>"
            );
        }).join("");
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

        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
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
        const correctionNoticeLoadPromise = applicationIds.length > 0
            ? loadLatestCorrectionNoticesByApplicationIds(context, applicationIds)
            : Promise.resolve({ noticeMap: {}, errorMessage: "" });

        const profileLoad = await profileLoadPromise;
        if (loadToken !== applicationsLoadToken) {
            return;
        }

        const profileMap = profileLoad.profileMap;
        allRows = buildQueueRows(rows, profileMap, {});

        if (profileLoad.failedBatchCount > 0) {
            showStatus(
                "Loaded application queue, but some applicant profiles could not be loaded. " +
                (profileLoad.lastErrorMessage ? ("Last error: " + profileLoad.lastErrorMessage) : "Please refresh and try again."),
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

        allRows = buildQueueRows(rows, profileMap, correctionNoticeLoad.noticeMap || {});
        applyFiltersAndRender(false);
    }

    function bindEvents() {
        const applyBtn = byId("secretaryApplicationsApplyFilterBtn");
        const searchInput = byId("secretaryApplicationsSearchInput");
        const barangayFilter = byId("secretaryApplicationsBarangayFilter");
        const sectorFilter = byId("secretaryApplicationsSectorFilter");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        const pagination = byId("secretaryApplicationsPagination");
        const pageSizeSelect = byId("secretaryApplicationsPageSize");
        const walkInBtn = byId("secretaryWalkInBtn");
        const walkInForm = byId("secretaryWalkInForm");
        const walkInModalEl = byId("secretaryWalkInModal");

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
        try {
            await loadWorkflowControls(context);
        } catch (error) {
            workflowControls = readFallbackWorkflowControls();
            showStatus(error && error.message ? error.message : "Failed to load workflow controls.", "alert-warning");
        }

        bindEvents();
        applyWalkInDefaults();
        syncWalkInAction();
        await loadApplications(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
