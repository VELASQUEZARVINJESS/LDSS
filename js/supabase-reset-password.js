(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const MIN_PASSWORD_LENGTH = 12;

    function setStatus(message, type) {
        const el = document.getElementById("resetStatus");
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
        const btn = document.getElementById("resetSubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Updating..." : "Update Password";
    }

    function validatePasswordSecurity(password) {
        if (/\s/.test(password)) {
            return "Password cannot contain spaces.";
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return "New password must be at least 12 characters.";
        }
        if (!/[A-Z]/.test(password)) {
            return "New password must include at least one uppercase letter.";
        }
        if (!/[a-z]/.test(password)) {
            return "New password must include at least one lowercase letter.";
        }
        if (!/[0-9]/.test(password)) {
            return "New password must include at least one number.";
        }
        if (!/[^A-Za-z0-9]/.test(password)) {
            return "New password must include at least one symbol.";
        }
        return "";
    }

    async function ensureRecoverySession(client) {
        try {
            const { data, error } = await client.auth.getSession();
            if (error) {
                setStatus("Could not validate recovery session. Reopen the email reset link.", "alert-warning");
                return false;
            }
            if (!data || !data.session) {
                setStatus("No active recovery session found. Use Forgot Password again.", "alert-warning");
                return false;
            }
            return true;
        } catch (err) {
            setStatus("Recovery session check failed. Reopen your reset link.", "alert-warning");
            return false;
        }
    }

    async function onResetSubmit(client, event) {
        event.preventDefault();
        setStatus("");

        const newPassword = document.getElementById("newPassword")?.value || "";
        const confirmNewPassword = document.getElementById("confirmNewPassword")?.value || "";

        if (!newPassword || !confirmNewPassword) {
            setStatus("Enter and confirm your new password.", "alert-danger");
            return;
        }
        const passwordPolicyError = validatePasswordSecurity(newPassword);
        if (passwordPolicyError) {
            setStatus(passwordPolicyError, "alert-danger");
            return;
        }
        if (newPassword !== confirmNewPassword) {
            setStatus("Password and Confirm Password do not match.", "alert-danger");
            return;
        }

        const hasSession = await ensureRecoverySession(client);
        if (!hasSession) {
            return;
        }

        setSubmitLoading(true);
        try {
            const { error } = await client.auth.updateUser({ password: newPassword });
            if (error) {
                setStatus(error.message || "Password update failed.", "alert-danger");
                return;
            }
            try {
                await client.auth.signOut();
            } catch (signOutError) {
                // Ignore post-reset sign-out failure and continue to login.
            }
            setStatus("Password updated successfully. Redirecting to login...", "alert-success");
            setTimeout(function () {
                window.location.replace("login.html");
            }, 1300);
        } catch (err) {
            setStatus("Unexpected password update error. Please retry.", "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    function init() {
        const form = document.getElementById("resetForm");
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
            onResetSubmit(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
