(function () {
    "use strict";

    const API_BASE = (window.LDSS_UPLOAD_API_BASE || "/api/uploads").replace(/\/+$/, "");
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";

    function isHostedPath(storedPath) {
        return /^uploads\//i.test((storedPath || "").toString().trim());
    }

    async function getAccessToken(context) {
        if (!context || !context.client || !context.client.auth || typeof context.client.auth.getSession !== "function") {
            throw new Error("Supabase session is not available.");
        }

        const result = await context.client.auth.getSession();
        const session = result && result.data ? result.data.session : null;
        const token = session && session.access_token ? session.access_token : "";
        if (!token) {
            throw new Error("No active access token found.");
        }
        return token;
    }

    async function request(context, relativePath, options) {
        const token = await getAccessToken(context);
        const fetchOptions = Object.assign({ method: "GET" }, options || {});
        const headers = new Headers(fetchOptions.headers || {});
        headers.set("Authorization", "Bearer " + token);

        fetchOptions.headers = headers;

        const response = await fetch(API_BASE + relativePath, fetchOptions);
        if (response.ok) {
            return response;
        }

        let message = "Upload server request failed.";
        let responseText = "";
        try {
            responseText = await response.text();
            if (responseText) {
                const payload = JSON.parse(responseText);
                if (payload && payload.error) {
                    message = payload.error;
                }
            }
        } catch (error) {
            // Ignore parse failure and keep default message.
        }

        if (response.status === 413) {
            message = "File exceeds the 10MB upload limit.";
        } else if (response.status === 404) {
            message = "Upload API route was not found. Open the site through the Node app and make sure /api/uploads is routed to server.js.";
        } else if (response.status === 401 || response.status === 403) {
            message = message === "Upload server request failed."
                ? "Upload request was rejected. Please sign in again and retry."
                : message;
        } else if (response.status >= 500) {
            message = "Upload server is not available right now.";
        } else if (/<(!doctype|html)\b/i.test(responseText)) {
            message = "Upload API returned an HTML page instead of JSON. The domain is likely not routed through the Node upload server.";
        }

        throw new Error(message);
    }

    async function uploadFile(context, file, metadata) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("applicationId", metadata && metadata.applicationId ? metadata.applicationId : "");
        formData.append("documentType", metadata && metadata.documentType ? metadata.documentType : "other");

        const response = await request(context, "", {
            method: "POST",
            body: formData
        });
        return response.json();
    }

    async function createObjectUrl(context, storedPath) {
        const normalizedPath = (storedPath || "").toString().trim();
        if (!normalizedPath) {
            return "";
        }

        if (isHostedPath(normalizedPath)) {
            const response = await request(context, "/blob?path=" + encodeURIComponent(normalizedPath), {
                method: "GET"
            });
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        }

        const result = await context.client.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(normalizedPath, 60 * 30);

        if (result.error || !result.data || !result.data.signedUrl) {
            return "";
        }
        return result.data.signedUrl;
    }

    async function deleteFiles(context, storedPaths) {
        const paths = Array.isArray(storedPaths) ? storedPaths : [];
        const hostedPaths = [];
        const legacyPaths = [];

        paths.forEach(function (pathValue) {
            const clean = (pathValue || "").toString().trim();
            if (!clean) {
                return;
            }
            if (isHostedPath(clean)) {
                hostedPaths.push(clean);
                return;
            }
            legacyPaths.push(clean);
        });

        const warnings = [];
        const deleted = [];

        if (hostedPaths.length > 0) {
            const response = await request(context, "/delete", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ paths: hostedPaths })
            });
            const payload = await response.json();
            if (payload && Array.isArray(payload.deleted)) {
                deleted.push.apply(deleted, payload.deleted);
            }
            if (payload && Array.isArray(payload.missing) && payload.missing.length > 0) {
                warnings.push("Some hosted files were already missing.");
            }
        }

        if (legacyPaths.length > 0) {
            const removeResult = await context.client.storage
                .from(STORAGE_BUCKET)
                .remove(legacyPaths);
            if (removeResult.error) {
                warnings.push(removeResult.error.message || "Legacy Supabase Storage cleanup failed.");
            } else {
                deleted.push.apply(deleted, legacyPaths);
            }
        }

        return {
            deleted: deleted,
            warnings: warnings
        };
    }

    window.ldssUploads = {
        isHostedPath: isHostedPath,
        uploadFile: uploadFile,
        createObjectUrl: createObjectUrl,
        deleteFiles: deleteFiles
    };
})();
