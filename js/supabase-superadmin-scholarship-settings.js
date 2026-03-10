(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";

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
                require_admin_remarks: true,
                lock_ranking_after_decision: true,
                allow_special_endorsement: true,
                auto_set_for_interview: true
            }
        }
    };

    function byId(id) {
        return document.getElementById(id);
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

    function formatPercent(value) {
        const numeric = Number(value || 0);
        if (Number.isNaN(numeric)) {
            return "0%";
        }
        return numeric.toFixed(2).replace(/\.00$/, "") + "%";
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
        const lines = [
            "School Year: " + (settings.school_year || "-"),
            "Quota: " + Number(settings.quota_slots || 0),
            "Waitlist Buffer: " + Number(settings.waitlist_slots || 0),
            "Passing Score: " + formatPercent(settings.passing_score || 0),
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

        writeInput("superSettingsSchoolYear", settings.school_year || "");
        writeInput("superSettingsQuotaSlots", settings.quota_slots || 0);
        writeInput("superSettingsWaitlistSlots", settings.waitlist_slots || 0);
        writeInput("superSettingsExamItems", settings.exam_total_items || 0);
        writeInput("superSettingsPassingScore", settings.passing_score || 0);
        writeInput("superSettingsCycleOpen", settings.application_open_date || "");
        writeInput("superSettingsCycleClose", settings.application_close_date || "");
        writeInput("superSettingsWeightExam", ranking.exam_weight || 0);
        writeInput("superSettingsWeightInterview", ranking.interview_weight || 0);
        writeInput("superSettingsWeightIncome", ranking.income_weight || 0);
        writeInput("superSettingsWeightRequirements", ranking.requirements_weight || 0);
        writeInput("superSettingsRankingNotes", ranking.notes || "");
        writeCheckbox("superSettingsRequireRemarks", controls.require_admin_remarks);
        writeCheckbox("superSettingsLockRankingAfterDecision", controls.lock_ranking_after_decision);
        writeCheckbox("superSettingsAllowSpecialEndorsement", controls.allow_special_endorsement);
        writeCheckbox("superSettingsAutoSetForInterview", controls.auto_set_for_interview);

        renderWeightTotal();
        renderKpis(settings);
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

        return {
            school_year: schoolYear,
            quota_slots: Math.trunc(quotaSlots),
            waitlist_slots: Math.trunc(waitlistSlots),
            exam_total_items: Math.trunc(examItems),
            passing_score: passingScore,
            application_open_date: byId("superSettingsCycleOpen") ? (byId("superSettingsCycleOpen").value || null) : null,
            application_close_date: byId("superSettingsCycleClose") ? (byId("superSettingsCycleClose").value || null) : null,
            ranking_basis: {
                exam_weight: examWeight,
                interview_weight: interviewWeight,
                income_weight: incomeWeight,
                requirements_weight: requirementsWeight,
                notes: byId("superSettingsRankingNotes") ? byId("superSettingsRankingNotes").value.trim() : "",
                controls: {
                    require_admin_remarks: Boolean(byId("superSettingsRequireRemarks") && byId("superSettingsRequireRemarks").checked),
                    lock_ranking_after_decision: Boolean(byId("superSettingsLockRankingAfterDecision") && byId("superSettingsLockRankingAfterDecision").checked),
                    allow_special_endorsement: Boolean(byId("superSettingsAllowSpecialEndorsement") && byId("superSettingsAllowSpecialEndorsement").checked),
                    auto_set_for_interview: Boolean(byId("superSettingsAutoSetForInterview") && byId("superSettingsAutoSetForInterview").checked)
                }
            }
        };
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
                applyForm(fallback || DEFAULT_SETTINGS);
                showStatus("Using local fallback settings. Deploy ranking_settings table for Supabase persistence.", "alert-warning");
                return;
            }
            throw new Error("Failed to load ranking settings: " + result.error.message);
        }

        const active = result.data && result.data.length > 0 ? result.data[0] : null;
        if (!active) {
            applyForm(fallback || DEFAULT_SETTINGS);
            showStatus("No active ranking settings yet. Configure and save to initialize.", "alert-info");
            return;
        }

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

        // TODO(Supabase): support versioned settings history per school year before overwriting active row.
        const upsertResult = await context.client
            .from("ranking_settings")
            .upsert(payload, { onConflict: "school_year" })
            .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
            .single();

        if (upsertResult.error) {
            if (/does not exist|relation/i.test(upsertResult.error.message || "")) {
                writeFallbackStorage(payload);
                applyForm(payload);
                showStatus("Saved to local fallback only. Run schema update to enable Supabase persistence.", "alert-warning");
                return;
            }
            throw new Error("Failed to save settings: " + upsertResult.error.message);
        }

        writeFallbackStorage(upsertResult.data);
        applyForm(upsertResult.data);
        showStatus("Scholarship settings saved successfully.", "alert-success");
    }

    function bindEvents(context) {
        const saveBtn = byId("superSettingsSaveBtn");
        const loadBtn = byId("superSettingsLoadBtn");

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

        [
            "superSettingsWeightExam",
            "superSettingsWeightInterview",
            "superSettingsWeightIncome",
            "superSettingsWeightRequirements"
        ].forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", renderWeightTotal);
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
            applyForm(readFallbackStorage() || DEFAULT_SETTINGS);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
