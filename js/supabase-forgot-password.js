(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const DEFAULT_PRODUCTION_RESET_URL = "https://iskolarngdaet.app/reset-password.html";

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

    function resolveResetRedirectUrl() {
        const configured = (window.LDSS_PASSWORD_RESET_REDIRECT_URL || "").toString().trim();
        if (configured) {
            return configured;
        }

        const protocol = (window.location.protocol || "").toString().trim().toLowerCase();
        const hostname = (window.location.hostname || "").toString().trim().toLowerCase();
        const origin = (window.location.origin || "").toString().trim().replace(/\/+$/, "");
        const isLocal = protocol === "file:" || hostname === "localhost" || hostname === "127.0.0.1";

        if (!isLocal && /^https?:\/\//i.test(origin)) {
            return origin + "/reset-password.html";
        }

        return DEFAULT_PRODUCTION_RESET_URL;
    }

    function getErrorMessage(error, fallbackMessage) {
        if (!error) {
            return fallbackMessage;
        }

        if (typeof error === "string" && error.trim()) {
            return error.trim();
        }

        if (typeof error.message === "string" && error.message.trim() && error.message.trim() !== "{}") {
            return error.message.trim();
        }

        if (typeof error.error_description === "string" && error.error_description.trim()) {
            return error.error_description.trim();
        }

        if (typeof error.msg === "string" && error.msg.trim()) {
            return error.msg.trim();
        }

        if (typeof error.code === "string") {
            if (error.code.toLowerCase().includes("rate")) {
                return "Email rate limit exceeded. Wait at least 60 seconds, then try again.";
            }
            return "Request failed (" + error.code + ").";
        }

        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== "{}") {
                return serialized;
            }
        } catch (serializationError) {
            // Ignore serialization failure and use the fallback below.
        }

        return fallbackMessage;
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
            const redirectTo = resolveResetRedirectUrl();
            const { error } = await client.auth.resetPasswordForEmail(identifier.toLowerCase(), {
                redirectTo: redirectTo
            });

            if (error) {
                setStatus(
                    getErrorMessage(
                        error,
                        "Failed to send recovery email. Check Supabase Auth URL Configuration, SMTP, and rate limits."
                    ),
                    "alert-danger"
                );
                return;
            }

            setStatus("Recovery email sent. Check your inbox and open the reset link.", "alert-success");
        } catch (err) {
            console.error("Forgot password error:", err);
            setStatus(
                getErrorMessage(
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
