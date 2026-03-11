(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const MIN_PASSWORD_LENGTH = 12;

    function setStatus(message, type) {
        const el = document.getElementById("registerStatus");
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
        const btn = document.getElementById("registerSubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Creating Account..." : "Create Applicant Account";
    }

    function setPasswordToggleIcon(button, isVisible) {
        if (!button) {
            return;
        }

        const iconName = isVisible ? "eye-off" : "eye";
        button.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");

        if (window.feather && window.feather.icons && window.feather.icons[iconName]) {
            button.innerHTML = window.feather.icons[iconName].toSvg({ width: 16, height: 16 });
            return;
        }

        button.textContent = isVisible ? "Hide" : "Show";
    }

    function bindPasswordToggle(inputId, buttonId) {
        const input = document.getElementById(inputId);
        const button = document.getElementById(buttonId);
        if (!input || !button) {
            return;
        }

        setPasswordToggleIcon(button, input.type === "text");
        button.addEventListener("click", function () {
            const nextVisible = input.type === "password";
            input.type = nextVisible ? "text" : "password";
            setPasswordToggleIcon(button, nextVisible);
            input.focus();
        });
    }

    function normalizePhone(identifier) {
        const raw = (identifier || "").trim();
        const cleaned = raw.replace(/[\s()-]/g, "");
        const digits = cleaned.replace(/\D/g, "");

        if (/^09\d{9}$/.test(digits)) {
            return "+63" + digits.slice(1);
        }
        if (/^9\d{9}$/.test(digits)) {
            return "+63" + digits;
        }
        if (/^63\d{10}$/.test(digits)) {
            return "+" + digits;
        }
        if (/^\+639\d{9}$/.test(cleaned)) {
            return cleaned;
        }
        return null;
    }

    function validatePasswordSecurity(password) {
        if (/\s/.test(password)) {
            return "Password cannot contain spaces.";
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return "Password must be at least 12 characters.";
        }
        if (!/[A-Z]/.test(password)) {
            return "Password must include at least one uppercase letter.";
        }
        if (!/[a-z]/.test(password)) {
            return "Password must include at least one lowercase letter.";
        }
        if (!/[0-9]/.test(password)) {
            return "Password must include at least one number.";
        }
        if (!/[^A-Za-z0-9]/.test(password)) {
            return "Password must include at least one symbol.";
        }
        return "";
    }

    async function onRegisterSubmit(client, event) {
        event.preventDefault();
        setStatus("");

        const firstName = (document.getElementById("firstName")?.value || "").trim();
        const lastName = (document.getElementById("lastName")?.value || "").trim();
        const email = (document.getElementById("email")?.value || "").trim().toLowerCase();
        const mobileRaw = (document.getElementById("mobile")?.value || "").trim();
        const password = document.getElementById("password")?.value || "";
        const confirmPassword = document.getElementById("confirmPassword")?.value || "";
        const termsChecked = !!document.getElementById("terms")?.checked;

        if (!firstName || !lastName || !email || !mobileRaw || !password || !confirmPassword) {
            setStatus("Please complete all required registration fields.", "alert-danger");
            return;
        }
        if (!termsChecked) {
            setStatus("Please confirm that your information is true and accurate.", "alert-danger");
            return;
        }
        const passwordPolicyError = validatePasswordSecurity(password);
        if (passwordPolicyError) {
            setStatus(passwordPolicyError, "alert-danger");
            return;
        }
        if (password !== confirmPassword) {
            setStatus("Password and Confirm Password do not match.", "alert-danger");
            return;
        }

        const mobileE164 = normalizePhone(mobileRaw);
        if (!mobileE164) {
            setStatus("Enter a valid mobile number (example: 09XXXXXXXXX).", "alert-danger");
            return;
        }

        setSubmitLoading(true);
        try {
            const emailRedirectTo = "https://iskolarngdaet.app/login.html";
            const { data, error } = await client.auth.signUp({
                email: email,
                password: password,
                options: {
                    emailRedirectTo: emailRedirectTo,
                    data: {
                        first_name: firstName,
                        last_name: lastName,
                        mobile_number: mobileE164
                    }
                }
            });

            if (error) {
                setStatus(error.message || "Registration failed. Please try again.", "alert-danger");
                return;
            }

            if (data?.user && data?.session) {
                // Keep profile fields in sync for immediate-use projects without email confirmation.
                await client.from("profiles").upsert(
                    {
                        id: data.user.id,
                        email: email,
                        first_name: firstName,
                        last_name: lastName,
                        mobile_number: mobileE164
                    },
                    { onConflict: "id" }
                );
                await client.auth.signOut();
            }

            setStatus("Registration successful. Check your email for confirmation, then sign in.", "alert-success");
            setTimeout(function () {
                window.location.href = "login.html";
            }, 1400);
        } catch (err) {
            setStatus("Unexpected registration error. Please try again.", "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    function init() {
        const form = document.getElementById("registerForm");
        if (!form) {
            return;
        }
        bindPasswordToggle("password", "passwordToggle");
        bindPasswordToggle("confirmPassword", "confirmPasswordToggle");

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
            onRegisterSubmit(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
