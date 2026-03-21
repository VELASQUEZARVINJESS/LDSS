(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const ROLE_ROUTES = {
        applicant: "../APPLICANT/",
        secretary: "../SECRETARY/",
        admin: "../ADMIN/",
        super_admin: "../SYSTEMADMINISTRATOR/"
    };
    const DESKTOP_ONLY_ROLE_LABELS = {
        secretary: "Secretary",
        admin: "Admin",
        super_admin: "System Administrator"
    };
    const DESKTOP_ONLY_MIN_WIDTH = 992;
    let authRedirectInProgress = false;

    function roleRequiresDesktop(role) {
        return Object.prototype.hasOwnProperty.call(DESKTOP_ONLY_ROLE_LABELS, role || "");
    }

    function ensureDesktopOnlyStyles() {
        if (document.getElementById("ldssDesktopOnlyStyle")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "ldssDesktopOnlyStyle";
        style.textContent = [
            ".ldss-desktop-only-overlay{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:1.25rem;background:rgba(241,245,249,.97);backdrop-filter:blur(8px);}",
            ".ldss-desktop-only-card{width:min(100%,30rem);padding:1.75rem;border:1px solid #dde1e6;border-radius:1rem;background:#ffffff;box-shadow:0 1rem 2.5rem rgba(15,23,42,.12);text-align:center;}",
            ".ldss-desktop-only-badge{display:inline-flex;align-items:center;justify-content:center;padding:.35rem .75rem;border-radius:999px;background:#fff3e6;color:#b45309;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;}",
            ".ldss-desktop-only-title{margin:.9rem 0 .55rem;color:#1f2937;font-size:1.35rem;font-weight:700;line-height:1.3;}",
            ".ldss-desktop-only-copy{margin:0;color:#667085;font-size:.96rem;line-height:1.65;}",
            "body.ldss-desktop-only-active{overflow:hidden;}"
        ].join("");
        document.head.appendChild(style);
    }

    function ensureDesktopOnlyOverlay(role) {
        const roleLabel = DESKTOP_ONLY_ROLE_LABELS[role] || "Staff";
        let overlay = document.getElementById("ldssDesktopOnlyOverlay");
        if (overlay) {
            const title = document.getElementById("ldssDesktopOnlyTitle");
            if (title) {
                title.textContent = roleLabel + " pages are available on desktop only";
            }
            return overlay;
        }

        overlay = document.createElement("div");
        overlay.id = "ldssDesktopOnlyOverlay";
        overlay.className = "ldss-desktop-only-overlay d-none";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "ldssDesktopOnlyTitle");
        overlay.innerHTML = [
            '<div class="ldss-desktop-only-card">',
            '<div class="ldss-desktop-only-badge">Desktop Only</div>',
            '<h1 class="ldss-desktop-only-title" id="ldssDesktopOnlyTitle">' + roleLabel + " pages are available on desktop only</h1>",
            '<p class="ldss-desktop-only-copy">Please open this page on a laptop or desktop browser. Staff tools are hidden on phone screens to keep review, approval, and records work readable and secure.</p>',
            "</div>"
        ].join("");
        document.body.appendChild(overlay);
        return overlay;
    }

    function setupDesktopOnlyGuard(role) {
        if (!roleRequiresDesktop(role)) {
            return;
        }

        const applyState = function () {
            const body = document.body;
            if (!body) {
                return;
            }
            ensureDesktopOnlyStyles();
            const overlay = ensureDesktopOnlyOverlay(role);
            const blocked = window.innerWidth < DESKTOP_ONLY_MIN_WIDTH;
            overlay.classList.toggle("d-none", !blocked);
            body.classList.toggle("ldss-desktop-only-active", blocked);
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", applyState, { once: true });
        } else {
            applyState();
        }

        window.addEventListener("resize", applyState);
        window.addEventListener("orientationchange", applyState);
    }

    function hasPlaceholderConfig(url, anonKey) {
        return CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });
    }

    function showGuardError(message) {
        const body = document.body;
        if (!body) {
            return;
        }
        let box = document.getElementById("ldssAuthGuardStatus");
        if (!box) {
            box = document.createElement("div");
            box.id = "ldssAuthGuardStatus";
            box.className = "alert alert-warning m-3";
            body.prepend(box);
        }
        box.textContent = message;
    }

    async function failClosed(client, message, options) {
        if (authRedirectInProgress) {
            return null;
        }
        authRedirectInProgress = true;
        showGuardError(message);
        try {
            if (
                (!options || options.signOut !== false) &&
                client &&
                client.auth &&
                typeof client.auth.signOut === "function"
            ) {
                await client.auth.signOut();
            }
        } catch (error) {
            // Ignore signout failure and continue redirect.
        }
        window.location.replace("../login.html");
        return null;
    }

    function bindAuthStateMonitor(client, expectedUserId) {
        if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") {
            return;
        }

        let handled = false;
        client.auth.onAuthStateChange(function (_event, nextSession) {
            if (handled || authRedirectInProgress) {
                return;
            }

            if (!nextSession || !nextSession.user) {
                handled = true;
                failClosed(null, "Your session has ended. Please sign in again.", { signOut: false });
                return;
            }

            if (expectedUserId && nextSession.user.id !== expectedUserId) {
                handled = true;
                failClosed(null, "Your signed-in account changed. Please sign in again.", { signOut: false });
            }
        });
    }

    async function guardApplicant() {
        const requiredRole = window.LDSS_REQUIRED_ROLE || "applicant";
        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";

        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            return failClosed(null, "Supabase library failed to load.");
        }
        if (!url || !anonKey || hasPlaceholderConfig(url, anonKey)) {
            return failClosed(null, "Supabase config is missing. Update js/supabase-config.js.");
        }

        const client = window.supabase.createClient(url, anonKey);
        const sessionResult = await client.auth.getSession();
        const session = sessionResult && sessionResult.data ? sessionResult.data.session : null;

        if (!session || !session.user) {
            return failClosed(client, "No active session found.");
        }

        const roleResult = await client
            .from("profiles")
            .select("role,is_active")
            .eq("id", session.user.id)
            .single();

        if (
            roleResult.error ||
            !roleResult.data ||
            !roleResult.data.role
        ) {
            return failClosed(client, "Profile role lookup failed.");
        }
        if (roleResult.data.is_active === false) {
            return failClosed(client, "Account is inactive.");
        }

        const role = roleResult.data.role;
        if (role !== requiredRole) {
            const redirect = ROLE_ROUTES[role] || "../login.html";
            window.location.replace(redirect);
            return null;
        }

        setupDesktopOnlyGuard(role);
        bindAuthStateMonitor(client, session.user.id);

        const authContext = {
            client: client,
            user: session.user,
            role: role
        };
        window.ldssAuthContext = authContext;
        return authContext;
    }

    window.ldssAuthReadyPromise = guardApplicant()
        .then(function (context) {
            if (context) {
                document.dispatchEvent(new CustomEvent("ldss:auth-ready", { detail: context }));
            }
            return context;
        })
        .catch(function () {
            window.location.replace("../login.html");
            return null;
        });
})();
