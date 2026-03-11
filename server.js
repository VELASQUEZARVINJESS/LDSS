require("dotenv").config({ quiet: true });

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT || process.env.NODE_PORT || "3000");
const ROOT_DIR = __dirname;
const UPLOAD_ROOT = path.resolve(ROOT_DIR, process.env.LDSS_UPLOAD_DIR || "uploads");
const SUPABASE_URL = process.env.LDSS_SUPABASE_URL || "https://rfzqifloaixrtseqzrzk.supabase.co";
const SUPABASE_ANON_KEY = process.env.LDSS_SUPABASE_ANON_KEY || "sb_publishable_ysa32dk9v2Vcps9KQSR2Rg_F0w9TftL";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const STAFF_ROLES = new Set(["secretary", "admin", "super_admin"]);
const ALLOWED_DOCUMENT_TYPES = new Set([
    "report_card",
    "barangay_certificate",
    "income_certificate",
    "applicant_photo",
    "verified_interview_photo",
    "other"
]);

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

function createSupabaseClient(accessToken) {
    const options = {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    };
    if (accessToken) {
        options.global = {
            headers: {
                Authorization: "Bearer " + accessToken
            }
        };
    }
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
}

function readBearerToken(request) {
    const header = request.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : "";
}

function sanitizeFileName(name) {
    return (name || "document")
        .replace(/[^a-zA-Z0-9.\-_]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 120);
}

function normalizeStoredPath(value) {
    const raw = (value || "").toString().trim().replace(/\\/g, "/");
    if (!raw || raw.startsWith("/") || raw.includes("\0")) {
        return "";
    }
    const normalized = path.posix.normalize(raw);
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
        return "";
    }
    return normalized;
}

function buildHostedUploadPath(role, userId, applicationId, documentType, originalFileName) {
    const randomSuffix = Date.now().toString() + "-" + crypto.randomBytes(5).toString("hex");
    const safeName = randomSuffix + "-" + sanitizeFileName(originalFileName);

    if (documentType === "verified_interview_photo" && STAFF_ROLES.has(role)) {
        return ["uploads", "verified_interview_photo", "staff", userId, applicationId, safeName].join("/");
    }

    return ["uploads", documentType || "other", userId, applicationId, safeName].join("/");
}

function resolveHostedUploadPath(storedPath) {
    const normalized = normalizeStoredPath(storedPath);
    if (!normalized || !normalized.startsWith("uploads/")) {
        return { normalized: "", absolutePath: "" };
    }

    const absolutePath = path.resolve(ROOT_DIR, normalized);
    const uploadsPrefix = UPLOAD_ROOT + path.sep;
    if (absolutePath !== UPLOAD_ROOT && !absolutePath.startsWith(uploadsPrefix)) {
        return { normalized: "", absolutePath: "" };
    }

    return { normalized: normalized, absolutePath: absolutePath };
}

async function ensureDirectory(targetFilePath) {
    await fsPromises.mkdir(path.dirname(targetFilePath), { recursive: true });
}

async function removeEmptyParentDirectories(filePath) {
    let currentDir = path.dirname(filePath);
    while (currentDir.startsWith(UPLOAD_ROOT) && currentDir !== UPLOAD_ROOT) {
        try {
            await fsPromises.rmdir(currentDir);
        } catch (error) {
            if (error && (error.code === "ENOTEMPTY" || error.code === "ENOENT")) {
                return;
            }
            throw error;
        }
        currentDir = path.dirname(currentDir);
    }
}

async function authenticate(request, response, next) {
    try {
        const token = readBearerToken(request);
        if (!token) {
            response.status(401).json({ error: "Authentication required." });
            return;
        }

        const anonClient = createSupabaseClient();
        const authResult = await anonClient.auth.getUser(token);
        if (authResult.error || !authResult.data || !authResult.data.user) {
            response.status(401).json({ error: "Invalid or expired session." });
            return;
        }

        const scopedClient = createSupabaseClient(token);
        const profileResult = await scopedClient
            .from("profiles")
            .select("role,is_active")
            .eq("id", authResult.data.user.id)
            .single();

        if (profileResult.error || !profileResult.data || !profileResult.data.role) {
            response.status(403).json({ error: "Profile role lookup failed." });
            return;
        }
        if (profileResult.data.is_active === false) {
            response.status(403).json({ error: "Account is inactive." });
            return;
        }

        request.auth = {
            token: token,
            user: authResult.data.user,
            role: profileResult.data.role,
            client: scopedClient
        };
        next();
    } catch (error) {
        response.status(500).json({ error: "Authentication check failed." });
    }
}

async function applicantOwnsApplication(client, applicantId, applicationId) {
    if (!applicationId) {
        return false;
    }

    const result = await client
        .from("applications")
        .select("id")
        .eq("id", applicationId)
        .eq("applicant_id", applicantId)
        .maybeSingle();

    return !result.error && !!result.data;
}

async function applicationExists(client, applicationId) {
    if (!applicationId) {
        return false;
    }

    const result = await client
        .from("applications")
        .select("id")
        .eq("id", applicationId)
        .maybeSingle();

    return !result.error && !!result.data;
}

async function assertUploadAllowed(auth, applicationId, documentType) {
    if (!applicationId) {
        throw new Error("Application ID is required.");
    }
    if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) {
        throw new Error("Document type is not allowed.");
    }

    const isStaff = STAFF_ROLES.has(auth.role);
    if (documentType === "verified_interview_photo" && !isStaff) {
        throw new Error("Only staff can upload verified interview photos.");
    }

    if (isStaff) {
        if (!(await applicationExists(auth.client, applicationId))) {
            throw new Error("Target application was not found.");
        }
        return;
    }

    if (!(await applicantOwnsApplication(auth.client, auth.user.id, applicationId))) {
        throw new Error("You cannot upload files for this application.");
    }
}

async function assertHostedPathAccess(auth, storedPath) {
    const resolved = resolveHostedUploadPath(storedPath);
    if (!resolved.normalized || !resolved.absolutePath) {
        throw new Error("Invalid hosted upload path.");
    }

    if (STAFF_ROLES.has(auth.role)) {
        return resolved;
    }

    const segments = resolved.normalized.split("/");
    if (segments.length < 5 || segments[0] !== "uploads") {
        throw new Error("Invalid hosted upload path.");
    }

    const documentType = segments[1];
    if (documentType === "verified_interview_photo") {
        const applicationId = segments[4] || "";
        if (!(await applicantOwnsApplication(auth.client, auth.user.id, applicationId))) {
            throw new Error("You cannot access this file.");
        }
        return resolved;
    }

    const ownerId = segments[2] || "";
    const applicationId = segments[3] || "";
    if (ownerId !== auth.user.id) {
        throw new Error("You cannot access this file.");
    }
    if (!(await applicantOwnsApplication(auth.client, auth.user.id, applicationId))) {
        throw new Error("You cannot access this file.");
    }

    return resolved;
}

function writeJsonError(response, statusCode, message) {
    response.status(statusCode).json({ error: message });
}

app.use(express.json({ limit: "1mb" }));
app.use(["/uploads", "/node_modules"], function (_request, response) {
    response.status(404).send("Not found");
});

app.post("/api/uploads", authenticate, upload.single("file"), async function (request, response) {
    try {
        const file = request.file;
        if (!file) {
            writeJsonError(response, 400, "No file was uploaded.");
            return;
        }

        const applicationId = (request.body.applicationId || "").toString().trim();
        const documentType = (request.body.documentType || "").toString().trim();

        await assertUploadAllowed(request.auth, applicationId, documentType);

        const storedPath = buildHostedUploadPath(
            request.auth.role,
            request.auth.user.id,
            applicationId,
            documentType,
            file.originalname
        );
        const resolved = resolveHostedUploadPath(storedPath);
        await ensureDirectory(resolved.absolutePath);
        await fsPromises.writeFile(resolved.absolutePath, file.buffer);

        response.json({
            ok: true,
            path: resolved.normalized,
            originalFilename: file.originalname,
            mimeType: file.mimetype || "application/octet-stream",
            sizeBytes: file.size
        });
    } catch (error) {
        writeJsonError(response, 400, error.message || "Upload failed.");
    }
});

app.get("/api/uploads/blob", authenticate, async function (request, response) {
    try {
        const storedPath = (request.query.path || "").toString();
        const resolved = await assertHostedPathAccess(request.auth, storedPath);
        if (!fs.existsSync(resolved.absolutePath)) {
            writeJsonError(response, 404, "File was not found.");
            return;
        }

        response.sendFile(resolved.absolutePath);
    } catch (error) {
        writeJsonError(response, 403, error.message || "File access denied.");
    }
});

app.post("/api/uploads/delete", authenticate, async function (request, response) {
    try {
        const rawPaths = Array.isArray(request.body && request.body.paths) ? request.body.paths : [];
        const deleted = [];
        const missing = [];

        for (let index = 0; index < rawPaths.length; index += 1) {
            const storedPath = (rawPaths[index] || "").toString();
            const resolved = await assertHostedPathAccess(request.auth, storedPath);

            try {
                await fsPromises.unlink(resolved.absolutePath);
                await removeEmptyParentDirectories(resolved.absolutePath);
                deleted.push(resolved.normalized);
            } catch (error) {
                if (error && error.code === "ENOENT") {
                    missing.push(resolved.normalized);
                    continue;
                }
                throw error;
            }
        }

        response.json({
            ok: true,
            deleted: deleted,
            missing: missing
        });
    } catch (error) {
        writeJsonError(response, 400, error.message || "File delete failed.");
    }
});

app.use(function (error, request, response, next) {
    if (!error) {
        next();
        return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        writeJsonError(response, 413, "File exceeds the 10MB upload limit.");
        return;
    }

    if ((request.path || "").indexOf("/api/uploads") === 0) {
        writeJsonError(response, 500, error.message || "Upload server request failed.");
        return;
    }

    next(error);
});

app.use(express.static(ROOT_DIR, { extensions: ["html"] }));

app.use(function (_request, response) {
    response.status(404).send("Not found");
});

const server = app.listen(PORT, function () {
    console.log("LDSS server running on port " + PORT);
});

module.exports = server;
