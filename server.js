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
const SUPABASE_SERVICE_ROLE_KEY = process.env.LDSS_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_STAFF_PASSWORD_LENGTH = 12;
const STAFF_ROLES = new Set(["secretary", "admin", "super_admin"]);
const EDITABLE_APPLICATION_STATUSES = new Set(["draft", "returned_for_correction"]);
const ROOT_STATIC_FILES = [
    "index.html",
    "login.html",
    "register.html",
    "forgot-password.html",
    "reset-password.html",
    "logout.html",
    "BARANGAY-DAET.TXT",
    "BARANGAY-DAET LIST.TXT"
];
const STATIC_DIRECTORIES = [
    "APPLICANT",
    "SECRETARY",
    "ADMIN",
    "SYSTEMADMINISTRATOR",
    "SUPERADMIN",
    "css",
    "js",
    "img",
    "assets"
];
const MIME_BY_KIND = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf"
};
const EXTENSION_BY_KIND = {
    jpg: ".jpg",
    png: ".png",
    webp: ".webp",
    pdf: ".pdf"
};
const DOCUMENT_RULES = {
    report_card: {
        allowedKinds: new Set(["jpg", "png", "pdf"]),
        allowedExtensions: new Set([".jpg", ".jpeg", ".png", ".pdf"]),
        allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"])
    },
    barangay_certificate: {
        allowedKinds: new Set(["jpg", "png", "pdf"]),
        allowedExtensions: new Set([".jpg", ".jpeg", ".png", ".pdf"]),
        allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"])
    },
    income_certificate: {
        allowedKinds: new Set(["pdf"]),
        allowedExtensions: new Set([".pdf"]),
        allowedMimeTypes: new Set(["application/pdf"])
    },
    applicant_photo: {
        allowedKinds: new Set(["jpg", "png", "webp"]),
        allowedExtensions: new Set([".jpg", ".jpeg", ".png", ".webp"]),
        allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"])
    },
    verified_interview_photo: {
        allowedKinds: new Set(["jpg", "png"]),
        allowedExtensions: new Set([".jpg", ".jpeg", ".png"]),
        allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png"])
    },
    other: {
        allowedKinds: new Set(["jpg", "png", "pdf"]),
        allowedExtensions: new Set([".jpg", ".jpeg", ".png", ".pdf"]),
        allowedMimeTypes: new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"])
    }
};
const ALLOWED_DOCUMENT_TYPES = new Set(Object.keys(DOCUMENT_RULES));
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-src 'none'",
    "upgrade-insecure-requests"
].join("; ");
const PERMISSIONS_POLICY = "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()";

const app = express();
app.disable("x-powered-by");
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

function resolveCorsOrigin(request) {
    const origin = (request.headers.origin || "").toString().trim();
    if (!origin) {
        return "";
    }

    try {
        const parsedOrigin = new URL(origin);
        const requestHost = (request.headers.host || "").toString().trim().toLowerCase();
        const originHost = parsedOrigin.host.toLowerCase();
        const isLocalOrigin = parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1";

        if (isLocalOrigin) {
            return origin;
        }
        if (requestHost && originHost === requestHost) {
            return origin;
        }
    } catch (error) {
        return "";
    }

    return "";
}

function applyUploadCors(request, response) {
    const allowedOrigin = resolveCorsOrigin(request);
    if (allowedOrigin) {
        response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
        response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Max-Age", "86400");
}

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

function createSupabaseAdminClient() {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        return null;
    }

    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
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

function normalizeMimeType(mimeType) {
    const normalized = (mimeType || "").toString().trim().toLowerCase();
    if (!normalized) {
        return "";
    }
    if (normalized === "image/jpg") {
        return "image/jpeg";
    }
    return normalized;
}

function nullIfBlank(value) {
    const text = (value || "").toString().trim();
    return text || null;
}

function normalizePhoneNumber(value) {
    const raw = (value || "").toString().trim();
    if (!raw) {
        return null;
    }

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

function validateStaffPassword(password) {
    const value = (password || "").toString();
    if (/\s/.test(value)) {
        return "Password cannot contain spaces.";
    }
    if (value.length < MIN_STAFF_PASSWORD_LENGTH) {
        return "Password must be at least 12 characters.";
    }
    if (!/[A-Z]/.test(value)) {
        return "Password must include at least one uppercase letter.";
    }
    if (!/[a-z]/.test(value)) {
        return "Password must include at least one lowercase letter.";
    }
    if (!/[0-9]/.test(value)) {
        return "Password must include at least one number.";
    }
    if (!/[^A-Za-z0-9]/.test(value)) {
        return "Password must include at least one symbol.";
    }
    return "";
}

function explainUserCreationError(message) {
    const text = (message || "").toString();
    const normalized = text.toLowerCase();

    if (normalized.includes("user already registered")) {
        return "Email address is already registered.";
    }
    if (
        normalized.includes("profiles_mobile_number_key") ||
        (normalized.includes("duplicate key value") && normalized.includes("mobile_number"))
    ) {
        return "Mobile number is already used by another account.";
    }
    if (
        normalized.includes("profiles_email_key") ||
        (normalized.includes("duplicate key value") && normalized.includes("email"))
    ) {
        return "Email address is already used by another profile.";
    }
    return text || "Secretary account creation failed.";
}

function detectUploadedFileKind(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return "";
    }
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return "png";
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }
    if (
        buffer.length >= 12 &&
        buffer.slice(0, 4).toString("ascii") === "RIFF" &&
        buffer.slice(8, 12).toString("ascii") === "WEBP"
    ) {
        return "webp";
    }
    if (buffer.length >= 5 && buffer.slice(0, 5).toString("ascii") === "%PDF-") {
        return "pdf";
    }
    return "";
}

function canonicalMimeTypeForKind(kind) {
    return MIME_BY_KIND[kind] || "application/octet-stream";
}

function canonicalExtensionForKind(kind) {
    return EXTENSION_BY_KIND[kind] || "";
}

function buildStoredFileName(originalFileName, detectedKind) {
    const parsed = path.parse((originalFileName || "document").toString());
    const safeBase = sanitizeFileName(parsed.name || "document").replace(/\.+$/g, "") || "document";
    return safeBase + canonicalExtensionForKind(detectedKind);
}

function validateUploadedFile(documentType, file) {
    const rule = DOCUMENT_RULES[documentType];
    if (!rule) {
        throw new Error("Document type is not allowed.");
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw new Error("Uploaded file is empty.");
    }

    const extension = path.extname((file.originalname || "").toString()).toLowerCase();
    if (!extension || !rule.allowedExtensions.has(extension)) {
        throw new Error("Invalid file extension for " + documentType + ".");
    }

    const mimeType = normalizeMimeType(file.mimetype);
    if (mimeType && !rule.allowedMimeTypes.has(mimeType)) {
        throw new Error("Invalid file type for " + documentType + ".");
    }

    const detectedKind = detectUploadedFileKind(file.buffer);
    if (!detectedKind || !rule.allowedKinds.has(detectedKind)) {
        throw new Error("Uploaded file contents do not match an allowed format for " + documentType + ".");
    }

    return {
        detectedKind: detectedKind,
        safeFileName: buildStoredFileName(file.originalname, detectedKind),
        mimeType: canonicalMimeTypeForKind(detectedKind)
    };
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

function buildHostedUploadPath(role, userId, applicationId, documentType, storedFileName) {
    const randomSuffix = Date.now().toString() + "-" + crypto.randomBytes(5).toString("hex");
    const safeName = randomSuffix + "-" + sanitizeFileName(storedFileName || "document");

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

function parseHostedPathDetails(normalizedPath) {
    const segments = (normalizedPath || "").split("/");
    if (segments.length < 5 || segments[0] !== "uploads") {
        return null;
    }

    const documentType = segments[1] || "";
    if (documentType === "verified_interview_photo") {
        if (segments[2] !== "staff" || segments.length < 6) {
            return null;
        }
        return {
            documentType: documentType,
            isStaffScoped: true,
            ownerId: segments[3] || "",
            applicationId: segments[4] || "",
            fileName: segments.slice(5).join("/")
        };
    }

    return {
        documentType: documentType,
        isStaffScoped: false,
        ownerId: segments[2] || "",
        applicationId: segments[3] || "",
        fileName: segments.slice(4).join("/")
    };
}

function mimeTypeFromPath(storedPath) {
    const extension = path.extname((storedPath || "").toString()).toLowerCase();
    if (extension === ".jpg" || extension === ".jpeg") {
        return "image/jpeg";
    }
    if (extension === ".png") {
        return "image/png";
    }
    if (extension === ".webp") {
        return "image/webp";
    }
    if (extension === ".pdf") {
        return "application/pdf";
    }
    return "application/octet-stream";
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

async function applicantOwnsEditableApplication(client, applicantId, applicationId) {
    if (!applicationId) {
        return false;
    }

    const result = await client
        .from("applications")
        .select("status")
        .eq("id", applicationId)
        .eq("applicant_id", applicantId)
        .maybeSingle();

    return !result.error && !!result.data && EDITABLE_APPLICATION_STATUSES.has(result.data.status);
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

async function assertHostedPathAccess(auth, storedPath, accessMode) {
    const resolved = resolveHostedUploadPath(storedPath);
    if (!resolved.normalized || !resolved.absolutePath) {
        throw new Error("Invalid hosted upload path.");
    }

    const details = parseHostedPathDetails(resolved.normalized);
    if (!details || !details.applicationId) {
        throw new Error("Invalid hosted upload path.");
    }

    if (STAFF_ROLES.has(auth.role)) {
        if (accessMode === "delete") {
            if (auth.role === "super_admin") {
                return { resolved: resolved, details: details };
            }
            if (details.documentType !== "verified_interview_photo" || !details.isStaffScoped) {
                throw new Error("Staff cannot delete applicant-uploaded files.");
            }
            if (auth.role === "secretary" && details.ownerId !== auth.user.id) {
                throw new Error("You cannot delete another staff member's uploaded file.");
            }
            if (!(await applicationExists(auth.client, details.applicationId))) {
                throw new Error("Target application was not found.");
            }
            return { resolved: resolved, details: details };
        }

        if (!(await applicationExists(auth.client, details.applicationId))) {
            throw new Error("Target application was not found.");
        }
        return { resolved: resolved, details: details };
    }

    if (details.isStaffScoped || details.ownerId !== auth.user.id) {
        throw new Error("You cannot access this file.");
    }

    if (accessMode === "delete") {
        if (!(await applicantOwnsEditableApplication(auth.client, auth.user.id, details.applicationId))) {
            throw new Error("You cannot delete files for a locked application.");
        }
        return { resolved: resolved, details: details };
    }

    if (!(await applicantOwnsApplication(auth.client, auth.user.id, details.applicationId))) {
        throw new Error("You cannot access this file.");
    }

    return { resolved: resolved, details: details };
}

function writeJsonError(response, statusCode, message) {
    response.status(statusCode).json({ error: message });
}

function applySecurityHeaders(_request, response, next) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000");
    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("X-Frame-Options", "SAMEORIGIN");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
}

app.use(applySecurityHeaders);
app.use(express.json({ limit: "1mb" }));
app.use(["/uploads", "/node_modules"], function (_request, response) {
    response.status(404).send("Not found");
});

app.use("/api/uploads", function (request, response, next) {
    applyUploadCors(request, response);
    if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
    }
    next();
});

app.get("/api/uploads/health", function (_request, response) {
    response.json({
        ok: true,
        service: "ldss-uploads"
    });
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
        const validatedFile = validateUploadedFile(documentType, file);

        const storedPath = buildHostedUploadPath(
            request.auth.role,
            request.auth.user.id,
            applicationId,
            documentType,
            validatedFile.safeFileName
        );
        const resolved = resolveHostedUploadPath(storedPath);
        await ensureDirectory(resolved.absolutePath);
        await fsPromises.writeFile(resolved.absolutePath, file.buffer);

        response.json({
            ok: true,
            path: resolved.normalized,
            originalFilename: path.basename(validatedFile.safeFileName),
            mimeType: validatedFile.mimeType,
            sizeBytes: file.size
        });
    } catch (error) {
        writeJsonError(response, 400, error.message || "Upload failed.");
    }
});

app.get("/api/uploads/blob", authenticate, async function (request, response) {
    try {
        const storedPath = (request.query.path || "").toString();
        const access = await assertHostedPathAccess(request.auth, storedPath, "view");
        if (!fs.existsSync(access.resolved.absolutePath)) {
            writeJsonError(response, 404, "File was not found.");
            return;
        }

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "private, max-age=300");
        response.type(mimeTypeFromPath(access.resolved.normalized));
        response.sendFile(access.resolved.absolutePath);
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
            const access = await assertHostedPathAccess(request.auth, storedPath, "delete");

            try {
                await fsPromises.unlink(access.resolved.absolutePath);
                await removeEmptyParentDirectories(access.resolved.absolutePath);
                deleted.push(access.resolved.normalized);
            } catch (error) {
                if (error && error.code === "ENOENT") {
                    missing.push(access.resolved.normalized);
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

app.post("/api/super-admin/secretaries", authenticate, async function (request, response) {
    let createdUserId = "";

    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can create secretary accounts.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const firstName = nullIfBlank(request.body && request.body.firstName);
        const middleName = nullIfBlank(request.body && request.body.middleName);
        const lastName = nullIfBlank(request.body && request.body.lastName);
        const email = ((request.body && request.body.email) || "").toString().trim().toLowerCase();
        const mobileNumber = normalizePhoneNumber(request.body && request.body.mobileNumber);
        const password = ((request.body && request.body.password) || "").toString();

        if (!firstName || !lastName || !email || !mobileNumber || !password) {
            writeJsonError(response, 400, "First name, last name, email, mobile number, and password are required.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            writeJsonError(response, 400, "Enter a valid email address.");
            return;
        }
        if (!mobileNumber) {
            writeJsonError(response, 400, "Enter a valid mobile number.");
            return;
        }

        const passwordError = validateStaffPassword(password);
        if (passwordError) {
            writeJsonError(response, 400, passwordError);
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const createResult = await adminClient.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true,
            user_metadata: {
                first_name: firstName,
                middle_name: middleName || "",
                last_name: lastName,
                mobile_number: mobileNumber
            }
        });

        if (createResult.error || !createResult.data || !createResult.data.user) {
            writeJsonError(response, 400, explainUserCreationError(createResult.error && createResult.error.message));
            return;
        }

        createdUserId = createResult.data.user.id || "";

        const profileResult = await adminClient
            .from("profiles")
            .upsert({
                id: createdUserId,
                role: "secretary",
                email: email,
                mobile_number: mobileNumber,
                first_name: firstName,
                middle_name: middleName,
                last_name: lastName,
                is_active: true
            }, { onConflict: "id" })
            .select("id, role, email, mobile_number, first_name, middle_name, last_name, is_active, created_at")
            .single();

        if (profileResult.error || !profileResult.data) {
            if (createdUserId) {
                try {
                    await adminClient.auth.admin.deleteUser(createdUserId);
                } catch (_cleanupError) {
                    // Best effort only; return the profile setup error below.
                }
            }

            writeJsonError(response, 400, explainUserCreationError(profileResult.error && profileResult.error.message));
            return;
        }

        response.status(201).json({
            ok: true,
            user: profileResult.data
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Secretary account creation failed.");
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

STATIC_DIRECTORIES.forEach(function (directoryName) {
    app.use("/" + directoryName, express.static(path.join(ROOT_DIR, directoryName), { extensions: ["html"] }));
});

ROOT_STATIC_FILES.forEach(function (fileName) {
    app.get("/" + fileName, function (_request, response) {
        response.sendFile(path.join(ROOT_DIR, fileName));
    });
});

app.get("/", function (_request, response) {
    response.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.use(function (_request, response) {
    response.status(404).send("Not found");
});

const server = app.listen(PORT, function () {
    console.log("LDSS server running on port " + PORT);
});

module.exports = server;
