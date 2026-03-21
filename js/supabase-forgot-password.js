(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];

    function authHelper() {
        return window.LDSSAuthEmailHelper || null;
    }

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

    async function onForgotSubmit(client, event) {
        event.preventDefault();
        setStatus("");

        const identifier = (document.getElementById("resetIdentifier")?.value || "").trim();
        const helper = authHelper();
        if (!identifier) {
            setStatus("Enter your registered email address.", "alert-danger");
            return;
        }

        if (!helper.looksLikeEmail(identifier)) {
            setStatus("Mobile recovery is not enabled yet. Please use your registered email.", "alert-warning");
            return;
        }
        if (!helper.isValidEmail(identifier)) {
            setStatus("Please enter a valid email address.", "alert-danger");
            return;
        }

        setSubmitLoading(true);
        try {
            const redirectTo = helper.resolvePasswordResetRedirectUrl();
            const { error } = await client.auth.resetPasswordForEmail(helper.normalizeEmailAddress(identifier), {
                redirectTo: redirectTo
            });

            if (error) {
                setStatus(
                    helper.getErrorMessage(
                        error,
                        "Failed to send recovery email. Check Supabase Auth URL Configuration, SMTP, and rate limits."
                    ),
                    "alert-danger"
                );
                return;
            }

            setStatus("Recovery email sent. Check your inbox and open the reset link.", "alert-success");
        } catch (err) {
            setStatus(
                helper.getErrorMessage(
                    err,
                    "Unexpected error while sending recovery email. Check Supabase Auth URL Configuration, SMTP, and rate limits."
                ),
                "alert-danger"
            );
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
        if (!window.LDSSAuthEmailHelper) {
            setStatus("Auth email helper failed to load. Check js/supabase-auth-email-helper.js.", "alert-danger");
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
