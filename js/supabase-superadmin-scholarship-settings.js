(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const RECEIVE_OVERRIDE_SCHEDULE = "schedule";
    const RECEIVE_OVERRIDE_FORCE_OPEN = "force_open";
    const RECEIVE_OVERRIDE_FORCE_CLOSED = "force_closed";

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
                allow_secretary_applicant_edits: false,
                require_applicant_photo_on_submit: true,
                auto_set_for_interview: true
            }
        }
    };
    let activeSettingsRecord = null;

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
                    require_applicant_photo_on_submit: Boolean(byId("superSettingsRequireApplicantPhotoOnSubmit") && byId("superSettingsRequireApplicantPhotoOnSubmit").checked),
                    auto_set_for_interview: Boolean(byId("superSettingsAutoSetForInterview") && byId("superSettingsAutoSetForInterview").checked)
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
            "Secretary Applicant Detail Edit: " + (controls.allow_secretary_applicant_edits ? "Enabled" : "Disabled"),
            "Applicant Photo Required On Submit: " + (controls.require_applicant_photo_on_submit !== false ? "Enabled" : "Disabled"),
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
        writeCheckbox("superSettingsAllowSecretaryApplicantEdits", controls.allow_secretary_applicant_edits);
        writeCheckbox("superSettingsRequireApplicantPhotoOnSubmit", controls.require_applicant_photo_on_submit !== false);
        writeCheckbox("superSettingsAutoSetForInterview", controls.auto_set_for_interview);

        renderWeightTotal();
        renderKpis(settings);
        renderReceiveControl(settings);
        renderSnapshot(settings);
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
                    allow_secretary_applicant_edits: Boolean(byId("superSettingsAllowSecretaryApplicantEdits") && byId("superSettingsAllowSecretaryApplicantEdits").checked),
                    require_applicant_photo_on_submit: Boolean(byId("superSettingsRequireApplicantPhotoOnSubmit") && byId("superSettingsRequireApplicantPhotoOnSubmit").checked),
                    auto_set_for_interview: Boolean(byId("superSettingsAutoSetForInterview") && byId("superSettingsAutoSetForInterview").checked)
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
                return;
            }
            throw new Error("Failed to load ranking settings: " + result.error.message);
        }

        const active = result.data && result.data.length > 0 ? result.data[0] : null;
        if (!active) {
            activeSettingsRecord = cloneSettings(fallback || DEFAULT_SETTINGS);
            applyForm(activeSettingsRecord);
            showStatus("No active ranking settings yet. Configure and save to initialize.", "alert-info");
            return;
        }

        activeSettingsRecord = cloneSettings(active);
        applyForm(active);
    }

    async function saveSettings(context) {
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
                return;
            }
            throw new Error("Failed to save settings: " + upsertResult.error.message);
        }

        await logSettingsAudit(context, previousSettings, upsertResult.data);
        writeFallbackStorage(upsertResult.data);
        activeSettingsRecord = cloneSettings(upsertResult.data);
        applyForm(upsertResult.data);
        showStatus("Scholarship settings saved successfully.", "alert-success");
    }

    function bindEvents(context) {
        const saveBtn = byId("superSettingsSaveBtn");
        const loadBtn = byId("superSettingsLoadBtn");
        const receiveToggleBtn = byId("superSettingsReceiveToggleBtn");
        const receiveResetBtn = byId("superSettingsReceiveResetBtn");

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
                writeInput("superSettingsApplicationReceiveOverrideMode", nextMode);
                renderReceiveControl(previewSettingsFromForm());
                renderSnapshot(previewSettingsFromForm());
                showStatus(
                    (nextMode === RECEIVE_OVERRIDE_FORCE_OPEN
                        ? "Receiving is set to manual ENABLE."
                        : "Receiving is set to manual DISABLE.") + " Click Save Settings to apply this change to applicants.",
                    "alert-info"
                );
            });
        }

        if (receiveResetBtn) {
            receiveResetBtn.addEventListener("click", function () {
                writeInput("superSettingsApplicationReceiveOverrideMode", RECEIVE_OVERRIDE_SCHEDULE);
                renderReceiveControl(previewSettingsFromForm());
                renderSnapshot(previewSettingsFromForm());
                showStatus("Receiving is back to automatic schedule mode. Click Save Settings to apply this change.", "alert-info");
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
            "superSettingsRequireApplicantPhotoOnSubmit",
            "superSettingsAutoSetForInterview"
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
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
