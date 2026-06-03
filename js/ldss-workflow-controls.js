(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const DEFAULT_CONTROLS = {
        allow_applicant_application_edits: true,
        exam_checking_in_progress: false,
        show_applicant_exam_scores: true
    };
    const DEFAULT_RANKING_SETTINGS = {
        exam_total_items: 100,
        passing_score: 75
    };

    function cloneControls(controls) {
        return Object.assign({}, DEFAULT_CONTROLS, controls || {});
    }

    function normalizeNumber(value, fallbackValue) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function normalizeRankingSettings(settings, available) {
        const totalItems = Math.max(1, Math.round(normalizeNumber(
            settings && settings.exam_total_items,
            DEFAULT_RANKING_SETTINGS.exam_total_items
        )));
        const passingScore = Math.min(100, Math.max(0, normalizeNumber(
            settings && settings.passing_score,
            DEFAULT_RANKING_SETTINGS.passing_score
        )));

        return {
            exam_total_items: totalItems,
            passing_score: passingScore,
            available: available === true
        };
    }

    function stripRankingSettings(source) {
        const payload = Object.assign({}, source || {});
        delete payload.exam_total_items;
        delete payload.passing_score;
        delete payload.available;
        return payload;
    }

    function applyControls(controls) {
        window.LDSS_ACTIVE_WORKFLOW_CONTROLS = cloneControls(stripRankingSettings(controls));
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
    }

    function applyRankingSettings(settings, available) {
        window.LDSS_ACTIVE_RANKING_SETTINGS = normalizeRankingSettings(settings, available);
        return window.LDSS_ACTIVE_RANKING_SETTINGS;
    }

    function readFallbackState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return {
                    controls: cloneControls(DEFAULT_CONTROLS),
                    rankingSettings: normalizeRankingSettings(DEFAULT_RANKING_SETTINGS, false)
                };
            }
            const parsed = JSON.parse(raw);
            const controls = parsed && parsed.ranking_basis && parsed.ranking_basis.controls
                ? parsed.ranking_basis.controls
                : {};
            const hasLivePolicy = !!(
                parsed &&
                typeof parsed === "object" &&
                parsed.exam_total_items !== undefined &&
                parsed.exam_total_items !== null &&
                parsed.passing_score !== undefined &&
                parsed.passing_score !== null
            );
            return {
                controls: cloneControls(controls),
                rankingSettings: normalizeRankingSettings(parsed, hasLivePolicy)
            };
        } catch (_error) {
            return {
                controls: cloneControls(DEFAULT_CONTROLS),
                rankingSettings: normalizeRankingSettings(DEFAULT_RANKING_SETTINGS, false)
            };
        }
    }

    const fallbackState = readFallbackState();
    applyControls(fallbackState.controls);
    applyRankingSettings(fallbackState.rankingSettings, fallbackState.rankingSettings.available);

    window.ldssWorkflowControlsReadyPromise = (async function () {
        const authReady = window.ldssAuthReadyPromise;
        if (!authReady || typeof authReady.then !== "function") {
            return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
        }

        try {
            const context = await authReady;
            if (!context || !context.client || typeof context.client.rpc !== "function") {
                return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
            }

            const result = await context.client.rpc("active_workflow_controls");
            if (!result.error && result.data && typeof result.data === "object") {
                const nextRankingSettings = {
                    exam_total_items: result.data.exam_total_items,
                    passing_score: result.data.passing_score
                };
                const rankingSettings = {
                    exam_total_items: fallbackState.rankingSettings.exam_total_items,
                    passing_score: fallbackState.rankingSettings.passing_score
                };
                const hasLivePolicy = Number.isFinite(Number(result.data.exam_total_items))
                    && Number.isFinite(Number(result.data.passing_score));
                applyControls(Object.assign({}, fallbackState.controls, stripRankingSettings(result.data)));
                applyRankingSettings(hasLivePolicy ? nextRankingSettings : rankingSettings, hasLivePolicy || fallbackState.rankingSettings.available);
                return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
            }
        } catch (_error) {
            return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
        }

        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
    })();
})();
