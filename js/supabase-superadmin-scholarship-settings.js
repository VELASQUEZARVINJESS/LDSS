(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const RECEIVE_OVERRIDE_SCHEDULE = "schedule";
    const RECEIVE_OVERRIDE_FORCE_OPEN = "force_open";
    const RECEIVE_OVERRIDE_FORCE_CLOSED = "force_closed";
    const APPLICATION_STAFF_FLAGS_TABLE = "application_staff_flags";
    const RESERVED_SLOT_TAG = "reserved_slot_exception";
    const PROFILE_BATCH_SIZE = 120;
    const RESERVED_SLOT_RESULT_LIMIT = 8;

    const DEFAULT_SETTINGS = {
        school_year: "",
        quota_slots: 0,
        waitlist_slots: 0,
        passing_score: 75,
        exam_total_items: 100,
        application_open_date: null,
        application_close_date: null,
        ranking_basis: {
            exam_weight: 60,
            interview_weight: 25,
            income_weight: 10,
            requirements_weight: 5,
            notes: "",
            controls: {
                application_intake_enabled: true,
                application_receive_override_mode: RECEIVE_OVERRIDE_SCHEDULE,
                application_open_time: "",
                application_close_time: "",
                require_admin_remarks: true,
                lock_ranking_after_decision: true,
                allow_special_endorsement: true,
                allow_applicant_application_edits: true,
                allow_secretary_applicant_edits: false,
                allow_secretary_draft_completion: false,
                allow_secretary_walk_in_intake: false,
                allow_secretary_special_consideration: false,
                show_secretary_special_consideration_control: false,
                special_consideration_options: [],
                require_applicant_photo_on_submit: true,
                auto_set_for_interview: true,
                exam_checking_in_progress: false,
                show_applicant_exam_scores: true
            }
        }
    };
    let activeSettingsRecord = null;
    let reservedSlotCandidates = [];
    let reservedSlotApplicationsById = {};
    let reservedSlotFlagsAvailable = true;
    let reservedSlotLoadedYear = "";
    let reservedSlotLoadToken = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function auditHelper() {
        return window.LDSSSuperAdminAudit || null;
    }

    function showStatus(message, type) {
        const box = byId("superSettingsStatus");
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
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function readNumberField(id) {
        const input = byId(id);
        if (!input) {
            return 0;
        }
        const raw = (input.value || "").trim();
        if (!raw) {
            return 0;
        }
        const numeric = Number(raw);
        return Number.isNaN(numeric) ? NaN : numeric;
    }

    function writeInput(id, value) {
        const input = byId(id);
        if (input) {
            input.value = value === null || typeof value === "undefined" ? "" : String(value);
        }
    }

    function writeCheckbox(id, checked) {
        const input = byId(id);
        if (input) {
            input.checked = Boolean(checked);
        }
    }

    function readFallbackStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function writeFallbackStorage(settings) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }

    function cloneSettings(settings) {
        if (!settings || typeof settings !== "object") {
            return null;
        }
        return JSON.parse(JSON.stringify(settings));
    }

    function formatPercent(value) {
        const numeric = Number(value || 0);
        if (Number.isNaN(numeric)) {
            return "0%";
        }
        return numeric.toFixed(2).replace(/\.00$/, "") + "%";
    }

    function normalizeTimeValue(value) {
        const raw = (value || "").toString().trim();
        const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? (match[1] + ":" + match[2]) : "";
    }

    function normalizeSpecialConsiderationOptions(value) {
        const source = Array.isArray(value)
            ? value
            : (value || "").toString().split(/\r?\n/);
        const output = [];
        const seen = new Set();

        source.forEach(function (entry) {
            const normalized = (entry || "").toString().trim().replace(/\s+/g, " ");
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            output.push(normalized);
        });

        return output.slice(0, 25);
    }

    function specialConsiderationOptionsToTextarea(value) {
        return normalizeSpecialConsiderationOptions(value).join("\n");
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

    function normalizeStatus(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    function formatStatusLabel(value) {
        const normalized = normalizeStatus(value);
        if (!normalized) {
            return "-";
        }
        return normalized.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); });
    }

    function buildApplicantName(profile) {
        if (!profile || typeof profile !== "object") {
            return "";
        }
        return [
            (profile.first_name || "").trim(),
            (profile.middle_name || "").trim(),
            (profile.last_name || "").trim()
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    function formatTimeValue(value) {
        const normalized = normalizeTimeValue(value);
        if (!normalized) {
            return "";
        }
        const parts = normalized.split(":");
        const hours = Number(parts[0]);
        const minutes = parts[1];
        const suffix = hours >= 12 ? "PM" : "AM";
        const hour12 = hours % 12 || 12;
        return hour12 + ":" + minutes + " " + suffix;
    }

    function formatScheduleLabel(dateValue, timeValue) {
        if (!dateValue) {
            return "-";
        }
        const dateLabel = formatDateDisplay(dateValue);
        const timeLabel = formatTimeValue(timeValue);
        return timeLabel ? (dateLabel + " at " + timeLabel + " (Asia/Manila)") : dateLabel;
    }

    function formatDateDisplay(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value + "T12:00:00");
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function normalizeReceiveOverrideMode(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (raw === RECEIVE_OVERRIDE_FORCE_OPEN) {
            return RECEIVE_OVERRIDE_FORCE_OPEN;
        }
        if (raw === RECEIVE_OVERRIDE_FORCE_CLOSED) {
            return RECEIVE_OVERRIDE_FORCE_CLOSED;
        }
        return RECEIVE_OVERRIDE_SCHEDULE;
    }

    function resolveReceiveOverrideMode(controls) {
        const normalized = normalizeReceiveOverrideMode(controls && controls.application_receive_override_mode);
        if (normalized !== RECEIVE_OVERRIDE_SCHEDULE) {
            return normalized;
        }
        if (controls && controls.application_intake_enabled === false) {
            return RECEIVE_OVERRIDE_FORCE_CLOSED;
        }
        return RECEIVE_OVERRIDE_SCHEDULE;
    }

    function manilaNowStamp() {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        });
        const parts = {};
        formatter.formatToParts(new Date()).forEach(function (part) {
            if (part.type !== "literal") {
                parts[part.type] = part.value;
            }
        });
        return [
            parts.year || "0000",
            "-",
            parts.month || "01",
            "-",
            parts.day || "01",
            "T",
            parts.hour || "00",
            ":",
            parts.minute || "00",
            ":",
            parts.second || "00"
        ].join("");
    }

    function scheduleStamp(dateValue, timeValue, fallbackTime) {
        if (!dateValue) {
            return "";
        }
        const normalizedTime = normalizeTimeValue(timeValue || "") || fallbackTime;
        return dateValue + "T" + normalizedTime + ":00";
    }

    function computeScheduledReceiveState(settings) {
        const ranking = settings && settings.ranking_basis ? settings.ranking_basis : {};
        const controls = ranking && ranking.controls ? ranking.controls : {};
        const openDate = (settings && settings.application_open_date ? settings.application_open_date : "") || "";
        const closeDate = (settings && settings.application_close_date ? settings.application_close_date : "") || "";
        const openTime = controls.application_open_time || "";
        const closeTime = controls.application_close_time || "";
        const currentStamp = manilaNowStamp();
        const openStamp = scheduleStamp(openDate, openTime, "00:00");
        const closeStamp = scheduleStamp(closeDate, closeTime, "23:59");

        if (openStamp && currentStamp < openStamp) {
            return { isOpen: false, reason: "before_open_date" };
        }
        if (closeStamp && currentStamp > closeStamp) {
            return { isOpen: false, reason: "after_close_date" };
        }
        return { isOpen: true, reason: "open" };
    }

    function computeReceiveState(settings) {
        const ranking = settings && settings.ranking_basis ? settings.ranking_basis : {};
        const controls = ranking && ranking.controls ? ranking.controls : {};
        const scheduledState = computeScheduledReceiveState(settings || DEFAULT_SETTINGS);
        const overrideMode = resolveReceiveOverrideMode(controls);

        if (overrideMode === RECEIVE_OVERRIDE_FORCE_OPEN) {
            return {
                isOpen: true,
                reason: "opened_by_admin",
                overrideMode: overrideMode,
                manualOverride: true,
                scheduledReason: scheduledState.reason
            };
        }

        if (overrideMode === RECEIVE_OVERRIDE_FORCE_CLOSED) {
            return {
                isOpen: false,
                reason: "closed_by_admin",
                overrideMode: overrideMode,
                manualOverride: true,
                scheduledReason: scheduledState.reason
            };
        }

        return {
            isOpen: scheduledState.isOpen,
            reason: scheduledState.reason,
            overrideMode: overrideMode,
            manualOverride: false,
            scheduledReason: scheduledState.reason
        };
    }

    function receiveStatusMeta(settings) {
        const ranking = settings && settings.ranking_basis ? settings.ranking_basis : {};
        const controls = ranking && ranking.controls ? ranking.controls : {};
        const state = computeReceiveState(settings || DEFAULT_SETTINGS);
        const openLabel = formatScheduleLabel(settings && settings.application_open_date ? settings.application_open_date : "", controls.application_open_time || "");
        const closeLabel = formatScheduleLabel(settings && settings.application_close_date ? settings.application_close_date : "", controls.application_close_time || "");

        if (state.reason === "opened_by_admin") {
            return {
                chipClass: "ldss-chip-success",
                label: "Receiving Enabled Manually",
                text: "Applicants can create and submit applications even if the scheduled cutoff has already passed.",
                actionLabel: "DISABLE RECEIVE",
                showReset: true
            };
        }

        if (state.reason === "closed_by_admin") {
            return {
                chipClass: "ldss-chip-danger",
                label: "Receiving Disabled Manually",
                text: "All new applicant filing entry points are locked until you enable receiving again.",
                actionLabel: "ENABLE RECEIVE",
                showReset: true
            };
        }

        if (state.reason === "before_open_date") {
            return {
                chipClass: "ldss-chip-accent",
                label: "Waiting For Schedule Start",
                text: openLabel !== "-"
                    ? ("Applications will open on " + openLabel + ".")
                    : "Applications are waiting for the configured schedule start.",
                actionLabel: "ENABLE RECEIVE",
                showReset: false
            };
        }

        if (state.reason === "after_close_date") {
            return {
                chipClass: "ldss-chip-danger",
                label: "Closed By Schedule",
                text: closeLabel !== "-"
                    ? ("The schedule automatically closed on " + closeLabel + ".")
                    : "The intake window is already beyond the configured close schedule.",
                actionLabel: "ENABLE RECEIVE",
                showReset: false
            };
        }

        return {
            chipClass: "ldss-chip-success",
            label: "Open By Schedule",
            text: closeLabel !== "-"
                ? ("Applicants can file until " + closeLabel + ".")
                : "Applicants can create and submit applications while filing remains open.",
            actionLabel: "DISABLE RECEIVE",
            showReset: false
        };
    }

    function previewSettingsFromForm() {
        const overrideMode = normalizeReceiveOverrideMode(byId("superSettingsApplicationReceiveOverrideMode") ? byId("superSettingsApplicationReceiveOverrideMode").value : "");

        return {
            school_year: (byId("superSettingsSchoolYear") ? byId("superSettingsSchoolYear").value : "").trim(),
            quota_slots: Number(readNumberField("superSettingsQuotaSlots") || 0),
            waitlist_slots: Number(readNumberField("superSettingsWaitlistSlots") || 0),
            passing_score: Number(readNumberField("superSettingsPassingScore") || 0),
            exam_total_items: Number(readNumberField("superSettingsExamItems") || 0),
            application_open_date: byId("superSettingsCycleOpen") ? (byId("superSettingsCycleOpen").value || null) : null,
            application_close_date: byId("superSettingsCycleClose") ? (byId("superSettingsCycleClose").value || null) : null,
            ranking_basis: {
                exam_weight: Number(readNumberField("superSettingsWeightExam") || 0),
                interview_weight: Number(readNumberField("superSettingsWeightInterview") || 0),
                income_weight: Number(readNumberField("superSettingsWeightIncome") || 0),
                requirements_weight: Number(readNumberField("superSettingsWeightRequirements") || 0),
                notes: byId("superSettingsRankingNotes") ? byId("superSettingsRankingNotes").value.trim() : "",
                controls: {
                    application_intake_enabled: overrideMode !== RECEIVE_OVERRIDE_FORCE_CLOSED,
                    application_receive_override_mode: overrideMode,
                    application_open_time: normalizeTimeValue(byId("superSettingsCycleOpenTime") ? byId("superSettingsCycleOpenTime").value : ""),
                    application_close_time: normalizeTimeValue(byId("superSettingsCycleCloseTime") ? byId("superSettingsCycleCloseTime").value : ""),
                    require_admin_remarks: Boolean(byId("superSettingsRequireRemarks") && byId("superSettingsRequireRemarks").checked),
                    lock_ranking_after_decision: Boolean(byId("superSettingsLockRankingAfterDecision") && byId("superSettingsLockRankingAfterDecision").checked),
                    allow_special_endorsement: Boolean(byId("superSettingsAllowSpecialEndorsement") && byId("superSettingsAllowSpecialEndorsement").checked),
                    allow_secretary_applicant_edits: Boolean(byId("superSettingsAllowSecretaryApplicantEdits") && byId("superSettingsAllowSecretaryApplicantEdits").checked),
                    allow_secretary_draft_completion: Boolean(byId("superSettingsAllowSecretaryDraftCompletion") && byId("superSettingsAllowSecretaryDraftCompletion").checked),
                    allow_secretary_walk_in_intake: Boolean(byId("superSettingsAllowSecretaryWalkInIntake") && byId("superSettingsAllowSecretaryWalkInIntake").checked),
                    allow_secretary_special_consideration: currentSpecialConsiderationEnabled(),
                    show_secretary_special_consideration_control: currentSecretarySpecialConsiderationControlEnabled(),
                    special_consideration_options: currentSpecialConsiderationOptions(),
                    require_applicant_photo_on_submit: Boolean(byId("superSettingsRequireApplicantPhotoOnSubmit") && byId("superSettingsRequireApplicantPhotoOnSubmit").checked),
                    auto_set_for_interview: Boolean(byId("superSettingsAutoSetForInterview") && byId("superSettingsAutoSetForInterview").checked),
                    exam_checking_in_progress: Boolean(byId("superSettingsExamCheckingInProgress") && byId("superSettingsExamCheckingInProgress").checked),
                    show_applicant_exam_scores: Boolean(byId("superSettingsShowApplicantExamScores") && byId("superSettingsShowApplicantExamScores").checked)
                }
            }
        };
    }

    function renderReceiveControl(settings) {
        const chip = byId("superSettingsReceiveStatusChip");
        const text = byId("superSettingsReceiveStatusText");
        const toggleBtn = byId("superSettingsReceiveToggleBtn");
        const resetBtn = byId("superSettingsReceiveResetBtn");
        const meta = receiveStatusMeta(settings || DEFAULT_SETTINGS);

        if (chip) {
            chip.className = "ldss-chip " + meta.chipClass;
            chip.textContent = meta.label;
        }
        if (text) {
            text.textContent = meta.text;
        }
        if (toggleBtn) {
            toggleBtn.textContent = meta.actionLabel;
            toggleBtn.className = meta.actionLabel === "ENABLE RECEIVE"
                ? "btn btn-dark btn-sm"
                : "btn btn-outline-dark btn-sm";
        }
        if (resetBtn) {
            resetBtn.classList.toggle("d-none", !meta.showReset);
        }
    }

    function setReceiveActionButtonsDisabled(disabled) {
        const toggleBtn = byId("superSettingsReceiveToggleBtn");
        const resetBtn = byId("superSettingsReceiveResetBtn");

        [toggleBtn, resetBtn].forEach(function (button) {
            if (!button) {
                return;
            }
            button.disabled = Boolean(disabled);
        });
    }

    function receiveAppliedMessage(mode) {
        if (mode === RECEIVE_OVERRIDE_FORCE_OPEN) {
            return "Receive control saved. Applicants can create and submit applications immediately.";
        }
        if (mode === RECEIVE_OVERRIDE_FORCE_CLOSED) {
            return "Receive control saved. New applicant filing is now locked immediately.";
        }
        return "Receive control returned to schedule mode and saved successfully.";
    }

    function showReservedSlotStatus(message, type) {
        const box = byId("superReservedSlotStatus");
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

    function currentReservedSlotYear() {
        const fromInput = byId("superSettingsSchoolYear") ? byId("superSettingsSchoolYear").value : "";
        const fromActive = activeSettingsRecord && activeSettingsRecord.school_year ? activeSettingsRecord.school_year : "";
        return (fromInput || fromActive || "").toString().trim();
    }

    function currentSpecialConsiderationEnabled() {
        const input = byId("superSettingsAllowSecretarySpecialConsideration");
        const controls = activeSettingsRecord && activeSettingsRecord.ranking_basis && activeSettingsRecord.ranking_basis.controls
            ? activeSettingsRecord.ranking_basis.controls
            : (DEFAULT_SETTINGS.ranking_basis && DEFAULT_SETTINGS.ranking_basis.controls ? DEFAULT_SETTINGS.ranking_basis.controls : {});

        if (input) {
            return Boolean(input.checked);
        }
        return Boolean(controls && controls.allow_secretary_special_consideration);
    }

    function currentSecretarySpecialConsiderationControlEnabled() {
        const input = byId("superSettingsShowSecretarySpecialConsiderationControl");
        const controls = activeSettingsRecord && activeSettingsRecord.ranking_basis && activeSettingsRecord.ranking_basis.controls
            ? activeSettingsRecord.ranking_basis.controls
            : (DEFAULT_SETTINGS.ranking_basis && DEFAULT_SETTINGS.ranking_basis.controls ? DEFAULT_SETTINGS.ranking_basis.controls : {});

        if (input) {
            return Boolean(input.checked);
        }
        return Boolean(controls && controls.show_secretary_special_consideration_control);
    }

    function currentSpecialConsiderationOptions() {
        const controls = activeSettingsRecord && activeSettingsRecord.ranking_basis && activeSettingsRecord.ranking_basis.controls
            ? activeSettingsRecord.ranking_basis.controls
            : (DEFAULT_SETTINGS.ranking_basis && DEFAULT_SETTINGS.ranking_basis.controls ? DEFAULT_SETTINGS.ranking_basis.controls : {});
        return normalizeSpecialConsiderationOptions(controls && controls.special_consideration_options);
    }

    function hasReservedSlotManager() {
        return Boolean(
            byId("superReservedSlotSearchInput")
            || byId("superReservedSlotSearchResults")
            || byId("superReservedSlotTableBody")
            || byId("superReservedSlotStatus")
        );
    }

    function reservedSlotFlowEnabled() {
        return currentSpecialConsiderationEnabled();
    }

    function reservedSlotRows() {
        return reservedSlotCandidates
            .filter(function (row) { return row.is_reserved_slot; })
            .sort(function (left, right) {
                const leftStamp = new Date(left.flag_updated_at || left.updated_at || left.created_at || 0).getTime();
                const rightStamp = new Date(right.flag_updated_at || right.updated_at || right.created_at || 0).getTime();
                return rightStamp - leftStamp;
            });
    }

    function renderReservedSlotCount() {
        const chip = byId("superReservedSlotCountChip");
        if (!chip) {
            return;
        }
        const count = reservedSlotRows().length;
        chip.className = "ldss-chip " + (count > 0 ? "ldss-chip-accent" : "ldss-chip-neutral");
        chip.textContent = count + " allowed";
    }

    function setReservedSlotLoadingState(message) {
        const searchResults = byId("superReservedSlotSearchResults");
        const tableBody = byId("superReservedSlotTableBody");
        const safeMessage = escapeHtml(message || "Loading special consideration students...");

        if (searchResults) {
            searchResults.innerHTML = '<div class="px-3 pb-3 small text-muted">' + safeMessage + "</div>";
        }
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">' + safeMessage + "</td></tr>";
        }
        renderReservedSlotCount();
    }

    function syncReservedSlotManagerState() {
        const searchInput = byId("superReservedSlotSearchInput");
        const meta = byId("superReservedSlotMeta");
        const schoolYear = currentReservedSlotYear();

        if (searchInput) {
            searchInput.disabled = !reservedSlotFlagsAvailable || !schoolYear;
        }

        if (meta) {
            if (!reservedSlotFlagsAvailable) {
                meta.textContent = "Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.";
            } else if (!schoolYear) {
                meta.textContent = "Set or load the active school year first, then search and add allowed students.";
            } else if (!reservedSlotFlowEnabled()) {
                meta.textContent = "Special consideration flow is currently off. You can still prepare the list below, then enable the switch when the office is ready.";
            } else {
                meta.textContent = "Search the active school year queue and add the students who should stay eligible for final review under special consideration.";
            }
        }

        renderReservedSlotCount();
    }

    async function fetchReservedSlotProfiles(context, applicantIds) {
        const profileMap = {};
        const ids = Array.isArray(applicantIds) ? applicantIds.filter(Boolean) : [];

        for (let index = 0; index < ids.length; index += PROFILE_BATCH_SIZE) {
            const batch = ids.slice(index, index + PROFILE_BATCH_SIZE);
            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email")
                .in("id", batch);

            if (result.error) {
                throw new Error("Failed to load applicant names: " + result.error.message);
            }

            (result.data || []).forEach(function (profile) {
                if (profile && profile.id) {
                    profileMap[profile.id] = profile;
                }
            });
        }

        return profileMap;
    }

    function renderReservedSlotSearchResults() {
        const target = byId("superReservedSlotSearchResults");
        const schoolYear = currentReservedSlotYear();
        const query = (byId("superReservedSlotSearchInput") ? byId("superReservedSlotSearchInput").value : "").toString().trim().toLowerCase();

        if (!target) {
            return;
        }
        if (!reservedSlotFlagsAvailable) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">Special consideration storage is not installed yet.</div>';
            return;
        }
        if (!schoolYear) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">Set the active school year first.</div>';
            return;
        }
        if (!reservedSlotCandidates.length) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">No application records were found for ' + escapeHtml(schoolYear) + ".</div>";
            return;
        }

        let matches = reservedSlotCandidates.filter(function (row) {
            return !row.is_reserved_slot;
        });

        if (query) {
            matches = matches.filter(function (row) {
                const haystack = [
                    row.applicant_name,
                    row.application_no,
                    row.scholarship_type,
                    row.status
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });
        }

        matches = matches.slice(0, RESERVED_SLOT_RESULT_LIMIT);

        if (!matches.length) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">No matching students are available to add.</div>';
            return;
        }

        target.innerHTML = matches.map(function (row) {
            return [
                '<div class="ldss-settings-reserved-item">',
                '<div class="ldss-settings-reserved-copy">',
                '<div class="ldss-settings-reserved-name">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>",
                '<div class="ldss-settings-reserved-note">' + escapeHtml((row.application_no || "-") + " | " + formatStatusLabel(row.status) + " | " + (row.scholarship_type || "-")) + "</div>",
                "</div>",
                '<div class="ldss-settings-reserved-actions">',
                '<button class="btn btn-dark btn-sm" type="button" data-reserved-slot-add="' + escapeHtml(row.id) + '">Allow</button>',
                "</div>",
                "</div>"
            ].join("");
        }).join("");
    }

    function renderReservedSlotTable() {
        const tbody = byId("superReservedSlotTableBody");
        const rows = reservedSlotRows();

        if (!tbody) {
            return;
        }
        renderReservedSlotCount();

        if (!reservedSlotFlagsAvailable) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.</td></tr>';
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No students are currently on the special consideration allow-list.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return [
                "<tr>",
                "<td>",
                '<div class="fw-600">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>",
                '<div class="small text-muted">' + escapeHtml((row.scholarship_type || "-") + " | " + (row.school_year || "-")) + "</div>",
                "</td>",
                "<td>",
                '<div class="fw-600">' + escapeHtml(row.application_no || "-") + "</div>",
                '<div class="small text-muted">Updated ' + escapeHtml(formatDateDisplay((row.flag_updated_at || row.updated_at || "").slice(0, 10))) + "</div>",
                "</td>",
                "<td>",
                '<span class="ldss-chip ldss-chip-neutral">' + escapeHtml(formatStatusLabel(row.status)) + "</span>",
                "</td>",
                '<td class="text-end"><button class="btn btn-outline-dark btn-sm" type="button" data-reserved-slot-remove="' + escapeHtml(row.id) + '">Remove</button></td>',
                "</tr>"
            ].join("");
        }).join("");
    }

    async function loadReservedSlotManager(context) {
        const schoolYear = currentReservedSlotYear();
        const loadToken = reservedSlotLoadToken + 1;
        reservedSlotLoadToken = loadToken;
        reservedSlotLoadedYear = schoolYear;
        showReservedSlotStatus("");

        if (!schoolYear) {
            reservedSlotCandidates = [];
            reservedSlotApplicationsById = {};
            setReservedSlotLoadingState("Set the active school year to load applicants.");
            syncReservedSlotManagerState();
            return;
        }

        setReservedSlotLoadingState("Loading special consideration student list...");

        const applicationResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, school_year, scholarship_type, status, submitted_at, created_at, updated_at")
            .eq("school_year", schoolYear)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(500);

        if (loadToken !== reservedSlotLoadToken) {
            return;
        }

        if (applicationResult.error) {
            reservedSlotCandidates = [];
            reservedSlotApplicationsById = {};
            setReservedSlotLoadingState("Unable to load application records for this school year.");
            throw new Error("Failed to load special consideration candidates: " + applicationResult.error.message);
        }

        const applicationRows = applicationResult.data || [];
        const applicantIds = Array.from(new Set(applicationRows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));
        const profileMap = await fetchReservedSlotProfiles(context, applicantIds);

        if (loadToken !== reservedSlotLoadToken) {
            return;
        }

        let flagMap = {};
        if (reservedSlotFlagsAvailable && applicationRows.length) {
            const flagResult = await context.client
                .from(APPLICATION_STAFF_FLAGS_TABLE)
                .select("application_id, special_consideration_tag, updated_at, created_at")
                .in("application_id", applicationRows.map(function (row) { return row.id; }));

            if (loadToken !== reservedSlotLoadToken) {
                return;
            }

            if (flagResult.error) {
                if (/does not exist|relation|schema cache/i.test(flagResult.error.message || "")) {
                    reservedSlotFlagsAvailable = false;
                    showReservedSlotStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
                } else {
                    throw new Error("Failed to load special consideration records: " + flagResult.error.message);
                }
            } else {
                (flagResult.data || []).forEach(function (row) {
                    const tag = (row && row.special_consideration_tag ? row.special_consideration_tag : "").toString().trim();
                    if (row && row.application_id && tag) {
                        flagMap[row.application_id] = {
                            tag: tag,
                            updated_at: row.updated_at || row.created_at || null
                        };
                    }
                });
            }
        }

        reservedSlotCandidates = applicationRows.map(function (row) {
            const profile = row && row.applicant_id ? profileMap[row.applicant_id] : null;
            const flag = flagMap[row.id] || null;
            return {
                id: row.id,
                applicant_id: row.applicant_id || "",
                applicant_name: buildApplicantName(profile) || "Unknown Applicant",
                applicant_email: profile && profile.email ? profile.email : "",
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                scholarship_type: row.scholarship_type || "",
                status: row.status || "",
                submitted_at: row.submitted_at || null,
                created_at: row.created_at || null,
                updated_at: row.updated_at || null,
                is_reserved_slot: Boolean(flag),
                flag_updated_at: flag && flag.updated_at ? flag.updated_at : null,
                hidden_tag: flag && flag.tag ? flag.tag : ""
            };
        });

        reservedSlotApplicationsById = {};
        reservedSlotCandidates.forEach(function (row) {
            reservedSlotApplicationsById[row.id] = row;
        });

        syncReservedSlotManagerState();
        renderReservedSlotSearchResults();
        renderReservedSlotTable();
    }

    async function addReservedSlotStudent(context, applicationId) {
        const row = reservedSlotApplicationsById[applicationId];
        if (!row) {
            showReservedSlotStatus("Applicant record could not be found. Reload the active school year first.", "alert-warning");
            return;
        }
        if (!reservedSlotFlagsAvailable) {
            showReservedSlotStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
            return;
        }

        const result = await context.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .upsert({
                application_id: applicationId,
                special_consideration_tag: RESERVED_SLOT_TAG,
                special_consideration_marked_by: context.user.id
            }, { onConflict: "application_id" });

        if (result.error) {
            if (/does not exist|relation|schema cache/i.test(result.error.message || "")) {
                reservedSlotFlagsAvailable = false;
                syncReservedSlotManagerState();
                renderReservedSlotSearchResults();
                renderReservedSlotTable();
                showReservedSlotStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
                return;
            }
            throw new Error("Failed to add special consideration student: " + result.error.message);
        }

        row.is_reserved_slot = true;
        row.hidden_tag = RESERVED_SLOT_TAG;
        row.flag_updated_at = new Date().toISOString();
        renderReservedSlotSearchResults();
        renderReservedSlotTable();
        showReservedSlotStatus("Special consideration saved for " + row.applicant_name + ".", "alert-success");

        await writeAuditEntry(context, {
            module: "scholarship_settings",
            action: "grant_reserved_slot_exception",
            recordType: "application",
            recordId: applicationId,
            targetUserId: row.applicant_id || null,
            targetLabel: row.applicant_name,
            summary: "Granted special consideration to " + row.applicant_name + ".",
            details: {
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                status: normalizeStatus(row.status)
            }
        });
    }

    async function removeReservedSlotStudent(context, applicationId) {
        const row = reservedSlotApplicationsById[applicationId];
        if (!row) {
            showReservedSlotStatus("Applicant record could not be found. Reload the active school year first.", "alert-warning");
            return;
        }
        if (!reservedSlotFlagsAvailable) {
            showReservedSlotStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
            return;
        }

        const result = await context.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .delete()
            .eq("application_id", applicationId);

        if (result.error) {
            throw new Error("Failed to remove special consideration student: " + result.error.message);
        }

        row.is_reserved_slot = false;
        row.hidden_tag = "";
        row.flag_updated_at = new Date().toISOString();
        renderReservedSlotSearchResults();
        renderReservedSlotTable();
        showReservedSlotStatus("Removed special consideration for " + row.applicant_name + ".", "alert-success");

        await writeAuditEntry(context, {
            module: "scholarship_settings",
            action: "revoke_reserved_slot_exception",
            recordType: "application",
            recordId: applicationId,
            targetUserId: row.applicant_id || null,
            targetLabel: row.applicant_name,
            summary: "Removed special consideration from " + row.applicant_name + ".",
            details: {
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                status: normalizeStatus(row.status)
            }
        });
    }

    function renderWeightTotal() {
        const exam = readNumberField("superSettingsWeightExam");
        const interview = readNumberField("superSettingsWeightInterview");
        const income = readNumberField("superSettingsWeightIncome");
        const requirements = readNumberField("superSettingsWeightRequirements");

        const values = [exam, interview, income, requirements].map(function (value) {
            return Number.isNaN(value) ? 0 : value;
        });
        const total = values.reduce(function (sum, value) { return sum + value; }, 0);
        setText("superSettingsWeightTotal", total.toFixed(2));
    }

    function renderKpis(settings) {
        setText("superSettingsActiveYear", settings.school_year || "-");
        setText("superSettingsActiveQuota", Number(settings.quota_slots || 0));
        setText("superSettingsActivePassing", formatPercent(settings.passing_score || 0));
    }

    function renderSnapshot(settings) {
        const target = byId("superSettingsSnapshot");
        if (!target) {
            return;
        }
        const ranking = settings.ranking_basis || {};
        const controls = ranking.controls || {};
        const receiveState = receiveStatusMeta(settings);
        const overrideMode = resolveReceiveOverrideMode(controls);
        const lines = [
            "School Year: " + (settings.school_year || "-"),
            "Quota: " + Number(settings.quota_slots || 0),
            "Waitlist Buffer: " + Number(settings.waitlist_slots || 0),
            "Passing Score: " + formatPercent(settings.passing_score || 0),
            "Application Window: " + formatScheduleLabel(settings.application_open_date || "", controls.application_open_time || "") + " to " + formatScheduleLabel(settings.application_close_date || "", controls.application_close_time || ""),
            "Application Receive Status: " + receiveState.label,
            "Receive Override Mode: " + (
                overrideMode === RECEIVE_OVERRIDE_FORCE_OPEN
                    ? "Manual Enable"
                    : (overrideMode === RECEIVE_OVERRIDE_FORCE_CLOSED ? "Manual Disable" : "Follow Schedule")
            ),
            "Applicant Application Editing: " + (controls.allow_applicant_application_edits !== false ? "Enabled" : "Disabled"),
            "Secretary Applicant Detail Edit: " + (controls.allow_secretary_applicant_edits ? "Enabled" : "Disabled"),
            "Secretary Draft Completion: " + (controls.allow_secretary_draft_completion ? "Enabled" : "Disabled"),
            "Secretary Walk-In Intake: " + (controls.allow_secretary_walk_in_intake ? "Enabled" : "Disabled"),
            "Secretary Special Consideration Selector: " + (controls.show_secretary_special_consideration_control ? "Enabled" : "Disabled"),
            "Special Consideration Flow Page: " + (controls.allow_secretary_special_consideration ? "Enabled" : "Disabled"),
            "Applicant Photo Required On Submit: " + (controls.require_applicant_photo_on_submit !== false ? "Enabled" : "Disabled"),
            "Checking Examination Progress: " + (controls.exam_checking_in_progress ? "Enabled" : "Disabled"),
            "Applicant Exam Score Visibility: " + (controls.show_applicant_exam_scores !== false ? "Visible" : "Hidden"),
            "Special Endorsement: " + ((controls.allow_special_endorsement !== false) ? "Enabled" : "Disabled"),
            "Weights (Exam/Interview/Income/Requirements): "
                + Number(ranking.exam_weight || 0) + "/"
                + Number(ranking.interview_weight || 0) + "/"
                + Number(ranking.income_weight || 0) + "/"
                + Number(ranking.requirements_weight || 0),
            "Updated: " + (settings.updated_at || settings.created_at || "local draft")
        ];
        target.innerHTML = lines.map(function (line) {
            return "<div>" + line + "</div>";
        }).join("");
    }

    function applyForm(settingsInput) {
        const settings = settingsInput || DEFAULT_SETTINGS;
        const ranking = settings.ranking_basis || {};
        const controls = ranking.controls || {};
        const receiveOverrideMode = resolveReceiveOverrideMode(controls);

        writeInput("superSettingsSchoolYear", settings.school_year || "");
        writeInput("superSettingsQuotaSlots", settings.quota_slots || 0);
        writeInput("superSettingsWaitlistSlots", settings.waitlist_slots || 0);
        writeInput("superSettingsExamItems", settings.exam_total_items || 0);
        writeInput("superSettingsPassingScore", settings.passing_score || 0);
        writeInput("superSettingsCycleOpen", settings.application_open_date || "");
        writeInput("superSettingsCycleOpenTime", controls.application_open_time || "");
        writeInput("superSettingsCycleClose", settings.application_close_date || "");
        writeInput("superSettingsCycleCloseTime", controls.application_close_time || "");
        writeInput("superSettingsWeightExam", ranking.exam_weight || 0);
        writeInput("superSettingsWeightInterview", ranking.interview_weight || 0);
        writeInput("superSettingsWeightIncome", ranking.income_weight || 0);
        writeInput("superSettingsWeightRequirements", ranking.requirements_weight || 0);
        writeInput("superSettingsRankingNotes", ranking.notes || "");
        writeInput("superSettingsApplicationReceiveOverrideMode", receiveOverrideMode);
        writeCheckbox("superSettingsRequireRemarks", controls.require_admin_remarks);
        writeCheckbox("superSettingsLockRankingAfterDecision", controls.lock_ranking_after_decision);
        writeCheckbox("superSettingsAllowSpecialEndorsement", controls.allow_special_endorsement);
        writeCheckbox("superSettingsAllowApplicantApplicationEdits", controls.allow_applicant_application_edits !== false);
        writeCheckbox("superSettingsAllowSecretaryApplicantEdits", controls.allow_secretary_applicant_edits);
        writeCheckbox("superSettingsAllowSecretaryDraftCompletion", controls.allow_secretary_draft_completion);
        writeCheckbox("superSettingsAllowSecretaryWalkInIntake", controls.allow_secretary_walk_in_intake);
        writeCheckbox("superSettingsShowSecretarySpecialConsiderationControl", controls.show_secretary_special_consideration_control);
        writeCheckbox("superSettingsRequireApplicantPhotoOnSubmit", controls.require_applicant_photo_on_submit !== false);
        writeCheckbox("superSettingsAutoSetForInterview", controls.auto_set_for_interview);
        writeCheckbox("superSettingsExamCheckingInProgress", controls.exam_checking_in_progress);
        writeCheckbox("superSettingsShowApplicantExamScores", controls.show_applicant_exam_scores !== false);

        renderWeightTotal();
        renderKpis(settings);
        renderReceiveControl(settings);
        renderSnapshot(settings);
        syncReservedSlotManagerState();
    }

    function readFormValues() {
        const schoolYear = (byId("superSettingsSchoolYear") ? byId("superSettingsSchoolYear").value : "").trim();
        const quotaSlots = readNumberField("superSettingsQuotaSlots");
        const waitlistSlots = readNumberField("superSettingsWaitlistSlots");
        const examItems = readNumberField("superSettingsExamItems");
        const passingScore = readNumberField("superSettingsPassingScore");
        const examWeight = readNumberField("superSettingsWeightExam");
        const interviewWeight = readNumberField("superSettingsWeightInterview");
        const incomeWeight = readNumberField("superSettingsWeightIncome");
        const requirementsWeight = readNumberField("superSettingsWeightRequirements");
        const openDate = byId("superSettingsCycleOpen") ? (byId("superSettingsCycleOpen").value || null) : null;
        const closeDate = byId("superSettingsCycleClose") ? (byId("superSettingsCycleClose").value || null) : null;
        const openTime = normalizeTimeValue(byId("superSettingsCycleOpenTime") ? byId("superSettingsCycleOpenTime").value : "");
        const closeTime = normalizeTimeValue(byId("superSettingsCycleCloseTime") ? byId("superSettingsCycleCloseTime").value : "");
        const receiveOverrideMode = normalizeReceiveOverrideMode(byId("superSettingsApplicationReceiveOverrideMode") ? byId("superSettingsApplicationReceiveOverrideMode").value : "");
        if (!/^[0-9]{4}-[0-9]{4}$/.test(schoolYear)) {
            return { error: "School year must follow YYYY-YYYY format." };
        }
        if ([quotaSlots, waitlistSlots, examItems].some(function (value) { return Number.isNaN(value) || value < 0; })) {
            return { error: "Quota, waitlist slots, and exam total items must be valid non-negative numbers." };
        }
        if (Number.isNaN(passingScore) || passingScore < 0 || passingScore > 100) {
            return { error: "Passing score must be between 0 and 100." };
        }
        if ([examWeight, interviewWeight, incomeWeight, requirementsWeight].some(function (value) {
            return Number.isNaN(value) || value < 0 || value > 100;
        })) {
            return { error: "All ranking weights must be between 0 and 100." };
        }

        const weightTotal = examWeight + interviewWeight + incomeWeight + requirementsWeight;
        if (weightTotal <= 0) {
            return { error: "Ranking weight total must be greater than zero." };
        }
        if ((openTime && !openDate) || (closeTime && !closeDate)) {
            return { error: "Set the application date before assigning an open or close time." };
        }
        if (openDate && closeDate && closeDate < openDate) {
            return { error: "Application close date cannot be earlier than the open date." };
        }
        if (openDate && closeDate && openDate === closeDate && openTime && closeTime && closeTime <= openTime) {
            return { error: "On the same day, application close time must be later than the open time." };
        }
        return {
            school_year: schoolYear,
            quota_slots: Math.trunc(quotaSlots),
            waitlist_slots: Math.trunc(waitlistSlots),
            exam_total_items: Math.trunc(examItems),
            passing_score: passingScore,
            application_open_date: openDate,
            application_close_date: closeDate,
            ranking_basis: {
                exam_weight: examWeight,
                interview_weight: interviewWeight,
                income_weight: incomeWeight,
                requirements_weight: requirementsWeight,
                notes: byId("superSettingsRankingNotes") ? byId("superSettingsRankingNotes").value.trim() : "",
                controls: {
                    application_intake_enabled: receiveOverrideMode !== RECEIVE_OVERRIDE_FORCE_CLOSED,
                    application_receive_override_mode: receiveOverrideMode,
                    application_open_time: openTime,
                    application_close_time: closeTime,
                    require_admin_remarks: Boolean(byId("superSettingsRequireRemarks") && byId("superSettingsRequireRemarks").checked),
                    lock_ranking_after_decision: Boolean(byId("superSettingsLockRankingAfterDecision") && byId("superSettingsLockRankingAfterDecision").checked),
                    allow_special_endorsement: Boolean(byId("superSettingsAllowSpecialEndorsement") && byId("superSettingsAllowSpecialEndorsement").checked),
                    allow_applicant_application_edits: Boolean(byId("superSettingsAllowApplicantApplicationEdits") && byId("superSettingsAllowApplicantApplicationEdits").checked),
                    allow_secretary_applicant_edits: Boolean(byId("superSettingsAllowSecretaryApplicantEdits") && byId("superSettingsAllowSecretaryApplicantEdits").checked),
                    allow_secretary_draft_completion: Boolean(byId("superSettingsAllowSecretaryDraftCompletion") && byId("superSettingsAllowSecretaryDraftCompletion").checked),
                    allow_secretary_walk_in_intake: Boolean(byId("superSettingsAllowSecretaryWalkInIntake") && byId("superSettingsAllowSecretaryWalkInIntake").checked),
                    allow_secretary_special_consideration: currentSpecialConsiderationEnabled(),
                    show_secretary_special_consideration_control: currentSecretarySpecialConsiderationControlEnabled(),
                    special_consideration_options: currentSpecialConsiderationOptions(),
                    require_applicant_photo_on_submit: Boolean(byId("superSettingsRequireApplicantPhotoOnSubmit") && byId("superSettingsRequireApplicantPhotoOnSubmit").checked),
                    auto_set_for_interview: Boolean(byId("superSettingsAutoSetForInterview") && byId("superSettingsAutoSetForInterview").checked),
                    exam_checking_in_progress: Boolean(byId("superSettingsExamCheckingInProgress") && byId("superSettingsExamCheckingInProgress").checked),
                    show_applicant_exam_scores: Boolean(byId("superSettingsShowApplicantExamScores") && byId("superSettingsShowApplicantExamScores").checked)
                }
            }
        };
    }

    async function writeAuditEntry(context, entry) {
        const helper = auditHelper();
        if (!helper || !context) {
            return { ok: false, skipped: "missing_helper" };
        }

        try {
            return await helper.logEvent(context, entry);
        } catch (_error) {
            return { ok: false, skipped: "write_failed" };
        }
    }

    async function logSettingsAudit(context, previousSettings, savedSettings) {
        const previous = previousSettings || null;
        const current = savedSettings || null;
        if (!current) {
            return;
        }

        const previousControls = previous && previous.ranking_basis && previous.ranking_basis.controls
            ? previous.ranking_basis.controls
            : {};
        const currentControls = current.ranking_basis && current.ranking_basis.controls
            ? current.ranking_basis.controls
            : {};
        const previousReceiveMode = resolveReceiveOverrideMode(previousControls);
        const currentReceiveMode = resolveReceiveOverrideMode(currentControls);
        const previousPhotoRequirement = previousControls.require_applicant_photo_on_submit !== false;
        const currentPhotoRequirement = currentControls.require_applicant_photo_on_submit !== false;
        const schoolYear = current.school_year || "current school year";

        await writeAuditEntry(context, {
            module: "scholarship_settings",
            action: "save_scholarship_settings",
            recordType: "ranking_settings",
            recordId: current.id || schoolYear,
            summary: "Saved scholarship settings for " + schoolYear + ".",
            details: {
                school_year: schoolYear,
                quota_slots: Number(current.quota_slots || 0),
                waitlist_slots: Number(current.waitlist_slots || 0),
                passing_score: Number(current.passing_score || 0),
                receive_override_mode: currentReceiveMode,
                require_applicant_photo_on_submit: currentPhotoRequirement,
                exam_checking_in_progress: Boolean(currentControls.exam_checking_in_progress),
                reserved_slot_exception_flow: Boolean(currentControls.allow_secretary_special_consideration),
                secretary_special_consideration_selector: Boolean(currentControls.show_secretary_special_consideration_control),
                application_open_date: current.application_open_date || "",
                application_close_date: current.application_close_date || ""
            }
        });

        if (previousReceiveMode !== currentReceiveMode) {
            await writeAuditEntry(context, {
                module: "scholarship_settings",
                action: "update_receive_control",
                recordType: "ranking_settings",
                recordId: current.id || schoolYear,
                summary: "Changed receive control from " + previousReceiveMode.replace(/_/g, " ") + " to " + currentReceiveMode.replace(/_/g, " ") + ".",
                details: {
                    school_year: schoolYear,
                    previous_mode: previousReceiveMode,
                    current_mode: currentReceiveMode
                }
            });
        }

        if (previousPhotoRequirement !== currentPhotoRequirement) {
            await writeAuditEntry(context, {
                module: "scholarship_settings",
                action: "update_applicant_photo_requirement",
                recordType: "ranking_settings",
                recordId: current.id || schoolYear,
                summary: "Changed applicant photo submit requirement from " + (previousPhotoRequirement ? "enabled" : "disabled") + " to " + (currentPhotoRequirement ? "enabled" : "disabled") + ".",
                details: {
                    school_year: schoolYear,
                    previous_required: previousPhotoRequirement,
                    current_required: currentPhotoRequirement
                }
            });
        }
    }

    async function loadSettings(context) {
        showStatus("");

        const fallback = readFallbackStorage();

        const result = await context.client
            .from("ranking_settings")
            .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                activeSettingsRecord = cloneSettings(fallback || DEFAULT_SETTINGS);
                applyForm(activeSettingsRecord);
                showStatus("Using local fallback settings. Deploy ranking_settings table for Supabase persistence.", "alert-warning");
                if (hasReservedSlotManager()) {
                    await loadReservedSlotManager(context);
                }
                return;
            }
            throw new Error("Failed to load ranking settings: " + result.error.message);
        }

        const active = result.data && result.data.length > 0 ? result.data[0] : null;
        if (!active) {
            activeSettingsRecord = cloneSettings(fallback || DEFAULT_SETTINGS);
            applyForm(activeSettingsRecord);
            showStatus("No active ranking settings yet. Configure and save to initialize.", "alert-info");
            if (hasReservedSlotManager()) {
                await loadReservedSlotManager(context);
            }
            return;
        }

        activeSettingsRecord = cloneSettings(active);
        applyForm(active);
        if (hasReservedSlotManager()) {
            await loadReservedSlotManager(context);
        }
    }

    async function saveSettings(context, options) {
        const saveOptions = options || {};
        const values = readFormValues();
        if (values.error) {
            showStatus(values.error, "alert-warning");
            return;
        }

        const payload = Object.assign({}, values, {
            is_active: true,
            managed_by: context.user.id
        });
        const previousSettings = cloneSettings(activeSettingsRecord);

        // TODO(Supabase): support versioned settings history per school year before overwriting active row.
        const upsertResult = await context.client
            .from("ranking_settings")
            .upsert(payload, { onConflict: "school_year" })
            .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
            .single();

        if (upsertResult.error) {
            if (/does not exist|relation/i.test(upsertResult.error.message || "")) {
                writeFallbackStorage(payload);
                activeSettingsRecord = cloneSettings(payload);
                applyForm(payload);
                showStatus("Saved to local fallback only. Run schema update to enable Supabase persistence.", "alert-warning");
                if (hasReservedSlotManager()) {
                    await loadReservedSlotManager(context);
                }
                return;
            }
            throw new Error("Failed to save settings: " + upsertResult.error.message);
        }

        await logSettingsAudit(context, previousSettings, upsertResult.data);
        writeFallbackStorage(upsertResult.data);
        activeSettingsRecord = cloneSettings(upsertResult.data);
        applyForm(upsertResult.data);
        showStatus(saveOptions.successMessage || "Scholarship settings saved successfully.", "alert-success");
        if (hasReservedSlotManager()) {
            await loadReservedSlotManager(context);
        }
    }

    async function applyReceiveOverride(context, nextMode) {
        const overrideInputId = "superSettingsApplicationReceiveOverrideMode";
        const previousMode = byId(overrideInputId) ? byId(overrideInputId).value : RECEIVE_OVERRIDE_SCHEDULE;

        writeInput(overrideInputId, nextMode);
        renderReceiveControl(previewSettingsFromForm());
        renderSnapshot(previewSettingsFromForm());
        setReceiveActionButtonsDisabled(true);

        try {
            await saveSettings(context, {
                successMessage: receiveAppliedMessage(nextMode)
            });
        } catch (error) {
            writeInput(overrideInputId, previousMode);
            renderReceiveControl(previewSettingsFromForm());
            renderSnapshot(previewSettingsFromForm());
            throw error;
        } finally {
            setReceiveActionButtonsDisabled(false);
        }
    }

    function bindEvents(context) {
        const saveBtn = byId("superSettingsSaveBtn");
        const loadBtn = byId("superSettingsLoadBtn");
        const receiveToggleBtn = byId("superSettingsReceiveToggleBtn");
        const receiveResetBtn = byId("superSettingsReceiveResetBtn");
        const reservedSearchInput = byId("superReservedSlotSearchInput");
        const reservedSearchResults = byId("superReservedSlotSearchResults");
        const reservedTableBody = byId("superReservedSlotTableBody");

        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                saveSettings(context).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to save settings.", "alert-danger");
                });
            });
        }

        if (loadBtn) {
            loadBtn.addEventListener("click", function () {
                loadSettings(context).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to load settings.", "alert-danger");
                });
            });
        }

        if (receiveToggleBtn) {
            receiveToggleBtn.addEventListener("click", function () {
                const currentState = computeReceiveState(previewSettingsFromForm());
                const nextMode = currentState.isOpen ? RECEIVE_OVERRIDE_FORCE_CLOSED : RECEIVE_OVERRIDE_FORCE_OPEN;
                applyReceiveOverride(context, nextMode).catch(function (error) {
                    showStatus(
                        "Failed to apply receive control. " + (error && error.message ? error.message : "Please try again."),
                        "alert-danger"
                    );
                });
            });
        }

        if (receiveResetBtn) {
            receiveResetBtn.addEventListener("click", function () {
                applyReceiveOverride(context, RECEIVE_OVERRIDE_SCHEDULE).catch(function (error) {
                    showStatus(
                        "Failed to return receive control to schedule mode. " + (error && error.message ? error.message : "Please try again."),
                        "alert-danger"
                    );
                });
            });
        }

        if (reservedSearchInput) {
            reservedSearchInput.addEventListener("input", function () {
                renderReservedSlotSearchResults();
            });
        }

        if (reservedSearchResults) {
            reservedSearchResults.addEventListener("click", function (event) {
                const button = event.target && event.target.closest ? event.target.closest("[data-reserved-slot-add]") : null;
                if (!button) {
                    return;
                }
                addReservedSlotStudent(context, button.getAttribute("data-reserved-slot-add")).catch(function (error) {
                    showReservedSlotStatus(error && error.message ? error.message : "Failed to add special consideration student.", "alert-danger");
                });
            });
        }

        if (reservedTableBody) {
            reservedTableBody.addEventListener("click", function (event) {
                const button = event.target && event.target.closest ? event.target.closest("[data-reserved-slot-remove]") : null;
                if (!button) {
                    return;
                }
                removeReservedSlotStudent(context, button.getAttribute("data-reserved-slot-remove")).catch(function (error) {
                    showReservedSlotStatus(error && error.message ? error.message : "Failed to remove special consideration student.", "alert-danger");
                });
            });
        }

        [
            "superSettingsCycleOpen",
            "superSettingsCycleOpenTime",
            "superSettingsCycleClose",
            "superSettingsCycleCloseTime",
            "superSettingsSchoolYear",
            "superSettingsQuotaSlots",
            "superSettingsWaitlistSlots",
            "superSettingsExamItems",
            "superSettingsPassingScore",
            "superSettingsWeightExam",
            "superSettingsWeightInterview",
            "superSettingsWeightIncome",
            "superSettingsWeightRequirements",
            "superSettingsRankingNotes",
            "superSettingsRequireRemarks",
            "superSettingsLockRankingAfterDecision",
            "superSettingsAllowSpecialEndorsement",
            "superSettingsAllowSecretaryApplicantEdits",
            "superSettingsAllowSecretaryDraftCompletion",
            "superSettingsAllowSecretaryWalkInIntake",
            "superSettingsShowSecretarySpecialConsiderationControl",
            "superSettingsRequireApplicantPhotoOnSubmit",
            "superSettingsAutoSetForInterview",
            "superSettingsExamCheckingInProgress"
        ].forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", function () {
                if (id.indexOf("Weight") !== -1) {
                    renderWeightTotal();
                }
                renderReceiveControl(previewSettingsFromForm());
                renderSnapshot(previewSettingsFromForm());
            });
            input.addEventListener("change", function () {
                renderReceiveControl(previewSettingsFromForm());
                renderSnapshot(previewSettingsFromForm());
                if (id === "superSettingsSchoolYear") {
                    if (hasReservedSlotManager()) {
                        loadReservedSlotManager(context).catch(function (error) {
                            showReservedSlotStatus(error && error.message ? error.message : "Failed to load special consideration student list.", "alert-danger");
                        });
                    }
                }
            });
        });
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents(context);
        try {
            await loadSettings(context);
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load scholarship settings.", "alert-danger");
            activeSettingsRecord = cloneSettings(readFallbackStorage() || DEFAULT_SETTINGS);
            applyForm(activeSettingsRecord);
            if (hasReservedSlotManager()) {
                try {
                    await loadReservedSlotManager(context);
                } catch (reservedError) {
                    showReservedSlotStatus(reservedError && reservedError.message ? reservedError.message : "Failed to load special consideration student list.", "alert-danger");
                }
            }
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
