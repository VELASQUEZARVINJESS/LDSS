(function () {
    "use strict";

    const ROLE_ROUTES = {
        applicant: "APPLICANT/",
        secretary: "SECRETARY/",
        admin: "ADMIN/",
        super_admin: "SYSTEMADMINISTRATOR/"
    };

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];

    function normalizePhone(identifier) {
        const cleaned = (identifier || "").replace(/[\s()-]/g, "");
        const digitsOnly = cleaned.replace(/\D/g, "");

        if (/^09\d{9}$/.test(digitsOnly)) {
            return "+63" + digitsOnly.slice(1);
        }
        if (/^9\d{9}$/.test(digitsOnly)) {
            return "+63" + digitsOnly;
        }
        if (/^63\d{10}$/.test(digitsOnly)) {
            return "+" + digitsOnly;
        }
        if (/^\+63\d{10}$/.test(cleaned)) {
            return cleaned;
        }
        if (/^\+\d{10,15}$/.test(cleaned)) {
            return cleaned;
        }
        return cleaned;
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

    async function fetchRoleAndRedirect(client, userId) {
        const { data, error } = await client
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .single();

        if (error) {
            setStatus("Login succeeded, but profile role lookup failed. Contact administrator.", "alert-warning");
            return;
        }

        const role = (data && data.role) || "applicant";
        const route = ROLE_ROUTES[role] || ROLE_ROUTES.applicant;
        window.location.href = route;
    }

    async function onSubmitLogin(client, event) {
        event.preventDefault();
        setStatus("");

        const identifierInput = document.getElementById("loginIdentifier");
        const passwordInput = document.getElementById("loginPassword");
        const identifier = identifierInput ? identifierInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!identifier || !password) {
            setStatus("Please enter your email/mobile and password.", "alert-danger");
            return;
        }

        const isEmail = identifier.includes("@");
        const payload = isEmail
            ? { email: identifier.toLowerCase(), password: password }
            : { phone: normalizePhone(identifier), password: password };

        setSubmitLoading(true);
        try {
            const { data, error } = await client.auth.signInWithPassword(payload);
            if (error) {
                setStatus(error.message || "Invalid login credentials.", "alert-danger");
                return;
            }
            if (!data || !data.user) {
                setStatus("Login failed: user session not returned.", "alert-danger");
                return;
            }
            await fetchRoleAndRedirect(client, data.user.id);
        } catch (err) {
            setStatus("Unexpected login error. Please try again.", "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    async function init() {
        const form = document.getElementById("loginForm");
        if (!form) {
            return;
        }

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholderConfig = CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });

        if (!window.supabase || !window.supabase.createClient) {
            setStatus("Supabase library failed to load. Check internet/CDN access.", "alert-danger");
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
