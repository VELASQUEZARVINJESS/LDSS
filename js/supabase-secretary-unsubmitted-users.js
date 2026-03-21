(function () {
    "use strict";

    const PAGE_SIZE_DEFAULT = 10;
    const SUPABASE_FETCH_LIMIT = 1000;
    const REMINDER_CAMPAIGN_API_PATH = "/api/notifications/reminder-campaign";
    const REMINDER_CAMPAIGN_JOBS_TABLE = "reminder_campaign_jobs";
    const REMINDER_LOGS_TABLE = "reminder_email_logs";
    const REMINDER_CAMPAIGN_STATUS_POLL_MS = 15000;
    const REMINDER_COOLDOWN_DAYS = {
        draft_only: 5,
        no_application: 7,
        returned_resubmission: 3
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
    let pageSize = PAGE_SIZE_DEFAULT;
    let barangayLookup = null;
    let authContext = null;
    let reminderCampaignModalInstance = null;
    let reminderLogLookup = {};
    let currentReminderCampaignJobId = "";
    let reminderCampaignStatusPollHandle = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function getReminderCampaignModal() {
        if (!reminderCampaignModalInstance) {
            const modalEl = byId("secretaryReminderCampaignModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                reminderCampaignModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return reminderCampaignModalInstance;
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
        return getBarangayLookup()[key] || (value || "").toString().trim();
    }

    function buildApplicantName(profile) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        return profile && profile.email ? profile.email : "Unknown Applicant";
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function showStatus(message, type) {
        const box = byId("secretaryNoFormStatus");
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

    function setReminderCampaignStatus(message, type) {
        const box = byId("secretaryReminderCampaignStatus");
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

    function setText(id, value) {
        const element = byId(id);
        if (element) {
            element.textContent = value;
        }
    }

    function reminderCampaignTypeLabel(type) {
        if (type === "draft_only") {
            return "Draft Only";
        }
        if (type === "no_application") {
            return "No Application Yet";
        }
        return "All Filtered Users";
    }

    function reminderCampaignStatusLabel(status) {
        if (status === "processing") {
            return "Sending";
        }
        if (status === "completed") {
            return "Completed";
        }
        if (status === "failed") {
            return "Failed";
        }
        if (status === "cancelled") {
            return "Cancelled";
        }
        return "Queued";
    }

    function reminderCampaignBadgeClass(status) {
        if (status === "processing") {
            return "badge bg-primary";
        }
        if (status === "completed") {
            return "badge bg-success";
        }
        if (status === "failed") {
            return "badge bg-danger";
        }
        if (status === "cancelled") {
            return "badge bg-dark";
        }
        return "badge bg-warning text-dark";
    }

    function reminderCampaignProgressClasses(status) {
        if (status === "processing") {
            return "progress-bar progress-bar-striped progress-bar-animated bg-primary";
        }
        if (status === "completed") {
            return "progress-bar bg-success";
        }
        if (status === "failed") {
            return "progress-bar bg-danger";
        }
        if (status === "cancelled") {
            return "progress-bar bg-dark";
        }
        return "progress-bar bg-warning";
    }

    function hideReminderCampaignError() {
        const wrap = byId("secretaryReminderJobErrorWrap");
        const messageBox = byId("secretaryReminderJobError");
        if (wrap) {
            wrap.classList.add("d-none");
        }
        if (messageBox) {
            messageBox.textContent = "";
        }
    }

    function showReminderCampaignError(message) {
        const wrap = byId("secretaryReminderJobErrorWrap");
        const messageBox = byId("secretaryReminderJobError");
        if (wrap) {
            wrap.classList.remove("d-none");
        }
        if (messageBox) {
            messageBox.textContent = message;
        }
    }

    function renderReminderCampaignIndicatorEmpty(message, details) {
        const badge = byId("secretaryReminderJobBadge");
        const progressBar = byId("secretaryReminderJobProgressBar");

        if (badge) {
            badge.className = "badge bg-secondary";
            badge.textContent = "No Campaign Yet";
        }
        setText("secretaryReminderJobHeadline", message || "No queued reminder campaign yet.");
        setText(
            "secretaryReminderJobMeta",
            details || "Single-recipient reminders send immediately and update the Last Reminder column."
        );
        setText("secretaryReminderJobTiming", "Waiting for reminder campaign activity.");
        setText("secretaryReminderJobTotal", "0");
        setText("secretaryReminderJobSent", "0");
        setText("secretaryReminderJobSkipped", "0");
        setText("secretaryReminderJobFailed", "0");

        if (progressBar) {
            progressBar.className = "progress-bar";
            progressBar.style.width = "0%";
            progressBar.setAttribute("aria-valuenow", "0");
            progressBar.textContent = "0%";
        }

        hideReminderCampaignError();
    }

    function selectReminderCampaignJob(rows) {
        const jobRows = Array.isArray(rows) ? rows : [];
        let selectedJob = null;

        if (currentReminderCampaignJobId) {
            selectedJob = jobRows.find(function (row) {
                return row && row.id === currentReminderCampaignJobId;
            }) || null;
            if (!selectedJob) {
                currentReminderCampaignJobId = "";
            }
        }

        if (!selectedJob) {
            selectedJob = jobRows.find(function (row) {
                const status = ((row && row.status) || "").toString().trim().toLowerCase();
                return status === "queued" || status === "processing";
            }) || null;
        }

        return selectedJob || jobRows[0] || null;
    }

    function renderReminderCampaignIndicator(job) {
        if (!job) {
            renderReminderCampaignIndicatorEmpty();
            return;
        }

        const status = ((job.status || "queued").toString().trim().toLowerCase()) || "queued";
        const totalRecipients = Math.max(0, Number(job.total_recipients) || 0);
        const processedCount = Math.max(0, Number(job.processed_count) || 0);
        const sentCount = Math.max(0, Number(job.sent_count) || 0);
        const skippedCount = Math.max(0, Number(job.skipped_count) || 0);
        const failedCount = Math.max(0, Number(job.failed_count) || 0);
        const batchSize = Math.max(1, Number(job.batch_size) || 100);
        const batchDelayMinutes = Math.max(1, Number(job.batch_delay_minutes) || 10);
        const progressPercent = totalRecipients > 0
            ? Math.max(0, Math.min(100, Math.round((processedCount / totalRecipients) * 100)))
            : 0;
        const badge = byId("secretaryReminderJobBadge");
        const progressBar = byId("secretaryReminderJobProgressBar");
        const campaignLabel = reminderCampaignTypeLabel(job.campaign_type);
        let headline = campaignLabel + " reminder campaign is queued.";
        let timingText = "Created " + formatDateTime(job.created_at) + ".";

        if (status === "processing") {
            headline = campaignLabel + " reminder campaign is now sending emails.";
            timingText = "Started " + formatDateTime(job.started_at || job.created_at) +
                ". Last updated " + formatDateTime(job.updated_at || job.started_at || job.created_at) + ".";
        } else if (status === "completed") {
            headline = campaignLabel + " reminder campaign finished sending.";
            timingText = "Completed " + formatDateTime(job.completed_at || job.updated_at || job.created_at) + ".";
        } else if (status === "failed") {
            headline = campaignLabel + " reminder campaign stopped before completion.";
            timingText = "Last updated " + formatDateTime(job.updated_at || job.completed_at || job.created_at) + ".";
        } else if (status === "cancelled") {
            headline = campaignLabel + " reminder campaign was cancelled.";
            timingText = "Last updated " + formatDateTime(job.updated_at || job.created_at) + ".";
        } else if (job.next_run_at) {
            timingText = "Next batch " + formatDateTime(job.next_run_at) + ".";
        }

        if (badge) {
            badge.className = reminderCampaignBadgeClass(status);
            badge.textContent = reminderCampaignStatusLabel(status);
        }
        setText("secretaryReminderJobHeadline", headline);
        setText(
            "secretaryReminderJobMeta",
            "Processed " + processedCount + " of " + totalRecipients +
            " recipients. Batch size " + batchSize + " every " + batchDelayMinutes +
            " minutes. Sent " + sentCount + ", skipped " + skippedCount + ", failed " + failedCount + "."
        );
        setText("secretaryReminderJobTiming", timingText);
        setText("secretaryReminderJobTotal", String(totalRecipients));
        setText("secretaryReminderJobSent", String(sentCount));
        setText("secretaryReminderJobSkipped", String(skippedCount));
        setText("secretaryReminderJobFailed", String(failedCount));

        if (progressBar) {
            progressBar.className = reminderCampaignProgressClasses(status);
            progressBar.style.width = progressPercent + "%";
            progressBar.setAttribute("aria-valuenow", String(progressPercent));
            progressBar.textContent = progressPercent + "%";
        }

        if (job.last_error) {
            showReminderCampaignError(job.last_error);
        } else {
            hideReminderCampaignError();
        }
    }

    async function fetchReminderCampaignJobs(context) {
        return context.client
            .from(REMINDER_CAMPAIGN_JOBS_TABLE)
            .select("id, campaign_type, total_recipients, processed_count, sent_count, skipped_count, failed_count, batch_size, batch_delay_minutes, status, next_run_at, started_at, completed_at, last_error, created_at, updated_at, created_by")
            .eq("created_by", context.user.id)
            .order("created_at", { ascending: false })
            .limit(10);
    }

    async function refreshReminderCampaignIndicator() {
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        const result = await fetchReminderCampaignJobs(authContext);
        if (result.error) {
            renderReminderCampaignIndicatorEmpty(
                "Reminder campaign activity could not be loaded.",
                "The batch email queue is available, but the live status panel could not read the latest campaign."
            );
            showReminderCampaignError(result.error.message || "Unable to load reminder campaign progress.");
            return;
        }

        const job = selectReminderCampaignJob(result.data || []);
        if (job) {
            currentReminderCampaignJobId = job.id || currentReminderCampaignJobId;
        }
        renderReminderCampaignIndicator(job);
    }

    function startReminderCampaignStatusPolling() {
        if (reminderCampaignStatusPollHandle) {
            window.clearInterval(reminderCampaignStatusPollHandle);
        }
        reminderCampaignStatusPollHandle = window.setInterval(function () {
            refreshReminderCampaignIndicator().catch(function () {
                // Keep polling quiet; the status card already explains the failure state.
            });
        }, REMINDER_CAMPAIGN_STATUS_POLL_MS);
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
            throw new Error(payload && payload.error ? payload.error : "Request failed.");
        }

        return payload || {};
    }

    function reminderLookupKey(applicantId, reminderType) {
        return (applicantId || "") + "::" + (reminderType || "");
    }

    function cooldownDaysForType(reminderType) {
        return REMINDER_COOLDOWN_DAYS[reminderType] || 7;
    }

    function addDaysToIso(value, days) {
        const parsed = new Date(value || "");
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        parsed.setDate(parsed.getDate() + days);
        return parsed.toISOString();
    }

    function buildReminderLogLookup(logRows) {
        const lookup = {};
        (logRows || []).forEach(function (row) {
            if (!row || row.status !== "sent" || !row.applicant_id || !row.reminder_type || !row.sent_at) {
                return;
            }
            const key = reminderLookupKey(row.applicant_id, row.reminder_type);
            if (!lookup[key]) {
                lookup[key] = {
                    lastSentAt: row.sent_at,
                    timesSent: 1
                };
                return;
            }
            lookup[key].timesSent += 1;
            if (new Date(row.sent_at).getTime() > new Date(lookup[key].lastSentAt).getTime()) {
                lookup[key].lastSentAt = row.sent_at;
            }
        });
        return lookup;
    }

    function applyReminderLogStateToRows() {
        allRows.forEach(function (row) {
            const type = reminderStateKey(row);
            const logMeta = reminderLogLookup[reminderLookupKey(row.id, type)] || null;
            row.last_reminder_sent_at = logMeta ? logMeta.lastSentAt : "";
            row.reminder_times_sent = logMeta ? logMeta.timesSent : 0;
            row.cooldown_until = logMeta ? addDaysToIso(logMeta.lastSentAt, cooldownDaysForType(type)) : "";
        });
    }

    function isCooldownActiveForRow(row) {
        if (!row || !row.cooldown_until) {
            return false;
        }
        const parsed = new Date(row.cooldown_until);
        return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
    }

    async function fetchReminderLogs(context, applicantIds) {
        const uniqueIds = Array.from(new Set((applicantIds || []).filter(Boolean)));
        if (!uniqueIds.length) {
            return { data: [], error: null };
        }

        const rows = [];
        for (let index = 0; index < uniqueIds.length; index += 200) {
            const batchIds = uniqueIds.slice(index, index + 200);
            const result = await context.client
                .from(REMINDER_LOGS_TABLE)
                .select("applicant_id, reminder_type, status, sent_at")
                .in("applicant_id", batchIds)
                .eq("channel", "email")
                .order("sent_at", { ascending: false });

            if (result.error) {
                return {
                    data: rows,
                    error: result.error
                };
            }

            rows.push.apply(rows, result.data || []);
        }

        return {
            data: rows,
            error: null
        };
    }

    async function refreshReminderLogState(context) {
        if (!context || !allRows.length) {
            reminderLogLookup = {};
            applyReminderLogStateToRows();
            return;
        }

        const result = await fetchReminderLogs(context, allRows.map(function (row) { return row.id; }));
        if (result.error) {
            reminderLogLookup = {};
            applyReminderLogStateToRows();
            showStatus("Reminder cooldown history is unavailable. Run the reminder log SQL hotfix first.", "alert-warning");
            return;
        }

        reminderLogLookup = buildReminderLogLookup(result.data || []);
        applyReminderLogStateToRows();
    }

    function pageCount(totalRows) {
        if (totalRows <= 0) {
            return 1;
        }
        return Math.ceil(totalRows / pageSize);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' +
            escapeHtml(label) +
            "</button>" +
            "</li>"
        );
    }

    function renderMetrics(rows) {
        const draftOnly = rows.filter(function (row) { return row.form_state === "Draft Only"; }).length;
        const noApplication = rows.filter(function (row) { return row.form_state === "No Application Yet"; }).length;

        if (byId("secretaryNoFormTotal")) {
            byId("secretaryNoFormTotal").textContent = String(rows.length);
        }
        if (byId("secretaryNoFormDraftOnly")) {
            byId("secretaryNoFormDraftOnly").textContent = String(draftOnly);
        }
        if (byId("secretaryNoFormNoApplication")) {
            byId("secretaryNoFormNoApplication").textContent = String(noApplication);
        }
    }

    function renderTable(rows) {
        const tbody = byId("secretaryNoFormTableBody");
        if (!tbody) {
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No users matched the current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const canSend = !!row.email;
            const cooldownActive = isCooldownActiveForRow(row);
            const disabled = !canSend || cooldownActive;
            const buttonLabel = cooldownActive ? "Cooldown" : "Send";
            const disabledTitle = !canSend
                ? ' title="No email on file"'
                : (cooldownActive ? ' title="Reminder is still in cooldown"' : "");
            const lastReminderMarkup = row.last_reminder_sent_at
                ? '<span class="d-block">' + escapeHtml(formatDateTime(row.last_reminder_sent_at)) + '</span><span class="small text-muted">' + escapeHtml(String(row.reminder_times_sent || 1)) + ' sent</span>'
                : '<span class="text-muted">-</span>';
            const actionMeta = cooldownActive
                ? '<div class="small text-muted mt-1">Again ' + escapeHtml(formatDate(row.cooldown_until)) + "</div>"
                : (!canSend ? '<div class="small text-muted mt-1">No email</div>' : "");
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.applicant_name) + "</td>" +
                "<td>" + escapeHtml(row.barangay || "No Barangay") + "</td>" +
                "<td>" + escapeHtml(row.email || "-") + "</td>" +
                "<td>" + escapeHtml(row.form_state) + "</td>" +
                "<td>" + escapeHtml(formatDate(row.created_at)) + "</td>" +
                "<td>" + lastReminderMarkup + "</td>" +
                '<td class="text-end"><button class="btn btn-outline-dark btn-sm secretary-no-form-send-btn" type="button" data-user-id="' + escapeHtml(row.id) + '" data-campaign-type="' + escapeHtml(reminderStateKey(row)) + '"' + (disabled ? " disabled" : "") + disabledTitle + ">" + escapeHtml(buttonLabel) + "</button>" + actionMeta + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("secretaryNoFormPaginationInfo");
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
        const pagination = byId("secretaryNoFormPagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const totalPages = pageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", currentPage - 1, currentPage <= 1, false, "Previous page"));

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === currentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", currentPage + 1, currentPage >= totalPages, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function reminderStateKey(row) {
        return row && row.form_state === "Draft Only" ? "draft_only" : "no_application";
    }

    function reminderSubjectPreview(type) {
        if (type === "draft_only") {
            return "Complete Your LDSP Application";
        }
        if (type === "no_application") {
            return "LDSP Application Reminder";
        }
        return "LDSP Application Reminder Campaign";
    }

    function campaignRows(type) {
        if (type === "draft_only") {
            return filteredRows.filter(function (row) { return reminderStateKey(row) === "draft_only"; });
        }
        if (type === "no_application") {
            return filteredRows.filter(function (row) { return reminderStateKey(row) === "no_application"; });
        }
        return filteredRows.slice();
    }

    function updateReminderCampaignPreview() {
        const type = ((byId("secretaryReminderCampaignType") || {}).value || "all_visible").toString();
        const rows = campaignRows(type);
        const emailReadyCount = rows.filter(function (row) { return !!row.email; }).length;
        const missingEmailCount = rows.length - emailReadyCount;
        const cooldownCount = rows.filter(function (row) { return isCooldownActiveForRow(row); }).length;
        const readyNowCount = rows.filter(function (row) { return !!row.email && !isCooldownActiveForRow(row); }).length;
        const draftCount = rows.filter(function (row) { return reminderStateKey(row) === "draft_only"; }).length;
        const noApplicationCount = rows.length - draftCount;
        const sendBtn = byId("secretaryReminderCampaignSendBtn");

        if (byId("secretaryReminderRecipientCount")) {
            byId("secretaryReminderRecipientCount").textContent = String(rows.length);
        }
        if (byId("secretaryReminderEmailReadyCount")) {
            byId("secretaryReminderEmailReadyCount").textContent = String(emailReadyCount);
        }
        if (byId("secretaryReminderMissingEmailCount")) {
            byId("secretaryReminderMissingEmailCount").textContent = String(missingEmailCount);
        }
        if (byId("secretaryReminderSubjectPreview")) {
            byId("secretaryReminderSubjectPreview").textContent = reminderSubjectPreview(type);
        }
        if (byId("secretaryReminderSummaryText")) {
            byId("secretaryReminderSummaryText").textContent =
                "Using the current filters. Draft Only: " + draftCount +
                ". No Application Yet: " + noApplicationCount +
                ". Ready now: " + readyNowCount +
                ". In cooldown: " + cooldownCount +
                ". Users without email will be skipped automatically. Multi-user campaigns are queued and sent in background batches.";
        }
        if (sendBtn) {
            sendBtn.disabled = !readyNowCount;
        }
    }

    function openReminderCampaignModal() {
        updateReminderCampaignPreview();
        setReminderCampaignStatus("");
        const modal = getReminderCampaignModal();
        if (modal) {
            modal.show();
        }
    }

    async function sendReminderCampaign() {
        const type = ((byId("secretaryReminderCampaignType") || {}).value || "all_visible").toString();
        const rows = campaignRows(type);
        const sendBtn = byId("secretaryReminderCampaignSendBtn");

        if (!rows.length) {
            setReminderCampaignStatus("No users match the selected reminder group right now.", "alert-warning");
            return;
        }

        try {
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.textContent = "Sending...";
            }
            setReminderCampaignStatus("");

            const result = await requestJson(REMINDER_CAMPAIGN_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    campaignType: type,
                    recipientIds: rows.map(function (row) { return row.id; })
                })
            });

            if (result && result.queued) {
                const totalRecipients = Number(result.totalRecipients || rows.length || 0);
                const batchSize = Number(result.batchSize || 100);
                const batchDelayMinutes = Number(result.batchDelayMinutes || 10);
                const estimatedBatches = Number(result.estimatedBatches || Math.ceil(totalRecipients / Math.max(1, batchSize)));
                const queuedSummary = "Reminder campaign queued for " + totalRecipients + " recipients. The server will send up to " + batchSize + " emails every " + batchDelayMinutes + " minutes in about " + estimatedBatches + " batch(es).";
                currentReminderCampaignJobId = (result.jobId || "").toString();
                showStatus(queuedSummary, "alert-info");
                setReminderCampaignStatus(queuedSummary + " You may close this window while it continues in the background.", "alert-info");
                await refreshReminderCampaignIndicator();
                const modal = getReminderCampaignModal();
                if (modal) {
                    window.setTimeout(function () {
                        modal.hide();
                    }, 900);
                }
                return;
            }

            const sentCount = Number(result.sentCount || 0);
            const skippedCount = Number(result.skippedCount || 0);
            const failedCount = Number(result.failedCount || 0);
            const summary = "Reminder campaign finished. Sent " + sentCount + ", skipped " + skippedCount + ", failed " + failedCount + ".";

            showStatus(summary, failedCount > 0 ? "alert-warning" : "alert-success");
            setReminderCampaignStatus(summary, failedCount > 0 ? "alert-warning" : "alert-success");
            await refreshReminderLogState(authContext);
            applyFilters(false);
            await refreshReminderCampaignIndicator();

            const modal = getReminderCampaignModal();
            if (modal && failedCount === 0) {
                window.setTimeout(function () {
                    modal.hide();
                }, 600);
            }
        } catch (error) {
            setReminderCampaignStatus(error && error.message ? error.message : "Reminder campaign failed.", "alert-danger");
        } finally {
            updateReminderCampaignPreview();
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.textContent = "Send Reminder Emails";
            }
        }
    }

    function rowById(userId) {
        for (let index = 0; index < allRows.length; index += 1) {
            if (allRows[index] && allRows[index].id === userId) {
                return allRows[index];
            }
        }
        return null;
    }

    async function sendSingleReminder(userId, campaignType, triggerButton) {
        const row = rowById(userId);
        if (!row) {
            showStatus("Selected user was not found anymore.", "alert-warning");
            return;
        }
        if (!row.email) {
            showStatus("This applicant has no email address on file.", "alert-warning");
            return;
        }

        const originalLabel = triggerButton ? triggerButton.textContent : "";

        try {
            if (triggerButton) {
                triggerButton.disabled = true;
                triggerButton.textContent = "Sending...";
            }

            const result = await requestJson(REMINDER_CAMPAIGN_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    campaignType: campaignType || reminderStateKey(row),
                    recipientIds: [row.id]
                })
            });

            const sentCount = Number(result.sentCount || 0);
            const failedCount = Number(result.failedCount || 0);
            const skippedCount = Number(result.skippedCount || 0);
            const summary = "Reminder for " + row.applicant_name + ": sent " + sentCount + ", skipped " + skippedCount + ", failed " + failedCount + ".";
            showStatus(summary, failedCount > 0 ? "alert-warning" : "alert-success");
            await refreshReminderLogState(authContext);
            applyFilters(false);
            await refreshReminderCampaignIndicator();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to send reminder email.", "alert-danger");
        } finally {
            if (triggerButton) {
                triggerButton.disabled = false;
                triggerButton.textContent = originalLabel || "Send";
            }
        }
    }

    function applyFilters(resetPage) {
        const searchValue = ((byId("secretaryNoFormSearchInput") || {}).value || "").toString().trim().toLowerCase();
        const barangayValue = ((byId("secretaryNoFormBarangayFilter") || {}).value || "all").toString();
        const typeValue = ((byId("secretaryNoFormTypeFilter") || {}).value || "all").toString();

        filteredRows = allRows.filter(function (row) {
            const matchesSearch = !searchValue || row.applicant_name.toLowerCase().indexOf(searchValue) !== -1;
            const matchesBarangay = barangayValue === "all" || (row.barangay || "No Barangay") === barangayValue;
            const matchesType =
                typeValue === "all" ||
                (typeValue === "draft_only" && row.form_state === "Draft Only") ||
                (typeValue === "no_application" && row.form_state === "No Application Yet");
            return matchesSearch && matchesBarangay && matchesType;
        });

        renderMetrics(filteredRows);

        if (resetPage) {
            currentPage = 1;
        }

        const totalPages = pageCount(filteredRows.length);
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);

        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
        updateReminderCampaignPreview();
    }

    function populateBarangayFilter(rows) {
        const select = byId("secretaryNoFormBarangayFilter");
        if (!select) {
            return;
        }
        const currentValue = select.value || "all";
        const options = Array.from(new Set(rows.map(function (row) {
            return row.barangay || "No Barangay";
        }))).sort(function (left, right) {
            if (left === "No Barangay") {
                return 1;
            }
            if (right === "No Barangay") {
                return -1;
            }
            return left.localeCompare(right);
        });

        select.innerHTML = '<option value="all">All</option>' + options.map(function (barangay) {
            return '<option value="' + escapeHtml(barangay) + '">' + escapeHtml(barangay) + "</option>";
        }).join("");

        if (options.indexOf(currentValue) !== -1 || currentValue === "all") {
            select.value = currentValue;
        }
    }

    function bindEvents() {
        const applyBtn = byId("secretaryNoFormApplyFilterBtn");
        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFilters(true);
            });
        }

        const reminderBtn = byId("secretaryReminderCampaignBtn");
        if (reminderBtn) {
            reminderBtn.addEventListener("click", openReminderCampaignModal);
        }

        const reminderTypeSelect = byId("secretaryReminderCampaignType");
        if (reminderTypeSelect) {
            reminderTypeSelect.addEventListener("change", updateReminderCampaignPreview);
        }

        const reminderSendBtn = byId("secretaryReminderCampaignSendBtn");
        if (reminderSendBtn) {
            reminderSendBtn.addEventListener("click", function () {
                sendReminderCampaign();
            });
        }

        const pageSizeSelect = byId("secretaryNoFormPageSize");
        if (pageSizeSelect) {
            pageSizeSelect.addEventListener("change", function () {
                pageSize = Math.max(1, Number(pageSizeSelect.value || PAGE_SIZE_DEFAULT));
                applyFilters(true);
            });
        }

        const pagination = byId("secretaryNoFormPagination");
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }
                const nextPage = Number(button.getAttribute("data-page"));
                const totalPages = pageCount(filteredRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > totalPages) {
                    return;
                }
                currentPage = nextPage;
                applyFilters(false);
            });
        }

        const tableBody = byId("secretaryNoFormTableBody");
        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const button = event.target.closest(".secretary-no-form-send-btn");
                if (!button || button.disabled) {
                    return;
                }
                sendSingleReminder(
                    (button.getAttribute("data-user-id") || "").toString(),
                    (button.getAttribute("data-campaign-type") || "").toString(),
                    button
                );
            });
        }
    }

    async function fetchAllApplicantProfiles(context) {
        const rows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, barangay, created_at")
                .eq("role", "applicant")
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

    async function fetchAllApplications(context) {
        const rows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("applications")
                .select("applicant_id, status, updated_at, created_at")
                .order("updated_at", { ascending: false })
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

    async function loadData(context) {
        showStatus("");
        renderTable([]);

        const [profilesResult, applicationsResult] = await Promise.all([
            fetchAllApplicantProfiles(context),
            fetchAllApplications(context)
        ]);

        if (profilesResult.error) {
            showStatus("Failed to load registered applicant accounts: " + profilesResult.error.message, "alert-danger");
            return;
        }

        if (applicationsResult.error) {
            showStatus("Failed to compare application records: " + applicationsResult.error.message, "alert-danger");
            return;
        }

        const profileRows = profilesResult.data || [];
        const applicationRows = applicationsResult.data || [];
        const applicationMap = {};

        applicationRows.forEach(function (application) {
            if (!application || !application.applicant_id) {
                return;
            }
            if (!applicationMap[application.applicant_id]) {
                applicationMap[application.applicant_id] = [];
            }
            applicationMap[application.applicant_id].push(application);
        });

        allRows = profileRows.map(function (profile) {
            const applications = applicationMap[profile.id] || [];
            const hasSubmittedForm = applications.some(function (application) {
                return (application.status || "").toString().trim().toLowerCase() !== "draft";
            });
            if (hasSubmittedForm) {
                return null;
            }

            const hasDraftOnly = applications.some(function (application) {
                return (application.status || "").toString().trim().toLowerCase() === "draft";
            });

            return {
                id: profile.id,
                applicant_name: buildApplicantName(profile),
                barangay: normalizeBarangay(profile.barangay || "") || "No Barangay",
                email: profile.email || "",
                created_at: profile.created_at || "",
                form_state: hasDraftOnly ? "Draft Only" : "No Application Yet"
            };
        }).filter(Boolean);

        await refreshReminderLogState(context);
        populateBarangayFilter(allRows);
        applyFilters(true);
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        authContext = context;
        bindEvents();
        await loadData(context);
        await refreshReminderCampaignIndicator();
        startReminderCampaignStatusPolling();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
