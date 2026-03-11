// LDSP Supabase Client Config
// TODO(Supabase): replace placeholder values with your actual Supabase project URL and anon key.
window.LDSS_SUPABASE_URL = window.LDSS_SUPABASE_URL || "https://rfzqifloaixrtseqzrzk.supabase.co";
window.LDSS_SUPABASE_ANON_KEY = window.LDSS_SUPABASE_ANON_KEY || "sb_publishable_ysa32dk9v2Vcps9KQSR2Rg_F0w9TftL";
window.LDSS_STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";

(function () {
    if (window.LDSS_UPLOAD_API_BASE) {
        return;
    }

    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "";
    const port = window.location.port || "";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isLocalFile = protocol === "file:";

    if ((isLocalHost || isLocalFile) && port !== "3000") {
        const localHost = hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
        const localProtocol = protocol === "https:" ? "https:" : "http:";
        window.LDSS_UPLOAD_API_BASE = localProtocol + "//" + localHost + ":3000/api/uploads";
        return;
    }

    window.LDSS_UPLOAD_API_BASE = "/api/uploads";
})();

