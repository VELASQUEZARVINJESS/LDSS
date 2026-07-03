// LDSP Supabase Client Config
// TODO(Supabase): replace placeholder values with your actual Supabase project URL and anon key.
window.LDSS_SUPABASE_URL = window.LDSS_SUPABASE_URL || "https://rfzqifloaixrtseqzrzk.supabase.co";
window.LDSS_SUPABASE_ANON_KEY = window.LDSS_SUPABASE_ANON_KEY || "sb_publishable_ysa32dk9v2Vcps9KQSR2Rg_F0w9TftL";
window.LDSS_STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";

(function () {
    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "";
    const port = window.location.port || "";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isLocalFile = protocol === "file:";

    if (typeof window.LDSS_USE_HOSTED_UPLOADS !== "boolean") {
        window.LDSS_USE_HOSTED_UPLOADS = !isLocalHost && !isLocalFile;
    }

    if (window.LDSS_UPLOAD_API_BASE) {
        return;
    }

    if ((isLocalHost || isLocalFile) && port !== "3000") {
        const localHost = hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
        const localProtocol = protocol === "https:" ? "https:" : "http:";
        window.LDSS_UPLOAD_API_BASE = localProtocol + "//" + localHost + ":3000/api/uploads";
        return;
    }

    window.LDSS_UPLOAD_API_BASE = "/api/uploads";
})();

(function () {
    const protocol = window.location.protocol || "http:";
    const hostname = window.location.hostname || "";
    const port = window.location.port || "";
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    const isLocalFile = protocol === "file:";

    if (window.LDSS_AUTH_API_BASE) {
        return;
    }

    if ((isLocalHost || isLocalFile) && port !== "3000") {
        const localHost = hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
        const localProtocol = protocol === "https:" ? "https:" : "http:";
        window.LDSS_AUTH_API_BASE = localProtocol + "//" + localHost + ":3000/api/auth";
        return;
    }

    window.LDSS_AUTH_API_BASE = "/api/auth";
})();

(function () {
    const AUTH_STORAGE_MODE_KEY = "ldss-auth-storage-mode";
    const AUTH_STORAGE_MODE_LOCAL = "local";
    const AUTH_STORAGE_MODE_SESSION = "session";
    const STORAGE_PROBE_KEY = "__ldss-storage-probe";
    const memoryStorageState = {};

    // Keep auth session storage aligned with the login page "Remember me" choice.

    function createMemoryStorage() {
        return {
            getItem: function (key) {
                return Object.prototype.hasOwnProperty.call(memoryStorageState, key)
                    ? memoryStorageState[key]
                    : null;
            },
            setItem: function (key, value) {
                memoryStorageState[key] = String(value);
            },
            removeItem: function (key) {
                delete memoryStorageState[key];
            }
        };
    }

    const memoryStorage = createMemoryStorage();

    function safeStorage(candidate) {
        if (!candidate) {
            return null;
        }
        try {
            candidate.setItem(STORAGE_PROBE_KEY, STORAGE_PROBE_KEY);
            candidate.removeItem(STORAGE_PROBE_KEY);
            return candidate;
        } catch (error) {
            return null;
        }
    }

    function localStorageRef() {
        return safeStorage(window.localStorage);
    }

    function sessionStorageRef() {
        return safeStorage(window.sessionStorage);
    }

    function normalizeStorageMode(value) {
        return value === AUTH_STORAGE_MODE_SESSION
            ? AUTH_STORAGE_MODE_SESSION
            : AUTH_STORAGE_MODE_LOCAL;
    }

    function readExplicitStorageMode() {
        const sessionStore = sessionStorageRef();
        const localStore = localStorageRef();
        const sessionMode = sessionStore ? sessionStore.getItem(AUTH_STORAGE_MODE_KEY) : "";
        if (sessionMode === AUTH_STORAGE_MODE_SESSION) {
            return AUTH_STORAGE_MODE_SESSION;
        }
        const localMode = localStore ? localStore.getItem(AUTH_STORAGE_MODE_KEY) : "";
        if (localMode === AUTH_STORAGE_MODE_LOCAL) {
            return AUTH_STORAGE_MODE_LOCAL;
        }
        return "";
    }

    function getAuthStorageMode() {
        return readExplicitStorageMode() || AUTH_STORAGE_MODE_LOCAL;
    }

    function resolveStorageByMode(mode) {
        const normalizedMode = normalizeStorageMode(mode);
        if (normalizedMode === AUTH_STORAGE_MODE_SESSION) {
            return sessionStorageRef() || localStorageRef() || memoryStorage;
        }
        return localStorageRef() || sessionStorageRef() || memoryStorage;
    }

    function secondaryStorage(mode) {
        const normalizedMode = normalizeStorageMode(mode);
        if (normalizedMode === AUTH_STORAGE_MODE_SESSION) {
            return localStorageRef();
        }
        return sessionStorageRef();
    }

    function setAuthStorageMode(mode) {
        const normalizedMode = normalizeStorageMode(mode);
        const sessionStore = sessionStorageRef();
        const localStore = localStorageRef();

        if (normalizedMode === AUTH_STORAGE_MODE_SESSION) {
            if (sessionStore) {
                sessionStore.setItem(AUTH_STORAGE_MODE_KEY, AUTH_STORAGE_MODE_SESSION);
            }
            if (localStore) {
                localStore.removeItem(AUTH_STORAGE_MODE_KEY);
            }
            return sessionStore ? AUTH_STORAGE_MODE_SESSION : AUTH_STORAGE_MODE_LOCAL;
        }

        if (localStore) {
            localStore.setItem(AUTH_STORAGE_MODE_KEY, AUTH_STORAGE_MODE_LOCAL);
        }
        if (sessionStore) {
            sessionStore.removeItem(AUTH_STORAGE_MODE_KEY);
        }
        return localStore ? AUTH_STORAGE_MODE_LOCAL : AUTH_STORAGE_MODE_SESSION;
    }

    function authStorageGetItem(key) {
        const mode = getAuthStorageMode();
        const primaryStore = resolveStorageByMode(mode);
        const primaryValue = primaryStore.getItem(key);

        if (primaryValue !== null && typeof primaryValue !== "undefined") {
            return primaryValue;
        }

        const secondaryStore = secondaryStorage(mode);
        if (secondaryStore) {
            return secondaryStore.getItem(key);
        }
        return null;
    }

    function authStorageSetItem(key, value) {
        const mode = getAuthStorageMode();
        const primaryStore = resolveStorageByMode(mode);
        const secondaryStore = secondaryStorage(mode);

        primaryStore.setItem(key, value);
        if (secondaryStore) {
            secondaryStore.removeItem(key);
        }
    }

    function authStorageRemoveItem(key) {
        const primaryStore = resolveStorageByMode(getAuthStorageMode());
        const localStore = localStorageRef();
        const sessionStore = sessionStorageRef();

        primaryStore.removeItem(key);
        if (localStore) {
            localStore.removeItem(key);
        }
        if (sessionStore) {
            sessionStore.removeItem(key);
        }
        memoryStorage.removeItem(key);
    }

    function mergeSupabaseClientOptions(options) {
        const nextOptions = Object.assign({}, options || {});
        const authOptions = Object.assign({}, nextOptions.auth || {});

        if (!authOptions.storage) {
            authOptions.storage = {
                getItem: authStorageGetItem,
                setItem: authStorageSetItem,
                removeItem: authStorageRemoveItem
            };
        }
        if (typeof authOptions.persistSession === "undefined") {
            authOptions.persistSession = true;
        }

        nextOptions.auth = authOptions;
        return nextOptions;
    }

    function patchSupabaseCreateClient() {
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            return;
        }
        if (window.supabase.__ldssCreateClientPatched) {
            return;
        }

        const originalCreateClient = window.supabase.createClient.bind(window.supabase);
        window.supabase.createClient = function (url, anonKey, options) {
            return originalCreateClient(url, anonKey, mergeSupabaseClientOptions(options));
        };
        window.supabase.__ldssCreateClientPatched = true;
    }

    window.LDSSAuthStorage = {
        getMode: getAuthStorageMode,
        setMode: setAuthStorageMode
    };

    patchSupabaseCreateClient();
})();

