(function () {
    "use strict";

    const PROFILE_BATCH_SIZE = 200;
    const SUPABASE_FETCH_LIMIT = 1000;
    const EXAM_SCOPE_STATUSES = ["pending_exam", "exam_scheduled", "exam_completed", "passed_exam", "failed_exam"];
    const LOCKED_RECORD_STATUS = "scheduled";
    const LEGACY_LOCKED_RECORD_STATUS = "exam_scheduled";
    const EXAM_SCHEDULE_EMAIL_API_PATH = "/api/notifications/exam-schedule";
    const EXAM_SCHEDULE_TEST_EMAIL_API_PATH = "/api/notifications/exam-schedule/test";
    const DEFAULT_CONTROL_START = 1001;
    const DEFAULT_ROOM_CAPACITY = 25;
    const ELIGIBLE_ROWS_PER_PAGE = 10;
    const EXAM_EMAIL_QUEUE_REFRESH_INTERVAL_MS = 15000;
    const DEFAULT_EXAM_SCHEDULE_EMAIL_NOTE = "Please bring your school ID or any valid ID for identification, and please bring one black ballpen on exam day.";
    const BATCH_META_MARKER = "[LDSS_BATCH_META]";
    const PDF_BRAND_ASSETS = [
        { key: "lgu", src: "../img/daet-lgu.png", label: "LGU DAET", width: 960, height: 960 }
    ];

    let authContext = null;
    let applications = [];
    let batches = [];
    let examRecords = [];
    let selectedApplicationIds = new Set();
    let currentBatchId = "";
    let roomHotfixAvailable = true;
    let previewActiveRoomKey = "";
    let eligiblePage = 1;
    let returnConfirmModalInstance = null;
    let returnConfirmResolver = null;
    let resetConfirmModalInstance = null;
    let resetConfirmResolver = null;
    let deleteConfirmModalInstance = null;
    let deleteConfirmResolver = null;
    let currentEmailQueueJob = null;
    let emailQueueStatusAvailable = true;
    let emailQueueRefreshTimer = 0;
    let emailQueueRequestToken = 0;
    const pdfBrandImageCache = {};

    function byId(id) {
        return document.getElementById(id);
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
            let fallbackMessage = "Request failed (HTTP " + response.status + ").";
            if (response.status === 404) {
                fallbackMessage = "Exam schedule email API route was not found. Open the site through the Node server.";
            } else if (response.status === 400) {
                fallbackMessage = "The request was rejected by the server. Check the selected batch, scheduled examinee, and email fields, then try again.";
            } else if (response.status === 401) {
                fallbackMessage = "Your session may have expired. Sign in again, then retry the request.";
            } else if (response.status === 403) {
                fallbackMessage = "Your account does not have permission to use this email action.";
            } else if (response.status === 503) {
                fallbackMessage = "Server email is not configured. Add SMTP settings to the Node app first.";
            } else if (response.status >= 500) {
                fallbackMessage = "The Node email server returned an internal error. Check the latest server upload and restart the Node app.";
            }

            if (!payload && responseText) {
                const compactText = responseText.replace(/\s+/g, " ").trim();
                if (compactText && compactText.charAt(0) === "<") {
                    fallbackMessage += " The server returned an HTML error page instead of the LDSP API response.";
                }
            }
            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
    }

    function getReturnConfirmModal() {
        if (!returnConfirmModalInstance) {
            const modalEl = byId("examManagementReturnConfirmModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                returnConfirmModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return returnConfirmModalInstance;
    }

    function getResetConfirmModal() {
        if (!resetConfirmModalInstance) {
            const modalEl = byId("examManagementResetConfirmModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                resetConfirmModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return resetConfirmModalInstance;
    }

    function getDeleteConfirmModal() {
        if (!deleteConfirmModalInstance) {
            const modalEl = byId("examManagementDeleteConfirmModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                deleteConfirmModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return deleteConfirmModalInstance;
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) {
                return (status || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral" };
            }
        };
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function isScheduledExamRecordStatus(status) {
        const normalized = normalizeStatus(status || "");
        return normalized === LOCKED_RECORD_STATUS || normalized === LEGACY_LOCKED_RECORD_STATUS;
    }

    function hasScheduledRecordInBatch(batchId, applicationId) {
        if (!batchId || !applicationId) {
            return false;
        }
        return batchRecords(batchId).some(function (record) {
            return record.application_id === applicationId && isScheduledExamRecordStatus(record.status);
        });
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

    function upperRoomLabel(value) {
        return (value || "-").toString().trim().toUpperCase() || "-";
    }

    function compareRoomLabels(left, right) {
        return (left || "").toString().localeCompare((right || "").toString(), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function parsedBatchNotes(rawNotes) {
        const raw = (rawNotes || "").toString();
        const markerIndex = raw.indexOf(BATCH_META_MARKER);
        if (markerIndex === -1) {
            return {
                notes: raw.trim(),
                roomCount: null,
                roomPrefix: ""
            };
        }

        const visibleNotes = raw.slice(0, markerIndex).trim();
        const metaRaw = raw.slice(markerIndex + BATCH_META_MARKER.length).trim();
        let meta = {};

        if (metaRaw) {
            try {
                meta = JSON.parse(metaRaw);
            } catch (_error) {
                meta = {};
            }
        }

        const roomCount = Number(meta.roomCount);
        return {
            notes: visibleNotes,
            roomCount: Number.isInteger(roomCount) && roomCount > 0 ? roomCount : null,
            roomPrefix: (meta.roomPrefix || "").toString().trim()
        };
    }

    function composeBatchNotes(notes, roomCount, roomPrefix) {
        const meta = {
            roomCount: Number(roomCount) > 0 ? Math.floor(Number(roomCount)) : 1,
            roomPrefix: (roomPrefix || "Room").toString().trim() || "Room"
        };
        const visibleNotes = (notes || "").toString().trim();
        return (visibleNotes ? visibleNotes + "\n\n" : "") + BATCH_META_MARKER + JSON.stringify(meta);
    }

    function buildVerificationUrl(applicationId) {
        return "secretary-interview-verification.html?id=" + encodeURIComponent(applicationId || "");
    }

    function showStatus(message, type) {
        const box = byId("examManagementStatus");
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

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatDateTimeStamp(value) {
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

    function normalizeQueueStatus(status) {
        return (status || "").toString().trim().toLowerCase();
    }

    function hasActiveEmailQueueJob(job) {
        const status = normalizeQueueStatus(job && job.status);
        return status === "queued" || status === "processing";
    }

    function emailQueueBadgeMeta(status) {
        const normalized = normalizeQueueStatus(status);
        if (normalized === "queued") {
            return { label: "Queued", className: "ldss-email-queue-badge is-queued" };
        }
        if (normalized === "processing") {
            return { label: "Sending", className: "ldss-email-queue-badge is-processing" };
        }
        if (normalized === "completed") {
            return { label: "Completed", className: "ldss-email-queue-badge is-completed" };
        }
        if (normalized === "failed") {
            return { label: "Failed", className: "ldss-email-queue-badge is-failed" };
        }
        if (normalized === "cancelled") {
            return { label: "Cancelled", className: "ldss-email-queue-badge is-cancelled" };
        }
        return { label: "Not queued", className: "ldss-email-queue-badge is-idle" };
    }

    function clearEmailQueueRefreshTimer() {
        if (emailQueueRefreshTimer) {
            window.clearTimeout(emailQueueRefreshTimer);
            emailQueueRefreshTimer = 0;
        }
    }

    function currentBatchEmailQueueJob() {
        if (!currentBatchId || !currentEmailQueueJob || currentEmailQueueJob.batch_id !== currentBatchId) {
            return null;
        }
        return currentEmailQueueJob;
    }

    function formatDateTimeLocalValue(value) {
        if (!value) {
            return "";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        const offsetMs = parsed.getTimezoneOffset() * 60000;
        return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 10);
    }

    function datetimeLocalToIso(value) {
        const raw = (value || "").toString().trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return "";
        }
        return raw + "T12:00:00.000Z";
    }

    function buildApplicantName(profile) {
        if (!profile) {
            return "Unknown Applicant";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) { return (value || "").toString().trim(); })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : (profile.email || "Unknown Applicant");
    }

    function appById(applicationId) {
        for (let index = 0; index < applications.length; index += 1) {
            if (applications[index].id === applicationId) {
                return applications[index];
            }
        }
        return null;
    }

    function batchById(batchId) {
        for (let index = 0; index < batches.length; index += 1) {
            if (batches[index].id === batchId) {
                return batches[index];
            }
        }
        return null;
    }

    function batchRecords(batchId) {
        return (batchId ? examRecords.filter(function (record) { return record.batch_id === batchId; }) : []);
    }

    function batchMembers(batchId) {
        const members = new Set();
        batchRecords(batchId).forEach(function (record) {
            if (record.application_id) {
                members.add(record.application_id);
            }
        });
        return members;
    }

    function roomCountForBatch(batchId) {
        const labels = new Set();
        batchRecords(batchId).forEach(function (record) {
            if (record.room_label) {
                labels.add(record.room_label);
            }
        });
        return labels.size;
    }

    function plannedRoomCountForBatch(batchId) {
        const batch = batchById(batchId);
        const storedCount = Number(batch && batch.room_count);
        if (Number.isInteger(storedCount) && storedCount > 0) {
            return storedCount;
        }
        return roomCountForBatch(batchId);
    }

    function roomPrefixForBatch(batchId) {
        const batch = batchById(batchId);
        const storedPrefix = (batch && batch.room_prefix ? batch.room_prefix : "").toString().trim();
        if (storedPrefix) {
            return storedPrefix;
        }
        const rows = batchRecords(batchId);
        for (let index = 0; index < rows.length; index += 1) {
            const label = (rows[index].room_label || "").toString().trim();
            const match = label.match(/^(.*?)(\s+\d+)$/);
            if (match && match[1].trim()) {
                return match[1].trim();
            }
        }
        return "Room";
    }

    function controlStartForBatch(batchId) {
        let min = Number.POSITIVE_INFINITY;
        batchRecords(batchId).forEach(function (record) {
            const numeric = Number((record.exam_control_no || "").toString().trim());
            if (!Number.isNaN(numeric) && numeric < min) {
                min = numeric;
            }
        });
        if (Number.isFinite(min)) {
            return min;
        }

        let max = 0;
        examRecords.forEach(function (record) {
            const numeric = Number((record.exam_control_no || "").toString().trim());
            if (!Number.isNaN(numeric) && numeric > max) {
                max = numeric;
            }
        });
        return max > 0 ? max + 1 : DEFAULT_CONTROL_START;
    }

    function roomCapacityForBatch(batchId) {
        const batch = batchById(batchId);
        const savedCapacity = Number(batch && batch.capacity);
        if (!Number.isNaN(savedCapacity) && savedCapacity > 0) {
            return Math.floor(savedCapacity);
        }

        const counts = {};
        let max = 0;
        batchRecords(batchId).forEach(function (record) {
            const key = (record.room_label || "room").toString();
            counts[key] = (counts[key] || 0) + 1;
            if (counts[key] > max) {
                max = counts[key];
            }
        });
        return max > 0 ? max : DEFAULT_ROOM_CAPACITY;
    }

    function selectableRow(row) {
        if (!currentBatchId) {
            return true;
        }
        const record = batchRecords(currentBatchId).find(function (item) {
            return item.application_id === row.id;
        }) || null;
        return !(record && !isScheduledExamRecordStatus(record.status));
    }

    function eligibleRows() {
        const search = (byId("examManagementSearchInput") ? byId("examManagementSearchInput").value : "").toLowerCase().trim();
        const currentBatchMembers = batchMembers(currentBatchId);
        return applications.filter(function (row) {
            const normalized = normalizeStatus(row.status);
            const eligible = normalized === "pending_exam" || currentBatchMembers.has(row.id);
            if (!eligible) {
                return false;
            }
            if (!search) {
                return true;
            }
            const haystack = [row.application_no || "", row.applicant_name || "", row.school_name || "", row.email || ""].join(" ").toLowerCase();
            return haystack.includes(search);
        });
    }

    function allSelectableEligibleRows() {
        const currentBatchMembers = batchMembers(currentBatchId);
        return applications.filter(function (row) {
            const normalized = normalizeStatus(row.status);
            const eligible = normalized === "pending_exam" || currentBatchMembers.has(row.id);
            return eligible && selectableRow(row);
        });
    }

    function eligiblePageCount() {
        return Math.max(1, Math.ceil(eligibleRows().length / ELIGIBLE_ROWS_PER_PAGE));
    }

    function clampEligiblePage() {
        const pageCount = eligiblePageCount();
        if (eligiblePage < 1) {
            eligiblePage = 1;
        }
        if (eligiblePage > pageCount) {
            eligiblePage = pageCount;
        }
    }

    function pagedEligibleRows() {
        const rows = eligibleRows();
        clampEligiblePage();
        const start = (eligiblePage - 1) * ELIGIBLE_ROWS_PER_PAGE;
        return rows.slice(start, start + ELIGIBLE_ROWS_PER_PAGE);
    }

    function visibleSelectableRows() {
        return pagedEligibleRows().filter(selectableRow);
    }

    function selectedSelectableRows() {
        return applications.filter(function (row) {
            return selectedApplicationIds.has(row.id) && selectableRow(row);
        });
    }

    function selectedScheduledRowsForCurrentBatch() {
        return scheduledRowsForBatch(currentBatchId).filter(function (row) {
            return selectedApplicationIds.has(row.application_id);
        });
    }

    function examRecordsForApplications(applicationIds) {
        const wanted = new Set((applicationIds || []).filter(Boolean));
        return examRecords.filter(function (record) {
            return wanted.has(record.application_id);
        });
    }

    function resetSelectionToEligible() {
        selectedApplicationIds = new Set();
    }

    function writeInput(id, value) {
        const input = byId(id);
        if (input) {
            input.value = value == null ? "" : String(value);
        }
    }

    function ensureExamScheduleEmailNote(forceDefault) {
        const noteInput = byId("examScheduleEmailNote");
        if (!noteInput) {
            return;
        }
        const currentValue = (noteInput.value || "").toString().trim();
        if (forceDefault || !currentValue) {
            noteInput.value = DEFAULT_EXAM_SCHEDULE_EMAIL_NOTE;
        }
    }

    function writeBatchLabelValue(value) {
        const select = byId("examBatchLabel");
        const normalized = (value || "").toString().trim();
        if (!select) {
            return;
        }
        if (normalized) {
            const hasOption = Array.from(select.options || []).some(function (option) {
                return option.value === normalized;
            });
            if (!hasOption) {
                const option = document.createElement("option");
                option.value = normalized;
                option.textContent = normalized;
                select.appendChild(option);
            }
        }
        select.value = normalized;
    }

    function applyBatchForm(batchId) {
        const batch = batchById(batchId);
        if (!batch) {
            writeBatchLabelValue("");
            writeInput("examBatchDateTime", "");
            writeInput("examBatchVenue", "");
            writeInput("examBatchNotes", "");
            writeInput("examRoomCount", 1);
            writeInput("examRoomCapacity", DEFAULT_ROOM_CAPACITY);
            writeInput("examRoomPrefix", "Room");
            ensureExamScheduleEmailNote(true);
            return;
        }

        writeBatchLabelValue(batch.batch_label || "");
        writeInput("examBatchDateTime", formatDateTimeLocalValue(batch.exam_datetime || ""));
        writeInput("examBatchVenue", batch.venue || "");
        writeInput("examBatchNotes", batch.notes || "");
        writeInput("examRoomCount", plannedRoomCountForBatch(batch.id) || 1);
        writeInput("examRoomCapacity", roomCapacityForBatch(batch.id));
        writeInput("examRoomPrefix", roomPrefixForBatch(batch.id));
        ensureExamScheduleEmailNote(false);
    }

    function batchScheduleFieldsLocked(batchId) {
        if (!batchId) {
            return false;
        }
        return batchRecords(batchId).length > 0;
    }

    function syncBatchScheduleFieldLock() {
        const locked = batchScheduleFieldsLocked(currentBatchId);
        const dateTimeInput = byId("examBatchDateTime");
        const venueInput = byId("examBatchVenue");
        const note = byId("examBatchScheduleLockNote");

        if (dateTimeInput) {
            dateTimeInput.disabled = locked;
        }
        if (venueInput) {
            venueInput.disabled = locked;
        }
        if (!note) {
            return;
        }

        if (!locked) {
            note.textContent = "";
            note.classList.add("d-none");
            return;
        }

        note.textContent = "Exam date and venue are locked because this batch already has saved examinees. Return them first or create a new batch if the schedule must change.";
        note.classList.remove("d-none");
    }

    function renderBatchSelect() {
        const select = byId("examBatchSelect");
        if (!select) {
            return;
        }
        select.innerHTML = '<option value="">Create new batch</option>';
        batches.forEach(function (batch) {
            const option = document.createElement("option");
            option.value = batch.id;
            option.textContent = batch.batch_label || ("Batch " + batch.id);
            select.appendChild(option);
        });
        select.value = currentBatchId || "";
    }

    function renderMetrics() {
        const pending = applications.filter(function (row) { return normalizeStatus(row.status) === "pending_exam"; }).length;
        const scheduledIds = new Set();
        applications.forEach(function (row) {
            if (normalizeStatus(row.status) === "exam_scheduled" && row.id) {
                scheduledIds.add(row.id);
            }
        });
        examRecords.forEach(function (record) {
            if (record && record.application_id && isScheduledExamRecordStatus(record.status)) {
                scheduledIds.add(record.application_id);
            }
        });
        const scheduled = scheduledIds.size;
        const pendingEl = byId("examManagementPendingCount");
        const scheduledEl = byId("examManagementScheduledCount");
        const selectedEl = byId("examManagementSelectedCount");
        const roomsEl = byId("examManagementRoomsUsedCount");

        if (pendingEl) {
            pendingEl.textContent = String(pending);
        }
        if (scheduledEl) {
            scheduledEl.textContent = String(scheduled);
        }
        if (selectedEl) {
            selectedEl.textContent = String(selectedApplicationIds.size);
        }
        if (roomsEl) {
            roomsEl.textContent = String(currentBatchId ? plannedRoomCountForBatch(currentBatchId) : 0);
        }
    }

    function renderActiveBatchSummary() {
        const nameEl = byId("examActiveBatchName");
        const subcopyEl = byId("examActiveBatchSubcopy");
        const pillsEl = byId("examActiveBatchPills");
        const batch = batchById(currentBatchId);

        if (!nameEl && !subcopyEl && !pillsEl) {
            return;
        }

        if (!batch) {
            if (nameEl) {
                nameEl.textContent = "Create new batch";
            }
            if (subcopyEl) {
                subcopyEl.textContent = "No saved batch is loaded yet.";
            }
            if (pillsEl) {
                pillsEl.innerHTML = '<span class="ldss-active-batch-pill">No active batch loaded</span>';
            }
            return;
        }

        const scheduledCount = scheduledRowsForBatch(currentBatchId).length;
        const plannedRooms = plannedRoomCountForBatch(currentBatchId);
        const roomCapacity = roomCapacityForBatch(currentBatchId);

        if (nameEl) {
            nameEl.textContent = batch.batch_label || "Saved Batch";
        }
        if (subcopyEl) {
            subcopyEl.textContent = "Official examination batch currently loaded for room assignment, PDF download, and email sending.";
        }
        if (pillsEl) {
            pillsEl.innerHTML = [
                '<span class="ldss-active-batch-pill">Exam Date: ' + escapeHtml(formatDateTime(batch.exam_datetime || "")) + "</span>",
                '<span class="ldss-active-batch-pill">Venue: ' + escapeHtml(batch.venue || "-") + "</span>",
                '<span class="ldss-active-batch-pill">Scheduled: ' + scheduledCount + "</span>",
                '<span class="ldss-active-batch-pill">Rooms: ' + plannedRooms + " x " + roomCapacity + "</span>"
            ].join("");
        }
    }

    function renderEmailQueueStatus() {
        const badgeEl = byId("examEmailQueueStatusBadge");
        const summaryEl = byId("examEmailQueueSummary");
        const detailEl = byId("examEmailQueueDetail");
        const totalEl = byId("examEmailQueueTotalCount");
        const sentEl = byId("examEmailQueueSentCount");
        const skippedEl = byId("examEmailQueueSkippedCount");
        const failedEl = byId("examEmailQueueFailedCount");
        const remainingEl = byId("examEmailQueueRemainingCount");
        const batch = batchById(currentBatchId);
        const job = currentBatchEmailQueueJob();
        const badgeMeta = emailQueueBadgeMeta(job && job.status);
        const total = Math.max(0, Number(job && job.total_recipients) || 0);
        const processed = Math.max(0, Number(job && job.processed_count) || 0);
        const sent = Math.max(0, Number(job && job.sent_count) || 0);
        const skipped = Math.max(0, Number(job && job.skipped_count) || 0);
        const failed = Math.max(0, Number(job && job.failed_count) || 0);
        const remaining = Math.max(0, total - processed);

        if (!badgeEl && !summaryEl && !detailEl) {
            return;
        }

        if (badgeEl) {
            badgeEl.className = badgeMeta.className;
            badgeEl.textContent = badgeMeta.label;
        }
        if (totalEl) {
            totalEl.textContent = String(total);
        }
        if (sentEl) {
            sentEl.textContent = String(sent);
        }
        if (skippedEl) {
            skippedEl.textContent = String(skipped);
        }
        if (failedEl) {
            failedEl.textContent = String(failed);
        }
        if (remainingEl) {
            remainingEl.textContent = String(remaining);
        }

        if (!batch) {
            if (summaryEl) {
                summaryEl.textContent = "Load a saved batch first to track batch-email progress.";
            }
            if (detailEl) {
                detailEl.textContent = "No active batch email queue is loaded yet.";
            }
            return;
        }

        if (!emailQueueStatusAvailable) {
            if (summaryEl) {
                summaryEl.textContent = "Batch email queue tracking is not available on this build yet.";
            }
            if (detailEl) {
                detailEl.textContent = "Run exam_schedule_email_jobs_hotfix_2026_04_05.sql first so the secretary page can read live send counters.";
            }
            return;
        }

        if (!job) {
            if (summaryEl) {
                summaryEl.textContent = "No batch email send has been queued yet for " + (batch.batch_label || "this batch") + ".";
            }
            if (detailEl) {
                detailEl.textContent = "When you click Send Schedule Emails, the live sent / failed / remaining counter will update here until the batch is fully completed.";
            }
            return;
        }

        const status = normalizeQueueStatus(job.status);
        if (summaryEl) {
            if (status === "completed" && !failed && total && sent >= total) {
                summaryEl.textContent = "All queued exam schedule emails were sent for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else if (status === "completed") {
                summaryEl.textContent = "Batch email sending finished for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else if (status === "processing") {
                summaryEl.textContent = "Batch email sending is in progress for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else if (status === "queued") {
                summaryEl.textContent = "Batch email sending is queued for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else if (status === "failed") {
                summaryEl.textContent = "Batch email sending stopped with an error for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else if (status === "cancelled") {
                summaryEl.textContent = "Batch email sending was cancelled for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            } else {
                summaryEl.textContent = "Batch email status is available for " + (job.batch_label || batch.batch_label || "this batch") + ".";
            }
        }

        if (detailEl) {
            const parts = [];
            if (status === "queued" || status === "processing") {
                parts.push(String(processed) + " of " + String(total) + " queued email(s) already processed");
                parts.push("sending " + String(Number(job.batch_size || 100)) + " every " + String(Number(job.batch_delay_minutes || 5)) + " minute(s)");
                if (job.next_run_at) {
                    parts.push("next run " + formatDateTimeStamp(job.next_run_at));
                }
            } else if (status === "completed") {
                parts.push("Completed " + formatDateTimeStamp(job.completed_at || job.updated_at || job.created_at));
            } else {
                parts.push("Last update " + formatDateTimeStamp(job.updated_at || job.created_at));
            }
            if (skipped) {
                parts.push(String(skipped) + " skipped without email address");
            }
            if (failed) {
                parts.push(String(failed) + " failed");
            }
            if (status === "failed" && job.last_error) {
                parts.push("reason: " + job.last_error);
            }
            detailEl.textContent = parts.join(" • ");
        }
    }

    function renderEligiblePagination(totalRows) {
        const meta = byId("examManagementEligiblePaginationMeta");
        const pagination = byId("examManagementEligiblePagination");
        const safeTotal = Number(totalRows || 0);
        const pageCount = Math.max(1, Math.ceil(safeTotal / ELIGIBLE_ROWS_PER_PAGE));
        clampEligiblePage();

        if (meta) {
            if (!safeTotal) {
                meta.textContent = "Showing 0-0 of 0 eligible examinees.";
            } else {
                const start = ((eligiblePage - 1) * ELIGIBLE_ROWS_PER_PAGE) + 1;
                const end = Math.min(start + ELIGIBLE_ROWS_PER_PAGE - 1, safeTotal);
                meta.textContent = "Showing " + start + "-" + end + " of " + safeTotal + " eligible examinees.";
            }
        }

        if (!pagination) {
            return;
        }

        if (!safeTotal) {
            pagination.innerHTML = [
                '<li class="page-item disabled"><span class="page-link">Previous</span></li>',
                '<li class="page-item active"><span class="page-link">1</span></li>',
                '<li class="page-item disabled"><span class="page-link">Next</span></li>'
            ].join("");
            return;
        }

        const items = [];
        items.push(
            '<li class="page-item' + (eligiblePage === 1 ? ' disabled' : '') + '">' +
                '<button class="page-link" type="button" data-pagination-action="prev">Previous</button>' +
            "</li>"
        );

        const pagesToShow = [];
        for (let page = 1; page <= pageCount; page += 1) {
            if (page === 1 || page === pageCount || Math.abs(page - eligiblePage) <= 1) {
                pagesToShow.push(page);
            }
        }

        let lastShown = 0;
        pagesToShow.forEach(function (page) {
            if (page - lastShown > 1) {
                items.push('<li class="page-item disabled"><span class="page-link">...</span></li>');
            }
            items.push(
                '<li class="page-item' + (page === eligiblePage ? ' active' : '') + '">' +
                    '<button class="page-link" type="button" data-pagination-page="' + page + '">' + page + "</button>" +
                "</li>"
            );
            lastShown = page;
        });

        items.push(
            '<li class="page-item' + (eligiblePage === pageCount ? ' disabled' : '') + '">' +
                '<button class="page-link" type="button" data-pagination-action="next">Next</button>' +
            "</li>"
        );

        pagination.innerHTML = items.join("");
    }

    function renderEligibleTable() {
        const tbody = byId("examManagementEligibleTableBody");
        const headerCheckbox = byId("examManagementSelectAllCheckbox");
        const allRows = eligibleRows();
        const rows = pagedEligibleRows();
        const currentBatchMemberIds = batchMembers(currentBatchId);
        if (!tbody) {
            return;
        }
        if (!allRows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No eligible examinees match the current filters.</td></tr>';
            if (headerCheckbox) {
                headerCheckbox.checked = false;
                headerCheckbox.indeterminate = false;
            }
            renderEligiblePagination(0);
            renderMetrics();
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            const disabled = !selectableRow(row);
            const checked = selectedApplicationIds.has(row.id);
            const hint = disabled ? '<div class="small text-muted mt-1">Locked by completed or encoded exam records.</div>' : "";
            const canSendIndividualTestEmail = Boolean(
                currentBatchId
                && currentBatchMemberIds.has(row.id)
                && hasScheduledRecordInBatch(currentBatchId, row.id)
            );
            const actionButtons = [
                canSendIndividualTestEmail
                    ? '<button class="btn btn-outline-dark btn-sm" type="button" data-test-email-application-id="' + escapeHtml(row.id) + '">Send Test Email</button>'
                    : "",
                '<a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(buildVerificationUrl(row.id)) + '">Open Details</a>'
            ].filter(Boolean).join("");
            return (
                "<tr>" +
                    '<td><input class="form-check-input" type="checkbox" data-application-id="' + escapeHtml(row.id) + '"' + (checked ? ' checked="checked"' : "") + (disabled ? ' disabled="disabled"' : "") + " /></td>" +
                    "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                    "<td><div class=\"fw-700\">" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div><div class=\"small text-muted\">" + escapeHtml(row.email || "-") + "</div></td>" +
                    "<td>" + escapeHtml(row.school_name || "-") + "</td>" +
                    '<td><span class="ldss-chip ' + escapeHtml(meta.chipClass || "ldss-chip-neutral") + '">' + escapeHtml(meta.label || "-") + "</span>" + hint + "</td>" +
                    '<td><div class="d-flex flex-wrap gap-2">' + actionButtons + "</div></td>" +
                "</tr>"
            );
        }).join("");

        if (headerCheckbox) {
            const selectable = visibleSelectableRows();
            const checkedCount = selectable.filter(function (row) {
                return selectedApplicationIds.has(row.id);
            }).length;
            headerCheckbox.checked = selectable.length > 0 && checkedCount === selectable.length;
            headerCheckbox.indeterminate = checkedCount > 0 && checkedCount < selectable.length;
        }

        renderEligiblePagination(allRows.length);
        renderMetrics();
    }

    function assignedRowsForBatch(batchId) {
        return batchRecords(batchId).map(function (record) {
            const app = appById(record.application_id);
            return {
                application_id: record.application_id,
                application_no: app ? (app.application_no || "") : "",
                applicant_name: app ? app.applicant_name : "Unknown Applicant",
                school_name: app ? (app.school_name || "") : "",
                room_label: record.room_label || "",
                room_seat_no: Number(record.room_seat_no || 0),
                exam_control_no: record.exam_control_no || "",
                scheduled_at: record.scheduled_at || "",
                record_status: record.status || ""
            };
        }).sort(function (left, right) {
            const roomCompare = compareRoomLabels(left.room_label || "", right.room_label || "");
            if (roomCompare !== 0) {
                return roomCompare;
            }
            return Number(left.room_seat_no || 0) - Number(right.room_seat_no || 0);
        });
    }

    function scheduledRowsForBatch(batchId) {
        return assignedRowsForBatch(batchId).filter(function (row) {
            return isScheduledExamRecordStatus(row.record_status);
        });
    }

    function plannedRoomLabelsForBatch(batchId) {
        if (!batchId) {
            return [];
        }
        const plannedCount = Math.max(plannedRoomCountForBatch(batchId), roomCountForBatch(batchId));
        const prefix = roomPrefixForBatch(batchId) || "Room";
        const labels = [];
        for (let roomIndex = 1; roomIndex <= plannedCount; roomIndex += 1) {
            labels.push(prefix + " " + String(roomIndex));
        }
        return labels;
    }

    function roomCollectionsForBatch(batchId, rows) {
        const grouped = {};
        const assignedRows = rows || [];
        assignedRows.forEach(function (row) {
            const key = row.room_label || "Unassigned Room";
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(row);
        });

        const labels = plannedRoomLabelsForBatch(batchId);
        Object.keys(grouped).forEach(function (label) {
            if (!labels.includes(label)) {
                labels.push(label);
            }
        });

        return labels.sort(compareRoomLabels).map(function (roomLabel) {
            return {
                roomLabel: roomLabel,
                rows: grouped[roomLabel] || []
            };
        });
    }

    function previewTabsForRooms(roomCollections) {
        const occupiedRooms = (roomCollections || []).filter(function (room) {
            return room.rows.length > 0;
        });
        const emptyRooms = (roomCollections || []).filter(function (room) {
            return room.rows.length === 0;
        });

        const tabs = occupiedRooms.map(function (room) {
            return {
                key: "room:" + room.roomLabel,
                label: room.roomLabel,
                count: room.rows.length,
                type: "room",
                room: room
            };
        });

        if (emptyRooms.length) {
            tabs.push({
                key: "reserved-empty-rooms",
                label: "Reserved Empty Rooms",
                count: emptyRooms.length,
                type: "empty",
                rooms: emptyRooms
            });
        }

        return tabs;
    }

    function renderScheduleEmailMeta() {
        const meta = byId("examScheduleEmailMeta");
        const button = byId("examSendScheduleEmailsBtn");
        const batch = batchById(currentBatchId);
        const rows = scheduledRowsForBatch(currentBatchId);
        const queueJob = currentBatchEmailQueueJob();

        if (!meta) {
            return;
        }

        if (!batch) {
            meta.textContent = "Select or save a batch first before sending exam schedule emails.";
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (!rows.length) {
            meta.textContent = "This batch does not have any saved scheduled examinees yet. Generate and save the room assignment first.";
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (queueJob && hasActiveEmailQueueJob(queueJob)) {
            meta.textContent = "A batch email send is already " + (normalizeQueueStatus(queueJob.status) === "processing" ? "running" : "queued") + " for this batch. Watch the Batch Email Status counter above until it shows Completed.";
            if (button) {
                button.disabled = true;
            }
            return;
        }

        meta.textContent = String(rows.length) + " scheduled applicant(s) in " + (batch.batch_label || "this batch") + " will receive the email notice with their exam details.";
        if (button) {
            button.disabled = false;
        }
    }

    function renderResetBatchMeta() {
        const meta = byId("examResetBatchMeta");
        const button = byId("examResetBatchBtn");
        const batch = batchById(currentBatchId);
        const rows = batchRecords(currentBatchId);
        const hasLockedRecords = rows.some(function (record) {
            return !isScheduledExamRecordStatus(record.status);
        });

        if (!batch) {
            if (meta) {
                meta.textContent = "Load a saved batch first before resetting exam data.";
            }
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (!rows.length) {
            if (meta) {
                meta.textContent = "This saved batch does not have any exam data to reset yet.";
            }
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (hasLockedRecords) {
            if (meta) {
                meta.textContent = "Reset Exam Data is locked because this batch already has completed or encoded exam records.";
            }
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (meta) {
            meta.textContent = "Reset Exam Data will clear " + rows.length + " scheduled assignment(s) in this saved batch and return them to Pending Exam.";
        }
        if (button) {
            button.disabled = false;
        }
    }

    function renderDeleteBatchMeta() {
        const meta = byId("examDeleteBatchMeta");
        const button = byId("examDeleteBatchBtn");
        const batch = batchById(currentBatchId);
        const rows = batchRecords(currentBatchId);
        const hasLockedRecords = rows.some(function (record) {
            return !isScheduledExamRecordStatus(record.status);
        });

        if (!meta && !button) {
            return;
        }

        if (!batch) {
            if (meta) {
                meta.textContent = "Start Over clears the current form and returns this page to Create new batch.";
            }
            if (button) {
                button.disabled = false;
            }
            return;
        }

        if (hasLockedRecords) {
            if (meta) {
                meta.textContent = "Start Over is locked because this batch already has completed or encoded exam records.";
            }
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (!rows.length) {
            if (meta) {
                meta.textContent = "Start Over will remove this empty saved batch and return the page to Create new batch.";
            }
            if (button) {
                button.disabled = false;
            }
            return;
        }

        if (meta) {
            meta.textContent = "Start Over will remove this saved batch, return " + rows.length + " scheduled applicant(s) to Pending Exam, and reopen Create new batch.";
        }
        if (button) {
            button.disabled = false;
        }
    }

    function safeBatchEntries() {
        return batches.filter(function (batch) {
            const records = batchRecords(batch.id);
            return !records.some(function (record) {
                return !isScheduledExamRecordStatus(record.status);
            });
        }).map(function (batch) {
            const records = batchRecords(batch.id);
            return {
                batch: batch,
                records: records,
                recordCount: records.length
            };
        });
    }

    function renderDeleteAllSafeBatchesMeta() {
        const meta = byId("examDeleteAllSafeBatchesMeta");
        const button = byId("examDeleteAllSafeBatchesBtn");
        const safeEntries = safeBatchEntries();
        const safeBatchCount = safeEntries.length;
        const safeRecordCount = safeEntries.reduce(function (sum, entry) {
            return sum + entry.recordCount;
        }, 0);

        if (!meta && !button) {
            return;
        }

        if (!safeBatchCount) {
            if (meta) {
                meta.textContent = "There are no safe batches to clear right now.";
            }
            if (button) {
                button.disabled = true;
            }
            return;
        }

        if (meta) {
            meta.textContent = "Clear All Safe Batches will remove " + safeBatchCount + " safe batch(es)" + (safeRecordCount ? " and return " + safeRecordCount + " scheduled applicant(s) to Pending Exam." : ".") ;
        }
        if (button) {
            button.disabled = false;
        }
    }

    function renderPreview() {
        const shell = byId("examManagementRoomPreview");
        const summary = byId("examManagementPreviewSummary");
        const batch = batchById(currentBatchId);
        const rows = currentBatchId ? assignedRowsForBatch(currentBatchId) : [];
        const roomCollections = currentBatchId ? roomCollectionsForBatch(currentBatchId, rows) : [];
        const previewTabs = previewTabsForRooms(roomCollections);
        const occupiedRooms = roomCollections.filter(function (room) { return room.rows.length; }).length;
        const emptyRooms = roomCollections.filter(function (room) { return !room.rows.length; }).length;

        if (summary) {
            if (!batch) {
                summary.innerHTML = '<span class="ldss-exam-preview-badge">No active batch loaded</span>';
            } else {
                summary.innerHTML = [
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(batch.batch_label || "Batch") + "</span>",
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(formatDateTime(batch.exam_datetime || "")) + "</span>",
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(batch.venue || "-") + "</span>",
                    '<span class="ldss-exam-preview-badge">' + rows.length + " assigned</span>",
                    '<span class="ldss-exam-preview-badge">' + plannedRoomCountForBatch(currentBatchId) + " planned rooms</span>",
                    '<span class="ldss-exam-preview-badge">' + occupiedRooms + " occupied</span>",
                    '<span class="ldss-exam-preview-badge">' + emptyRooms + " empty</span>",
                    '<span class="ldss-exam-preview-badge">' + roomCapacityForBatch(currentBatchId) + " per room</span>"
                ].join("");
            }
        }

        if (!shell) {
            return;
        }
        if (!currentBatchId) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">Create or load a batch, then generate room assignments to preview the room list here.</div>';
            return;
        }
        if (!roomHotfixAvailable) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">Apply <strong>supabase/exam_room_assignment_hotfix_2026_03_28.sql</strong> first so room names and seat numbers can be saved.</div>';
            return;
        }
        if (!rows.length) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">This batch exists, but it does not have saved room assignments yet.</div>';
            return;
        }
        if (!previewTabs.length) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">No room preview is available for this batch yet.</div>';
            return;
        }

        const availableKeys = new Set(previewTabs.map(function (tab) { return tab.key; }));
        if (!availableKeys.has(previewActiveRoomKey)) {
            previewActiveRoomKey = previewTabs[0].key;
        }

        const activeTab = previewTabs.find(function (tab) {
            return tab.key === previewActiveRoomKey;
        }) || previewTabs[0];

        let panelHtml = "";
        if (activeTab.type === "room") {
            const room = activeTab.room;
            const roomRows = room.rows;
            panelHtml = (
                '<section class="ldss-room-card">' +
                    '<div class="ldss-room-card-head">' +
                        '<div><div class="ldss-room-card-title">' + escapeHtml(room.roomLabel) + '</div><div class="ldss-room-card-copy">' + roomRows.length + ' applicant(s) assigned</div></div>' +
                    "</div>" +
                    '<div class="table-responsive">' +
                        '<table class="table table-sm">' +
                            "<thead><tr><th>Applicant Full Name</th><th>LDSP No.</th><th>Seat No.</th><th>Action</th></tr></thead>" +
                            "<tbody>" +
                                roomRows.map(function (row) {
                                    return (
                                        "<tr>" +
                                            "<td><div class=\"fw-700\">" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div><div class=\"small text-muted\">" + escapeHtml(row.school_name || "-") + "</div></td>" +
                                            "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                                            "<td>" + escapeHtml(row.room_seat_no || "-") + "</td>" +
                                            '<td><div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-dark btn-sm" type="button" data-test-email-application-id="' + escapeHtml(row.application_id) + '">Send Test Email</button><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(buildVerificationUrl(row.application_id)) + '">Open Details</a></div></td>' +
                                        "</tr>"
                                    );
                                }).join("") +
                            "</tbody>" +
                        "</table>" +
                    "</div>" +
                "</section>"
            );
        } else {
            panelHtml = (
                '<section class="ldss-room-card">' +
                    '<div class="ldss-room-card-head">' +
                        '<div><div class="ldss-room-card-title">Reserved Empty Rooms</div><div class="ldss-room-card-copy">' + activeTab.count + ' room(s) currently have no assigned examinees</div></div>' +
                    "</div>" +
                    '<div class="ldss-room-card-empty">' +
                        '<div class="ldss-room-empty-intro">These rooms are still part of the saved batch plan, but no examinees are assigned to them yet.</div>' +
                        '<div class="ldss-room-empty-chip-list">' +
                            activeTab.rooms.map(function (room) {
                                return '<span class="ldss-room-empty-chip">' + escapeHtml(room.roomLabel) + "</span>";
                            }).join("") +
                        "</div>" +
                    "</div>" +
                "</section>"
            );
        }

        shell.innerHTML =
            '<div class="ldss-room-preview-tabs" role="tablist" aria-label="Room preview tabs">' +
                previewTabs.map(function (tab) {
                    return (
                        '<button class="ldss-room-preview-tab' + (tab.key === activeTab.key ? ' is-active' : '') + '" type="button" data-preview-room-key="' + escapeHtml(tab.key) + '" role="tab" aria-selected="' + (tab.key === activeTab.key ? "true" : "false") + '">' +
                            '<span class="ldss-room-preview-tab-label">' + escapeHtml(tab.label) + '</span>' +
                            '<span class="ldss-room-preview-tab-count">' + tab.count + "</span>" +
                        "</button>"
                    );
                }).join("") +
            "</div>" +
            '<div class="ldss-room-preview-panel">' + panelHtml + "</div>";
    }

    function renderBatchDirectory() {
        const tbody = byId("examManagementBatchTableBody");
        if (!tbody) {
            return;
        }
        if (!batches.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No exam batches yet.</td></tr>';
            return;
        }
        tbody.innerHTML = batches.map(function (batch) {
            const assigned = assignedRowsForBatch(batch.id).length;
            return (
                "<tr>" +
                    "<td>" + escapeHtml(batch.batch_label || "-") + "</td>" +
                    "<td>" + escapeHtml(formatDateTime(batch.exam_datetime || "")) + "</td>" +
                    "<td>" + escapeHtml(batch.venue || "-") + "</td>" +
                    "<td>" + assigned + "</td>" +
                    "<td>" + plannedRoomCountForBatch(batch.id) + "</td>" +
                    "<td>" + roomCapacityForBatch(batch.id) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderAll() {
        renderBatchSelect();
        syncBatchScheduleFieldLock();
        renderMetrics();
        renderActiveBatchSummary();
        renderEmailQueueStatus();
        renderEligibleTable();
        renderPreview();
        renderScheduleEmailMeta();
        renderResetBatchMeta();
        renderDeleteBatchMeta();
        renderDeleteAllSafeBatchesMeta();
    }

    async function fetchLatestEmailQueueJob(batchId) {
        if (!batchId) {
            return null;
        }

        const result = await authContext.client
            .from("exam_schedule_email_jobs")
            .select("id, batch_id, batch_label, total_recipients, processed_count, sent_count, skipped_count, failed_count, batch_size, batch_delay_minutes, status, next_run_at, started_at, completed_at, last_error, created_at, updated_at")
            .eq("batch_id", batchId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                emailQueueStatusAvailable = false;
                return null;
            }
            throw new Error("Failed to load batch email queue status: " + result.error.message);
        }

        emailQueueStatusAvailable = true;
        return result.data || null;
    }

    function scheduleEmailQueueStatusRefresh(batchId) {
        clearEmailQueueRefreshTimer();
        if (!batchId || batchId !== currentBatchId || !hasActiveEmailQueueJob(currentEmailQueueJob)) {
            return;
        }

        emailQueueRefreshTimer = window.setTimeout(function () {
            refreshEmailQueueStatus({ batchId: batchId, showError: false }).catch(function () {
                // Quiet retry path only.
            });
        }, EXAM_EMAIL_QUEUE_REFRESH_INTERVAL_MS);
    }

    async function refreshEmailQueueStatus(options) {
        const opts = options || {};
        const batchId = Object.prototype.hasOwnProperty.call(opts, "batchId") ? opts.batchId : currentBatchId;
        const requestToken = emailQueueRequestToken + 1;
        emailQueueRequestToken = requestToken;
        clearEmailQueueRefreshTimer();

        if (!batchId || !authContext || !authContext.client) {
            currentEmailQueueJob = null;
            emailQueueStatusAvailable = true;
            renderEmailQueueStatus();
            renderScheduleEmailMeta();
            return;
        }

        try {
            const job = await fetchLatestEmailQueueJob(batchId);
            if (requestToken !== emailQueueRequestToken || batchId !== currentBatchId) {
                return;
            }
            currentEmailQueueJob = job;
            renderEmailQueueStatus();
            renderScheduleEmailMeta();
            scheduleEmailQueueStatusRefresh(batchId);
        } catch (error) {
            if (requestToken !== emailQueueRequestToken || batchId !== currentBatchId) {
                return;
            }
            currentEmailQueueJob = null;
            renderEmailQueueStatus();
            renderScheduleEmailMeta();
            if (opts.showError) {
                showStatus(error && error.message ? error.message : "Failed to load the batch email queue status.", "alert-warning");
            }
        }
    }

    async function loadProfilesByIds(applicantIds) {
        const map = {};
        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const chunk = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }
            const result = await authContext.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, school_name")
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to load applicant profiles: " + result.error.message);
            }

            (result.data || []).forEach(function (profile) {
                map[profile.id] = profile;
            });
        }
        return map;
    }

    async function fetchApplications() {
        const rows = [];
        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await authContext.client
                .from("applications")
                .select("id, application_no, applicant_id, status, updated_at")
                .in("status", EXAM_SCOPE_STATUSES)
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                throw new Error("Failed to load examinee records: " + result.error.message);
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        if (!rows.length) {
            return [];
        }

        const profileMap = await loadProfilesByIds(Array.from(new Set(rows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean))));

        return rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return {
                id: row.id,
                applicant_id: row.applicant_id,
                application_no: row.application_no || "",
                status: normalizeStatus(row.status),
                applicant_name: buildApplicantName(profile),
                school_name: profile && profile.school_name ? profile.school_name : "",
                email: profile && profile.email ? profile.email : ""
            };
        });
    }

    async function fetchBatches() {
        const result = await authContext.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
            .order("exam_datetime", { ascending: false });

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                return [];
            }
            throw new Error("Failed to load exam batches: " + result.error.message);
        }
        return (result.data || []).filter(function (batch) {
            return normalizeStatus(batch && batch.status) !== "archived";
        }).map(function (batch) {
            const parsed = parsedBatchNotes(batch.notes || "");
            return Object.assign({}, batch, {
                notes: parsed.notes,
                room_count: parsed.roomCount,
                room_prefix: parsed.roomPrefix
            });
        });
    }

    async function fetchExamRecords() {
        roomHotfixAvailable = true;
        const rows = [];
        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const withRooms = await authContext.client
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, result, room_label, room_seat_no, created_at, updated_at")
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (!withRooms.error) {
                const batch = withRooms.data || [];
                rows.push.apply(rows, batch);
                if (batch.length < SUPABASE_FETCH_LIMIT) {
                    return rows;
                }
                continue;
            }

            if (/room_label|room_seat_no/i.test(withRooms.error.message || "")) {
                roomHotfixAvailable = false;
                const fallbackRows = [];
                for (let fallbackFrom = 0; ; fallbackFrom += SUPABASE_FETCH_LIMIT) {
                    const fallback = await authContext.client
                        .from("exam_records")
                        .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, result, created_at, updated_at")
                        .order("updated_at", { ascending: false })
                        .range(fallbackFrom, fallbackFrom + SUPABASE_FETCH_LIMIT - 1);

                    if (fallback.error) {
                        throw new Error("Failed to load exam records: " + fallback.error.message);
                    }

                    const fallbackBatch = fallback.data || [];
                    fallbackRows.push.apply(fallbackRows, fallbackBatch);
                    if (fallbackBatch.length < SUPABASE_FETCH_LIMIT) {
                        return fallbackRows.map(function (row) {
                            return Object.assign({}, row, { room_label: "", room_seat_no: null });
                        });
                    }
                }
            }

            if (/does not exist|relation/i.test(withRooms.error.message || "")) {
                showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                return [];
            }

            throw new Error("Failed to load exam records: " + withRooms.error.message);
        }
    }

    async function loadData(targetBatchId) {
        const loaded = await Promise.all([fetchApplications(), fetchBatches(), fetchExamRecords()]);
        applications = loaded[0];
        batches = loaded[1];
        examRecords = loaded[2];

        if (targetBatchId === null) {
            currentBatchId = "";
        } else {
            currentBatchId = targetBatchId && batchById(targetBatchId) ? targetBatchId : (batchById(currentBatchId) ? currentBatchId : "");
        }
        eligiblePage = 1;
        currentEmailQueueJob = null;
        applyBatchForm(currentBatchId);
        resetSelectionToEligible();
        renderAll();
        await refreshEmailQueueStatus({ batchId: currentBatchId, showError: false });

        if (!roomHotfixAvailable) {
            showStatus("Room assignment fields are not deployed yet. Apply supabase/exam_room_assignment_hotfix_2026_03_28.sql before saving room assignments.", "alert-warning");
        }
    }

    function readFormValues() {
        const values = {
            batchLabel: (byId("examBatchLabel") ? byId("examBatchLabel").value : "").trim(),
            dateTimeRaw: (byId("examBatchDateTime") ? byId("examBatchDateTime").value : "").trim(),
            venue: (byId("examBatchVenue") ? byId("examBatchVenue").value : "").trim(),
            notes: (byId("examBatchNotes") ? byId("examBatchNotes").value : "").trim(),
            roomCount: Number((byId("examRoomCount") ? byId("examRoomCount").value : "").trim()),
            roomCapacity: Number((byId("examRoomCapacity") ? byId("examRoomCapacity").value : "").trim()),
            roomPrefix: ((byId("examRoomPrefix") ? byId("examRoomPrefix").value : "").trim() || "Room"),
            scheduledAt: datetimeLocalToIso(byId("examBatchDateTime") ? byId("examBatchDateTime").value : "")
        };

        if (!values.batchLabel) {
            return { error: "Batch label is required." };
        }
        if (!values.scheduledAt) {
            return { error: "Exam date is required." };
        }
        if (!values.venue) {
            return { error: "Venue is required." };
        }
        if (Number.isNaN(values.roomCount) || values.roomCount <= 0 || Math.floor(values.roomCount) !== values.roomCount) {
            return { error: "Number of rooms must be a whole number greater than zero." };
        }
        if (Number.isNaN(values.roomCapacity) || values.roomCapacity <= 0 || Math.floor(values.roomCapacity) !== values.roomCapacity) {
            return { error: "Number of examinees per room must be a whole number greater than zero." };
        }
        return values;
    }

    function shuffledAssignmentRows(rows) {
        const shuffled = (rows || []).slice();
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            const current = shuffled[index];
            shuffled[index] = shuffled[swapIndex];
            shuffled[swapIndex] = current;
        }
        return shuffled;
    }

    function buildAssignments(rows, values, batchId) {
        const orderedRows = shuffledAssignmentRows(rows);
        const assignments = [];
        let rowIndex = 0;
        let controlNo = controlStartForBatch(batchId);

        for (let roomIndex = 0; roomIndex < values.roomCount && rowIndex < orderedRows.length; roomIndex += 1) {
            const roomLabel = values.roomPrefix + " " + String(roomIndex + 1);

            for (let seatIndex = 0; seatIndex < values.roomCapacity && rowIndex < orderedRows.length; seatIndex += 1) {
                const row = orderedRows[rowIndex];
                rowIndex += 1;
                assignments.push({
                    application_id: row.id,
                    batch_id: batchId,
                    exam_control_no: String(controlNo).padStart(4, "0"),
                    scheduled_at: values.scheduledAt,
                    status: LOCKED_RECORD_STATUS,
                    room_label: roomLabel,
                    room_seat_no: seatIndex + 1
                });
                controlNo += 1;
            }
        }

        if (rowIndex < orderedRows.length) {
            throw new Error("Selected applicants exceed the allowed room capacity. Increase the number of rooms or the examinees per room.");
        }

        return assignments;
    }

    async function createOrUpdateBatch(values) {
        const existingBatch = currentBatchId ? batchById(currentBatchId) : null;
        const scheduleLocked = Boolean(existingBatch) && batchScheduleFieldsLocked(currentBatchId);
        const payload = {
            batch_label: values.batchLabel,
            exam_datetime: scheduleLocked ? (existingBatch.exam_datetime || values.scheduledAt) : values.scheduledAt,
            venue: scheduleLocked ? (existingBatch.venue || values.venue) : values.venue,
            capacity: values.roomCapacity,
            notes: composeBatchNotes(values.notes || "", values.roomCount, values.roomPrefix),
            status: "open"
        };

        if (currentBatchId) {
            const updateResult = await authContext.client
                .from("exam_batches")
                .update(payload)
                .eq("id", currentBatchId)
                .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
                .single();

            if (updateResult.error) {
                throw new Error("Failed to update exam batch: " + updateResult.error.message);
            }
            return updateResult.data;
        }

        const insertResult = await authContext.client
            .from("exam_batches")
            .insert({
                batch_label: payload.batch_label,
                exam_datetime: payload.exam_datetime,
                venue: payload.venue,
                capacity: payload.capacity,
                notes: payload.notes,
                status: payload.status,
                created_by: authContext.user.id
            })
            .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
            .single();

        if (insertResult.error) {
            throw new Error("Failed to create exam batch: " + insertResult.error.message);
        }
        return insertResult.data;
    }

    async function updateApplicationStatuses(applicationIds, nextStatus) {
        if (!applicationIds.length) {
            return;
        }
        for (let start = 0; start < applicationIds.length; start += 200) {
            const chunk = applicationIds.slice(start, start + 200);
            const result = await authContext.client
                .from("applications")
                .update({ status: nextStatus })
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to update application statuses: " + result.error.message);
            }
        }
    }

    async function deleteExamRecordsForApplications(applicationIds) {
        const removableIds = (applicationIds || []).filter(Boolean);
        if (!removableIds.length) {
            return;
        }

        const records = examRecordsForApplications(removableIds);
        if (!records.length) {
            return;
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            throw new Error("One or more selected examinees already have completed or encoded exam records and cannot be returned.");
        }

        for (let start = 0; start < removableIds.length; start += 200) {
            const chunk = removableIds.slice(start, start + 200);
            const result = await authContext.client
                .from("exam_records")
                .delete()
                .in("application_id", chunk);

            if (result.error) {
                throw new Error("Failed to clear exam assignments: " + result.error.message);
            }
        }
    }

    function resolveReturnConfirmation(confirmed) {
        if (!returnConfirmResolver) {
            return;
        }
        const resolve = returnConfirmResolver;
        returnConfirmResolver = null;
        resolve(Boolean(confirmed));
    }

    function resolveResetConfirmation(confirmed) {
        if (!resetConfirmResolver) {
            return;
        }
        const resolve = resetConfirmResolver;
        resetConfirmResolver = null;
        resolve(Boolean(confirmed));
    }

    function resolveDeleteConfirmation(confirmed) {
        if (!deleteConfirmResolver) {
            return;
        }
        const resolve = deleteConfirmResolver;
        deleteConfirmResolver = null;
        resolve(Boolean(confirmed));
    }

    function confirmationDetails(nextStatus, selectedCount, scheduledCount) {
        if (nextStatus === "submitted") {
            return {
                kicker: "Return to Checking",
                title: "Return selected examinees to secretary checking?",
                copy: "This will move the selected examinees out of Room Assignment and send them back to the secretary checking queue for review.",
                target: "Secretary Checking",
                note: scheduledCount > 0
                    ? String(scheduledCount) + " scheduled room assignment(s) will be cleared before the rollback is saved."
                    : "No saved room assignment will be cleared for this selection. The selected records will simply leave Room Assignment and return to checking.",
                confirmLabel: "Return to Checking"
            };
        }

        return {
            kicker: "Back to Pending",
            title: "Move selected examinees back to Pending Exam?",
            copy: "This keeps the selected examinees in Room Assignment but removes them from the current scheduled room assignment so staff can schedule them again later.",
            target: "Pending Exam",
            note: String(scheduledCount) + " scheduled room assignment(s) will be cleared before the rollback is saved.",
            confirmLabel: "Back to Pending"
        };
    }

    function populateReturnConfirmModal(nextStatus, selectedCount, scheduledCount) {
        const details = confirmationDetails(nextStatus, selectedCount, scheduledCount);
        const kicker = byId("examManagementReturnConfirmKicker");
        const title = byId("examManagementReturnConfirmTitle");
        const copy = byId("examManagementReturnConfirmCopy");
        const count = byId("examManagementReturnConfirmCount");
        const target = byId("examManagementReturnConfirmTarget");
        const note = byId("examManagementReturnConfirmNote");
        const proceedBtn = byId("examManagementReturnConfirmProceedBtn");

        if (kicker) {
            kicker.textContent = details.kicker;
        }
        if (title) {
            title.textContent = details.title;
        }
        if (copy) {
            copy.textContent = details.copy;
        }
        if (count) {
            count.textContent = String(selectedCount);
        }
        if (target) {
            target.textContent = details.target;
        }
        if (note) {
            note.textContent = details.note;
        }
        if (proceedBtn) {
            proceedBtn.textContent = details.confirmLabel;
        }
    }

    function requestReturnConfirmation(nextStatus, selectedCount, scheduledCount) {
        const actionCopy = nextStatus === "submitted"
            ? "return the selected examinees to secretary checking"
            : "move the selected examinees back to Pending Exam";
        const modal = getReturnConfirmModal();
        if (!modal) {
            return Promise.resolve(window.confirm("This will " + actionCopy + ". Continue?"));
        }

        populateReturnConfirmModal(nextStatus, selectedCount, scheduledCount);
        return new Promise(function (resolve) {
            returnConfirmResolver = resolve;
            modal.show();
        });
    }

    function populateResetConfirmModal(batch, recordCount) {
        const batchEl = byId("examManagementResetConfirmBatch");
        const countEl = byId("examManagementResetConfirmCount");
        const copyEl = byId("examManagementResetConfirmCopy");
        const noteEl = byId("examManagementResetConfirmNote");

        if (batchEl) {
            batchEl.textContent = batch && batch.batch_label ? batch.batch_label : "-";
        }
        if (countEl) {
            countEl.textContent = String(recordCount || 0);
        }
        if (copyEl) {
            copyEl.textContent = "This will remove the current batch's saved room assignments and place those applicants back in Pending Exam.";
        }
        if (noteEl) {
            noteEl.textContent = "Only unlocked scheduled exam data in the current batch will be cleared. Completed or encoded exam records stay protected and must be handled separately.";
        }
    }

    function requestResetConfirmation(batch, recordCount) {
        const modal = getResetConfirmModal();
        if (!modal) {
            return Promise.resolve(window.confirm("This will clear the selected batch's scheduled exam data and return those applicants to Pending Exam. Continue?"));
        }

        populateResetConfirmModal(batch, recordCount);
        return new Promise(function (resolve) {
            resetConfirmResolver = resolve;
            modal.show();
        });
    }

    function populateDeleteConfirmModal(config) {
        const settings = config || {};
        const titleEl = byId("examManagementDeleteConfirmTitle");
        const batchEl = byId("examManagementDeleteConfirmBatch");
        const countEl = byId("examManagementDeleteConfirmCount");
        const copyEl = byId("examManagementDeleteConfirmCopy");
        const noteEl = byId("examManagementDeleteConfirmNote");
        const proceedBtn = byId("examManagementDeleteConfirmProceedBtn");
        const kickerEl = byId("examManagementDeleteConfirmKicker");

        if (kickerEl) {
            kickerEl.textContent = settings.kicker || "Start Over";
        }
        if (titleEl) {
            titleEl.textContent = settings.title || "Clear this batch and start over?";
        }
        if (batchEl) {
            batchEl.textContent = settings.scopeLabel || "-";
        }
        if (countEl) {
            countEl.textContent = String(settings.recordCount || 0);
        }
        if (copyEl) {
            copyEl.textContent = settings.copy || "This will remove the selected safe batch and return its still-scheduled applicants to Pending Exam before the page goes back to Create new batch.";
        }
        if (noteEl) {
            noteEl.textContent = settings.note || "Start Over works only for batches without completed or encoded exam records. Any still-scheduled applicants in this batch will be returned to Pending Exam first.";
        }
        if (proceedBtn) {
            proceedBtn.textContent = settings.confirmLabel || "Start Over";
        }
    }

    function requestDeleteConfirmation(config) {
        const modal = getDeleteConfirmModal();
        if (!modal) {
            return Promise.resolve(window.confirm((config && config.confirmPrompt) || "This will clear the selected safe batch and return its still-scheduled applicants to Pending Exam before the page goes back to Create new batch. Continue?"));
        }

        populateDeleteConfirmModal(config);
        return new Promise(function (resolve) {
            deleteConfirmResolver = resolve;
            modal.show();
        });
    }

    async function deleteRemovedBatchAssignments(batchId, keepIds) {
        const records = batchRecords(batchId);
        if (!records.length) {
            return;
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            throw new Error("This batch already has completed or encoded exam records and can no longer be regenerated.");
        }

        const keep = new Set(keepIds);
        const removedIds = records.filter(function (record) {
            return !keep.has(record.application_id);
        }).map(function (record) {
            return record.application_id;
        }).filter(Boolean);

        if (!removedIds.length) {
            return;
        }

        const deleteResult = await authContext.client
            .from("exam_records")
            .delete()
            .eq("batch_id", batchId)
            .in("application_id", removedIds);

        if (deleteResult.error) {
            throw new Error("Failed to clear removed batch assignments: " + deleteResult.error.message);
        }

        await updateApplicationStatuses(removedIds, "pending_exam");
    }

    async function resetCurrentBatchAssignments(batchId) {
        const records = batchRecords(batchId);
        if (!records.length) {
            return 0;
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            throw new Error("This batch already contains completed or encoded exam records and cannot be fully reset.");
        }

        const applicationIds = records.map(function (record) {
            return record.application_id;
        }).filter(Boolean);

        const deleteResult = await authContext.client
            .from("exam_records")
            .delete()
            .eq("batch_id", batchId);

        if (deleteResult.error) {
            throw new Error("Failed to reset the current batch's exam data: " + deleteResult.error.message);
        }

        await updateApplicationStatuses(applicationIds, "pending_exam");
        return applicationIds.length;
    }

    async function clearAssignmentsForBatches(batchIds) {
        const ids = Array.from(new Set((batchIds || []).filter(Boolean)));
        if (!ids.length) {
            return;
        }

        for (let start = 0; start < ids.length; start += 100) {
            const batchChunk = ids.slice(start, start + 100);
            const updateRecordsResult = await authContext.client
                .from("exam_records")
                .update({
                    batch_id: null,
                    room_label: null,
                    room_seat_no: null
                })
                .in("batch_id", batchChunk);

            if (updateRecordsResult.error) {
                throw new Error("Failed to clear safe batch exam assignments: " + updateRecordsResult.error.message);
            }
        }
    }

    async function archiveBatches(batchIds) {
        const ids = Array.from(new Set((batchIds || []).filter(Boolean)));
        if (!ids.length) {
            return;
        }

        for (let start = 0; start < ids.length; start += 100) {
            const batchChunk = ids.slice(start, start + 100);
            const archiveResult = await authContext.client
                .from("exam_batches")
                .update({ status: "archived" })
                .in("id", batchChunk);

            if (archiveResult.error) {
                throw new Error("Failed to archive safe batch entries: " + archiveResult.error.message);
            }
        }
    }

    async function deleteCurrentBatch(batchId) {
        const batch = batchById(batchId);
        const records = batchRecords(batchId);
        if (!batch) {
            throw new Error("Select a saved batch first before deleting it.");
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            throw new Error("This batch already contains completed or encoded exam records and cannot be deleted.");
        }

        const applicationIds = records.map(function (record) {
            return record.application_id;
        }).filter(Boolean);

        if (applicationIds.length) {
            await clearAssignmentsForBatches([batchId]);
            await updateApplicationStatuses(applicationIds, "pending_exam");
        }
        await archiveBatches([batchId]);

        return {
            batchLabel: batch.batch_label || "the selected batch",
            scheduledCount: applicationIds.length
        };
    }

    async function deleteAllSafeBatches() {
        const safeEntries = safeBatchEntries();
        if (!safeEntries.length) {
            return {
                batchCount: 0,
                scheduledCount: 0
            };
        }

        const batchIds = safeEntries.map(function (entry) {
            return entry.batch.id;
        }).filter(Boolean);
        const applicationIds = Array.from(new Set(safeEntries.reduce(function (allIds, entry) {
            entry.records.forEach(function (record) {
                if (record && record.application_id) {
                    allIds.push(record.application_id);
                }
            });
            return allIds;
        }, [])));

        await clearAssignmentsForBatches(batchIds);

        if (applicationIds.length) {
            await updateApplicationStatuses(applicationIds, "pending_exam");
        }
        await archiveBatches(batchIds);

        return {
            batchCount: batchIds.length,
            scheduledCount: applicationIds.length
        };
    }

    async function saveAssignments(assignments) {
        for (let start = 0; start < assignments.length; start += 100) {
            const chunk = assignments.slice(start, start + 100);
            const result = await authContext.client
                .from("exam_records")
                .upsert(chunk, { onConflict: "application_id" });

            if (result.error) {
                throw new Error("Failed to save room assignments: " + result.error.message);
            }
        }
    }

    async function handleGenerate() {
        if (!roomHotfixAvailable) {
            showStatus("Apply supabase/exam_room_assignment_hotfix_2026_03_28.sql first so room assignments can be saved.", "alert-warning");
            return;
        }

        const values = readFormValues();
        if (values.error) {
            showStatus(values.error, "alert-warning");
            return;
        }

        const selectedRows = allSelectableEligibleRows();

        if (!selectedRows.length) {
            showStatus("There are no eligible Pending Exam applicants ready for room assignment right now.", "alert-warning");
            return;
        }
        if (selectedRows.length > values.roomCount * values.roomCapacity) {
            showStatus("Eligible Pending Exam applicants exceed the allowed room capacity. Increase the number of rooms or the examinees per room.", "alert-warning");
            return;
        }

        const button = byId("examGenerateBtn");
        if (button) {
            button.disabled = true;
            button.textContent = "Saving...";
        }

        try {
            const batch = await createOrUpdateBatch(values);
            currentBatchId = batch.id;
            await deleteRemovedBatchAssignments(batch.id, selectedRows.map(function (row) { return row.id; }));

            const assignments = buildAssignments(selectedRows, values, batch.id);
            await saveAssignments(assignments);
            await updateApplicationStatuses(assignments.map(function (row) { return row.application_id; }), "exam_scheduled");

            await loadData(batch.id);
            const usedRoomCount = Array.from(new Set(assignments.map(function (row) { return row.room_label; }).filter(Boolean))).length;
            const emptyRoomCount = Math.max(values.roomCount - usedRoomCount, 0);
            showStatus("Room assignment saved successfully. All eligible Pending Exam applicants were shuffled randomly, then " + assignments.length + " applicant(s) were assigned across " + usedRoomCount + " occupied room(s) from a " + values.roomCount + "-room plan, with up to " + values.roomCapacity + " examinee(s) per room. " + emptyRoomCount + " room(s) remain empty but reserved in the batch plan. You can now send the batch schedule emails or use the one-person row action for individual test email.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to save room assignments.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Generate and Save Room Assignment";
            }
        }
    }

    async function handleResetBatch() {
        const batch = batchById(currentBatchId);
        const button = byId("examResetBatchBtn");
        const records = batchRecords(currentBatchId);

        if (!batch) {
            showStatus("Select a saved batch first before resetting exam data.", "alert-warning");
            return;
        }
        if (!records.length) {
            showStatus("This batch does not have any saved exam data to reset yet.", "alert-info");
            return;
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            showStatus("This batch already contains completed or encoded exam records and cannot be fully reset.", "alert-warning");
            return;
        }

        const confirmed = await requestResetConfirmation(batch, records.length);
        if (!confirmed) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Resetting...";
        }

        try {
            const resetCount = await resetCurrentBatchAssignments(currentBatchId);
            previewActiveRoomKey = "";
            eligiblePage = 1;
            await loadData(currentBatchId);
            showStatus("Exam data reset successfully for " + (batch.batch_label || "the selected batch") + ". " + resetCount + " applicant(s) were returned to Pending Exam and the room assignment was cleared.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to reset the current batch's exam data.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Reset Exam Data";
            }
        }
    }

    async function handleDeleteBatch() {
        const batch = batchById(currentBatchId);
        const button = byId("examDeleteBatchBtn");
        const records = batchRecords(currentBatchId);

        if (!batch) {
            currentBatchId = "";
            previewActiveRoomKey = "";
            eligiblePage = 1;
            applyBatchForm("");
            resetSelectionToEligible();
            renderAll();
            showStatus("Start over ready. The page is back to Create new batch.", "alert-info");
            return;
        }
        if (records.some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
            showStatus("This batch already contains completed or encoded exam records, so Start Over is locked for safety.", "alert-warning");
            return;
        }

        const confirmed = await requestDeleteConfirmation({
            kicker: "Start Over",
            title: "Clear this batch and start over?",
            scopeLabel: batch.batch_label || "-",
            recordCount: records.length,
            copy: records.length
                ? "This will remove the selected safe batch and return its still-scheduled applicants to Pending Exam before the page goes back to Create new batch."
                : "This will remove the selected empty batch and return the page to Create new batch.",
            note: "Start Over works only for batches without completed or encoded exam records. Any still-scheduled applicants in this batch will be returned to Pending Exam first.",
            confirmLabel: "Start Over",
            confirmPrompt: "This will clear the selected safe batch and return its still-scheduled applicants to Pending Exam before the page goes back to Create new batch. Continue?"
        });
        if (!confirmed) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Starting Over...";
        }

        try {
            const deletion = await deleteCurrentBatch(currentBatchId);
            previewActiveRoomKey = "";
            eligiblePage = 1;
            currentBatchId = "";
            await loadData(null);
            showStatus("Start over complete. " + deletion.batchLabel + " was cleared from Existing Batch" + (deletion.scheduledCount ? ", and " + deletion.scheduledCount + " applicant(s) were returned to Pending Exam." : ".") + " The page is now back to Create new batch.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to start over with the selected batch.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Start Over";
            }
        }
    }

    async function handleDeleteAllSafeBatches() {
        const button = byId("examDeleteAllSafeBatchesBtn");
        const safeEntries = safeBatchEntries();
        const safeBatchCount = safeEntries.length;
        const safeRecordCount = safeEntries.reduce(function (sum, entry) {
            return sum + entry.recordCount;
        }, 0);

        if (!safeBatchCount) {
            showStatus("There are no safe batches to clear right now.", "alert-info");
            return;
        }

        const confirmed = await requestDeleteConfirmation({
            kicker: "Clear All Safe Batches",
            title: "Clear all safe batches now?",
            scopeLabel: String(safeBatchCount) + " safe batch(es)",
            recordCount: safeRecordCount,
            copy: safeRecordCount
                ? "This will remove every safe saved batch and return all still-scheduled applicants in those batches to Pending Exam."
                : "This will remove every safe saved empty batch and return the page to Create new batch.",
            note: "Completed or encoded exam batches stay protected and will not be touched by this bulk cleanup.",
            confirmLabel: "Clear All Safe Batches",
            confirmPrompt: "This will remove every safe saved batch and return all still-scheduled applicants in those batches to Pending Exam. Continue?"
        });
        if (!confirmed) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Clearing...";
        }

        try {
            const deletion = await deleteAllSafeBatches();
            currentBatchId = "";
            previewActiveRoomKey = "";
            eligiblePage = 1;
            await loadData(null);
            showStatus("Clear all safe batches complete. " + deletion.batchCount + " batch(es) were removed" + (deletion.scheduledCount ? ", and " + deletion.scheduledCount + " applicant(s) were returned to Pending Exam." : "."), "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to clear all safe batches.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Clear All Safe Batches";
            }
        }
    }

    async function sendExamScheduleEmails(batchId, customMessage) {
        return requestJson(EXAM_SCHEDULE_EMAIL_API_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                batchId: batchId || "",
                customMessage: (customMessage || "").trim()
            })
        });
    }

    async function sendTestExamScheduleEmail(batchId, applicationId, customMessage, testEmail) {
        return requestJson(EXAM_SCHEDULE_TEST_EMAIL_API_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                batchId: batchId || "",
                applicationId: applicationId || "",
                customMessage: (customMessage || "").trim(),
                testEmail: (testEmail || "").trim().toLowerCase()
            })
        });
    }

    async function handleSendScheduleEmails() {
        const batch = batchById(currentBatchId);
        const recipients = scheduledRowsForBatch(currentBatchId);
        const button = byId("examSendScheduleEmailsBtn");
        const noteInput = byId("examScheduleEmailNote");
        const customMessage = noteInput ? noteInput.value.trim() : "";

        if (!batch) {
            showStatus("Select a saved batch first before sending exam schedule emails.", "alert-warning");
            return;
        }
        if (!recipients.length) {
            showStatus("This batch does not have any saved scheduled examinees yet.", "alert-warning");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Queueing...";
        }

        try {
            const response = await sendExamScheduleEmails(currentBatchId, customMessage);
            await loadData(currentBatchId);

            if (response && response.queued) {
                const queuedCount = Number(response.queued_email_count || 0);
                const skippedCount = Number(response.email_skipped_count || 0);
                const batchSize = Number(response.batch_size || 100);
                const batchDelayMinutes = Number(response.batch_delay_minutes || 5);
                const estimatedBatches = Number(response.estimated_batches || (queuedCount ? Math.ceil(queuedCount / Math.max(1, batchSize)) : 0));
                const queueSummaryParts = [
                    String(queuedCount) + " email(s) queued",
                    "sending in batches of " + batchSize + " every " + batchDelayMinutes + " minute(s)"
                ];

                if (estimatedBatches > 1) {
                    queueSummaryParts.push(String(estimatedBatches) + " total queue batch(es)");
                }
                if (skippedCount) {
                    queueSummaryParts.push(String(skippedCount) + " skipped without email address");
                }
                if (response.notification_count || response.notification_count === 0) {
                    queueSummaryParts.push(String(response.notification_count) + " in-app notification(s) saved");
                }
                if (response.status_update_error) {
                    queueSummaryParts.push("status update warning");
                }
                if (response.notification_error) {
                    queueSummaryParts.push("notification save warning");
                }

                showStatus(
                    "Exam schedule email queue created for " + (response.batch_label || batch.batch_label || "the selected batch") + ". " + queueSummaryParts.join(". ") + ". The Node server will continue sending in the background even if you leave this page.",
                    response.notification_error ? "alert-warning" : "alert-success"
                );
                return;
            }

            const summaryParts = [
                String(response.email_sent_count || 0) + " email(s) sent",
                String(response.status_updated_count || 0) + " application(s) confirmed as Exam Scheduled"
            ];

            if (response.email_skipped_count) {
                summaryParts.push(String(response.email_skipped_count) + " skipped without email address");
            }
            if (response.notification_count || response.notification_count === 0) {
                summaryParts.push(String(response.notification_count) + " in-app notification(s) saved");
            }
            if (response.email_failed_count) {
                summaryParts.push(String(response.email_failed_count) + " email(s) failed");
            }
            if (response.notification_error) {
                summaryParts.push("notification save warning");
            }

            const alertType = response.email_failed_count || response.notification_error
                ? "alert-warning"
                : "alert-success";

            showStatus(
                "Exam schedule notices processed for " + (response.batch_label || batch.batch_label || "the selected batch") + ". " + summaryParts.join(". ") + ".",
                alertType
            );
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to send exam schedule emails.", "alert-danger");
        } finally {
            if (button) {
                button.textContent = "Send Schedule Emails";
            }
            renderScheduleEmailMeta();
        }
    }

    async function handleSendTestEmail(targetApplicationIdOverride) {
        const batch = batchById(currentBatchId);
        const selectedRecipients = selectedScheduledRowsForCurrentBatch();
        const selectedRows = selectedSelectableRows();
        const batchScheduledRecipients = scheduledRowsForBatch(currentBatchId);
        const button = byId("examSendTestEmailBtn");
        const noteInput = byId("examScheduleEmailNote");
        const testEmailInput = byId("examScheduleTestEmail");
        const customMessage = noteInput ? noteInput.value.trim() : "";
        const testEmail = testEmailInput ? testEmailInput.value.trim().toLowerCase() : "";
        let targetRecipient = null;

        if (!batch) {
            showStatus("Select a saved batch first before sending a one-person test email.", "alert-warning");
            return;
        }
        if (!batchScheduledRecipients.length) {
            showStatus("Generate and save the room assignment first so the batch has at least one scheduled examinee for the test email.", "alert-warning");
            return;
        }

        if (targetApplicationIdOverride) {
            targetRecipient = batchScheduledRecipients.find(function (row) {
                return row && row.application_id === targetApplicationIdOverride;
            }) || null;
            if (!targetRecipient) {
                showStatus("That applicant is not scheduled in the current batch yet. Generate and save the room assignment first, then send the test email.", "alert-warning");
                return;
            }
        } else if (!selectedRecipients.length) {
            if (selectedRows.length) {
                showStatus("The checked applicant is not scheduled in this batch yet. Generate and save the room assignment first, then send the test email.", "alert-warning");
            } else {
                showStatus("Check one scheduled examinee first, or use the row-level Send Test Email button.", "alert-warning");
            }
            return;
        } else if (selectedRecipients.length > 1) {
            showStatus("Keep only one scheduled examinee checked before sending the test email.", "alert-warning");
            return;
        } else {
            targetRecipient = selectedRecipients[0];
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Sending Test...";
        }

        try {
            const targetApplicationId = targetRecipient && (targetRecipient.id || targetRecipient.application_id) ? (targetRecipient.id || targetRecipient.application_id) : "";
            const response = await sendTestExamScheduleEmail(currentBatchId, targetApplicationId, customMessage, testEmail);
            const deliveredTo = response && response.sent_to_email ? response.sent_to_email : (testEmail || "the selected recipient");
            const applicantName = response && response.applicant_name ? response.applicant_name : (targetRecipient && targetRecipient.applicant_name ? targetRecipient.applicant_name : "the selected examinee");
            showStatus("Test exam schedule email sent successfully to " + deliveredTo + " using " + applicantName + "'s room assignment details.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to send the one-person test email.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Send Test Email";
            }
        }
    }

    async function handleReturnSelected(nextStatus, buttonId, loadingText) {
        const selectedRows = selectedSelectableRows();
        if (!selectedRows.length) {
            showStatus("Select at least one eligible examinee first.", "alert-warning");
            return;
        }

        const selectedIds = selectedRows.map(function (row) { return row.id; }).filter(Boolean);
        const scheduledIds = selectedRows.filter(function (row) {
            return hasScheduledRecordInBatch(currentBatchId, row.id);
        }).map(function (row) {
            return row.id;
        }).filter(Boolean);
        const idsNeedingStatusChange = selectedRows.filter(function (row) {
            return normalizeStatus(row.status) !== nextStatus;
        }).map(function (row) {
            return row.id;
        }).filter(Boolean);

        if (nextStatus === "pending_exam" && !scheduledIds.length) {
            showStatus("The selected examinees are already in Pending Exam.", "alert-info");
            return;
        }

        const confirmed = await requestReturnConfirmation(nextStatus, selectedRows.length, scheduledIds.length);
        if (!confirmed) {
            return;
        }

        const button = byId(buttonId);
        if (button) {
            button.disabled = true;
            button.textContent = loadingText;
        }

        try {
            await deleteExamRecordsForApplications(selectedIds);
            if (idsNeedingStatusChange.length) {
                await updateApplicationStatuses(idsNeedingStatusChange, nextStatus);
            }
            await loadData(currentBatchId);

            if (nextStatus === "submitted") {
                showStatus("Selected examinees were returned to secretary checking. Any unlocked exam assignments tied to them were cleared.", "alert-success");
            } else {
                showStatus("Selected examinees were moved back to Pending Exam and removed from their saved room assignment.", "alert-success");
            }
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to reverse the selected examinees.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = nextStatus === "submitted" ? "Return to Checking" : "Back to Pending";
            }
        }
    }

    function buildPrintHtml(mode, batch, rows) {
        const lguHref = new URL("../img/daet-lgu.png", window.location.href).href;
        const roomCollections = roomCollectionsForBatch(batch.id, rows);
        const headerHtml =
            '<div class="print-official-header">' +
                '<div class="print-logo-row">' +
                    '<div class="print-logo-stack"><div class="print-logo-frame"><img class="print-logo print-logo-lgu" src="' + escapeHtml(lguHref) + '" alt="LGU Daet" /></div><div>LGU DAET</div></div>' +
                "</div>" +
                '<div class="print-title-block">' +
                    '<div class="print-title-kicker">LGU Daet Scholarship System</div>' +
                    '<div class="print-title-main">' + escapeHtml(mode === "rooms" ? "Official Examination Room List" : "Official Examination Masterlist") + "</div>" +
                "</div>" +
                '<div class="print-meta">' +
                    '<div><strong>Batch:</strong> ' + escapeHtml(batch.batch_label || "-") + '</div>' +
                    '<div><strong>Exam Date:</strong> ' + escapeHtml(formatDateTime(batch.exam_datetime || "")) + '</div>' +
                    '<div><strong>Venue:</strong> ' + escapeHtml(batch.venue || "-") + '</div>' +
                "</div>" +
            "</div>";

        const roomSections = roomCollections.map(function (room) {
            const roomRows = room.rows;
            return (
                '<section class="room-section">' +
                headerHtml +
                '<div class="room-banner">' + escapeHtml(upperRoomLabel(room.roomLabel)) + "</div>" +
                (roomRows.length
                    ? '<table class="print-table"><thead><tr><th>Applicant Full Name</th><th>LDSP No.</th><th>Seat No.</th></tr></thead><tbody>' +
                        roomRows.map(function (row) {
                            return "<tr><td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td><td>" + escapeHtml(row.application_no || "-") + "</td><td>" + escapeHtml(row.room_seat_no || "-") + "</td></tr>";
                        }).join("") +
                        "</tbody></table>"
                    : '<div class="print-empty-room">No examinees assigned to this room yet.</div>') +
                "</section>"
            );
        }).join("");

        const masterTable = headerHtml +
            '<div class="master-banner">OFFICIAL EXAMINATION MASTERLIST</div>' +
            '<table class="print-table"><thead><tr><th>Room</th><th>Applicant Full Name</th><th>LDSP No.</th><th>Seat No.</th></tr></thead><tbody>' +
            rows.map(function (row) {
                return "<tr><td><strong>" + escapeHtml(upperRoomLabel(row.room_label || "-")) + "</strong></td><td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td><td>" + escapeHtml(row.application_no || "-") + "</td><td>" + escapeHtml(row.room_seat_no || "-") + "</td></tr>";
            }).join("") +
            "</tbody></table>";

        return [
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>LDSP Exam Print</title><style>",
            "@page{size:legal portrait;margin:0.4in;} body{font-family:Arial,sans-serif;margin:0;color:#0f172a;} .print-official-header{margin-bottom:10px;border-bottom:1.2px solid #0f172a;padding-bottom:8px;} .print-logo-row{display:flex;justify-content:center;align-items:flex-start;margin-bottom:6px;} .print-logo-stack{width:116px;text-align:center;font-size:8px;font-weight:800;letter-spacing:0.05em;color:#334155;line-height:1.15;} .print-logo-stack div{white-space:nowrap;} .print-logo-frame{height:46px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;} .print-logo{display:block;object-fit:contain;width:auto;height:auto;} .print-logo-lgu{width:42px;height:42px;} .print-title-block{text-align:center;margin-bottom:8px;} .print-title-kicker{font-size:9px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:2px;} .print-title-main{font-size:15px;font-weight:800;letter-spacing:0.01em;margin-bottom:0;} .print-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;font-size:10px;} .print-meta div{padding:5px 7px;border:1px solid #cbd5e1;border-radius:7px;background:#f8fafc;} .room-section{margin-bottom:10px;page-break-after:always;page-break-inside:avoid;} .room-section:last-child{page-break-after:auto;} .room-banner,.master-banner{margin:0 0 6px;padding:6px 10px;border:1.2px solid #0f172a;border-radius:8px;text-align:center;font-size:17px;font-weight:900;letter-spacing:0.08em;background:#f8fafc;} .print-table{width:100%;border-collapse:collapse;font-size:10px;} .print-table th,.print-table td{border:1px solid #94a3b8;padding:5px 6px;text-align:left;vertical-align:top;} .print-table th{background:#e2e8f0;font-size:10px;font-weight:800;letter-spacing:0.02em;text-transform:uppercase;} .print-table tbody tr:nth-child(even){background:#f8fafc;} .print-empty-room{padding:10px;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;color:#64748b;font-size:10px;}",
            "</style></head><body>",
            mode === "rooms" ? roomSections : masterTable,
            "<script>window.onload=function(){window.print();};<\/script></body></html>"
        ].join("");
    }

    function imagePathToAbsoluteHref(relativePath) {
        return new URL(relativePath, window.location.href).href;
    }

    async function imageHrefToDataUrl(href) {
        const response = await fetch(href);
        if (!response.ok) {
            throw new Error("Failed to load branding image.");
        }
        const blob = await response.blob();
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onloadend = function () {
                resolve(typeof reader.result === "string" ? reader.result : "");
            };
            reader.onerror = function () {
                reject(new Error("Failed to convert branding image."));
            };
            reader.readAsDataURL(blob);
        });
    }

    async function getPdfBrandImage(relativePath) {
        if (!pdfBrandImageCache[relativePath]) {
            pdfBrandImageCache[relativePath] = imageHrefToDataUrl(imagePathToAbsoluteHref(relativePath)).catch(function () {
                return "";
            });
        }
        return pdfBrandImageCache[relativePath];
    }

    async function loadPdfBrandAssets() {
        const loaded = await Promise.all(PDF_BRAND_ASSETS.map(async function (item) {
            return {
                key: item.key,
                label: item.label,
                width: item.width,
                height: item.height,
                dataUrl: await getPdfBrandImage(item.src)
            };
        }));
        return loaded;
    }

    function getPdfGenerator() {
        const jsPdfNamespace = window.jspdf || null;
        if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
            return null;
        }
        return jsPdfNamespace.jsPDF;
    }

    function fileSlug(value, fallback) {
        const slug = (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || fallback;
    }

    function pdfFileName(mode, batch) {
        const batchSlug = fileSlug(batch && batch.batch_label ? batch.batch_label : "", "batch");
        return "ldss-" + (mode === "rooms" ? "room-list" : "masterlist") + "-" + batchSlug + ".pdf";
    }

    function drawPdfBrandHeader(doc, titleText, assets) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const topY = 20;
        const logoBoxHeight = 40;
        const logoBoxWidth = 72;
        const logo = assets && assets.length ? assets[0] : null;
        if (logo) {
            const naturalWidth = Math.max(1, Number(logo.width) || 1);
            const naturalHeight = Math.max(1, Number(logo.height) || 1);
            const scale = Math.min(44 / naturalWidth, 44 / naturalHeight);
            const drawWidth = Math.max(18, naturalWidth * scale);
            const drawHeight = Math.max(18, naturalHeight * scale);
            const x = (pageWidth - drawWidth) / 2;
            const y = topY + Math.max(0, (logoBoxHeight - drawHeight) / 2);
            if (logo.dataUrl) {
                doc.addImage(logo.dataUrl, "PNG", x, y, drawWidth, drawHeight);
            }
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);
            doc.setTextColor(51, 65, 85);
            doc.text(logo.label, pageWidth / 2, topY + logoBoxHeight + 10, { align: "center" });
        }

        doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text("LGU DAET SCHOLARSHIP SYSTEM", pageWidth / 2, 78, { align: "center" });
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(15);
        doc.text(titleText, pageWidth / 2, 92, { align: "center" });
    }

    function drawPdfBatchMeta(doc, batch, startY) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginLeft = 36;
        const gap = 8;
        const boxWidth = (pageWidth - (marginLeft * 2) - (gap * 2)) / 3;
        const boxHeight = 28;
        const rows = [
            ["Batch", batch.batch_label || "-"],
            ["Exam Date", formatDateTime(batch.exam_datetime || "")],
            ["Venue", batch.venue || "-"]
        ];

        rows.forEach(function (entry, index) {
            const column = index;
            const row = 0;
            const x = marginLeft + (column * (boxWidth + gap));
            const y = startY + (row * (boxHeight + gap));

            doc.setDrawColor(203, 213, 225);
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(x, y, boxWidth, boxHeight, 8, 8, "FD");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7);
            doc.setTextColor(100, 116, 139);
            doc.text(entry[0].toUpperCase(), x + 8, y + 10);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.5);
            doc.setTextColor(15, 23, 42);
            doc.text(entry[1], x + 8, y + 21, { maxWidth: boxWidth - 16 });
        });

        return startY + boxHeight + 12;
    }

    function renderPdfHeader(doc, batch, titleText, assets) {
        const pageWidth = doc.internal.pageSize.getWidth();
        drawPdfBrandHeader(doc, titleText, assets);
        const metaEndY = drawPdfBatchMeta(doc, batch, 102);
        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.8);
        doc.line(36, metaEndY, pageWidth - 36, metaEndY);
        return metaEndY + 10;
    }

    function drawPdfRoomBanner(doc, roomLabel, startY) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const x = 36;
        const width = pageWidth - 72;
        doc.setDrawColor(15, 23, 42);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(x, startY, width, 28, 8, 8, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42);
        doc.text(upperRoomLabel(roomLabel), pageWidth / 2, startY + 18, { align: "center" });
        return startY + 34;
    }

    async function downloadPdf(mode) {
        const batch = batchById(currentBatchId);
        const rows = assignedRowsForBatch(currentBatchId);
        if (!batch || !rows.length) {
            showStatus("No saved room assignments are available for PDF download in the selected batch.", "alert-warning");
            return;
        }

        const JsPdf = getPdfGenerator();
        if (!JsPdf) {
            showStatus("The PDF library is not available right now, so the browser print view will open instead.", "alert-warning");
            openPrint(mode);
            return;
        }

        const doc = new JsPdf({
            orientation: "portrait",
            unit: "pt",
            format: "legal"
        });

        if (typeof doc.autoTable !== "function") {
            showStatus("The PDF table helper is not available right now, so the browser print view will open instead.", "alert-warning");
            openPrint(mode);
            return;
        }

        const brandAssets = await loadPdfBrandAssets();

        if (mode === "rooms") {
            const roomCollections = roomCollectionsForBatch(currentBatchId, rows);
            roomCollections.forEach(function (room, index) {
                if (index > 0) {
                    doc.addPage();
                }
                let startY = renderPdfHeader(doc, batch, "OFFICIAL EXAMINATION ROOM LIST", brandAssets);
                startY = drawPdfRoomBanner(doc, room.roomLabel, startY);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(9);
                doc.setTextColor(15, 23, 42);

                if (!room.rows.length) {
                    doc.setTextColor(100, 116, 139);
                    doc.text("No examinees assigned to this room yet.", 40, startY + 22);
                    doc.setTextColor(15, 23, 42);
                    return;
                }

                doc.autoTable({
                    startY: startY + 4,
                    head: [["Applicant Full Name", "LDSP No.", "Seat No."]],
                    body: room.rows.map(function (row) {
                        return [
                            row.applicant_name || "Unknown Applicant",
                            row.application_no || "-",
                            row.room_seat_no || "-"
                        ];
                    }),
                    margin: { left: 40, right: 40 },
                    styles: {
                        font: "helvetica",
                        fontSize: 8.3,
                        cellPadding: 5,
                        lineColor: [148, 163, 184],
                        lineWidth: 0.5,
                        textColor: [15, 23, 42]
                    },
                    headStyles: {
                        fillColor: [226, 232, 240],
                        textColor: [15, 23, 42],
                        fontStyle: "bold"
                    },
                    alternateRowStyles: {
                        fillColor: [248, 250, 252]
                    },
                    columnStyles: {
                        0: { cellWidth: 330 },
                        1: { cellWidth: 140 },
                        2: { cellWidth: 62, halign: "center" }
                    }
                });
            });
        } else {
            const startY = renderPdfHeader(doc, batch, "OFFICIAL EXAMINATION MASTERLIST", brandAssets);
            doc.autoTable({
                startY: startY,
                head: [["Room", "Applicant Full Name", "LDSP No.", "Seat No."]],
                body: rows.map(function (row) {
                    return [
                        upperRoomLabel(row.room_label || "-"),
                        row.applicant_name || "Unknown Applicant",
                        row.application_no || "-",
                        row.room_seat_no || "-"
                    ];
                }),
                margin: { left: 40, right: 40 },
                styles: {
                    font: "helvetica",
                    fontSize: 9.5,
                    cellPadding: 7,
                    lineColor: [148, 163, 184],
                    lineWidth: 0.6,
                    textColor: [15, 23, 42]
                },
                headStyles: {
                    fillColor: [226, 232, 240],
                    textColor: [15, 23, 42],
                    fontStyle: "bold"
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: 100, fontStyle: "bold" },
                    1: { cellWidth: 245 },
                    2: { cellWidth: 120 },
                    3: { cellWidth: 55, halign: "center" }
                }
            });
        }

        doc.save(pdfFileName(mode, batch));
        showStatus((mode === "rooms" ? "Room list" : "Masterlist") + " PDF downloaded successfully for " + (batch.batch_label || "the selected batch") + ".", "alert-success");
    }

    function openPrint(mode) {
        const batch = batchById(currentBatchId);
        const rows = assignedRowsForBatch(currentBatchId);
        if (!batch || !rows.length) {
            showStatus("No saved room assignments are available for printing in the selected batch.", "alert-warning");
            return;
        }
        const popup = window.open("", "_blank", "noopener,noreferrer,width=1080,height=900");
        if (!popup) {
            showStatus("Printing was blocked by the browser. Allow pop-ups for this page and try again.", "alert-warning");
            return;
        }
        popup.document.open();
        popup.document.write(buildPrintHtml(mode, batch, rows));
        popup.document.close();
    }

    function bindEvents() {
        const refreshBtn = byId("examManagementRefreshBtn");
        const batchSelect = byId("examBatchSelect");
        const searchInput = byId("examManagementSearchInput");
        const pagination = byId("examManagementEligiblePagination");
        const selectAllBtn = byId("examManagementSelectAllBtn");
        const clearBtn = byId("examManagementClearBtn");
        const backToPendingBtn = byId("examManagementBackToPendingBtn");
        const returnToCheckingBtn = byId("examManagementReturnToCheckingBtn");
        const resetBatchBtn = byId("examResetBatchBtn");
        const deleteBatchBtn = byId("examDeleteBatchBtn");
        const deleteAllSafeBatchesBtn = byId("examDeleteAllSafeBatchesBtn");
        const returnConfirmModalEl = byId("examManagementReturnConfirmModal");
        const returnConfirmCancelBtn = byId("examManagementReturnConfirmCancelBtn");
        const returnConfirmProceedBtn = byId("examManagementReturnConfirmProceedBtn");
        const resetConfirmModalEl = byId("examManagementResetConfirmModal");
        const resetConfirmCancelBtn = byId("examManagementResetConfirmCancelBtn");
        const resetConfirmProceedBtn = byId("examManagementResetConfirmProceedBtn");
        const deleteConfirmModalEl = byId("examManagementDeleteConfirmModal");
        const deleteConfirmCancelBtn = byId("examManagementDeleteConfirmCancelBtn");
        const deleteConfirmProceedBtn = byId("examManagementDeleteConfirmProceedBtn");
        const headerCheckbox = byId("examManagementSelectAllCheckbox");
        const tableBody = byId("examManagementEligibleTableBody");
        const generateBtn = byId("examGenerateBtn");
        const sendScheduleEmailsBtn = byId("examSendScheduleEmailsBtn");
        const sendTestEmailBtn = byId("examSendTestEmailBtn");
        const printRoomsBtn = byId("examPrintRoomsBtn");
        const printMasterBtn = byId("examPrintMasterBtn");
        const testEmailInput = byId("examScheduleTestEmail");
        const previewShell = byId("examManagementRoomPreview");

        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                loadData(currentBatchId).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh exam data.", "alert-danger");
                });
            });
        }
        if (batchSelect) {
            batchSelect.addEventListener("change", function () {
                currentBatchId = batchSelect.value || "";
                eligiblePage = 1;
                currentEmailQueueJob = null;
                applyBatchForm(currentBatchId);
                resetSelectionToEligible();
                renderAll();
                refreshEmailQueueStatus({ batchId: currentBatchId, showError: false }).catch(function () {
                    // Queue card will stay in its fallback state if the refresh fails.
                });
                if (currentBatchId && batchRecords(currentBatchId).some(function (record) { return !isScheduledExamRecordStatus(record.status); })) {
                    showStatus("This batch already contains completed or encoded exam records. Printing remains available, but regeneration is locked.", "alert-warning");
                } else {
                    showStatus("");
                }
            });
        }
        if (searchInput) {
            searchInput.addEventListener("input", function () {
                eligiblePage = 1;
                renderEligibleTable();
            });
        }
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const actionButton = event.target.closest("[data-pagination-action]");
                const pageButton = event.target.closest("[data-pagination-page]");

                if (actionButton) {
                    event.preventDefault();
                    const action = actionButton.getAttribute("data-pagination-action") || "";
                    if (action === "prev" && eligiblePage > 1) {
                        eligiblePage -= 1;
                    } else if (action === "next" && eligiblePage < eligiblePageCount()) {
                        eligiblePage += 1;
                    }
                    renderEligibleTable();
                    return;
                }

                if (pageButton) {
                    event.preventDefault();
                    const page = Number(pageButton.getAttribute("data-pagination-page") || "0");
                    if (!Number.isNaN(page) && page > 0) {
                        eligiblePage = page;
                        renderEligibleTable();
                    }
                }
            });
        }
        if (selectAllBtn) {
            selectAllBtn.addEventListener("click", function () {
                visibleSelectableRows().forEach(function (row) { selectedApplicationIds.add(row.id); });
                renderEligibleTable();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                eligibleRows().forEach(function (row) {
                    selectedApplicationIds.delete(row.id);
                });
                renderEligibleTable();
            });
        }
        if (backToPendingBtn) {
            backToPendingBtn.addEventListener("click", function () {
                handleReturnSelected("pending_exam", "examManagementBackToPendingBtn", "Returning...");
            });
        }
        if (returnToCheckingBtn) {
            returnToCheckingBtn.addEventListener("click", function () {
                handleReturnSelected("submitted", "examManagementReturnToCheckingBtn", "Returning...");
            });
        }
        if (resetBatchBtn) {
            resetBatchBtn.addEventListener("click", handleResetBatch);
        }
        if (deleteBatchBtn) {
            deleteBatchBtn.addEventListener("click", handleDeleteBatch);
        }
        if (deleteAllSafeBatchesBtn) {
            deleteAllSafeBatchesBtn.addEventListener("click", handleDeleteAllSafeBatches);
        }
        if (returnConfirmCancelBtn) {
            returnConfirmCancelBtn.addEventListener("click", function () {
                resolveReturnConfirmation(false);
            });
        }
        if (returnConfirmProceedBtn) {
            returnConfirmProceedBtn.addEventListener("click", function () {
                resolveReturnConfirmation(true);
                const modal = getReturnConfirmModal();
                if (modal) {
                    modal.hide();
                }
            });
        }
        if (returnConfirmModalEl) {
            returnConfirmModalEl.addEventListener("hidden.bs.modal", function () {
                resolveReturnConfirmation(false);
            });
        }
        if (resetConfirmCancelBtn) {
            resetConfirmCancelBtn.addEventListener("click", function () {
                resolveResetConfirmation(false);
            });
        }
        if (resetConfirmProceedBtn) {
            resetConfirmProceedBtn.addEventListener("click", function () {
                resolveResetConfirmation(true);
                const modal = getResetConfirmModal();
                if (modal) {
                    modal.hide();
                }
            });
        }
        if (resetConfirmModalEl) {
            resetConfirmModalEl.addEventListener("hidden.bs.modal", function () {
                resolveResetConfirmation(false);
            });
        }
        if (deleteConfirmCancelBtn) {
            deleteConfirmCancelBtn.addEventListener("click", function () {
                resolveDeleteConfirmation(false);
            });
        }
        if (deleteConfirmProceedBtn) {
            deleteConfirmProceedBtn.addEventListener("click", function () {
                resolveDeleteConfirmation(true);
                const modal = getDeleteConfirmModal();
                if (modal) {
                    modal.hide();
                }
            });
        }
        if (deleteConfirmModalEl) {
            deleteConfirmModalEl.addEventListener("hidden.bs.modal", function () {
                resolveDeleteConfirmation(false);
            });
        }
        if (headerCheckbox) {
            headerCheckbox.addEventListener("change", function () {
                visibleSelectableRows().forEach(function (row) {
                    if (headerCheckbox.checked) {
                        selectedApplicationIds.add(row.id);
                    } else {
                        selectedApplicationIds.delete(row.id);
                    }
                });
                renderEligibleTable();
            });
        }
        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const testEmailButton = event.target.closest("[data-test-email-application-id]");
                if (!testEmailButton) {
                    return;
                }
                const applicationId = testEmailButton.getAttribute("data-test-email-application-id") || "";
                if (!applicationId) {
                    return;
                }
                handleSendTestEmail(applicationId);
            });
            tableBody.addEventListener("change", function (event) {
                const input = event.target.closest("input[data-application-id]");
                const applicationId = input ? input.getAttribute("data-application-id") : "";
                if (!applicationId) {
                    return;
                }
                if (input.checked) {
                    selectedApplicationIds.add(applicationId);
                } else {
                    selectedApplicationIds.delete(applicationId);
                }
                renderEligibleTable();
            });
        }
        if (previewShell) {
            previewShell.addEventListener("click", function (event) {
                const testEmailButton = event.target.closest("[data-test-email-application-id]");
                if (testEmailButton) {
                    const applicationId = testEmailButton.getAttribute("data-test-email-application-id") || "";
                    if (applicationId) {
                        handleSendTestEmail(applicationId);
                    }
                    return;
                }
                const tabButton = event.target.closest("[data-preview-room-key]");
                if (!tabButton) {
                    return;
                }
                previewActiveRoomKey = tabButton.getAttribute("data-preview-room-key") || "";
                renderPreview();
            });
        }
        if (generateBtn) {
            generateBtn.addEventListener("click", handleGenerate);
        }
        if (sendScheduleEmailsBtn) {
            sendScheduleEmailsBtn.addEventListener("click", handleSendScheduleEmails);
        }
        if (sendTestEmailBtn) {
            sendTestEmailBtn.addEventListener("click", handleSendTestEmail);
        }
        if (printRoomsBtn) {
            printRoomsBtn.addEventListener("click", function () { downloadPdf("rooms"); });
        }
        if (printMasterBtn) {
            printMasterBtn.addEventListener("click", function () { downloadPdf("master"); });
        }
        if (testEmailInput) {
            testEmailInput.addEventListener("input", function () {
                testEmailInput.value = (testEmailInput.value || "").toString().replace(/\s+/g, "").toLowerCase();
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }
        bindEvents();
        ensureExamScheduleEmailNote(false);
        try {
            await loadData("");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load exam management data.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
