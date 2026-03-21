(function () {
    "use strict";

    const ROLE_ROUTES = {
        applicant: "APPLICANT/",
        secretary: "SECRETARY/",
        admin: "ADMIN/",
        super_admin: "SYSTEMADMINISTRATOR/"
    };

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    let resendController = null;

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
            setStatus("Please enter your email/mobile and password.", "alert-danger");
            return;
        }

        const isEmail = helper && typeof helper.looksLikeEmail === "function"
            ? helper.looksLikeEmail(identifier)
            : identifier.includes("@");
        let payload;
        if (isEmail) {
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
            payload = { email: normalizedEmail, password: password };
        } else {
            const normalizedPhone = helper && typeof helper.normalizePhoneNumber === "function"
                ? helper.normalizePhoneNumber(identifier)
                : identifier;
            if (!normalizedPhone) {
                setStatus("Please enter a valid email address or mobile number.", "alert-danger");
                return;
            }
            payload = { phone: normalizedPhone, password: password };
        }

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
                    await resendController.request(client, payload.email, {
                        automatic: true,
                        fallbackErrorMessage: "Failed to resend confirmation email.",
                        onCooldown: function (waitSeconds) {
                            setStatus(
                                "Your account is not verified yet. A confirmation email was already requested. Check your inbox or wait " + waitSeconds + " seconds before requesting again.",
                                "alert-warning"
                            );
                        },
                        onError: function (message) {
                            setStatus("Your account is not verified yet. " + message, "alert-warning");
                        },
                        onSuccess: function (context) {
                            setStatus(
                                context.automatic
                                    ? "Your account is not verified yet. A new confirmation email has been sent automatically. Check your inbox or spam folder, then confirm before signing in."
                                    : "A new confirmation email has been sent. Check your inbox or spam folder, then confirm before signing in.",
                                "alert-warning"
                            );
                        }
                    });
                    return;
                }
                resendController.hide();
                setStatus(helper.getErrorMessage(error, "Invalid login credentials."), "alert-danger");
                return;
            }
            if (!data || !data.user) {
                resendController.hide();
                setStatus("Login failed: user session not returned.", "alert-danger");
                return;
            }
            resendController.hide();
            await fetchRoleAndRedirect(client, data.user.id);
        } catch (err) {
            resendController.hide();
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

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholderConfig = CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });

        if (!window.supabase || !window.supabase.createClient) {
            setStatus("Supabase library failed to load. Check internet/CDN access.", "alert-danger");
            return;
        }
        if (!window.LDSSAuthEmailHelper || !window.LDSSAuthEmailHelper.createResendController) {
            setStatus("Auth email helper failed to load. Check js/supabase-auth-email-helper.js.", "alert-danger");
            return;
        }
        if (!url || !anonKey || hasPlaceholderConfig) {
            setStatus("Supabase config is not set. Update js/supabase-config.js first.", "alert-warning");
            return;
        }

        const client = window.supabase.createClient(url, anonKey);
        resendController = window.LDSSAuthEmailHelper.createResendController({
            wrapId: "loginResendWrap",
            buttonId: "loginResendBtn",
            storagePrefix: "ldss-login-resend",
            idleLabel: "Resend Verification Email",
            loadingLabel: "Sending Confirmation...",
            setStatus: setStatus
        });
        const resendBtn = resendController.button();
        if (resendBtn) {
            resendBtn.addEventListener("click", function () {
                const email = (resendBtn.dataset.email || "").trim().toLowerCase();
                if (!email) {
                    setStatus("Enter your email first, then try signing in again.", "alert-warning");
                    return;
                }
                resendController.request(client, email, {
                    automatic: false,
                    fallbackErrorMessage: "Failed to resend confirmation email.",
                    onCooldown: function (waitSeconds) {
                        setStatus(
                            "Your account is not verified yet. A confirmation email was already requested. Check your inbox or wait " + waitSeconds + " seconds before requesting again.",
                            "alert-warning"
                        );
                    },
                    onError: function (message) {
                        setStatus("Your account is not verified yet. " + message, "alert-warning");
                    },
                    onSuccess: function () {
                        setStatus("A new confirmation email has been sent. Check your inbox or spam folder, then confirm before signing in.", "alert-warning");
                    }
                });
            });
        }

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
