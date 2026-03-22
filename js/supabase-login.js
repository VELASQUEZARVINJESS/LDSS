(function () {
    "use strict";

    const ROLE_ROUTES = {
        applicant: "APPLICANT/",
        secretary: "SECRETARY/",
        admin: "ADMIN/",
        super_admin: "SYSTEMADMINISTRATOR/"
    };

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];

    function authHelper() {
        return window.LDSSAuthEmailHelper || null;
    }

    function setStatus(message, type) {
        const el = document.getElementById("loginStatus");
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
        const btn = document.getElementById("loginSubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Signing In..." : "Sign In";
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

    function buildVerifyAccountUrl(email) {
        const helper = authHelper();
        if (helper && typeof helper.buildVerifyAccountUrl === "function") {
            return helper.buildVerifyAccountUrl(email, "login");
        }
        return "verify-account.html";
    }

    function applyInitialQueryState() {
        const helper = authHelper();
        const params = new URLSearchParams(window.location.search || "");
        const loginIdentifier = document.getElementById("loginIdentifier");
        const queryEmail = helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(params.get("email") || "")
            : (params.get("email") || "").toString().trim().toLowerCase();
        const pendingEmail = helper && typeof helper.readPendingVerificationEmail === "function"
            ? helper.readPendingVerificationEmail()
            : "";

        if (loginIdentifier && !loginIdentifier.value) {
            if (helper && helper.isValidEmail(queryEmail)) {
                loginIdentifier.value = queryEmail;
            } else if (helper && helper.isValidEmail(pendingEmail)) {
                loginIdentifier.value = pendingEmail;
            }
        }

        if (params.get("verified") === "1") {
            setStatus("Account verified successfully. Sign in to continue.", "alert-success");
            return;
        }
        if (params.get("registered") === "1") {
            setStatus("Registration successful. Sign in with your email and password.", "alert-success");
        }
    }

    async function fetchRoleAndRedirect(client, userId) {
        const { data, error } = await client
            .from("profiles")
            .select("role,is_active")
            .eq("id", userId)
            .single();

        if (error || !data || !data.role) {
            await client.auth.signOut();
            setStatus("Login failed: account role lookup failed. Contact administrator.", "alert-danger");
            return;
        }
        if (data.is_active === false) {
            await client.auth.signOut();
            setStatus("This account is inactive. Contact administrator.", "alert-danger");
            return;
        }

        const role = data.role;
        const route = ROLE_ROUTES[role];
        if (!route) {
            await client.auth.signOut();
            setStatus("Login failed: account role is not recognized.", "alert-danger");
            return;
        }
        const helper = authHelper();
        if (helper && typeof helper.clearPendingVerificationEmail === "function") {
            helper.clearPendingVerificationEmail();
        }
        window.location.replace(route);
    }

    async function onSubmitLogin(client, event) {
        event.preventDefault();
        setStatus("");

        const identifierInput = document.getElementById("loginIdentifier");
        const passwordInput = document.getElementById("loginPassword");
        const identifier = identifierInput ? identifierInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";
        const helper = authHelper();

        if (!identifier || !password) {
            setStatus("Please enter your email and password.", "alert-danger");
            return;
        }

        const normalizedEmail = helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(identifier)
            : identifier.toLowerCase();
        const isValidEmail = helper && typeof helper.isValidEmail === "function"
            ? helper.isValidEmail(normalizedEmail)
            : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
        if (!isValidEmail) {
            setStatus("Please enter a valid email address.", "alert-danger");
            return;
        }
        const payload = { email: normalizedEmail, password: password };

        setSubmitLoading(true);
        try {
            const { data, error } = await client.auth.signInWithPassword(payload);
            if (error) {
                if (
                    payload.email &&
                    helper &&
                    typeof helper.isEmailNotConfirmedError === "function" &&
                    helper.isEmailNotConfirmedError(error)
                ) {
                    if (typeof helper.rememberPendingVerificationEmail === "function") {
                        helper.rememberPendingVerificationEmail(payload.email);
                    }
                    window.location.replace(buildVerifyAccountUrl(payload.email));
                    return;
                }
                setStatus(helper.getErrorMessage(error, "Invalid login credentials."), "alert-danger");
                return;
            }
            if (!data || !data.user) {
                setStatus("Login failed: user session not returned.", "alert-danger");
                return;
            }
            await fetchRoleAndRedirect(client, data.user.id);
        } catch (err) {
            setStatus(helper.getErrorMessage(err, "Unexpected login error. Please try again."), "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    async function init() {
        const form = document.getElementById("loginForm");
        if (!form) {
            return;
        }
        bindPasswordToggle("loginPassword", "loginPasswordToggle");
        applyInitialQueryState();

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholderConfig = CONFIG_PLACEHOLDERS.some(function (token) {
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
        if (!url || !anonKey || hasPlaceholderConfig) {
            setStatus("Supabase config is not set. Update js/supabase-config.js first.", "alert-warning");
            return;
        }

        const client = window.supabase.createClient(url, anonKey);

        try {
            const { data } = await client.auth.getSession();
            if (data && data.session && data.session.user) {
                await fetchRoleAndRedirect(client, data.session.user.id);
                return;
            }
        } catch (err) {
            setStatus("Could not check current session. Continue by signing in.", "alert-warning");
        }

        form.addEventListener("submit", function (event) {
            onSubmitLogin(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
