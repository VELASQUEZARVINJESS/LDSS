(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];

    function setStatus(message, type) {
        const el = document.getElementById("forgotStatus");
        if (!el) {
            return;
        }
        if (!message) {
            el.classList.add("d-none");
            el.classList.remove("alert-danger", "alert-warning", "alert-success");
            return;
        }
        el.textContent = message;
        el.classList.remove("d-none", "alert-danger", "alert-warning", "alert-success");
        el.classList.add(type || "alert-danger");
    }

    function setSubmitLoading(isLoading) {
        const btn = document.getElementById("forgotSubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Sending..." : "Send Recovery Instructions";
    }

    function looksLikeEmail(value) {
        return value.includes("@");
    }

    async function onForgotSubmit(client, event) {
        event.preventDefault();
        setStatus("");

        const identifier = (document.getElementById("resetIdentifier")?.value || "").trim();
        if (!identifier) {
            setStatus("Enter your registered email address.", "alert-danger");
            return;
        }

        if (!looksLikeEmail(identifier)) {
            setStatus("Mobile recovery is not enabled yet. Please use your registered email.", "alert-warning");
            return;
        }

        setSubmitLoading(true);
        try {
            const redirectTo = window.location.origin + "/reset-password.html";
            const { error } = await client.auth.resetPasswordForEmail(identifier.toLowerCase(), {
                redirectTo: redirectTo
            });

            if (error) {
                setStatus(error.message || "Failed to send recovery email.", "alert-danger");
                return;
            }

            setStatus("Recovery email sent. Check your inbox and open the reset link.", "alert-success");
        } catch (err) {
            setStatus("Unexpected error while sending recovery email.", "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    function init() {
        const form = document.getElementById("forgotForm");
        if (!form) {
            return;
        }

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholder = CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });

        if (!window.supabase || !window.supabase.createClient) {
            setStatus("Supabase library failed to load. Check internet/CDN access.", "alert-danger");
            return;
        }
        if (!url || !anonKey || hasPlaceholder) {
            setStatus("Supabase config is not set. Update js/supabase-config.js first.", "alert-warning");
            return;
        }

        const client = window.supabase.createClient(url, anonKey);
        form.addEventListener("submit", function (event) {
            onForgotSubmit(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
