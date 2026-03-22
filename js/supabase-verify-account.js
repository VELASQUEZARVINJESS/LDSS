(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const VERIFY_MESSAGES = {
        register: "Account created successfully. Enter the OTP code sent to your email to activate your LDSP account.",
        login: "Your account is not verified yet. Enter the latest OTP code sent to your email to continue.",
        default: "Check your spam or junk folder if the code does not arrive right away."
    };

    let resendController = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function authHelper() {
        return window.LDSSAuthEmailHelper || null;
    }

    function setStatus(message, type) {
        const el = byId("verifyStatus");
        if (!el) {
            return;
        }
        if (!message) {
            el.classList.add("d-none");
            el.classList.remove("alert-danger", "alert-warning", "alert-success", "alert-info");
            el.textContent = "";
            return;
        }
        el.textContent = message;
        el.classList.remove("d-none", "alert-danger", "alert-warning", "alert-success", "alert-info");
        el.classList.add(type || "alert-danger");
    }

    function setSubmitLoading(isLoading) {
        const btn = byId("verifySubmitBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Verifying..." : "Verify Account";
    }

    function sanitizeOtp(value) {
        return (value || "").toString().replace(/\D/g, "").slice(0, 6);
    }

    function buildLoginUrl(email, flags) {
        const target = new URL("login.html", window.location.href);
        const helper = authHelper();
        const normalizedEmail = helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(email)
            : (email || "").toString().trim().toLowerCase();

        if (normalizedEmail) {
            target.searchParams.set("email", normalizedEmail);
        }
        if (flags && flags.verified) {
            target.searchParams.set("verified", "1");
        }
        if (flags && flags.registered) {
            target.searchParams.set("registered", "1");
        }
        return target.toString();
    }

    function currentSource() {
        const params = new URLSearchParams(window.location.search || "");
        return (params.get("source") || "").toString().trim().toLowerCase();
    }

    function currentEmail() {
        const helper = authHelper();
        const emailInput = byId("verifyEmail");
        const inputValue = emailInput ? emailInput.value : "";
        return helper && typeof helper.normalizeEmailAddress === "function"
            ? helper.normalizeEmailAddress(inputValue)
            : (inputValue || "").toString().trim().toLowerCase();
    }

    function updateHelperCopy(source) {
        const helperText = byId("verifyHelperText");
        if (!helperText) {
            return;
        }
        helperText.textContent = VERIFY_MESSAGES[source] || VERIFY_MESSAGES.default;
    }

    function updateBackToLoginLink(email) {
        const link = byId("verifyBackToLoginLink");
        if (!link) {
            return;
        }
        link.href = buildLoginUrl(email);
    }

    function syncResendState() {
        const helper = authHelper();
        if (!helper || !resendController) {
            return;
        }
        const email = currentEmail();
        if (helper.isValidEmail(email)) {
            resendController.show(email);
            updateBackToLoginLink(email);
            return;
        }
        resendController.hide();
        updateBackToLoginLink("");
    }

    async function onSubmitVerify(client, event) {
        event.preventDefault();
        setStatus("");

        const helper = authHelper();
        const email = currentEmail();
        const otpInput = byId("verifyOtpCode");
        const otpCode = sanitizeOtp(otpInput ? otpInput.value : "");

        if (!helper.isValidEmail(email)) {
            setStatus("Enter a valid email address.", "alert-danger");
            return;
        }
        if (otpInput) {
            otpInput.value = otpCode;
        }
        if (otpCode.length !== 6) {
            setStatus("Enter the 6-digit OTP code sent to your email.", "alert-danger");
            return;
        }

        setSubmitLoading(true);
        try {
            const result = await client.auth.verifyOtp({
                email: email,
                token: otpCode,
                type: "email"
            });

            if (result.error) {
                setStatus(helper.getErrorMessage(result.error, "Invalid or expired OTP code. Please try again."), "alert-danger");
                return;
            }

            helper.clearPendingVerificationEmail();
            if (resendController) {
                resendController.hide();
            }
            setStatus("Account verified successfully. Redirecting to login...", "alert-success");
            window.setTimeout(function () {
                window.location.replace(buildLoginUrl(email, { verified: true }));
            }, 700);
        } catch (error) {
            setStatus(helper.getErrorMessage(error, "Verification failed. Please try again."), "alert-danger");
        } finally {
            setSubmitLoading(false);
        }
    }

    function bindEmailInput() {
        const emailInput = byId("verifyEmail");
        if (!emailInput) {
            return;
        }

        emailInput.addEventListener("input", function () {
            syncResendState();
        });
        emailInput.addEventListener("change", function () {
            syncResendState();
        });
    }

    function bindOtpInput() {
        const otpInput = byId("verifyOtpCode");
        if (!otpInput) {
            return;
        }

        otpInput.addEventListener("input", function () {
            otpInput.value = sanitizeOtp(otpInput.value);
        });
    }

    function initialEmailValue(helper) {
        const params = new URLSearchParams(window.location.search || "");
        const queryEmail = helper.normalizeEmailAddress(params.get("email") || "");
        if (helper.isValidEmail(queryEmail)) {
            return queryEmail;
        }

        const storedEmail = helper.readPendingVerificationEmail();
        if (helper.isValidEmail(storedEmail)) {
            return storedEmail;
        }
        return "";
    }

    function bindResendButton(client) {
        const resendBtn = resendController ? resendController.button() : null;
        if (!resendBtn) {
            return;
        }

        resendBtn.addEventListener("click", function () {
            const helper = authHelper();
            const email = currentEmail();

            resendController.request(client, email, {
                fallbackErrorMessage: "Failed to resend OTP code.",
                onMissingEmail: function () {
                    setStatus("Enter your email address first.", "alert-warning");
                },
                onCooldown: function (waitSeconds) {
                    setStatus(
                        "An OTP code was already requested. Check your inbox or wait " + waitSeconds + " seconds before requesting again.",
                        "alert-warning"
                    );
                },
                onError: function (message) {
                    setStatus(message, "alert-warning");
                },
                onSuccess: function () {
                    helper.rememberPendingVerificationEmail(email);
                    setStatus("A new OTP code has been sent. Check your inbox or spam folder.", "alert-success");
                    const otpInput = byId("verifyOtpCode");
                    if (otpInput) {
                        otpInput.focus();
                    }
                }
            });
        });
    }

    function showInitialMessage(helper, email) {
        const source = currentSource();
        if (email) {
            helper.rememberPendingVerificationEmail(email);
        }

        if (source === "register") {
            setStatus(VERIFY_MESSAGES.register, "alert-info");
            return;
        }
        if (source === "login") {
            setStatus(VERIFY_MESSAGES.login, "alert-warning");
        }
    }

    function initPrefill(helper) {
        const emailInput = byId("verifyEmail");
        const otpInput = byId("verifyOtpCode");
        const email = initialEmailValue(helper);

        if (emailInput && email) {
            emailInput.value = email;
        }
        updateBackToLoginLink(email);
        updateHelperCopy(currentSource());
        showInitialMessage(helper, email);
        syncResendState();

        if (otpInput && email) {
            otpInput.focus();
            return;
        }
        if (emailInput) {
            emailInput.focus();
        }
    }

    function init() {
        const form = byId("verifyForm");
        if (!form) {
            return;
        }

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholder = CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });
        const helper = authHelper();

        if (!window.supabase || !window.supabase.createClient) {
            setStatus("Supabase library failed to load. Check internet/CDN access.", "alert-danger");
            return;
        }
        if (!helper || typeof helper.createResendController !== "function") {
            setStatus("Auth email helper failed to load. Check js/supabase-auth-email-helper.js.", "alert-danger");
            return;
        }
        if (!url || !anonKey || hasPlaceholder) {
            setStatus("Supabase config is not set. Update js/supabase-config.js first.", "alert-warning");
            return;
        }

        const client = window.supabase.createClient(url, anonKey);
        resendController = helper.createResendController({
            wrapId: "verifyResendWrap",
            buttonId: "verifyResendBtn",
            storagePrefix: "ldss-verify-resend",
            idleLabel: "Resend OTP",
            loadingLabel: "Sending OTP...",
            setStatus: setStatus
        });

        bindEmailInput();
        bindOtpInput();
        bindResendButton(client);
        initPrefill(helper);

        form.addEventListener("submit", function (event) {
            onSubmitVerify(client, event);
        });
    }

    window.addEventListener("DOMContentLoaded", init);
})();
