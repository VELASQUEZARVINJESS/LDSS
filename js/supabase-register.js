(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const MIN_PASSWORD_LENGTH = 12;

    function authHelper() {
        return window.LDSSAuthEmailHelper || null;
    }

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

    function buildVerifyAccountUrl(email) {
        const helper = authHelper();
        if (helper && typeof helper.buildVerifyAccountUrl === "function") {
            return helper.buildVerifyAccountUrl(email, "register");
        }
        return "verify-account.html";
    }

    function buildLoginUrl(email, registered) {
        const target = new URL("login.html", window.location.href);
        const helper = authHelper();
        const normalizedEmail = helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(email)
            : (email || "").toString().trim().toLowerCase();

        if (normalizedEmail) {
            target.searchParams.set("email", normalizedEmail);
        }
        if (registered) {
            target.searchParams.set("registered", "1");
        }
        return target.toString();
    }

    function normalizeNameForSubmit(value) {
        return (value || "")
            .toString()
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    function bindUppercaseInput(inputId) {
        const input = document.getElementById(inputId);
        if (!input) {
            return;
        }

        input.addEventListener("input", function () {
            const upperValue = (input.value || "").toString().toUpperCase();
            if (input.value !== upperValue) {
                input.value = upperValue;
            }
        });

        input.addEventListener("blur", function () {
            const normalizedValue = normalizeNameForSubmit(input.value);
            if (input.value !== normalizedValue) {
                input.value = normalizedValue;
            }
        });
    }

    async function onRegisterSubmit(client, event) {
        event.preventDefault();
        setStatus("");

        const helper = authHelper();
        const firstName = normalizeNameForSubmit(document.getElementById("firstName")?.value || "");
        const lastName = normalizeNameForSubmit(document.getElementById("lastName")?.value || "");
        const email = helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(document.getElementById("email")?.value || "")
            : (document.getElementById("email")?.value || "").trim().toLowerCase();
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
        if (!helper.isValidEmail(email)) {
            setStatus("Please enter a valid email address.", "alert-danger");
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

        const mobileE164 = helper.normalizePhoneNumber(mobileRaw);
        if (!mobileE164) {
            setStatus("Enter a valid mobile number (example: 09XXXXXXXXX).", "alert-danger");
            return;
        }

        setSubmitLoading(true);
        try {
            const emailRedirectTo = window.LDSSAuthEmailHelper.resolveEmailConfirmRedirectUrl();
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
                setStatus(window.LDSSAuthEmailHelper.getErrorMessage(error, "Registration failed. Please try again."), "alert-danger");
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
                setStatus("Registration successful. Redirecting to login...", "alert-success");
                window.setTimeout(function () {
                    window.location.replace(buildLoginUrl(email, true));
                }, 500);
                return;
            }

            if (helper && typeof helper.rememberPendingVerificationEmail === "function") {
                helper.rememberPendingVerificationEmail(email);
            }
            setStatus("Registration successful. Redirecting to account verification...", "alert-success");
            window.setTimeout(function () {
                window.location.replace(buildVerifyAccountUrl(email));
            }, 500);
        } catch (err) {
            setStatus(window.LDSSAuthEmailHelper.getErrorMessage(err, "Unexpected registration error. Please try again."), "alert-danger");
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
        bindUppercaseInput("firstName");
        bindUppercaseInput("lastName");

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
            onRegisterSubmit(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
