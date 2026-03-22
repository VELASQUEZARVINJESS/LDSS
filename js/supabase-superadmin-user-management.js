(function () {
    "use strict";

    const SECRETARY_CREATE_API_PATH = "/api/super-admin/secretaries";
    const USER_CONFIRM_EMAIL_API_BASE = "/api/super-admin/users";
    const USER_VERIFICATION_STATUS_API_PATH = "/api/super-admin/users/verification-status";
    const SUPABASE_FETCH_LIMIT = 1000;
    const USER_VERIFICATION_STATUS_BATCH_SIZE = 150;
    const USER_APPLICATION_LOOKUP_BATCH_SIZE = 200;
    const MIN_PASSWORD_LENGTH = 12;
    const APPLICATION_STATUS_META = {
        draft: { label: "Draft", chipClass: "ldss-chip-neutral" },
        submitted: { label: "Submitted", chipClass: "ldss-chip-success" },
        pending_exam: { label: "Pending Exam", chipClass: "ldss-chip-accent" },
        exam_scheduled: { label: "Exam Scheduled", chipClass: "ldss-chip-accent" },
        exam_completed: { label: "Exam Completed", chipClass: "ldss-chip-accent" },
        passed_exam: { label: "Passed Exam", chipClass: "ldss-chip-success" },
        failed_exam: { label: "Failed Exam", chipClass: "ldss-chip-danger" },
        special_endorsement_review: { label: "Special Endorsement Review", chipClass: "ldss-chip-accent" },
        for_interview: { label: "For Interview", chipClass: "ldss-chip-accent" },
        interview_scheduled: { label: "Interview Scheduled", chipClass: "ldss-chip-accent" },
        interview_completed: { label: "Interview Completed", chipClass: "ldss-chip-accent" },
        hard_copy_verified: { label: "Hard Copy Verified", chipClass: "ldss-chip-success" },
        for_approval: { label: "For Approval", chipClass: "ldss-chip-accent" },
        returned_for_correction: { label: "Returned for Correction", chipClass: "ldss-chip-danger" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        for_release: { label: "For Release", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };

    let userRows = [];
    let authContext = null;
    let currentPage = 1;
    let pageSize = 10;

    function authEmailHelper() {
        return window.LDSSAuthEmailHelper || null;
    }

    function auditHelper() {
        return window.LDSSSuperAdminAudit || null;
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showStatus(message, type) {
        const alert = byId("userManagementStatus");
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

    function setCreateSecretaryLoading(isLoading) {
        const btn = byId("secretaryCreateSubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Creating Secretary..." : "Create Secretary Account";
    }

    function normalizePhone(value) {
        const raw = (value || "").trim();
        const cleaned = raw.replace(/[\s()-]/g, "");
        const digits = cleaned.replace(/\D/g, "");

        if (/^09\d{9}$/.test(digits)) {
            return "+63" + digits.slice(1);
        }
        if (/^9\d{9}$/.test(digits)) {
            return "+63" + digits;
        }
        if (/^63\d{10}$/.test(digits)) {
            return "+" + digits;
        }
        if (/^\+639\d{9}$/.test(cleaned)) {
            return cleaned;
        }
        return null;
    }

    function validatePasswordSecurity(password) {
        if (/\s/.test(password)) {
            return "Password cannot contain spaces.";
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return "Password must be at least 12 characters.";
        }
        if (!/[A-Z]/.test(password)) {
            return "Password must include at least one uppercase letter.";
        }
        if (!/[a-z]/.test(password)) {
            return "Password must include at least one lowercase letter.";
        }
        if (!/[0-9]/.test(password)) {
            return "Password must include at least one number.";
        }
        if (!/[^A-Za-z0-9]/.test(password)) {
            return "Password must include at least one symbol.";
        }
        return "";
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
        const notFoundMessage = fetchOptions.notFoundMessage || "Required System Administrator API route was not found. Open the site through the Node server.";
        delete fetchOptions.notFoundMessage;
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
            const fallbackMessage = response.status === 404 ? notFoundMessage : "Request failed.";
            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
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

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function roleLabel(role) {
        const map = {
            applicant: "Applicant",
            secretary: "Secretary",
            admin: "Admin",
            super_admin: "Super Admin"
        };
        return map[role] || (role || "-");
    }

    function applicationStatusMeta(status) {
        const normalized = (status || "").toString().trim();
        if (!normalized) {
            return { label: "-", chipClass: "ldss-chip-neutral" };
        }
        if (APPLICATION_STATUS_META[normalized]) {
            return APPLICATION_STATUS_META[normalized];
        }
        return {
            label: normalized.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); }),
            chipClass: "ldss-chip-neutral"
        };
    }

    function fullName(row) {
        const parts = [
            row.first_name || "",
            row.middle_name || "",
            row.last_name || ""
        ].map(function (value) { return value.toString().trim(); })
            .filter(function (value) { return value.length > 0; });

        if (parts.length > 0) {
            return parts.join(" ");
        }
        return "-";
    }

    function displayTarget(row) {
        const name = fullName(row);
        if (row && row.email) {
            return name !== "-" ? name + " (" + row.email + ")" : row.email;
        }
        return name;
    }

    function userNameMarkup(row) {
        const fullNameText = fullName(row);
        const nameText = escapeHtml(fullNameText);
        const emailText = row && row.email
            ? escapeHtml(row.email)
            : '<span class="fst-italic">No email on file</span>';

        return (
            '<span class="ldss-user-name" title="' + escapeHtml(fullNameText) + '">' + nameText + "</span>" +
            '<span class="small text-muted d-block mt-1 text-break">' + emailText + "</span>"
        );
    }

    function statusChip(row) {
        if (row.is_active === false) {
            return '<span class="ldss-chip ldss-chip-danger">Suspended</span>';
        }
        return '<span class="ldss-chip ldss-chip-success">Active</span>';
    }

    function verificationStateForRow(row) {
        if (!row || !row.email) {
            return "no_email";
        }
        const state = (row.email_verification_state || "").toString().trim().toLowerCase();
        if (state === "verified" || state === "pending" || state === "unknown") {
            return state;
        }
        return "unknown";
    }

    function verificationMeta(row) {
        const state = verificationStateForRow(row);
        if (state === "verified") {
            return {
                state: state,
                label: "Verified",
                chipClass: "ldss-chip-success",
                text: row.email_confirmed_at ? ("Confirmed " + formatDateTime(row.email_confirmed_at)) : "Email confirmation completed."
            };
        }
        if (state === "pending") {
            return {
                state: state,
                label: "Pending",
                chipClass: "ldss-chip-accent",
                text: "Awaiting OTP email confirmation."
            };
        }
        if (state === "no_email") {
            return {
                state: state,
                label: "No Email",
                chipClass: "ldss-chip-neutral",
                text: "This account does not have an email on file."
            };
        }
        return {
            state: "unknown",
            label: "Unavailable",
            chipClass: "ldss-chip-neutral",
            text: "Verification status could not be loaded from the Node server."
        };
    }

    function verificationMarkup(row) {
        const meta = verificationMeta(row);
        return (
            '<div><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></div>" +
            '<div class="small text-muted mt-1">' + escapeHtml(meta.text) + "</div>"
        );
    }

    function latestApplicationByApplicant(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            if (!row || !row.applicant_id) {
                return;
            }

            const existing = map[row.applicant_id];
            if (!existing) {
                map[row.applicant_id] = row;
                return;
            }

            const existingTs = new Date(existing.updated_at || existing.created_at || 0).getTime();
            const currentTs = new Date(row.updated_at || row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[row.applicant_id] = row;
            }
        });
        return map;
    }

    function submissionMeta(row) {
        if (!row || row.role !== "applicant") {
            return {
                state: "staff",
                label: "Staff Account",
                chipClass: "ldss-chip-neutral"
            };
        }

        const application = row.latest_application || null;
        if (!application) {
            return {
                state: "not_submitted",
                label: "No Form",
                chipClass: "ldss-chip-neutral"
            };
        }

        if (application.submitted_at || (application.status || "").toString() !== "draft") {
            return {
                state: "submitted",
                label: "Submitted",
                chipClass: "ldss-chip-success"
            };
        }

        return {
            state: "not_submitted",
            label: "Draft Only",
            chipClass: "ldss-chip-accent"
        };
    }

    function latestApplicationMarkup(row) {
        if (!row || row.role !== "applicant") {
            return '<span class="small text-muted">N/A</span>';
        }

        const application = row.latest_application || null;
        if (!application) {
            return '<span class="small text-muted">No application record</span>';
        }

        const meta = applicationStatusMeta(application.status);
        const dateText = application.submitted_at
            ? "Submitted " + formatDate(application.submitted_at)
            : "Created " + formatDate(application.created_at);

        return (
            '<div class="fw-600">' + escapeHtml(application.application_no || "-") + "</div>" +
            '<div class="small mt-1"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></div>" +
            '<div class="small text-muted mt-1">' + escapeHtml(dateText) + "</div>"
        );
    }

    function matchesSearch(row, query) {
        if (!query) {
            return true;
        }
        const submission = submissionMeta(row);
        const verification = verificationMeta(row);
        const latestApplication = row && row.latest_application ? row.latest_application : null;
        const latestStatus = latestApplication ? applicationStatusMeta(latestApplication.status).label : "";
        const haystack = [
            fullName(row),
            row.email || "",
            row.mobile_number || "",
            roleLabel(row.role),
            verification.label,
            submission.label,
            latestApplication && latestApplication.application_no ? latestApplication.application_no : "",
            latestStatus
        ].join(" ").toLowerCase();

        return haystack.includes(query);
    }

    function filteredRows() {
        const search = (byId("userMgmtSearch") ? byId("userMgmtSearch").value : "").trim().toLowerCase();
        const roleFilter = (byId("userMgmtRoleFilter") ? byId("userMgmtRoleFilter").value : "all").trim();
        const statusFilter = (byId("userMgmtStatusFilter") ? byId("userMgmtStatusFilter").value : "all").trim();
        const verificationFilter = (byId("userMgmtVerificationFilter") ? byId("userMgmtVerificationFilter").value : "all").trim();
        const submissionFilter = (byId("userMgmtSubmissionFilter") ? byId("userMgmtSubmissionFilter").value : "all").trim();

        return userRows.filter(function (row) {
            if (roleFilter !== "all" && row.role !== roleFilter) {
                return false;
            }
            if (statusFilter === "active" && row.is_active === false) {
                return false;
            }
            if (statusFilter === "suspended" && row.is_active !== false) {
                return false;
            }
            if (verificationFilter !== "all" && verificationStateForRow(row) !== verificationFilter) {
                return false;
            }
            if (submissionFilter !== "all") {
                const submission = submissionMeta(row);
                if (submissionFilter === "submitted" && submission.state !== "submitted") {
                    return false;
                }
                if (submissionFilter === "not_submitted" && submission.state !== "not_submitted") {
                    return false;
                }
            }
            return matchesSearch(row, search);
        });
    }

    async function fetchAllProfiles() {
        const rows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await authContext.client
                .from("profiles")
                .select("id, role, email, mobile_number, first_name, middle_name, last_name, is_active, created_at")
                .order("created_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

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

    async function fetchLatestApplicationsByApplicantIds(applicantIds) {
        const latestByApplicant = {};
        const uniqueIds = Array.isArray(applicantIds)
            ? applicantIds.filter(function (value, index, array) {
                return value && array.indexOf(value) === index;
            })
            : [];

        for (let chunkStart = 0; chunkStart < uniqueIds.length; chunkStart += USER_APPLICATION_LOOKUP_BATCH_SIZE) {
            const chunk = uniqueIds.slice(chunkStart, chunkStart + USER_APPLICATION_LOOKUP_BATCH_SIZE);

            for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
                const result = await authContext.client
                    .from("applications")
                    .select("id, applicant_id, application_no, status, submitted_at, created_at, updated_at")
                    .in("applicant_id", chunk)
                    .order("updated_at", { ascending: false })
                    .range(from, from + SUPABASE_FETCH_LIMIT - 1);

                if (result.error) {
                    return {
                        data: latestByApplicant,
                        error: result.error
                    };
                }

                const batch = result.data || [];
                const latestBatch = latestApplicationByApplicant(batch);
                Object.keys(latestBatch).forEach(function (applicantId) {
                    const current = latestBatch[applicantId];
                    const existing = latestByApplicant[applicantId];

                    if (!existing) {
                        latestByApplicant[applicantId] = current;
                        return;
                    }

                    const existingTs = new Date(existing.updated_at || existing.created_at || 0).getTime();
                    const currentTs = new Date(current.updated_at || current.created_at || 0).getTime();
                    if (currentTs > existingTs) {
                        latestByApplicant[applicantId] = current;
                    }
                });

                if (batch.length < SUPABASE_FETCH_LIMIT) {
                    break;
                }
            }
        }

        return {
            data: latestByApplicant,
            error: null
        };
    }

    function getPageCount(totalRows) {
        return Math.max(1, Math.ceil((totalRows || 0) / pageSize));
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
        const info = byId("userMgmtPaginationInfo");
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
        const pagination = byId("userMgmtPagination");
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

    async function loadVerificationStatusByUserIds(userIds) {
        const ids = Array.isArray(userIds)
            ? userIds.filter(function (value, index, array) {
                return value && array.indexOf(value) === index;
            })
            : [];

        if (!ids.length) {
            return {
                statusMap: {},
                errorMessage: ""
            };
        }

        const statusMap = {};
        let lastErrorMessage = "";

        try {
            for (let start = 0; start < ids.length; start += USER_VERIFICATION_STATUS_BATCH_SIZE) {
                const batchIds = ids.slice(start, start + USER_VERIFICATION_STATUS_BATCH_SIZE);
                const payload = await requestJson(
                    USER_VERIFICATION_STATUS_API_PATH + "?ids=" + encodeURIComponent(batchIds.join(",")),
                    {
                        method: "GET",
                        notFoundMessage: "Verification status API route was not found. Open the site through the Node server."
                    }
                );
                Object.assign(statusMap, payload && payload.statuses ? payload.statuses : {});
            }

            return {
                statusMap: statusMap,
                errorMessage: ""
            };
        } catch (error) {
            lastErrorMessage = error && error.message ? error.message : "Verification status could not be loaded.";
            return {
                statusMap: statusMap,
                errorMessage: lastErrorMessage
            };
        }
    }

    async function loadUsers() {
        showStatus("");
        const profileResult = await fetchAllProfiles();

        if (profileResult.error) {
            showStatus("Failed to load users: " + profileResult.error.message, "alert-danger");
            return;
        }

        const profiles = profileResult.data || [];
        const applicantIds = profiles
            .filter(function (row) { return row.role === "applicant"; })
            .map(function (row) { return row.id; })
            .filter(Boolean);

        let latestByApplicant = {};
        if (applicantIds.length > 0) {
            const appResult = await fetchLatestApplicationsByApplicantIds(applicantIds);

            if (appResult.error) {
                showStatus("Users loaded, but application submission data could not be loaded: " + appResult.error.message, "alert-warning");
            } else {
                latestByApplicant = appResult.data || {};
            }
        }

        const verificationLoad = await loadVerificationStatusByUserIds(
            profiles.map(function (row) { return row.id; })
        );
        if (verificationLoad.errorMessage) {
            showStatus(
                "Users loaded, but email verification status could not be loaded: " + verificationLoad.errorMessage,
                "alert-warning"
            );
        }

        userRows = profiles.map(function (row) {
            const verificationStatus = verificationLoad.statusMap[row.id] || null;
            return Object.assign({}, row, {
                latest_application: latestByApplicant[row.id] || null,
                email_verification_state: verificationStatus && verificationStatus.status
                    ? verificationStatus.status
                    : (row.email ? "unknown" : "no_email"),
                email_confirmed_at: verificationStatus && verificationStatus.email_confirmed_at
                    ? verificationStatus.email_confirmed_at
                    : null
            });
        });
        renderRows(true);
    }

    function setRefreshLoading(isLoading) {
        const btn = byId("userMgmtRefreshBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Refreshing..." : "Refresh";
    }

    async function writeAuditEntry(entry) {
        const helper = auditHelper();
        if (!helper || !authContext) {
            return { ok: false, skipped: "missing_helper" };
        }

        try {
            return await helper.logEvent(authContext, entry);
        } catch (_error) {
            return { ok: false, skipped: "write_failed" };
        }
    }

    function rowActionsMarkup(row) {
        const isCurrentUser = authContext && authContext.user && authContext.user.id === row.id;
        if (isCurrentUser) {
            return '<span class="small text-muted">Current Account</span>';
        }

        const suspendOrActivateLabel = row.is_active === false ? "Activate" : "Suspend";
        const suspendOrActivateAction = row.is_active === false ? "activate" : "suspend";
        const verificationState = verificationStateForRow(row);
        const verificationActions = [];

        if (row.email && verificationState !== "verified") {
            verificationActions.push('<li><button class="dropdown-item" type="button" data-action="resend-verification" data-id="' + escapeHtml(row.id) + '">Resend Verification Email</button></li>');
            verificationActions.push('<li><button class="dropdown-item" type="button" data-action="confirm-email" data-id="' + escapeHtml(row.id) + '">Confirm Email Login</button></li>');
        }
        const verificationDivider = verificationActions.length ? '<li><hr class="dropdown-divider"></li>' : "";

        return (
            '<div class="ldss-row-actions">' +
            '<div class="dropdown w-100">' +
            '<button class="btn btn-outline-dark btn-sm dropdown-toggle w-100" type="button" data-bs-toggle="dropdown" aria-expanded="false">Options</button>' +
            '<ul class="dropdown-menu dropdown-menu-end">' +
            verificationActions.join("") +
            verificationDivider +
            '<li><button class="dropdown-item" type="button" data-action="' + suspendOrActivateAction + '" data-id="' + escapeHtml(row.id) + '">' + suspendOrActivateLabel + '</button></li>' +
            '<li><hr class="dropdown-divider"></li>' +
            '<li><button class="dropdown-item text-danger" type="button" data-action="delete" data-id="' + escapeHtml(row.id) + '">Delete</button></li>' +
            "</ul>" +
            "</div>" +
            "</div>"
        );
    }

    function renderRows(resetPage) {
        const tbody = byId("userMgmtTableBody");
        const summary = byId("userMgmtSummary");
        if (!tbody) {
            return;
        }

        const rows = filteredRows();
        if (resetPage) {
            currentPage = 1;
        }
        if (summary) {
            summary.textContent = rows.length + " user" + (rows.length === 1 ? "" : "s");
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td class="text-center py-4 text-muted" colspan="8">No users found for current filters.</td></tr>';
            renderPaginationInfo(0);
            renderPagination(0);
            return;
        }

        const pageCount = getPageCount(rows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * pageSize;
        const pageRows = rows.slice(start, start + pageSize);

        tbody.innerHTML = pageRows.map(function (row) {
            const submission = submissionMeta(row);

            return (
                '<tr class="ldss-secretary-app-row" tabindex="0">' +
                '<td class="ldss-user-col-name" data-label="Name">' + userNameMarkup(row) + "</td>" +
                '<td class="ldss-user-col-role" data-label="Role">' + escapeHtml(roleLabel(row.role)) + "</td>" +
                '<td class="ldss-user-col-verification" data-label="Email Verification">' + verificationMarkup(row) + "</td>" +
                '<td class="ldss-user-col-form" data-label="Form Status"><span class="ldss-chip ' + submission.chipClass + '">' + escapeHtml(submission.label) + "</span></td>" +
                '<td class="ldss-user-col-application" data-label="Latest Application">' + latestApplicationMarkup(row) + "</td>" +
                '<td class="ldss-user-col-status" data-label="Status">' + statusChip(row) + "</td>" +
                '<td class="ldss-user-col-created" data-label="Created">' + escapeHtml(formatDate(row.created_at)) + "</td>" +
                '<td class="ldss-user-col-actions ldss-actions-cell" data-label="Actions">' + rowActionsMarkup(row) + "</td>" +
                "</tr>"
            );
        }).join("");
        renderPaginationInfo(rows.length);
        renderPagination(rows.length);
    }

    function resetCreateSecretaryForm() {
        const form = byId("secretaryCreateForm");
        if (form) {
            form.reset();
        }
    }

    async function createSecretaryAccount(event) {
        event.preventDefault();
        showStatus("");

        const firstName = (byId("secretaryCreateFirstName") ? byId("secretaryCreateFirstName").value : "").trim();
        const middleName = (byId("secretaryCreateMiddleName") ? byId("secretaryCreateMiddleName").value : "").trim();
        const lastName = (byId("secretaryCreateLastName") ? byId("secretaryCreateLastName").value : "").trim();
        const email = (byId("secretaryCreateEmail") ? byId("secretaryCreateEmail").value : "").trim().toLowerCase();
        const mobileRaw = (byId("secretaryCreateMobile") ? byId("secretaryCreateMobile").value : "").trim();
        const password = byId("secretaryCreatePassword") ? byId("secretaryCreatePassword").value : "";
        const confirmPassword = byId("secretaryCreateConfirmPassword") ? byId("secretaryCreateConfirmPassword").value : "";

        if (!firstName || !lastName || !email || !mobileRaw || !password || !confirmPassword) {
            showStatus("Complete all secretary account fields before creating access.", "alert-danger");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showStatus("Enter a valid email address.", "alert-danger");
            return;
        }
        const mobileNumber = normalizePhone(mobileRaw);
        if (!mobileNumber) {
            showStatus("Enter a valid mobile number (example: 09XXXXXXXXX).", "alert-danger");
            return;
        }
        const passwordPolicyError = validatePasswordSecurity(password);
        if (passwordPolicyError) {
            showStatus(passwordPolicyError, "alert-danger");
            return;
        }
        if (password !== confirmPassword) {
            showStatus("Password and Confirm Password do not match.", "alert-danger");
            return;
        }

        setCreateSecretaryLoading(true);
        try {
            const payload = await requestJson(SECRETARY_CREATE_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    firstName: firstName,
                    middleName: middleName,
                    lastName: lastName,
                    email: email,
                    mobileNumber: mobileNumber,
                    password: password
                })
            });

            resetCreateSecretaryForm();
            showStatus(
                "Secretary account created successfully for " + (((payload.user && payload.user.email) || email).toString()) + ".",
                "alert-success"
            );
            await loadUsers();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to create secretary account.", "alert-danger");
        } finally {
            setCreateSecretaryLoading(false);
        }
    }

    async function updateUserActiveState(userId, shouldBeActive) {
        const row = userRows.find(function (item) {
            return item && item.id === userId;
        }) || null;
        const actionLabel = shouldBeActive ? "activate" : "suspend";
        const confirmed = window.confirm(
            (shouldBeActive ? "Activate" : "Suspend") + " this user account?"
        );
        if (!confirmed) {
            return;
        }

        showStatus("");
        const result = await authContext.client
            .from("profiles")
            .update({ is_active: shouldBeActive })
            .eq("id", userId);

        if (result.error) {
            showStatus("Failed to " + actionLabel + " user: " + result.error.message, "alert-danger");
            return;
        }

        showStatus("User account updated successfully.", "alert-success");
        await writeAuditEntry({
            module: "user_management",
            action: shouldBeActive ? "activate_user_account" : "suspend_user_account",
            targetUserId: row && row.id ? row.id : userId,
            targetRole: row && row.role ? row.role : "",
            targetEmail: row && row.email ? row.email : "",
            targetLabel: row ? displayTarget(row) : "",
            recordType: "user",
            recordId: userId,
            summary: (shouldBeActive ? "Activated user account for " : "Suspended user account for ") + (row ? displayTarget(row) : userId) + ".",
            details: {
                is_active: shouldBeActive
            }
        });
        await loadUsers();
    }

    async function resendVerificationEmail(userId) {
        const row = userRows.find(function (item) {
            return item && item.id === userId;
        }) || null;
        const helper = authEmailHelper();

        if (!row || !row.email) {
            showStatus("Selected user does not have an email address on file.", "alert-warning");
            return;
        }

        const confirmed = window.confirm(
            "Send a new verification email to this user?\n\nTarget: " + displayTarget(row)
        );
        if (!confirmed) {
            return;
        }

        const resendResult = await authContext.client.auth.resend({
            type: "signup",
            email: row.email,
            options: {
                emailRedirectTo: helper && typeof helper.resolveEmailConfirmRedirectUrl === "function"
                    ? helper.resolveEmailConfirmRedirectUrl()
                    : undefined
            }
        });

        if (resendResult.error) {
            throw new Error(
                helper && typeof helper.getErrorMessage === "function"
                    ? helper.getErrorMessage(resendResult.error, "Failed to resend verification email.")
                    : (resendResult.error.message || "Failed to resend verification email.")
            );
        }

        showStatus("Verification email resent successfully to " + row.email + ".", "alert-success");
        await writeAuditEntry({
            module: "user_management",
            action: "resend_verification_email",
            targetUserId: row.id,
            targetRole: row.role,
            targetEmail: row.email,
            targetLabel: displayTarget(row),
            recordType: "user",
            recordId: row.id,
            summary: "Resent verification email to " + row.email + ".",
            details: {
                email_verification_state: verificationStateForRow(row)
            }
        });
    }

    async function confirmUserEmailLogin(userId) {
        const row = userRows.find(function (item) {
            return item && item.id === userId;
        }) || null;
        const targetLabel = displayTarget(row);
        const confirmed = window.confirm(
            "Manually confirm this account for email login?\n\nUse this only when the user cannot complete the verification email step.\n\nTarget: " + targetLabel
        );
        if (!confirmed) {
            return;
        }

        showStatus("");
        const payload = await requestJson(USER_CONFIRM_EMAIL_API_BASE + "/" + encodeURIComponent(userId) + "/confirm-email", {
            method: "POST",
            notFoundMessage: "Manual email confirmation API route was not found. Open the site through the Node server."
        });

        const confirmedEmail = payload && payload.user && payload.user.email
            ? payload.user.email
            : (row && row.email ? row.email : targetLabel);

        showStatus("Email login confirmed successfully for " + confirmedEmail + ".", "alert-success");
        await loadUsers();
    }

    async function deleteUser(userId) {
        const row = userRows.find(function (item) {
            return item && item.id === userId;
        }) || null;
        const confirmed = window.confirm(
            "Delete this user account permanently? This removes login access and related profile data."
        );
        if (!confirmed) {
            return;
        }

        showStatus("");
        const rpcResult = await authContext.client.rpc("super_admin_delete_user", { p_user_id: userId });
        if (rpcResult.error) {
            const fallback = await authContext.client
                .from("profiles")
                .delete()
                .eq("id", userId);

            if (fallback.error) {
                showStatus("Failed to delete user: " + rpcResult.error.message, "alert-danger");
                return;
            }

            showStatus("Profile deleted. Auth user may still exist until delete RPC is deployed.", "alert-warning");
            await writeAuditEntry({
                module: "user_management",
                action: "delete_user_account",
                targetUserId: "",
                targetRole: row && row.role ? row.role : "",
                targetEmail: row && row.email ? row.email : "",
                targetLabel: row ? displayTarget(row) : "",
                recordType: "user",
                recordId: userId,
                summary: "Deleted profile for " + (row ? displayTarget(row) : userId) + ".",
                details: {
                    fallback_profile_delete_only: true
                }
            });
            await loadUsers();
            return;
        }

        showStatus("User deleted successfully.", "alert-success");
        await writeAuditEntry({
            module: "user_management",
            action: "delete_user_account",
            targetUserId: "",
            targetRole: row && row.role ? row.role : "",
            targetEmail: row && row.email ? row.email : "",
            targetLabel: row ? displayTarget(row) : "",
            recordType: "user",
            recordId: userId,
            summary: "Deleted user account for " + (row ? displayTarget(row) : userId) + ".",
            details: {
                auth_delete_completed: true
            }
        });
        await loadUsers();
    }

    async function onTableActionClick(event) {
        const trigger = event.target.closest("button[data-action][data-id]");
        if (!trigger) {
            return;
        }

        const action = trigger.getAttribute("data-action");
        const userId = trigger.getAttribute("data-id");
        if (!action || !userId) {
            return;
        }

        trigger.disabled = true;
        try {
            if (action === "confirm-email") {
                await confirmUserEmailLogin(userId);
            } else if (action === "resend-verification") {
                await resendVerificationEmail(userId);
            } else if (action === "suspend") {
                await updateUserActiveState(userId, false);
            } else if (action === "activate") {
                await updateUserActiveState(userId, true);
            } else if (action === "delete") {
                await deleteUser(userId);
            }
        } finally {
            trigger.disabled = false;
        }
    }

    function bindEvents() {
        const table = byId("userMgmtTableBody");
        const refreshBtn = byId("userMgmtRefreshBtn");
        const applyBtn = byId("userMgmtApplyFilterBtn");
        const createForm = byId("secretaryCreateForm");
        const pageSizeInput = byId("userMgmtPageSize");
        const pagination = byId("userMgmtPagination");

        ["userMgmtSearch", "userMgmtRoleFilter", "userMgmtStatusFilter", "userMgmtVerificationFilter", "userMgmtSubmissionFilter"].forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", function () {
                renderRows(true);
            });
            input.addEventListener("change", function () {
                renderRows(true);
            });
        });

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                renderRows(true);
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async function () {
                setRefreshLoading(true);
                try {
                    await loadUsers();
                } finally {
                    setRefreshLoading(false);
                }
            });
        }

        if (pageSizeInput) {
            pageSizeInput.addEventListener("change", function () {
                const nextSize = Number(pageSizeInput.value || 10);
                pageSize = Number.isNaN(nextSize) || nextSize <= 0 ? 10 : nextSize;
                renderRows(true);
            });
        }

        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page") || 0);
                const pageCount = getPageCount(filteredRows().length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount || nextPage === currentPage) {
                    return;
                }

                currentPage = nextPage;
                renderRows(false);
            });
        }

        if (table) {
            table.addEventListener("click", function (event) {
                onTableActionClick(event).catch(function (error) {
                    showStatus(error && error.message ? error.message : "User action failed.", "alert-danger");
                });
            });
        }

        if (createForm) {
            createForm.addEventListener("submit", function (event) {
                createSecretaryAccount(event).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to create secretary account.", "alert-danger");
                });
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }
        if (authContext.role !== "super_admin") {
            showStatus("Only Super Admin can access this module.", "alert-warning");
            return;
        }

        bindEvents();
        setRefreshLoading(true);
        try {
            await loadUsers();
        } finally {
            setRefreshLoading(false);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
