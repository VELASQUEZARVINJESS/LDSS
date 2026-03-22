(function () {
    "use strict";

    const DEFAULT_PRODUCTION_LOGIN_URL = "https://daet-scholarship.gt.tc/login.html";
    const DEFAULT_PRODUCTION_RESET_URL = "https://daet-scholarship.gt.tc/reset-password.html";
    const DEFAULT_PRODUCTION_VERIFY_URL = "https://daet-scholarship.gt.tc/verify-account.html";
    const DEFAULT_COOLDOWN_MS = 60 * 1000;
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PENDING_VERIFICATION_EMAIL_STORAGE_KEY = "ldss-pending-verification-email";

    function getErrorMessage(error, fallbackMessage) {
        if (!error) {
            return fallbackMessage;
        }
        const combinedText = [
            error && error.code ? error.code : "",
            error && error.message ? error.message : "",
            error && error.error_description ? error.error_description : ""
        ].join(" ").toLowerCase();
        if (combinedText.includes("rate") && combinedText.includes("email")) {
            return "Email rate limit exceeded. Wait at least 60 seconds, then try again.";
        }
        if (typeof error === "string" && error.trim()) {
            return error.trim();
        }
        if (typeof error.message === "string" && error.message.trim()) {
            return error.message.trim();
        }
        if (typeof error.error_description === "string" && error.error_description.trim()) {
            return error.error_description.trim();
        }
        if (typeof error.code === "string" && error.code.trim()) {
            return error.code.trim();
        }
        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== "{}") {
                return serialized;
            }
        } catch (serializationError) {
            // Ignore serialization issue and use fallback.
        }
        return fallbackMessage;
    }

    function currentOrigin() {
        const protocol = (window.location.protocol || "").toString().trim().toLowerCase();
        const hostname = (window.location.hostname || "").toString().trim().toLowerCase();
        const origin = (window.location.origin || "").toString().trim().replace(/\/+$/, "");

        if ((protocol === "http:" || protocol === "https:") && /^https?:\/\//i.test(origin) && hostname) {
            return origin;
        }
        return "";
    }

    function resolveOriginPath(pathname, fallbackUrl) {
        const origin = currentOrigin();
        const normalizedPath = (pathname || "").toString().trim() || "/";
        if (origin) {
            return origin + (normalizedPath.startsWith("/") ? normalizedPath : "/" + normalizedPath);
        }
        return fallbackUrl || "";
    }

    function resolveEmailConfirmRedirectUrl(defaultUrl) {
        const configured = (window.LDSS_EMAIL_CONFIRM_REDIRECT_URL || "").toString().trim();
        if (configured) {
            return configured;
        }
        return resolveOriginPath("/login.html", defaultUrl || DEFAULT_PRODUCTION_LOGIN_URL);
    }

    function resolvePasswordResetRedirectUrl(defaultUrl) {
        const configured = (window.LDSS_PASSWORD_RESET_REDIRECT_URL || "").toString().trim();
        if (configured) {
            return configured;
        }
        return resolveOriginPath("/reset-password.html", defaultUrl || DEFAULT_PRODUCTION_RESET_URL);
    }

    function resolveVerifyAccountUrl(defaultUrl) {
        const configured = (window.LDSS_VERIFY_ACCOUNT_URL || "").toString().trim();
        if (configured) {
            return configured;
        }
        return resolveOriginPath("/verify-account.html", defaultUrl || DEFAULT_PRODUCTION_VERIFY_URL);
    }

    function normalizeEmailAddress(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    function looksLikeEmail(value) {
        return (value || "").toString().includes("@");
    }

    function isValidEmail(value) {
        return EMAIL_PATTERN.test(normalizeEmailAddress(value));
    }

    function normalizePhoneNumber(value) {
        const raw = (value || "").toString().trim();
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

    function rememberPendingVerificationEmail(email) {
        if (!window.sessionStorage) {
            return;
        }
        const normalizedEmail = normalizeEmailAddress(email);
        if (!normalizedEmail) {
            window.sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY, normalizedEmail);
    }

    function readPendingVerificationEmail() {
        if (!window.sessionStorage) {
            return "";
        }
        return normalizeEmailAddress(window.sessionStorage.getItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY) || "");
    }

    function clearPendingVerificationEmail() {
        if (!window.sessionStorage) {
            return;
        }
        window.sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL_STORAGE_KEY);
    }

    function buildVerifyAccountUrl(email, source) {
        const target = new URL(resolveVerifyAccountUrl(DEFAULT_PRODUCTION_VERIFY_URL), window.location.href);
        const normalizedEmail = normalizeEmailAddress(email);
        const normalizedSource = (source || "").toString().trim();

        if (normalizedEmail) {
            target.searchParams.set("email", normalizedEmail);
        }
        if (normalizedSource) {
            target.searchParams.set("source", normalizedSource);
        }
        return target.toString();
    }

    function isEmailNotConfirmedError(error) {
        const text = [
            error && error.code ? error.code : "",
            error && error.message ? error.message : "",
            error && error.error_description ? error.error_description : ""
        ].join(" ").toLowerCase();

        return text.includes("not confirmed") || text.includes("email_not_confirmed");
    }

    function createResendController(config) {
        const wrapId = config && config.wrapId ? config.wrapId : "";
        const buttonId = config && config.buttonId ? config.buttonId : "";
        const storagePrefix = config && config.storagePrefix ? config.storagePrefix : "ldss-resend";
        const idleLabel = config && config.idleLabel ? config.idleLabel : "Resend Confirmation Email";
        const loadingLabel = config && config.loadingLabel ? config.loadingLabel : "Sending Confirmation...";
        const cooldownMs = config && Number(config.cooldownMs) > 0 ? Number(config.cooldownMs) : DEFAULT_COOLDOWN_MS;
        const defaultRedirectUrl = config && config.defaultRedirectUrl ? config.defaultRedirectUrl : DEFAULT_PRODUCTION_LOGIN_URL;
        const setStatus = config && typeof config.setStatus === "function" ? config.setStatus : function () {};

        let timer = null;

        function wrap() {
            return document.getElementById(wrapId);
        }

        function button() {
            return document.getElementById(buttonId);
        }

        function clearTimer() {
            if (timer) {
                window.clearInterval(timer);
                timer = null;
            }
        }

        function setLoading(isLoading, label) {
            const btn = button();
            if (!btn) {
                return;
            }
            btn.disabled = !!isLoading;
            btn.textContent = label || (isLoading ? loadingLabel : idleLabel);
        }

        function storageKey(email) {
            return storagePrefix + ":" + (email || "").toLowerCase();
        }

        function getCooldownUntil(email) {
            if (!email || !window.sessionStorage) {
                return 0;
            }
            const raw = window.sessionStorage.getItem(storageKey(email));
            const parsed = Number(raw || 0);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function setCooldown(email, until) {
            if (!email || !window.sessionStorage) {
                return;
            }
            window.sessionStorage.setItem(storageKey(email), String(until || 0));
        }

        function hide() {
            const wrapEl = wrap();
            const btn = button();
            if (wrapEl) {
                wrapEl.classList.add("d-none");
            }
            if (btn) {
                btn.dataset.email = "";
                btn.textContent = idleLabel;
                btn.disabled = false;
            }
            clearTimer();
        }

        function sync(email) {
            const wrapEl = wrap();
            const btn = button();
            if (!wrapEl || !btn || !email) {
                hide();
                return;
            }

            const cooldownUntil = getCooldownUntil(email);
            const remainingMs = cooldownUntil - Date.now();

            wrapEl.classList.remove("d-none");
            btn.dataset.email = email;

            if (remainingMs > 0) {
                const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
                btn.disabled = true;
                btn.textContent = "Resend Available In " + remainingSeconds + "s";
                return;
            }

            btn.disabled = false;
            btn.textContent = idleLabel;
        }

        function show(email) {
            if (!email) {
                hide();
                return;
            }

            sync(email);
            clearTimer();
            timer = window.setInterval(function () {
                const remainingMs = getCooldownUntil(email) - Date.now();
                sync(email);
                if (remainingMs <= 0) {
                    clearTimer();
                }
            }, 1000);
        }

        async function request(client, email, options) {
            const lowerEmail = normalizeEmailAddress(email);
            const automatic = !!(options && options.automatic);
            const fallbackErrorMessage = options && options.fallbackErrorMessage
                ? options.fallbackErrorMessage
                : "Failed to resend confirmation email.";

            if (!lowerEmail) {
                if (options && typeof options.onMissingEmail === "function") {
                    options.onMissingEmail();
                } else {
                    setStatus("Enter your email address first.", "alert-warning");
                }
                return { ok: false, reason: "missing_email" };
            }

            const cooldownUntil = getCooldownUntil(lowerEmail);
            if (cooldownUntil > Date.now()) {
                const waitSeconds = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
                if (options && typeof options.onCooldown === "function") {
                    options.onCooldown(waitSeconds, { automatic: automatic, email: lowerEmail });
                }
                show(lowerEmail);
                return { ok: false, reason: "cooldown" };
            }

            setLoading(true);
            try {
                const { error } = await client.auth.resend({
                    type: "signup",
                    email: lowerEmail,
                    options: {
                        emailRedirectTo: resolveEmailConfirmRedirectUrl(defaultRedirectUrl)
                    }
                });

                if (error) {
                    const errorMessage = getErrorMessage(error, fallbackErrorMessage);
                    if (options && typeof options.onError === "function") {
                        options.onError(errorMessage, { automatic: automatic, email: lowerEmail, error: error });
                    } else {
                        setStatus(errorMessage, "alert-warning");
                    }
                    show(lowerEmail);
                    return { ok: false, reason: "error", error: error };
                }

                setCooldown(lowerEmail, Date.now() + cooldownMs);
                if (options && typeof options.onSuccess === "function") {
                    options.onSuccess({ automatic: automatic, email: lowerEmail });
                }
                show(lowerEmail);
                return { ok: true };
            } catch (err) {
                const errorMessage = getErrorMessage(err, fallbackErrorMessage);
                if (options && typeof options.onError === "function") {
                    options.onError(errorMessage, { automatic: automatic, email: lowerEmail, error: err });
                } else {
                    setStatus(errorMessage, "alert-warning");
                }
                show(lowerEmail);
                return { ok: false, reason: "error", error: err };
            } finally {
                sync(lowerEmail);
            }
        }

        return {
            button: button,
            hide: hide,
            request: request,
            show: show
        };
    }

    window.LDSSAuthEmailHelper = {
        createResendController: createResendController,
        buildVerifyAccountUrl: buildVerifyAccountUrl,
        clearPendingVerificationEmail: clearPendingVerificationEmail,
        getErrorMessage: getErrorMessage,
        isEmailNotConfirmedError: isEmailNotConfirmedError,
        isValidEmail: isValidEmail,
        looksLikeEmail: looksLikeEmail,
        normalizeEmailAddress: normalizeEmailAddress,
        normalizePhoneNumber: normalizePhoneNumber,
        readPendingVerificationEmail: readPendingVerificationEmail,
        rememberPendingVerificationEmail: rememberPendingVerificationEmail,
        resolveEmailConfirmRedirectUrl: resolveEmailConfirmRedirectUrl,
        resolveVerifyAccountUrl: resolveVerifyAccountUrl,
        resolvePasswordResetRedirectUrl: resolvePasswordResetRedirectUrl
    };
})();
