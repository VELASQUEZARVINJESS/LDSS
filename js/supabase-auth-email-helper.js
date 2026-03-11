(function () {
    "use strict";

    const DEFAULT_PRODUCTION_LOGIN_URL = "https://iskolarngdaet.app/login.html";
    const DEFAULT_COOLDOWN_MS = 60 * 1000;

    function getErrorMessage(error, fallbackMessage) {
        if (!error) {
            return fallbackMessage;
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

    function resolveEmailConfirmRedirectUrl(defaultUrl) {
        const configured = (window.LDSS_EMAIL_CONFIRM_REDIRECT_URL || "").toString().trim();
        if (configured) {
            return configured;
        }

        const protocol = (window.location.protocol || "").toString().trim().toLowerCase();
        const hostname = (window.location.hostname || "").toString().trim().toLowerCase();
        const origin = (window.location.origin || "").toString().trim().replace(/\/+$/, "");
        const isLocal = protocol === "file:" || hostname === "localhost" || hostname === "127.0.0.1";

        if (!isLocal && /^https?:\/\//i.test(origin)) {
            return origin + "/login.html";
        }

        return defaultUrl || DEFAULT_PRODUCTION_LOGIN_URL;
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
            const lowerEmail = (email || "").trim().toLowerCase();
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
        getErrorMessage: getErrorMessage,
        isEmailNotConfirmedError: isEmailNotConfirmedError,
        resolveEmailConfirmRedirectUrl: resolveEmailConfirmRedirectUrl
    };
})();
