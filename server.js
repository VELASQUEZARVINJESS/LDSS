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
const SMTP_HOST = (process.env.LDSS_SMTP_HOST || process.env.SMTP_HOST || "").toString().trim();
const SMTP_PORT = Number(process.env.LDSS_SMTP_PORT || process.env.SMTP_PORT || "0");
const SMTP_SECURE = /^(1|true|yes|on)$/i.test((process.env.LDSS_SMTP_SECURE || process.env.SMTP_SECURE || "").toString().trim());
const SMTP_USER = (process.env.LDSS_SMTP_USER || process.env.SMTP_USER || "").toString().trim();
const SMTP_PASS = (process.env.LDSS_SMTP_PASS || process.env.SMTP_PASS || "").toString();
const MAIL_FROM = (process.env.LDSS_MAIL_FROM || process.env.MAIL_FROM || "").toString().trim() || SMTP_USER;
const MAIL_REPLY_TO = (process.env.LDSS_MAIL_REPLY_TO || process.env.MAIL_REPLY_TO || "").toString().trim();
const REMINDER_LOGS_TABLE = "reminder_email_logs";
const REMINDER_COOLDOWN_DAYS = {
    draft_only: 5,
    no_application: 7,
    returned_resubmission: 3
};
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
let cachedMailTransporter = null;

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

function escapeHtml(value) {
    return (value || "")
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function mailServerConfigured() {
    return Boolean(SMTP_HOST && SMTP_PORT > 0 && SMTP_USER && SMTP_PASS && MAIL_FROM);
}

function loadMailer() {
    try {
        return require("nodemailer");
    } catch (_error) {
        throw new Error("Server is missing nodemailer. Run npm install on the hosting server first.");
    }
}

function getMailTransporter() {
    if (!mailServerConfigured()) {
        throw new Error("Server email is not configured. Add SMTP settings in the Node app environment first.");
    }
    if (cachedMailTransporter) {
        return cachedMailTransporter;
    }

    const nodemailer = loadMailer();
    cachedMailTransporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });
    return cachedMailTransporter;
}

function resolveBaseUrl(request) {
    const origin = (request.headers.origin || "").toString().trim();
    if (origin) {
        return origin.replace(/\/+$/g, "");
    }

    const forwardedProto = (request.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
    const forwardedHost = (request.headers["x-forwarded-host"] || "").toString().split(",")[0].trim();
    const host = forwardedHost || (request.headers.host || "").toString().trim();
    const protocol = forwardedProto || request.protocol || "https";

    if (!host) {
        return "";
    }
    return protocol + "://" + host;
}

function buildComplianceEmailHtml(details) {
    const updateLink = details.updateUrl
        ? '<p style="margin:20px 0 0;"><a href="' + escapeHtml(details.updateUrl) + '" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">Update Application</a></p>'
        : "";

    return (
        '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">' +
        '<p>Good day ' + escapeHtml(details.applicantName) + ',</p>' +
        '<p>Your scholarship application remains <strong>submitted</strong>, but the scholarship office needs you to comply with the following requirement(s):</p>' +
        '<div style="padding:12px 14px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;white-space:pre-wrap;">' + escapeHtml(details.remarks) + '</div>' +
        '<p style="margin-top:16px;">Application No.: <strong>' + escapeHtml(details.applicationNo) + "</strong></p>" +
        '<p>Please open your application and update the required information as soon as possible.</p>' +
        updateLink +
        '<p style="margin-top:24px;">LDSP LGU Daet Scholarship System</p>' +
        "</div>"
    );
}

function buildComplianceEmailText(details) {
    return [
        "Good day " + details.applicantName + ",",
        "",
        "Your scholarship application remains submitted, but the scholarship office needs you to comply with the following requirement(s):",
        details.remarks,
        "",
        "Application No.: " + details.applicationNo,
        "Please open your application and update the required information as soon as possible.",
        details.updateUrl ? "Update link: " + details.updateUrl : "",
        "",
        "LDSP LGU Daet Scholarship System"
    ].filter(Boolean).join("\n");
}

async function sendComplianceEmailMail(details) {
    const transporter = getMailTransporter();
    const mailOptions = {
        from: MAIL_FROM,
        to: details.email,
        subject: "LDSP Application Needs Compliance - " + details.applicationNo,
        text: buildComplianceEmailText(details),
        html: buildComplianceEmailHtml(details)
    };

    if (MAIL_REPLY_TO) {
        mailOptions.replyTo = MAIL_REPLY_TO;
    }

    await transporter.sendMail(mailOptions);
}

function reminderSubjectForState(state) {
    if (state === "draft_only") {
        return "Complete Your LDSP Application";
    }
    return "LDSP Application Reminder";
}

function reminderActionUrl(baseUrl, state, draftApplicationId) {
    if (!baseUrl) {
        return "";
    }
    if (state === "draft_only" && draftApplicationId) {
        return baseUrl + "/APPLICANT/applicant-application-form.html?application_id=" + encodeURIComponent(draftApplicationId);
    }
    return baseUrl + "/APPLICANT/applicant-application-form.html";
}

function buildReminderEmailHtml(details) {
    const actionText = details.state === "draft_only"
        ? "Your application is still saved as draft and has not been submitted yet."
        : "You already have an LDSP account, but you still do not have a submitted application form.";
    const actionLabel = details.state === "draft_only" ? "Continue Application" : "Start Application";
    const actionLink = details.actionUrl
        ? '<p style="margin:20px 0 0;"><a href="' + escapeHtml(details.actionUrl) + '" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600;">' + escapeHtml(actionLabel) + "</a></p>"
        : "";

    return (
        '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">' +
        '<p>Good day ' + escapeHtml(details.applicantName) + ',</p>' +
        "<p>" + escapeHtml(actionText) + "</p>" +
        '<p>Please complete your form as soon as possible so the scholarship office can review your application on time.</p>' +
        actionLink +
        '<p style="margin-top:24px;">LDSP LGU Daet Scholarship System</p>' +
        "</div>"
    );
}

function buildReminderEmailText(details) {
    const actionText = details.state === "draft_only"
        ? "Your application is still saved as draft and has not been submitted yet."
        : "You already have an LDSP account, but you still do not have a submitted application form.";

    return [
        "Good day " + details.applicantName + ",",
        "",
        actionText,
        "Please complete your form as soon as possible so the scholarship office can review your application on time.",
        details.actionUrl ? "Open here: " + details.actionUrl : "",
        "",
        "LDSP LGU Daet Scholarship System"
    ].filter(Boolean).join("\n");
}

async function sendApplicantReminderMail(details) {
    const transporter = getMailTransporter();
    const mailOptions = {
        from: MAIL_FROM,
        to: details.email,
        subject: reminderSubjectForState(details.state),
        text: buildReminderEmailText(details),
        html: buildReminderEmailHtml(details)
    };

    if (MAIL_REPLY_TO) {
        mailOptions.replyTo = MAIL_REPLY_TO;
    }

    await transporter.sendMail(mailOptions);
}

function newestApplication(left, right) {
    const leftDate = new Date((left && (left.updated_at || left.created_at)) || 0).getTime();
    const rightDate = new Date((right && (right.updated_at || right.created_at)) || 0).getTime();
    return rightDate - leftDate;
}

function classifyReminderState(applications) {
    const items = Array.isArray(applications) ? applications.slice() : [];
    const nonDraft = items.find(function (application) {
        return ((application && application.status) || "").toString().trim().toLowerCase() !== "draft";
    });

    if (nonDraft) {
        return {
            state: "submitted",
            draftApplicationId: ""
        };
    }

    const draftApplications = items.filter(function (application) {
        return ((application && application.status) || "").toString().trim().toLowerCase() === "draft";
    }).sort(newestApplication);

    if (draftApplications.length) {
        return {
            state: "draft_only",
            draftApplicationId: draftApplications[0].id || ""
        };
    }

    return {
        state: "no_application",
        draftApplicationId: ""
    };
}

function reminderCooldownDays(reminderType) {
    return REMINDER_COOLDOWN_DAYS[reminderType] || 7;
}

function reminderLogKey(applicantId, reminderType) {
    return (applicantId || "") + "::" + (reminderType || "");
}

function reminderCooldownUntil(sentAt, reminderType) {
    const parsed = new Date(sentAt || "");
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    parsed.setDate(parsed.getDate() + reminderCooldownDays(reminderType));
    return parsed.toISOString();
}

function buildReminderLogLookup(rows) {
    const lookup = {};
    (rows || []).forEach(function (row) {
        if (!row || row.status !== "sent" || !row.applicant_id || !row.reminder_type || !row.sent_at) {
            return;
        }
        const key = reminderLogKey(row.applicant_id, row.reminder_type);
        if (!lookup[key]) {
            lookup[key] = {
                lastSentAt: row.sent_at,
                timesSent: 1
            };
            return;
        }
        lookup[key].timesSent += 1;
        if (new Date(row.sent_at).getTime() > new Date(lookup[key].lastSentAt).getTime()) {
            lookup[key].lastSentAt = row.sent_at;
        }
    });
    return lookup;
}

function reminderInCooldown(logMeta, reminderType) {
    if (!logMeta || !logMeta.lastSentAt) {
        return false;
    }
    const nextAllowed = new Date(reminderCooldownUntil(logMeta.lastSentAt, reminderType));
    return !Number.isNaN(nextAllowed.getTime()) && nextAllowed.getTime() > Date.now();
}

function isMissingTableError(error, tableName) {
    const message = ((error && (error.message || error.details || error.hint)) || "").toString().toLowerCase();
    const code = ((error && error.code) || "").toString();
    return code === "42P01" || message.indexOf((tableName || "").toString().toLowerCase()) !== -1 || message.indexOf("relation") !== -1;
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

app.post("/api/notifications/compliance-email", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send compliance emails.");
            return;
        }

        const applicationId = nullIfBlank(request.body && request.body.applicationId);
        const remarks = nullIfBlank(request.body && request.body.remarks);
        if (!applicationId || !remarks || remarks.length < 10) {
            writeJsonError(response, 400, "Application ID and compliance remarks are required.");
            return;
        }

        const applicationResult = await request.auth.client
            .from("applications")
            .select("id, application_no, applicant_id")
            .eq("id", applicationId)
            .maybeSingle();

        if (applicationResult.error || !applicationResult.data) {
            writeJsonError(response, 404, "Target application was not found.");
            return;
        }

        const profileResult = await request.auth.client
            .from("profiles")
            .select("first_name, middle_name, last_name, email")
            .eq("id", applicationResult.data.applicant_id)
            .maybeSingle();

        if (profileResult.error || !profileResult.data) {
            writeJsonError(response, 404, "Applicant profile was not found.");
            return;
        }

        const email = ((profileResult.data.email || "")).toString().trim().toLowerCase();
        if (!email) {
            writeJsonError(response, 400, "Applicant does not have an email address on file.");
            return;
        }

        const applicantName = [
            profileResult.data.first_name,
            profileResult.data.middle_name,
            profileResult.data.last_name
        ].map(function (value) {
            return (value || "").toString().trim();
        }).filter(Boolean).join(" ").trim() || email;

        const baseUrl = resolveBaseUrl(request);
        const updateUrl = baseUrl
            ? baseUrl + "/APPLICANT/applicant-application-form.html?application_id=" + encodeURIComponent(applicationId)
            : "";

        await sendComplianceEmailMail({
            email: email,
            applicantName: applicantName,
            applicationNo: applicationResult.data.application_no || "LDSP Application",
            remarks: remarks,
            updateUrl: updateUrl
        });

        response.json({
            ok: true,
            email: email
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Compliance email failed.");
    }
});

app.post("/api/notifications/reminder-campaign", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send reminder campaigns.");
            return;
        }

        const campaignType = ((request.body && request.body.campaignType) || "all_visible").toString().trim().toLowerCase();
        const allowedCampaignTypes = new Set(["all_visible", "draft_only", "no_application"]);
        if (!allowedCampaignTypes.has(campaignType)) {
            writeJsonError(response, 400, "Reminder campaign type is invalid.");
            return;
        }

        const rawRecipientIds = Array.isArray(request.body && request.body.recipientIds) ? request.body.recipientIds : [];
        const recipientIds = Array.from(new Set(rawRecipientIds.map(function (value) {
            return (value || "").toString().trim();
        }).filter(Boolean)));

        if (!recipientIds.length) {
            writeJsonError(response, 400, "Select at least one recipient for the reminder campaign.");
            return;
        }
        if (recipientIds.length > 200) {
            writeJsonError(response, 400, "Too many recipients at once. Please filter the list and send in smaller batches.");
            return;
        }

        const [profilesResult, applicationsResult] = await Promise.all([
            request.auth.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, role")
                .eq("role", "applicant")
                .in("id", recipientIds),
            request.auth.client
                .from("applications")
                .select("id, applicant_id, status, updated_at, created_at")
                .in("applicant_id", recipientIds)
        ]);

        if (profilesResult.error) {
            writeJsonError(response, 500, profilesResult.error.message || "Unable to load reminder recipients.");
            return;
        }
        if (applicationsResult.error) {
            writeJsonError(response, 500, applicationsResult.error.message || "Unable to inspect application states.");
            return;
        }

        const profileMap = {};
        (profilesResult.data || []).forEach(function (profile) {
            if (profile && profile.id) {
                profileMap[profile.id] = profile;
            }
        });

        const applicationMap = {};
        (applicationsResult.data || []).forEach(function (application) {
            if (!application || !application.applicant_id) {
                return;
            }
            if (!applicationMap[application.applicant_id]) {
                applicationMap[application.applicant_id] = [];
            }
            applicationMap[application.applicant_id].push(application);
        });

        const reminderLogsResult = await request.auth.client
            .from(REMINDER_LOGS_TABLE)
            .select("applicant_id, reminder_type, status, sent_at")
            .in("applicant_id", recipientIds)
            .eq("channel", "email")
            .order("sent_at", { ascending: false });

        if (reminderLogsResult.error) {
            const missingTableMessage = "Reminder log table is not available yet. Run reminder_email_logs_hotfix_2026_03_17.sql first.";
            writeJsonError(
                response,
                500,
                isMissingTableError(reminderLogsResult.error, REMINDER_LOGS_TABLE)
                    ? missingTableMessage
                    : (reminderLogsResult.error.message || "Unable to read reminder log history.")
            );
            return;
        }

        const reminderLogLookup = buildReminderLogLookup(reminderLogsResult.data || []);

        const baseUrl = resolveBaseUrl(request);
        const sent = [];
        const skipped = [];
        const failed = [];

        for (let index = 0; index < recipientIds.length; index += 1) {
            const applicantId = recipientIds[index];
            const profile = profileMap[applicantId];
            if (!profile) {
                skipped.push({ id: applicantId, reason: "Profile not found." });
                continue;
            }

            const email = ((profile.email || "")).toString().trim().toLowerCase();
            if (!email) {
                skipped.push({ id: applicantId, reason: "No email address on file." });
                continue;
            }

            const stateInfo = classifyReminderState(applicationMap[applicantId] || []);
            if (stateInfo.state === "submitted") {
                skipped.push({ id: applicantId, email: email, reason: "Already has a submitted application." });
                continue;
            }
            if (campaignType === "draft_only" && stateInfo.state !== "draft_only") {
                skipped.push({ id: applicantId, email: email, reason: "Not in Draft Only state." });
                continue;
            }
            if (campaignType === "no_application" && stateInfo.state !== "no_application") {
                skipped.push({ id: applicantId, email: email, reason: "Already has a started draft." });
                continue;
            }

            const logMeta = reminderLogLookup[reminderLogKey(applicantId, stateInfo.state)] || null;
            if (reminderInCooldown(logMeta, stateInfo.state)) {
                skipped.push({
                    id: applicantId,
                    email: email,
                    reason: "Reminder is still in cooldown.",
                    nextAllowedAt: reminderCooldownUntil(logMeta.lastSentAt, stateInfo.state)
                });
                continue;
            }

            const applicantName = [
                profile.first_name,
                profile.middle_name,
                profile.last_name
            ].map(function (value) {
                return (value || "").toString().trim();
            }).filter(Boolean).join(" ").trim() || email;

            try {
                await sendApplicantReminderMail({
                    email: email,
                    applicantName: applicantName,
                    state: stateInfo.state,
                    actionUrl: reminderActionUrl(baseUrl, stateInfo.state, stateInfo.draftApplicationId)
                });

                const insertResult = await request.auth.client
                    .from(REMINDER_LOGS_TABLE)
                    .insert({
                        applicant_id: applicantId,
                        application_id: stateInfo.draftApplicationId || null,
                        reminder_type: stateInfo.state,
                        channel: "email",
                        status: "sent",
                        recipient_email: email,
                        sent_by: request.auth.user.id
                    });

                if (insertResult.error) {
                    throw new Error(insertResult.error.message || "Reminder log write failed.");
                }

                sent.push({ id: applicantId, email: email, state: stateInfo.state });
            } catch (error) {
                try {
                    await request.auth.client
                        .from(REMINDER_LOGS_TABLE)
                        .insert({
                            applicant_id: applicantId,
                            application_id: stateInfo.draftApplicationId || null,
                            reminder_type: stateInfo.state,
                            channel: "email",
                            status: "failed",
                            recipient_email: email,
                            sent_by: request.auth.user.id,
                            error_message: error && error.message ? error.message : "Email send failed."
                        });
                } catch (_logError) {
                    // Best effort only; keep the original email failure below.
                }
                failed.push({
                    id: applicantId,
                    email: email,
                    error: error && error.message ? error.message : "Email send failed."
                });
            }
        }

        response.json({
            ok: true,
            sentCount: sent.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            sent: sent,
            skipped: skipped,
            failed: failed
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Reminder campaign failed.");
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
