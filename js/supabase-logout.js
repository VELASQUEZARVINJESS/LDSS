(function () {
    "use strict";

    function setStatus(message) {
        const statusEl = document.getElementById("logoutStatus");
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    async function signOutAndRedirect() {
        try {
            if (
                window.supabase &&
                typeof window.supabase.createClient === "function" &&
                window.LDSS_SUPABASE_URL &&
                window.LDSS_SUPABASE_ANON_KEY
            ) {
                const client = window.supabase.createClient(window.LDSS_SUPABASE_URL, window.LDSS_SUPABASE_ANON_KEY);
                await client.auth.signOut();
            }
        } catch (error) {
            setStatus("Session sign-out encountered an issue. Redirecting...");
        }

        window.location.replace("login.html");
    }

    window.addEventListener("DOMContentLoaded", signOutAndRedirect);
})();
