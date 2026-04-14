(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const DEFAULT_CONTROLS = {
        exam_checking_in_progress: false
    };

    function cloneControls(controls) {
        return Object.assign({}, DEFAULT_CONTROLS, controls || {});
    }

    function readFallbackControls() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return cloneControls(DEFAULT_CONTROLS);
            }
            const parsed = JSON.parse(raw);
            const controls = parsed && parsed.ranking_basis && parsed.ranking_basis.controls
                ? parsed.ranking_basis.controls
                : {};
            return cloneControls(controls);
        } catch (_error) {
            return cloneControls(DEFAULT_CONTROLS);
        }
    }

    function applyControls(controls) {
        window.LDSS_ACTIVE_WORKFLOW_CONTROLS = cloneControls(controls);
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
    }

    applyControls(readFallbackControls());

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
                return applyControls(Object.assign({}, readFallbackControls(), result.data));
            }
        } catch (_error) {
            return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
        }

        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS;
    })();
})();
