(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];
    const ROLE_ROUTES = {
        applicant: "../APPLICANT/",
        secretary: "../SECRETARY/",
        admin: "../ADMIN/",
        super_admin: "../SYSTEMADMINISTRATOR/"
    };

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

    async function failClosed(client, message) {
        showGuardError(message);
        try {
            if (client && client.auth && typeof client.auth.signOut === "function") {
                await client.auth.signOut();
            }
        } catch (error) {
            // Ignore signout failure and continue redirect.
        }
        window.location.replace("../login.html");
        return null;
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
