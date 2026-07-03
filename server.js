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
const REMINDER_CAMPAIGN_JOBS_TABLE = "reminder_campaign_jobs";
const EXAM_SCHEDULE_EMAIL_JOBS_TABLE = "exam_schedule_email_jobs";
const REMINDER_COOLDOWN_DAYS = {
    draft_only: 5,
    no_application: 7,
    returned_resubmission: 3
};
const REMINDER_CAMPAIGN_MAX_RECIPIENTS = 5000;
const REMINDER_CAMPAIGN_DEFAULT_BATCH_SIZE = 100;
const REMINDER_CAMPAIGN_DEFAULT_BATCH_DELAY_MINUTES = 10;
const REMINDER_CAMPAIGN_PROCESSOR_INTERVAL_MS = 60 * 1000;
const EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_SIZE = 100;
const EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_DELAY_MINUTES = 5;
const EXAM_SCHEDULE_EMAIL_PROCESSOR_INTERVAL_MS = 60 * 1000;
const SPECIAL_EXAM_RESCHEDULE_MAX_RECIPIENTS = 500;
const DEFAULT_SPECIAL_EXAM_RESCHEDULE_SUBJECT = "LDSP Special Examination Reschedule Notice";
const DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL = "March 23, 2026";
const DEFAULT_WALK_IN_SCHOLARSHIP_TYPE = "Revised Daet Expanded Scholarship Program";
const PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE = "Exam room lookup is temporarily unavailable. Please try again later.";
const PUBLIC_LOOKUP_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const PUBLIC_LOOKUP_RATE_LIMIT_MAX_REQUESTS = 12;
const AUTH_IDENTIFIER_LOOKUP_UNAVAILABLE_MESSAGE = "Mobile account lookup is not available on this host yet. Use your registered email for now.";
const AUTH_IDENTIFIER_LOOKUP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_IDENTIFIER_LOOKUP_RATE_LIMIT_MAX_REQUESTS = 20;
const WALK_IN_TEMP_PASSWORD_LENGTH = 16;
const SUPABASE_FETCH_LIMIT = 1000;
const SUPPORT_FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61583672829501";
const CORRECTION_TARGET_LABELS = {
    full_application: "Entire Application Form",
    applicant_photo: "Applicant 1x1 Photo",
    personal_information: "Personal Information",
    address_contact: "Address and Contact",
    education_background: "Education Background",
    family_background: "Family Background",
    spouse_information: "Married / Spouse Section"
};
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_STAFF_PASSWORD_LENGTH = 12;
const STAFF_ROLES = new Set(["secretary", "admin", "super_admin"]);
const WALK_IN_ENABLED_STAFF_ROLES = new Set(["secretary", "admin", "super_admin"]);
const EDITABLE_APPLICATION_STATUSES = new Set(["draft", "returned_for_correction"]);
const ALLOWED_SECTOR_CLASSIFICATIONS = new Set([
    "Person with Disability (PWD)",
    "Solo Parent",
    "Child of Solo Parent",
    "Child of Farmer",
    "Child of Fisherfolk",
    "Orphan",
    "None of the above"
]);
const ROOT_STATIC_FILES = [
    "index.html",
    "login.html",
    "register.html",
    "verify-account.html",
    "exam-room-lookup.html",
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
let reminderCampaignProcessorRunning = false;
let reminderCampaignProcessorInterval = null;
let examScheduleEmailProcessorRunning = false;
let examScheduleEmailProcessorInterval = null;
const authIdentifierLookupRateLimitState = new Map();
const publicLookupRateLimitState = new Map();
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

function requestClientAddress(request) {
    const forwardedFor = (request.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
    if (forwardedFor) {
        return forwardedFor;
    }

    return (
        request.ip ||
        (request.socket && request.socket.remoteAddress) ||
        ""
    ).toString().trim() || "unknown";
}

function consumeRateLimit(store, key, windowMs, maxRequests) {
    const now = Date.now();
    const timestamps = (store.get(key) || []).filter(function (timestamp) {
        return now - timestamp < windowMs;
    });

    if (timestamps.length >= maxRequests) {
        store.set(key, timestamps);
        return {
            allowed: false,
            retryAfterSeconds: Math.ceil((windowMs - (now - timestamps[0])) / 1000)
        };
    }

    timestamps.push(now);
    store.set(key, timestamps);
    return {
        allowed: true,
        retryAfterSeconds: 0
    };
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

function upperTextOrNull(value) {
    const text = nullIfBlank(value);
    return text ? text.toUpperCase() : null;
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((value || "").toString().trim());
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

function explainAccountClaimError(message) {
    const text = (message || "").toString();
    const normalized = text.toLowerCase();

    if (normalized.includes("user already registered")) {
        return "Email address is already registered.";
    }
    if (
        normalized.includes("profiles_email_key") ||
        (normalized.includes("duplicate key value") && normalized.includes("email"))
    ) {
        return "Email address is already used by another account.";
    }
    if (normalized.includes("password")) {
        return text || "Password did not meet the required security rules.";
    }
    return text || "Claim account update failed.";
}

function generateTemporaryApplicantPassword() {
    const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lowercase = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%^&*";
    const all = uppercase + lowercase + digits + symbols;
    const required = [
        uppercase[Math.floor(Math.random() * uppercase.length)],
        lowercase[Math.floor(Math.random() * lowercase.length)],
        digits[Math.floor(Math.random() * digits.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
    ];

    while (required.length < WALK_IN_TEMP_PASSWORD_LENGTH) {
        const randomIndex = crypto.randomInt(0, all.length);
        required.push(all[randomIndex]);
    }

    for (let index = required.length - 1; index > 0; index -= 1) {
        const swapIndex = crypto.randomInt(0, index + 1);
        const temp = required[index];
        required[index] = required[swapIndex];
        required[swapIndex] = temp;
    }

    return required.join("");
}

function isValidSchoolYear(value) {
    return /^[0-9]{4}-[0-9]{4}$/.test((value || "").toString().trim());
}

function normalizeSectorClassification(value) {
    const text = nullIfBlank(value);
    if (!text) {
        return null;
    }
    return ALLOWED_SECTOR_CLASSIFICATIONS.has(text) ? text : "";
}

function buildFullName(firstName, middleName, lastName) {
    return [firstName, middleName || "", lastName]
        .map(function (value) { return (value || "").toString().trim(); })
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizePublicLookupName(value) {
    return (value || "")
        .toString()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function explainWalkInApplicationError(message) {
    const text = (message || "").toString();
    const normalized = text.toLowerCase();

    if (normalized.includes("one application") || normalized.includes("already has an application")) {
        return "This applicant already has an application for the selected school year.";
    }
    if (normalized.includes("applications_school_year_format")) {
        return "School year must follow YYYY-YYYY format.";
    }
    if (normalized.includes("applications_sector_classification_check")) {
        return "Sector classification value is not recognized.";
    }
    return text || "Walk-in application creation failed.";
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

function normalizeCorrectionTargetKey(value) {
    const normalized = (value || "").toString().trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CORRECTION_TARGET_LABELS, normalized) ? normalized : "";
}

function normalizeCorrectionTargetKeys(rawValue) {
    let values = [];
    if (Array.isArray(rawValue)) {
        values = rawValue.slice();
    } else if (typeof rawValue === "string") {
        values = rawValue.split(",");
    } else if (rawValue) {
        values = [rawValue];
    }

    const seen = {};
    return values
        .map(function (item) {
            return normalizeCorrectionTargetKey(item);
        })
        .filter(function (item) {
            if (!item || seen[item]) {
                return false;
            }
            seen[item] = true;
            return true;
        });
}

function parseCorrectionTargetKeys(rawValue, fallbackTarget) {
    const values = normalizeCorrectionTargetKeys(rawValue);
    if (fallbackTarget) {
        const fallback = normalizeCorrectionTargetKey(fallbackTarget);
        if (fallback && !values.includes(fallback)) {
            values.push(fallback);
        }
    }
    if (values.includes("full_application")) {
        return ["full_application"];
    }
    return values;
}

function correctionTargetLabel(targetKey) {
    return CORRECTION_TARGET_LABELS[targetKey] || CORRECTION_TARGET_LABELS.full_application;
}

function correctionTargetsSummary(targetKeys) {
    const keys = parseCorrectionTargetKeys(targetKeys);
    const effectiveTargets = keys.length ? keys : ["full_application"];
    const labels = effectiveTargets.map(function (key) {
        return correctionTargetLabel(key);
    });

    if (labels.length === 1) {
        return labels[0];
    }
    if (labels.length === 2) {
        return labels[0] + " and " + labels[1];
    }
    return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
}

function buildComplianceUpdateUrl(baseUrl, applicationId, correctionTarget, correctionTargets, remarks) {
    if (!baseUrl || !applicationId) {
        return "";
    }

    const effectiveTargets = parseCorrectionTargetKeys(correctionTargets, correctionTarget);
    const primaryTarget = normalizeCorrectionTargetKey(correctionTarget) || effectiveTargets[0] || "full_application";
    const params = new URLSearchParams();
    params.set("application_id", applicationId);
    params.set("correction", primaryTarget);
    params.set("correction_type", "compliance");
    if (effectiveTargets.length) {
        params.set("correction_targets", effectiveTargets.join(","));
    }
    if (remarks) {
        params.set("correction_note", remarks.slice(0, 500));
    }
    return baseUrl + "/APPLICANT/applicant-application-form.html?" + params.toString();
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
        '<p>Please update: <strong>' + escapeHtml(details.targetSummary) + "</strong></p>" +
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
        "Please update: " + details.targetSummary,
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

function formatExamScheduleDateTime(value) {
    if (!value) {
        return "";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function buildExamScheduleDetailUrl(baseUrl, applicationId) {
    if (!baseUrl || !applicationId) {
        return "";
    }
    return baseUrl + "/APPLICANT/application-detail.html?id=" + encodeURIComponent(applicationId);
}

function buildExamRoomLookupUrl(baseUrl, applicationNo) {
    if (!baseUrl) {
        return "";
    }
    return baseUrl + "/exam-room-lookup.html";
}

function buildExamScheduleEmailHtml(details) {
    const detailButton = details.detailUrl
        ? '<a href="' + escapeHtml(details.detailUrl) + '" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">Open Application Tracking</a>'
        : "";
    const lookupButton = details.lookupUrl
        ? '<a href="' + escapeHtml(details.lookupUrl) + '" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#ffffff;color:#111827;text-decoration:none;font-weight:700;font-size:14px;border:1px solid #cbd5e1;">Open Public Room Checker</a>'
        : "";
    const noteBlock = details.customMessage
        ? (
            '<div style="margin-top:20px;padding:16px 18px;border:1px solid #dbe3ee;border-radius:14px;background:#f8fafc;">' +
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Office Reminder</div>' +
            '<div style="font-size:14px;line-height:1.7;color:#1f2937;white-space:pre-wrap;">' + escapeHtml(details.customMessage) + "</div>" +
            "</div>"
        )
        : "";
    const supportBlock = SUPPORT_FACEBOOK_PAGE_URL
        ? (
            '<div style="margin-top:18px;padding:14px 16px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;">' +
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Need Help?</div>' +
            '<div style="font-size:14px;line-height:1.65;">If you cannot see your room assignment, please contact the LDSP Support Facebook Page: <a href="' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + '" style="color:#c2410c;font-weight:700;word-break:break-all;">' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + "</a>.</div>" +
            "</div>"
        )
        : "";

    return (
        '<div style="margin:0;padding:24px 12px;background:#eef2f7;font-family:Arial,sans-serif;color:#111827;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;border-collapse:collapse;background:#ffffff;border:1px solid #dbe3ee;border-radius:22px;overflow:hidden;box-shadow:0 12px 30px rgba(15,23,42,0.08);">' +
        '<tr>' +
        '<td style="padding:0;">' +
        '<div style="height:6px;background:linear-gradient(90deg,#f59e0b 0%,#111827 100%);font-size:0;line-height:0;">&nbsp;</div>' +
        '<div style="padding:26px 28px 18px;background:linear-gradient(180deg,#f8fafc 0%,#ffffff 100%);border-bottom:1px solid #e5e7eb;">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">LDSP LGU Daet Scholarship System</div>' +
        '<div style="font-size:28px;line-height:1.2;font-weight:800;color:#0f172a;margin-bottom:8px;">Exam Schedule Notice</div>' +
        '<div style="font-size:15px;line-height:1.7;color:#475569;">Your official examination schedule has been posted. Please review your assigned room details below and keep this notice for exam day reference.</div>' +
        '</div>' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding:28px;">' +
        '<div style="font-size:16px;line-height:1.7;color:#111827;margin-bottom:18px;">Good day <strong>' + escapeHtml(details.applicantName) + '</strong>,</div>' +
        '<div style="padding:16px 18px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.7;">Your scholarship examination is now <strong style="color:#0f172a;">scheduled</strong>. Please arrive prepared and review the official assignment details below.</div>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;border-collapse:separate;border-spacing:0;">' +
        '<tr>' +
        '<td width="50%" valign="top" style="padding:0 8px 12px 0;">' +
        '<div style="padding:18px;border:1px solid #dbe3ee;border-radius:16px;background:#ffffff;">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Assigned Room</div>' +
        '<div style="font-size:28px;line-height:1.15;font-weight:800;color:#0f172a;">' + escapeHtml(details.roomLabel || "-") + '</div>' +
        '</div>' +
        '</td>' +
        '<td width="50%" valign="top" style="padding:0 0 12px 8px;">' +
        '<div style="padding:18px;border:1px solid #dbe3ee;border-radius:16px;background:#ffffff;">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Seat Number</div>' +
        '<div style="font-size:28px;line-height:1.15;font-weight:800;color:#0f172a;">' + escapeHtml(details.seatNo || "-") + '</div>' +
        '</div>' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '<div style="margin-top:8px;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;background:#ffffff;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr><td colspan="2" style="padding:16px 18px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Official Schedule Details</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;width:34%;">Application No.</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111827;">' + escapeHtml(details.applicationNo) + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Batch</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.batchLabel) + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Exam Date</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.scheduleLabel || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Venue</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.venue || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Exam Control No.</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.examControlNo || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;font-size:13px;font-weight:700;color:#64748b;">Please Bring</td><td style="padding:14px 18px;font-size:14px;color:#111827;">Valid school ID or any valid ID, plus one black ballpen.</td></tr>' +
        '</table>' +
        '</div>' +
        noteBlock +
        '<div style="margin-top:22px;">' +
        (detailButton ? '<div style="display:inline-block;margin:0 10px 10px 0;">' + detailButton + '</div>' : "") +
        (lookupButton ? '<div style="display:inline-block;margin:0 10px 10px 0;">' + lookupButton + '</div>' : "") +
        '</div>' +
        '<div style="margin-top:8px;font-size:13px;line-height:1.7;color:#64748b;">Use the Public Room Checker if you only need to confirm your assigned room and seat. You will be asked to enter your full name together with your LDSP application number.</div>' +
        supportBlock +
        '<div style="margin-top:22px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.7;color:#475569;">Please keep this email for your reference and follow the scholarship office instructions on exam day.</div>' +
        '<div style="margin-top:12px;font-size:14px;font-weight:700;color:#0f172a;">LDSP LGU Daet Scholarship System</div>' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td></tr>' +
        '</table>' +
        '</div>'
    );
}

function buildExamScheduleEmailText(details) {
    const lines = [
        "Good day " + details.applicantName + ",",
        "",
        "Your scholarship examination is now scheduled. Please review the details below and be present on time.",
        "Application No.: " + details.applicationNo,
        "Batch: " + details.batchLabel,
        "Exam Schedule: " + (details.scheduleLabel || "-"),
        "Venue: " + (details.venue || "-"),
        "Room: " + (details.roomLabel || "-"),
        "Seat No.: " + (details.seatNo || "-"),
        "Exam Control No.: " + (details.examControlNo || "-")
    ];

    if (details.customMessage) {
        lines.push("", "Office Note:", details.customMessage);
    }

    if (details.detailUrl) {
        lines.push("Tracking link: " + details.detailUrl);
    }
    if (details.lookupUrl) {
        lines.push("Public room checker: " + details.lookupUrl);
        lines.push("Use your full name together with your LDSP application number to verify the posted room assignment.");
    }
    if (SUPPORT_FACEBOOK_PAGE_URL) {
        lines.push("If you cannot see your room assignment, please contact the LDSP Support Facebook Page: " + SUPPORT_FACEBOOK_PAGE_URL);
    }

    lines.push("", "LDSP LGU Daet Scholarship System");
    return lines.filter(Boolean).join("\n");
}

async function sendExamScheduleEmailMail(details) {
    const transporter = getMailTransporter();
    const mailOptions = {
        from: MAIL_FROM,
        to: details.email,
        subject: "LDSP Exam Schedule Notice - " + details.applicationNo,
        text: buildExamScheduleEmailText(details),
        html: buildExamScheduleEmailHtml(details)
    };

    if (MAIL_REPLY_TO) {
        mailOptions.replyTo = MAIL_REPLY_TO;
    }

    await transporter.sendMail(mailOptions);
}

function formatSpecialExamDateLabel(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || "").toString().trim());
    if (!match) {
        return (value || "").toString().trim();
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
    });
}

function formatSpecialExamTimeLabel(value) {
    const match = /^(\d{2}):(\d{2})$/.exec((value || "").toString().trim());
    if (!match) {
        return (value || "").toString().trim();
    }

    const rawHour = Number(match[1]);
    const minute = match[2];
    const suffix = rawHour >= 12 ? "PM" : "AM";
    const hour = rawHour % 12 || 12;
    return hour + ":" + minute + " " + suffix;
}

function buildSpecialExamScheduleLabel(scheduleDate, reportingTime) {
    const dateLabel = formatSpecialExamDateLabel(scheduleDate);
    const timeLabel = formatSpecialExamTimeLabel(reportingTime);

    if (dateLabel && timeLabel) {
        return dateLabel + " at " + timeLabel;
    }
    return dateLabel || timeLabel || "";
}

function normalizeSpecialExamRecipientList(rawRecipients) {
    const recipientList = Array.isArray(rawRecipients) ? rawRecipients : [];
    const normalizedRecipients = [];
    const skippedRecipients = [];
    const seenEmails = new Set();
    const seenPairs = new Set();

    recipientList.forEach(function (entry, index) {
        const fullName = nullIfBlank(
            entry && (
                entry.fullName ||
                entry.full_name ||
                entry.name
            )
        );
        const email = normalizeEmailAddress(
            entry && (
                entry.email ||
                entry.email_address ||
                entry.emailAddress
            )
        );

        if (!fullName) {
            skippedRecipients.push({
                row: index + 1,
                email: email,
                reason: "Missing full name."
            });
            return;
        }
        if (!email) {
            skippedRecipients.push({
                row: index + 1,
                full_name: fullName,
                reason: "Missing email address."
            });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            skippedRecipients.push({
                row: index + 1,
                full_name: fullName,
                email: email,
                reason: "Invalid email address format."
            });
            return;
        }

        const pairKey = fullName.toLowerCase() + "|" + email;
        if (seenPairs.has(pairKey) || seenEmails.has(email)) {
            skippedRecipients.push({
                row: index + 1,
                full_name: fullName,
                email: email,
                reason: "Duplicate recipient email."
            });
            return;
        }

        seenPairs.add(pairKey);
        seenEmails.add(email);
        normalizedRecipients.push({
            fullName: fullName,
            email: email
        });
    });

    return {
        recipients: normalizedRecipients,
        skipped: skippedRecipients
    };
}

function buildSpecialExamRescheduleEmailHtml(details) {
    const scheduleLabel = buildSpecialExamScheduleLabel(details.scheduleDate, details.reportingTime);
    const noteBlock = details.instructions
        ? (
            '<div style="margin-top:20px;padding:16px 18px;border:1px solid #dbe3ee;border-radius:14px;background:#f8fafc;">' +
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Office Reminder</div>' +
            '<div style="font-size:14px;line-height:1.7;color:#1f2937;white-space:pre-wrap;">' + escapeHtml(details.instructions) + "</div>" +
            "</div>"
        )
        : "";
    const roomRow = details.room
        ? '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Room / Area</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.room) + "</td></tr>"
        : "";
    const supportBlock = SUPPORT_FACEBOOK_PAGE_URL
        ? (
            '<div style="margin-top:18px;padding:14px 16px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;">' +
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Need Help?</div>' +
            '<div style="font-size:14px;line-height:1.65;">For questions about the rescheduled examination, please contact the LDSP Support Facebook Page: <a href="' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + '" style="color:#c2410c;font-weight:700;word-break:break-all;">' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + "</a>.</div>" +
            "</div>"
        )
        : "";

    return (
        '<div style="margin:0;padding:24px 12px;background:#eef2f7;font-family:Arial,sans-serif;color:#111827;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr><td align="center">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:720px;border-collapse:collapse;background:#ffffff;border:1px solid #dbe3ee;border-radius:22px;overflow:hidden;box-shadow:0 12px 30px rgba(15,23,42,0.08);">' +
        '<tr>' +
        '<td style="padding:0;">' +
        '<div style="height:6px;background:linear-gradient(90deg,#f59e0b 0%,#111827 100%);font-size:0;line-height:0;">&nbsp;</div>' +
        '<div style="padding:26px 28px 18px;background:linear-gradient(180deg,#f8fafc 0%,#ffffff 100%);border-bottom:1px solid #e5e7eb;">' +
        '<div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">LDSP LGU Daet Scholarship System</div>' +
        '<div style="font-size:28px;line-height:1.2;font-weight:800;color:#0f172a;margin-bottom:8px;">Special Examination Reschedule Notice</div>' +
        '<div style="font-size:15px;line-height:1.7;color:#475569;">Your scholarship examination schedule has been updated. Please review the new special examination details below and keep this notice for your reference.</div>' +
        '</div>' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding:28px;">' +
        '<div style="font-size:16px;line-height:1.7;color:#111827;margin-bottom:18px;">Good day <strong>' + escapeHtml(details.applicantName) + '</strong>,</div>' +
        '<div style="padding:16px 18px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:14px;line-height:1.7;">You are scheduled for a <strong style="color:#0f172a;">special examination</strong>. Please follow the updated reporting schedule below and arrive early for check-in.</div>' +
        '<div style="margin-top:20px;border:1px solid #dbe3ee;border-radius:18px;overflow:hidden;background:#ffffff;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr><td colspan="2" style="padding:16px 18px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Updated Examination Details</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;width:34%;">Examinee</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111827;">' + escapeHtml(details.applicantName) + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Exam Date</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(formatSpecialExamDateLabel(details.scheduleDate) || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Reporting Time</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(formatSpecialExamTimeLabel(details.reportingTime) || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Schedule</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(scheduleLabel || "-") + '</td></tr>' +
        '<tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#64748b;">Venue</td><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">' + escapeHtml(details.venue || "-") + '</td></tr>' +
        roomRow +
        '<tr><td style="padding:14px 18px;font-size:13px;font-weight:700;color:#64748b;">Please Bring</td><td style="padding:14px 18px;font-size:14px;color:#111827;">Valid school ID or any valid ID, plus one black ballpen.</td></tr>' +
        '</table>' +
        '</div>' +
        noteBlock +
        supportBlock +
        '<div style="margin-top:22px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.7;color:#475569;">Please keep this email for your reference and follow the scholarship office instructions on your special examination day.</div>' +
        '<div style="margin-top:12px;font-size:14px;font-weight:700;color:#0f172a;">LDSP LGU Daet Scholarship System</div>' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td></tr>' +
        '</table>' +
        '</div>'
    );
}

function buildSpecialExamRescheduleEmailText(details) {
    const lines = [
        "Good day " + details.applicantName + ",",
        "",
        "Your scholarship examination has been rescheduled for a special examination schedule.",
        "Exam Date: " + (formatSpecialExamDateLabel(details.scheduleDate) || "-"),
        "Reporting Time: " + (formatSpecialExamTimeLabel(details.reportingTime) || "-"),
        "Venue: " + (details.venue || "-")
    ];

    if (details.room) {
        lines.push("Room / Area: " + details.room);
    }

    lines.push("Please Bring: Valid school ID or any valid ID, plus one black ballpen.");

    if (details.instructions) {
        lines.push("", "Office Reminder:", details.instructions);
    }

    if (SUPPORT_FACEBOOK_PAGE_URL) {
        lines.push("", "For questions, please contact the LDSP Support Facebook Page: " + SUPPORT_FACEBOOK_PAGE_URL);
    }

    lines.push("", "LDSP LGU Daet Scholarship System");
    return lines.filter(Boolean).join("\n");
}

async function sendSpecialExamRescheduleMail(details) {
    const transporter = getMailTransporter();
    const mailOptions = {
        from: MAIL_FROM,
        to: details.email,
        subject: details.subject || DEFAULT_SPECIAL_EXAM_RESCHEDULE_SUBJECT,
        text: buildSpecialExamRescheduleEmailText(details),
        html: buildSpecialExamRescheduleEmailHtml(details)
    };

    if (MAIL_REPLY_TO) {
        mailOptions.replyTo = MAIL_REPLY_TO;
    }

    await transporter.sendMail(mailOptions);
}

function normalizeEmailAddress(value) {
    return (value || "").toString().trim().toLowerCase();
}

function buildPasswordResetRedirectUrl(baseUrl) {
    if (!baseUrl) {
        return "";
    }
    return assetUrl(baseUrl, "reset-password.html");
}

async function sendApplicantAccessResetEmail(email, baseUrl) {
    const anonClient = createSupabaseClient();
    const redirectTo = buildPasswordResetRedirectUrl(baseUrl);
    const options = redirectTo
        ? { redirectTo: redirectTo }
        : undefined;
    const result = await anonClient.auth.resetPasswordForEmail(email, options);
    if (result.error) {
        throw new Error(result.error.message || "Failed to send the password reset email.");
    }
}

function uniqueNonBlankStrings(values) {
    return Array.from(new Set((values || []).map(function (value) {
        return (value || "").toString().trim();
    }).filter(Boolean)));
}

async function loadExamScheduleRecipientsForBatch(request, batchId, targetApplicationIds) {
    const wantedApplicationIds = uniqueNonBlankStrings(targetApplicationIds);
    const batchResult = await request.auth.client
        .from("exam_batches")
        .select("id, batch_label, exam_datetime, venue, notes")
        .eq("id", batchId)
        .maybeSingle();

    if (batchResult.error || !batchResult.data) {
        throw new Error("Selected exam batch was not found.");
    }

    let scheduledRecords = [];
    for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
        let recordsQuery = request.auth.client
            .from("exam_records")
            .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, room_label, room_seat_no")
            .eq("batch_id", batchId)
            .eq("status", "scheduled")
            .order("updated_at", { ascending: false })
            .range(from, from + SUPABASE_FETCH_LIMIT - 1);

        if (wantedApplicationIds.length === 1) {
            recordsQuery = recordsQuery.eq("application_id", wantedApplicationIds[0]);
        } else if (wantedApplicationIds.length > 1) {
            recordsQuery = recordsQuery.in("application_id", wantedApplicationIds);
        }

        let recordsResult = await recordsQuery;

        if (recordsResult.error && /room_label|room_seat_no/i.test(recordsResult.error.message || "")) {
            let fallbackQuery = request.auth.client
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, status")
                .eq("batch_id", batchId)
                .eq("status", "scheduled")
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (wantedApplicationIds.length === 1) {
                fallbackQuery = fallbackQuery.eq("application_id", wantedApplicationIds[0]);
            } else if (wantedApplicationIds.length > 1) {
                fallbackQuery = fallbackQuery.in("application_id", wantedApplicationIds);
            }

            recordsResult = await fallbackQuery;

            if (!recordsResult.error) {
                recordsResult.data = (recordsResult.data || []).map(function (row) {
                    return Object.assign({}, row, {
                        room_label: "",
                        room_seat_no: null
                    });
                });
            }
        }

        if (recordsResult.error) {
            throw new Error(recordsResult.error.message || "Failed to load scheduled exam records.");
        }

        const recordBatch = (recordsResult.data || []).filter(function (row) {
            return row && row.application_id;
        });
        scheduledRecords.push.apply(scheduledRecords, recordBatch);
        if (recordBatch.length < SUPABASE_FETCH_LIMIT || wantedApplicationIds.length > 0) {
            break;
        }
    }

    if (!scheduledRecords.length) {
        return {
            batch: batchResult.data,
            recipients: []
        };
    }

    const applicationIds = Array.from(new Set(scheduledRecords.map(function (row) {
        return row.application_id;
    }).filter(Boolean)));
    const applicationRows = [];
    for (let start = 0; start < applicationIds.length; start += 200) {
        const chunk = applicationIds.slice(start, start + 200);
        const applicationsResult = await request.auth.client
            .from("applications")
            .select("id, application_no, applicant_id, status")
            .in("id", chunk);

        if (applicationsResult.error) {
            throw new Error(applicationsResult.error.message || "Failed to load scheduled applications.");
        }

        applicationRows.push.apply(applicationRows, applicationsResult.data || []);
    }

    const applicationMap = {};
    const applicantIds = [];
    applicationRows.forEach(function (row) {
        applicationMap[row.id] = row;
        if (row.applicant_id) {
            applicantIds.push(row.applicant_id);
        }
    });

    const uniqueApplicantIds = Array.from(new Set(applicantIds.filter(Boolean)));
    const profileMap = {};
    for (let start = 0; start < uniqueApplicantIds.length; start += 200) {
        const chunk = uniqueApplicantIds.slice(start, start + 200);
        const profilesResult = await request.auth.client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, email")
            .in("id", chunk);

        if (profilesResult.error) {
            throw new Error(profilesResult.error.message || "Failed to load applicant profiles.");
        }

        (profilesResult.data || []).forEach(function (row) {
            profileMap[row.id] = row;
        });
    }

    const baseUrl = resolveBaseUrl(request);
    const recipients = scheduledRecords.map(function (record) {
        const application = applicationMap[record.application_id] || null;
        const profile = application && application.applicant_id ? (profileMap[application.applicant_id] || null) : null;
        const applicantName = buildFullName(
            profile && profile.first_name ? profile.first_name : "",
            profile && profile.middle_name ? profile.middle_name : "",
            profile && profile.last_name ? profile.last_name : ""
        ) || ((profile && profile.email) || "Applicant");
        const scheduleLabel = formatExamScheduleDateTime(record.scheduled_at || batchResult.data.exam_datetime || "");
        return {
            applicationId: record.application_id,
            applicantId: application && application.applicant_id ? application.applicant_id : "",
            applicationNo: application && application.application_no ? application.application_no : "LDSP Application",
            applicantName: applicantName,
            email: normalizeEmailAddress((profile && profile.email) || ""),
            batchLabel: batchResult.data.batch_label || "Exam Batch",
            scheduleLabel: scheduleLabel,
            venue: batchResult.data.venue || "",
            roomLabel: record.room_label || "",
            seatNo: record.room_seat_no == null ? "" : String(record.room_seat_no),
            examControlNo: record.exam_control_no || "",
            detailUrl: buildExamScheduleDetailUrl(baseUrl, record.application_id),
            lookupUrl: buildExamRoomLookupUrl(baseUrl, application && application.application_no ? application.application_no : "")
        };
    }).filter(function (item) {
        return item.applicationId && item.applicantId;
    });

    return {
        batch: batchResult.data,
        recipients: recipients
    };
}

function buildExamScheduleNotificationEntry(item, senderUserId) {
    let message = "Your scholarship exam is now scheduled on " + (item.scheduleLabel || "the posted date") + " at " + (item.venue || "the assigned venue") + ".";
    if (item.roomLabel) {
        message += " Room: " + item.roomLabel + ".";
    }
    if (item.examControlNo) {
        message += " Control No.: " + item.examControlNo + ".";
    }
    message += " Please check your email for the full exam instructions.";

    return {
        recipient_user_id: item.applicantId,
        sender_user_id: senderUserId,
        notification_type: "application",
        title: "Exam Schedule Available",
        message: message,
        related_application_id: item.applicationId,
        related_url: "application-detail.html?id=" + encodeURIComponent(item.applicationId)
    };
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

function assetUrl(baseUrl, relativePath) {
    if (!baseUrl || !relativePath) {
        return "";
    }
    return baseUrl.replace(/\/+$/g, "") + "/" + relativePath.replace(/^\/+/g, "");
}

function reminderContactEmail() {
    const email = (MAIL_REPLY_TO || MAIL_FROM || "").toString().trim();
    return email.includes("@") ? email : "";
}

function reminderSupportFacebookUrl() {
    return SUPPORT_FACEBOOK_PAGE_URL;
}

function normalizeReminderScheduleTime(value) {
    const raw = (value || "").toString().trim();
    const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? (match[1] + ":" + match[2]) : "";
}

function formatReminderScheduleTime(value) {
    const normalized = normalizeReminderScheduleTime(value);
    if (!normalized) {
        return "";
    }
    const parts = normalized.split(":");
    const hours = Number(parts[0]);
    const minutes = parts[1];
    const suffix = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    return hour12 + ":" + minutes + " " + suffix;
}

function formatReminderScheduleDate(value) {
    const raw = (value || "").toString().trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return "";
    }
    const parsed = new Date(match[1] + "-" + match[2] + "-" + match[3] + "T12:00:00Z");
    if (Number.isNaN(parsed.getTime())) {
        return raw;
    }
    return parsed.toLocaleDateString("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}

function isMissingRelationMessage(message) {
    const text = (message || "").toString().toLowerCase();
    return text.includes("does not exist") || text.includes("relation") && text.includes("audit_logs");
}

async function writeAuditLogEntry(client, entry) {
    if (!client || !entry || !entry.action || !entry.summary) {
        return;
    }

    const payload = {
        module: nullIfBlank(entry.module) || "system_admin",
        action: entry.action,
        actor_id: nullIfBlank(entry.actor_id),
        actor_role: entry.actor_role || "super_admin",
        target_user_id: nullIfBlank(entry.target_user_id),
        target_role: nullIfBlank(entry.target_role),
        target_email: nullIfBlank(entry.target_email),
        target_label: nullIfBlank(entry.target_label),
        record_type: nullIfBlank(entry.record_type) || "system",
        record_id: nullIfBlank(entry.record_id),
        summary: entry.summary,
        details: entry.details && typeof entry.details === "object" ? entry.details : {}
    };

    try {
        const result = await client.from("audit_logs").insert(payload);
        if (result.error && !isMissingRelationMessage(result.error.message)) {
            console.error("Audit log insert failed:", result.error.message || result.error);
        }
    } catch (error) {
        if (!isMissingRelationMessage(error && error.message)) {
            console.error("Audit log insert failed:", error && error.message ? error.message : error);
        }
    }
}

function emptyWalkInOfficeStatus() {
    return {
        is_walk_in_account: false,
        is_claimed: false,
        has_office_temp_access: false,
        walk_in_created_at: null,
        claimed_at: null,
        audit_available: true
    };
}

async function loadWalkInOfficeStatus(adminClient, userId) {
    const status = emptyWalkInOfficeStatus();
    if (!adminClient || !userId) {
        return status;
    }

    try {
        const auditResult = await adminClient
            .from("audit_logs")
            .select("action, created_at")
            .eq("target_user_id", userId)
            .in("action", ["create_walk_in_application", "claim_applicant_account"])
            .order("created_at", { ascending: false });

        if (auditResult.error) {
            if (isMissingRelationMessage(auditResult.error.message)) {
                status.audit_available = false;
            } else {
                throw new Error(auditResult.error.message || "Failed to load walk-in audit history.");
            }
        } else {
            (auditResult.data || []).forEach(function (row) {
                const action = (row && row.action ? row.action : "").toString().trim().toLowerCase();
                if (action === "create_walk_in_application" && !status.walk_in_created_at) {
                    status.is_walk_in_account = true;
                    status.walk_in_created_at = row.created_at || null;
                }
                if (action === "claim_applicant_account" && !status.claimed_at) {
                    status.is_claimed = true;
                    status.claimed_at = row.created_at || null;
                }
            });
        }
    } catch (error) {
        throw new Error(error && error.message ? error.message : "Failed to load walk-in audit history.");
    }

    if (!status.is_walk_in_account) {
        const applicationResult = await adminClient
            .from("applications")
            .select("id, created_at, secretary_remarks")
            .eq("applicant_id", userId)
            .ilike("secretary_remarks", "Walk-in intake encoded by office%")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (applicationResult.error) {
            throw new Error(applicationResult.error.message || "Failed to load walk-in application history.");
        }

        if (applicationResult.data) {
            status.is_walk_in_account = true;
            status.walk_in_created_at = applicationResult.data.created_at || null;
        }
    }

    status.has_office_temp_access = status.is_walk_in_account && !status.is_claimed;
    return status;
}

async function listAllAuthUsers(adminClient) {
    const users = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
        const result = await adminClient.auth.admin.listUsers({
            page: page,
            perPage: perPage
        });
        const batch = result && result.data
            ? (
                Array.isArray(result.data.users)
                    ? result.data.users
                    : (Array.isArray(result.data) ? result.data : [])
            )
            : [];

        if (result.error) {
            throw new Error(result.error.message || "Failed to list auth users.");
        }

        users.push.apply(users, batch);
        if (batch.length < perPage) {
            break;
        }
        page += 1;
    }

    return users;
}

function formatReminderDeadlineLabel(dateValue, timeValue) {
    const dateLabel = formatReminderScheduleDate(dateValue);
    if (!dateLabel) {
        return DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL;
    }
    const timeLabel = formatReminderScheduleTime(timeValue);
    return timeLabel ? (dateLabel + " at " + timeLabel) : dateLabel;
}

async function loadActiveSubmissionDeadlineLabel(client) {
    if (!client) {
        return DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL;
    }

    const result = await client
        .from("ranking_settings")
        .select("application_close_date, ranking_basis")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (result.error || !result.data) {
        return DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL;
    }

    const controls = result.data.ranking_basis && result.data.ranking_basis.controls
        ? result.data.ranking_basis.controls
        : {};
    return formatReminderDeadlineLabel(
        result.data.application_close_date || "",
        controls.application_close_time || ""
    );
}

async function loadActiveRankingSettingsForOffice(adminClient) {
    if (!adminClient) {
        return {
            schoolYear: "",
            controls: {}
        };
    }

    const result = await adminClient
        .from("ranking_settings")
        .select("school_year, ranking_basis")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (result.error || !result.data) {
        return {
            schoolYear: "",
            controls: {}
        };
    }

    return {
        schoolYear: nullIfBlank(result.data.school_year) || "",
        controls: result.data.ranking_basis && result.data.ranking_basis.controls
            ? result.data.ranking_basis.controls
            : {}
    };
}

function buildNoApplicationReminderEmailHtml(details) {
    const supportFacebookUrl = reminderSupportFacebookUrl();
    const submissionDeadline = details.submissionDeadlineLabel || DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL;
    const greetingName = escapeHtml(details.firstName || details.applicantName || "Applicant");
    const lguLogo = assetUrl(details.baseUrl, "img/daet-lgu.png");
    const portalLogo = assetUrl(details.baseUrl, "img/icon.png");
    const maogmaLogo = assetUrl(details.baseUrl, "img/maogma.png");
    const actionUrl = details.actionUrl ? escapeHtml(details.actionUrl) : "";
    const actionLink = actionUrl
        ? '<a href="' + actionUrl + '" style="display:inline-block;padding:14px 30px;border-radius:14px;background:#2f5bea;color:#ffffff;text-decoration:none;font-size:18px;font-weight:700;">Start Application</a>'
        : "";
    const fallbackBox = actionUrl
        ? '<div style="margin-top:28px;padding:16px 18px;border:1px solid #d9e2f2;border-radius:16px;background:#f8fbff;color:#1f3558;font-size:14px;line-height:1.65;">If the button above does not work, please open this link:<br><a href="' + actionUrl + '" style="color:#2f5bea;word-break:break-all;">' + actionUrl + "</a></div>"
        : "";
    const deadlineBox =
        '<div style="margin-top:18px;padding:16px 18px;border:1px solid #f3c799;border-radius:16px;background:#fff6eb;color:#7c3a10;">' +
        '<div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">Online Application Deadline</div>' +
        '<div style="margin-top:8px;font-size:16px;line-height:1.7;color:#173463;"><strong>Submit your online application form on or before ' + escapeHtml(submissionDeadline) + ".</strong></div>" +
        "</div>";
    const photoReminderBox =
        '<div style="margin-top:18px;padding:16px 18px;border:1px solid #f3c799;border-radius:16px;background:#fffaf3;color:#7c3a10;">' +
        '<div style="font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">Important Photo Reminder</div>' +
        '<div style="margin-top:8px;font-size:15px;line-height:1.75;color:#173463;"><strong>Applicants are required to upload a recent 1x1 ID picture with white background.</strong> Please ensure that the image is clear and properly cropped.</div>' +
        "</div>";
    const supportBox =
        '<div style="margin-top:18px;padding:16px 18px;border:1px solid #b8d1ff;border-radius:16px;background:#eef5ff;color:#173463;font-size:15px;line-height:1.75;">If you need guidance in completing your online application form before <strong>' + escapeHtml(submissionDeadline) + '</strong>, please message our scholarship support team through our official Facebook page: <a href="' + escapeHtml(supportFacebookUrl) + '" style="color:#2f5bea;font-weight:700;word-break:break-all;">LDSP Facebook Page</a>.</div>';
    const footerContact =
        '<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#5f6f8e;">Please do not reply to this email. For inquiries, message our official Facebook page: <a href="' + escapeHtml(supportFacebookUrl) + '" style="color:#2f5bea;word-break:break-all;">' + escapeHtml(supportFacebookUrl) + "</a>.</p>";

    return (
        '<div style="margin:0;padding:32px 18px;background:#f6f2ea;font-family:Arial,sans-serif;color:#163257;">' +
        '<div style="max-width:650px;margin:0 auto;background:#ffffff;border-radius:24px;padding:34px 30px 28px;border:1px solid #e8edf5;box-shadow:0 10px 35px rgba(15,23,42,0.08);">' +
        '<div style="text-align:center;">' +
        '<div style="margin-bottom:18px;font-size:0;">' +
        (lguLogo ? '<img src="' + escapeHtml(lguLogo) + '" alt="LGU Daet" style="height:64px;max-width:120px;object-fit:contain;vertical-align:middle;margin:0 10px 10px;" />' : "") +
        (portalLogo ? '<img src="' + escapeHtml(portalLogo) + '" alt="Iskolar ng Daet" style="height:52px;max-width:112px;object-fit:contain;vertical-align:middle;margin:0 10px 10px;" />' : "") +
        (maogmaLogo ? '<img src="' + escapeHtml(maogmaLogo) + '" alt="Maogma Daet" style="height:42px;max-width:120px;object-fit:contain;vertical-align:middle;margin:0 10px 10px;" />' : "") +
        "</div>" +
        '<div style="font-size:13px;letter-spacing:0.24em;text-transform:uppercase;color:#c45a10;font-weight:700;">Scholarship Portal Reminder</div>' +
        '<div style="margin-top:10px;font-size:26px;line-height:1.2;font-weight:800;color:#0f2647;">Iskolar ng Daet</div>' +
        '<div style="margin-top:8px;font-size:16px;line-height:1.5;color:#61779b;">Municipality of Daet Scholarship Application System</div>' +
        '<div style="margin-top:28px;padding:24px 22px;border:1px solid #b8d1ff;border-radius:18px;background:#eef5ff;">' +
        '<div style="font-size:19px;line-height:1.3;font-weight:800;color:#2a56de;">Application Reminder</div>' +
        '<div style="margin-top:10px;font-size:16px;line-height:1.7;color:#173463;">Complete and submit your scholarship application to continue the review process.</div>' +
        "</div>" +
        "</div>" +
        '<div style="margin-top:30px;font-size:16px;line-height:1.85;color:#173463;">' +
        '<p style="margin:0 0 16px;">Good day <strong>' + greetingName + "</strong>,</p>" +
        '<p style="margin:0 0 16px;">Our records show that you already have an account in the <strong>Iskolar ng Daet Scholarship Portal</strong>, but you do not yet have a <strong>submitted application form</strong>.</p>' +
        '<p style="margin:0 0 18px;">Please complete and submit your application on or before <strong>' + escapeHtml(submissionDeadline) + "</strong> so the scholarship office can review your application on time.</p>" +
        deadlineBox +
        photoReminderBox +
        '<div style="padding:16px 18px;border:1px solid #b8d1ff;border-radius:16px;background:#eef5ff;color:#173463;">Please review your details carefully and make sure all required information and documents are complete before final submission.</div>' +
        supportBox +
        '<div style="margin-top:28px;text-align:center;">' + actionLink + "</div>" +
        fallbackBox +
        '<div style="margin-top:26px;padding-top:22px;border-top:1px solid #e2e8f0;">' +
        '<p style="margin:0;font-size:14px;line-height:1.6;color:#5f6f8e;">This is an automated reminder from the Iskolar ng Daet Scholarship Portal.</p>' +
        footerContact +
        "</div>" +
        "</div>" +
        "</div>" +
        "</div>"
    );
}

function buildReminderEmailHtml(details) {
    if (details.state === "no_application") {
        return buildNoApplicationReminderEmailHtml(details);
    }

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
    if (details.state === "no_application") {
        const supportFacebookUrl = reminderSupportFacebookUrl();
        const submissionDeadline = details.submissionDeadlineLabel || DEFAULT_ONLINE_APPLICATION_SUBMISSION_DEADLINE_LABEL;
        return [
            "Scholarship Portal Reminder",
            "Iskolar ng Daet",
            "",
            "Good day " + (details.firstName || details.applicantName || "Applicant") + ",",
            "",
            "Our records show that you already have an account in the Iskolar ng Daet Scholarship Portal, but you do not yet have a submitted application form.",
            "Please complete and submit your application on or before " + submissionDeadline + " so the scholarship office can review your application on time.",
            "Online application submission deadline: " + submissionDeadline + ".",
            "Important: Applicants are required to upload a recent 1x1 ID picture with white background. Please ensure that the image is clear and properly cropped.",
            "Please review your details carefully and make sure all required information and documents are complete before final submission.",
            "If you need guidance in completing your online application form, message our scholarship support team through the official Facebook page: " + supportFacebookUrl,
            details.actionUrl ? "Start application: " + details.actionUrl : "",
            "",
            "This is an automated reminder from the Iskolar ng Daet Scholarship Portal.",
            "For inquiries, message our official Facebook page: " + supportFacebookUrl,
            "Please do not reply to this email."
        ].filter(Boolean).join("\n");
    }

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

function uniqueReminderRecipientIds(rawRecipientIds) {
    const values = Array.isArray(rawRecipientIds) ? rawRecipientIds : [];
    const seen = {};
    return values.map(function (value) {
        return (value || "").toString().trim();
    }).filter(function (value) {
        if (!value || seen[value]) {
            return false;
        }
        seen[value] = true;
        return true;
    });
}

function normalizeReminderCampaignBatchSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return REMINDER_CAMPAIGN_DEFAULT_BATCH_SIZE;
    }
    return Math.min(500, Math.max(1, Math.floor(parsed)));
}

function normalizeReminderCampaignDelayMinutes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return REMINDER_CAMPAIGN_DEFAULT_BATCH_DELAY_MINUTES;
    }
    return Math.min(1440, Math.max(1, Math.floor(parsed)));
}

function addMinutesToIso(baseValue, minutes) {
    const parsed = new Date(baseValue || Date.now());
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }
    parsed.setMinutes(parsed.getMinutes() + Math.max(1, Number(minutes) || 0));
    return parsed.toISOString();
}

function normalizeReminderJobRecipientIds(rawValue) {
    if (Array.isArray(rawValue)) {
        return uniqueReminderRecipientIds(rawValue);
    }
    return [];
}

async function sendReminderEmailsForRecipients(details) {
    const client = details && details.client;
    const campaignType = ((details && details.campaignType) || "all_visible").toString().trim().toLowerCase();
    const recipientIds = uniqueReminderRecipientIds(details && details.recipientIds);
    const sentBy = nullIfBlank(details && details.sentBy);
    const baseUrl = ((details && details.baseUrl) || "").toString().trim();

    if (!client) {
        throw new Error("Reminder campaign client is unavailable.");
    }
    if (!recipientIds.length) {
        return {
            sent: [],
            skipped: [],
            failed: []
        };
    }

    const submissionDeadlineLabel = await loadActiveSubmissionDeadlineLabel(client);

    const [profilesResult, applicationsResult] = await Promise.all([
        client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, email, role")
            .eq("role", "applicant")
            .in("id", recipientIds),
        client
            .from("applications")
            .select("id, applicant_id, status, updated_at, created_at")
            .in("applicant_id", recipientIds)
    ]);

    if (profilesResult.error) {
        throw new Error(profilesResult.error.message || "Unable to load reminder recipients.");
    }
    if (applicationsResult.error) {
        throw new Error(applicationsResult.error.message || "Unable to inspect application states.");
    }

    const reminderLogsResult = await client
        .from(REMINDER_LOGS_TABLE)
        .select("applicant_id, reminder_type, status, sent_at")
        .in("applicant_id", recipientIds)
        .eq("channel", "email")
        .order("sent_at", { ascending: false });

    if (reminderLogsResult.error) {
        throw new Error(
            isMissingTableError(reminderLogsResult.error, REMINDER_LOGS_TABLE)
                ? "Reminder log table is not available yet. Run reminder_email_logs_hotfix_2026_03_17.sql first."
                : (reminderLogsResult.error.message || "Unable to read reminder log history.")
        );
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

    const reminderLogLookup = buildReminderLogLookup(reminderLogsResult.data || []);
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
                    firstName: (profile.first_name || "").toString().trim(),
                    baseUrl: baseUrl,
                    submissionDeadlineLabel: submissionDeadlineLabel,
                    state: stateInfo.state,
                    actionUrl: reminderActionUrl(baseUrl, stateInfo.state, stateInfo.draftApplicationId)
                });

            const insertResult = await client
                .from(REMINDER_LOGS_TABLE)
                .insert({
                    applicant_id: applicantId,
                    application_id: stateInfo.draftApplicationId || null,
                    reminder_type: stateInfo.state,
                    channel: "email",
                    status: "sent",
                    recipient_email: email,
                    sent_by: sentBy
                });

            if (insertResult.error) {
                throw new Error(insertResult.error.message || "Reminder log write failed.");
            }

            sent.push({ id: applicantId, email: email, state: stateInfo.state });
        } catch (error) {
            try {
                await client
                    .from(REMINDER_LOGS_TABLE)
                    .insert({
                        applicant_id: applicantId,
                        application_id: stateInfo.draftApplicationId || null,
                        reminder_type: stateInfo.state,
                        channel: "email",
                        status: "failed",
                        recipient_email: email,
                        sent_by: sentBy,
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

    return {
        sent: sent,
        skipped: skipped,
        failed: failed
    };
}

async function queueReminderCampaignJob(adminClient, details) {
    const recipientIds = uniqueReminderRecipientIds(details && details.recipientIds);
    const campaignType = ((details && details.campaignType) || "all_visible").toString().trim().toLowerCase();
    const batchSize = normalizeReminderCampaignBatchSize(details && details.batchSize);
    const batchDelayMinutes = normalizeReminderCampaignDelayMinutes(details && details.batchDelayMinutes);
    const baseUrl = ((details && details.baseUrl) || "").toString().trim();
    const createdBy = nullIfBlank(details && details.createdBy);
    const nowIso = new Date().toISOString();

    const insertResult = await adminClient
        .from(REMINDER_CAMPAIGN_JOBS_TABLE)
        .insert({
            campaign_type: campaignType,
            recipient_ids: recipientIds,
            total_recipients: recipientIds.length,
            processed_count: 0,
            sent_count: 0,
            skipped_count: 0,
            failed_count: 0,
            batch_size: batchSize,
            batch_delay_minutes: batchDelayMinutes,
            base_url: baseUrl || null,
            created_by: createdBy,
            status: "queued",
            next_run_at: nowIso
        })
        .select("id, total_recipients, batch_size, batch_delay_minutes, status")
        .single();

    if (insertResult.error) {
        throw new Error(
            isMissingTableError(insertResult.error, REMINDER_CAMPAIGN_JOBS_TABLE)
                ? "Reminder campaign queue table is not available yet. Run reminder_campaign_jobs_hotfix_2026_03_19.sql first."
                : (insertResult.error.message || "Unable to create the reminder campaign queue.")
        );
    }

    return insertResult.data;
}

async function fetchDueReminderCampaignJob(adminClient) {
    const result = await adminClient
        .from(REMINDER_CAMPAIGN_JOBS_TABLE)
        .select("id, campaign_type, recipient_ids, total_recipients, processed_count, sent_count, skipped_count, failed_count, batch_size, batch_delay_minutes, base_url, created_by, status, started_at, next_run_at, created_at")
        .in("status", ["queued", "processing"])
        .lte("next_run_at", new Date().toISOString())
        .order("next_run_at", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1);

    if (result.error) {
        if (isMissingTableError(result.error, REMINDER_CAMPAIGN_JOBS_TABLE)) {
            return null;
        }
        throw new Error(result.error.message || "Unable to load queued reminder campaigns.");
    }

    return result.data && result.data.length ? result.data[0] : null;
}

async function processReminderCampaignJobBatch(adminClient, job) {
    const recipientIds = normalizeReminderJobRecipientIds(job && job.recipient_ids);
    const totalRecipients = recipientIds.length;
    const processedCount = Math.max(0, Number(job && job.processed_count) || 0);
    const batchSize = normalizeReminderCampaignBatchSize(job && job.batch_size);
    const batchDelayMinutes = normalizeReminderCampaignDelayMinutes(job && job.batch_delay_minutes);
    const nowIso = new Date().toISOString();

    if (!totalRecipients || processedCount >= totalRecipients) {
        await adminClient
            .from(REMINDER_CAMPAIGN_JOBS_TABLE)
            .update({
                total_recipients: totalRecipients,
                processed_count: totalRecipients,
                status: "completed",
                completed_at: nowIso,
                next_run_at: null,
                last_error: null
            })
            .eq("id", job.id);
        return true;
    }

    const markProcessingResult = await adminClient
        .from(REMINDER_CAMPAIGN_JOBS_TABLE)
        .update({
            status: "processing",
            started_at: job.started_at || nowIso,
            total_recipients: totalRecipients,
            last_error: null
        })
        .eq("id", job.id);

    if (markProcessingResult.error) {
        throw new Error(markProcessingResult.error.message || "Unable to claim the queued reminder campaign.");
    }

    const batchRecipientIds = recipientIds.slice(processedCount, processedCount + batchSize);
    const results = await sendReminderEmailsForRecipients({
        client: adminClient,
        recipientIds: batchRecipientIds,
        campaignType: job.campaign_type,
        sentBy: job.created_by,
        baseUrl: job.base_url || ""
    });

    const nextProcessedCount = processedCount + batchRecipientIds.length;
    const isComplete = nextProcessedCount >= totalRecipients;
    const updateResult = await adminClient
        .from(REMINDER_CAMPAIGN_JOBS_TABLE)
        .update({
            processed_count: nextProcessedCount,
            sent_count: (Number(job.sent_count) || 0) + results.sent.length,
            skipped_count: (Number(job.skipped_count) || 0) + results.skipped.length,
            failed_count: (Number(job.failed_count) || 0) + results.failed.length,
            status: isComplete ? "completed" : "queued",
            completed_at: isComplete ? nowIso : null,
            next_run_at: isComplete ? null : addMinutesToIso(nowIso, batchDelayMinutes),
            last_error: null
        })
        .eq("id", job.id);

    if (updateResult.error) {
        throw new Error(updateResult.error.message || "Unable to update reminder campaign progress.");
    }

    return true;
}

async function runReminderCampaignProcessor() {
    if (reminderCampaignProcessorRunning) {
        return;
    }

    const adminClient = createSupabaseAdminClient();
    if (!adminClient) {
        return;
    }

    reminderCampaignProcessorRunning = true;
    try {
        while (true) {
            const job = await fetchDueReminderCampaignJob(adminClient);
            if (!job) {
                break;
            }

            try {
                await processReminderCampaignJobBatch(adminClient, job);
            } catch (error) {
                const failedAt = new Date().toISOString();
                await adminClient
                    .from(REMINDER_CAMPAIGN_JOBS_TABLE)
                    .update({
                        status: "failed",
                        last_error: error && error.message ? error.message : "Queued reminder campaign failed.",
                        completed_at: failedAt,
                        next_run_at: null
                    })
                    .eq("id", job.id);
            }
        }
    } finally {
        reminderCampaignProcessorRunning = false;
    }
}

function triggerReminderCampaignProcessor(delayMs) {
    const waitTime = Math.max(0, Number(delayMs) || 0);
    setTimeout(function () {
        runReminderCampaignProcessor().catch(function (error) {
            console.error("Reminder campaign processor failed:", error && error.message ? error.message : error);
        });
    }, waitTime);
}

function startReminderCampaignProcessor() {
    if (reminderCampaignProcessorInterval) {
        return;
    }

    reminderCampaignProcessorInterval = setInterval(function () {
        runReminderCampaignProcessor().catch(function (error) {
            console.error("Reminder campaign processor failed:", error && error.message ? error.message : error);
        });
    }, REMINDER_CAMPAIGN_PROCESSOR_INTERVAL_MS);

    triggerReminderCampaignProcessor(1500);
}

function normalizeExamScheduleEmailBatchSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_SIZE;
    }
    return Math.min(500, Math.max(1, Math.floor(parsed)));
}

function normalizeExamScheduleEmailDelayMinutes(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_DELAY_MINUTES;
    }
    return Math.min(1440, Math.max(1, Math.floor(parsed)));
}

function normalizeExamScheduleRecipientPayloads(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values.map(function (item) {
        if (!item || typeof item !== "object") {
            return null;
        }
        return {
            email: normalizeEmailAddress(item.email),
            applicantName: ((item.applicantName || "")).toString().trim(),
            applicationId: nullIfBlank(item.applicationId),
            applicationNo: ((item.applicationNo || "")).toString().trim(),
            batchLabel: ((item.batchLabel || "")).toString().trim(),
            scheduleLabel: ((item.scheduleLabel || "")).toString().trim(),
            venue: ((item.venue || "")).toString().trim(),
            roomLabel: ((item.roomLabel || "")).toString().trim(),
            seatNo: item.seatNo == null ? "" : String(item.seatNo),
            examControlNo: item.examControlNo == null ? "" : String(item.examControlNo),
            customMessage: ((item.customMessage || "")).toString().trim(),
            detailUrl: ((item.detailUrl || "")).toString().trim(),
            lookupUrl: ((item.lookupUrl || "")).toString().trim()
        };
    }).filter(function (item) {
        return item && item.email && item.applicationId;
    });
}

async function ensureNoActiveExamScheduleEmailJob(client, batchId) {
    const result = await client
        .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
        .select("id, status, total_recipients, processed_count, batch_size, batch_delay_minutes")
        .eq("batch_id", batchId)
        .in("status", ["queued", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (result.error) {
        throw new Error(
            isMissingTableError(result.error, EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
                ? "Exam schedule email queue table is not available yet. Run exam_schedule_email_jobs_hotfix_2026_04_05.sql first."
                : (result.error.message || "Unable to read the exam schedule email queue.")
        );
    }

    return result.data || null;
}

async function queueExamScheduleEmailJob(client, details) {
    const recipientPayloads = normalizeExamScheduleRecipientPayloads(details && details.recipientPayloads);
    const batchSize = normalizeExamScheduleEmailBatchSize(details && details.batchSize);
    const batchDelayMinutes = normalizeExamScheduleEmailDelayMinutes(details && details.batchDelayMinutes);
    const nowIso = new Date().toISOString();

    const insertResult = await client
        .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
        .insert({
            batch_id: nullIfBlank(details && details.batchId),
            batch_label: nullIfBlank(details && details.batchLabel),
            recipient_payloads: recipientPayloads,
            total_recipients: recipientPayloads.length,
            processed_count: 0,
            sent_count: 0,
            skipped_count: Math.max(0, Number(details && details.initialSkippedCount) || 0),
            failed_count: 0,
            batch_size: batchSize,
            batch_delay_minutes: batchDelayMinutes,
            created_by: nullIfBlank(details && details.createdBy),
            status: "queued",
            next_run_at: nowIso
        })
        .select("id, batch_id, batch_label, total_recipients, batch_size, batch_delay_minutes, status")
        .single();

    if (insertResult.error) {
        throw new Error(
            isMissingTableError(insertResult.error, EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
                ? "Exam schedule email queue table is not available yet. Run exam_schedule_email_jobs_hotfix_2026_04_05.sql first."
                : (insertResult.error.message || "Unable to create the exam schedule email queue.")
        );
    }

    return insertResult.data;
}

async function fetchDueExamScheduleEmailJob(adminClient) {
    const result = await adminClient
        .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
        .select("id, batch_id, batch_label, recipient_payloads, total_recipients, processed_count, sent_count, skipped_count, failed_count, batch_size, batch_delay_minutes, created_by, status, started_at, next_run_at, created_at")
        .in("status", ["queued", "processing"])
        .lte("next_run_at", new Date().toISOString())
        .order("next_run_at", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1);

    if (result.error) {
        if (isMissingTableError(result.error, EXAM_SCHEDULE_EMAIL_JOBS_TABLE)) {
            return null;
        }
        throw new Error(result.error.message || "Unable to load queued exam schedule emails.");
    }

    return result.data && result.data.length ? result.data[0] : null;
}

async function processExamScheduleEmailJobBatch(adminClient, job) {
    const recipientPayloads = normalizeExamScheduleRecipientPayloads(job && job.recipient_payloads);
    const totalRecipients = recipientPayloads.length;
    const processedCount = Math.max(0, Number(job && job.processed_count) || 0);
    const batchSize = normalizeExamScheduleEmailBatchSize(job && job.batch_size);
    const batchDelayMinutes = normalizeExamScheduleEmailDelayMinutes(job && job.batch_delay_minutes);
    const nowIso = new Date().toISOString();

    if (!totalRecipients || processedCount >= totalRecipients) {
        const completeResult = await adminClient
            .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
            .update({
                total_recipients: totalRecipients,
                processed_count: totalRecipients,
                status: "completed",
                completed_at: nowIso,
                next_run_at: null,
                last_error: null
            })
            .eq("id", job.id);

        if (completeResult.error) {
            throw new Error(completeResult.error.message || "Unable to complete the exam schedule email queue.");
        }
        return true;
    }

    const markProcessingResult = await adminClient
        .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
        .update({
            status: "processing",
            started_at: job.started_at || nowIso,
            total_recipients: totalRecipients,
            last_error: null
        })
        .eq("id", job.id);

    if (markProcessingResult.error) {
        throw new Error(markProcessingResult.error.message || "Unable to claim the queued exam schedule email batch.");
    }

    const batchPayloads = recipientPayloads.slice(processedCount, processedCount + batchSize);
    let sentCount = 0;
    let failedCount = 0;

    for (let index = 0; index < batchPayloads.length; index += 1) {
        const recipient = batchPayloads[index];
        try {
            await sendExamScheduleEmailMail(recipient);
            sentCount += 1;
        } catch (_error) {
            failedCount += 1;
        }
    }

    const nextProcessedCount = processedCount + batchPayloads.length;
    const isComplete = nextProcessedCount >= totalRecipients;
    const updateResult = await adminClient
        .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
        .update({
            processed_count: nextProcessedCount,
            sent_count: (Number(job.sent_count) || 0) + sentCount,
            failed_count: (Number(job.failed_count) || 0) + failedCount,
            status: isComplete ? "completed" : "queued",
            completed_at: isComplete ? nowIso : null,
            next_run_at: isComplete ? null : addMinutesToIso(nowIso, batchDelayMinutes),
            last_error: null
        })
        .eq("id", job.id);

    if (updateResult.error) {
        throw new Error(updateResult.error.message || "Unable to update exam schedule email queue progress.");
    }

    return true;
}

async function runExamScheduleEmailProcessor() {
    if (examScheduleEmailProcessorRunning) {
        return;
    }

    const adminClient = createSupabaseAdminClient();
    if (!adminClient) {
        return;
    }

    examScheduleEmailProcessorRunning = true;
    try {
        while (true) {
            const job = await fetchDueExamScheduleEmailJob(adminClient);
            if (!job) {
                break;
            }

            try {
                await processExamScheduleEmailJobBatch(adminClient, job);
            } catch (error) {
                const failedAt = new Date().toISOString();
                await adminClient
                    .from(EXAM_SCHEDULE_EMAIL_JOBS_TABLE)
                    .update({
                        status: "failed",
                        last_error: error && error.message ? error.message : "Queued exam schedule email batch failed.",
                        completed_at: failedAt,
                        next_run_at: null
                    })
                    .eq("id", job.id);
            }
        }
    } finally {
        examScheduleEmailProcessorRunning = false;
    }
}

function triggerExamScheduleEmailProcessor(delayMs) {
    const waitTime = Math.max(0, Number(delayMs) || 0);
    setTimeout(function () {
        runExamScheduleEmailProcessor().catch(function (error) {
            console.error("Exam schedule email processor failed:", error && error.message ? error.message : error);
        });
    }, waitTime);
}

function startExamScheduleEmailProcessor() {
    if (examScheduleEmailProcessorInterval) {
        return;
    }

    examScheduleEmailProcessorInterval = setInterval(function () {
        runExamScheduleEmailProcessor().catch(function (error) {
            console.error("Exam schedule email processor failed:", error && error.message ? error.message : error);
        });
    }, EXAM_SCHEDULE_EMAIL_PROCESSOR_INTERVAL_MS);

    triggerExamScheduleEmailProcessor(2000);
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

app.use("/api/auth", function (request, response, next) {
    applyUploadCors(request, response);
    if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
    }
    next();
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

        await writeAuditLogEntry(adminClient, {
            module: "user_management",
            action: "create_secretary_account",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: profileResult.data.id,
            target_role: profileResult.data.role,
            target_email: profileResult.data.email,
            target_label: [firstName, middleName || "", lastName].join(" ").replace(/\s+/g, " ").trim(),
            record_type: "user",
            record_id: profileResult.data.id,
            summary: "Created secretary account for " + (profileResult.data.email || "new staff user") + ".",
            details: {
                first_name: firstName,
                middle_name: middleName || "",
                last_name: lastName,
                mobile_number: mobileNumber
            }
        });

        response.status(201).json({
            ok: true,
            user: profileResult.data
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Secretary account creation failed.");
    }
});

app.get("/api/super-admin/users/verification-status", authenticate, async function (request, response) {
    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can view verification status.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const rawIds = ((request.query && request.query.ids) || "").toString();
        const userIds = rawIds
            .split(",")
            .map(function (value) { return value.trim(); })
            .filter(function (value, index, array) {
                return isUuid(value) && array.indexOf(value) === index;
            });

        if (userIds.length === 0) {
            response.status(200).json({ ok: true, statuses: {} });
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const authUsers = await listAllAuthUsers(adminClient);
        const requestedLookup = {};
        const statuses = {};

        userIds.forEach(function (userId) {
            requestedLookup[userId] = true;
        });

        authUsers.forEach(function (user) {
            if (!user || !requestedLookup[user.id]) {
                return;
            }

            const confirmedAt = user.email_confirmed_at || user.confirmed_at || null;
            const email = (user.email || "").toString();
            statuses[user.id] = {
                user_id: user.id,
                email: email,
                email_confirmed_at: confirmedAt,
                status: email
                    ? (confirmedAt ? "verified" : "pending")
                    : "no_email"
            };
        });

        userIds.forEach(function (userId) {
            if (!statuses[userId]) {
                statuses[userId] = {
                    user_id: userId,
                    email: "",
                    email_confirmed_at: null,
                    status: "unknown"
                };
            }
        });

        response.status(200).json({
            ok: true,
            statuses: statuses
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Failed to load verification status.");
    }
});

app.post("/api/super-admin/users/:userId/confirm-email", authenticate, async function (request, response) {
    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can manually confirm user email access.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const userId = nullIfBlank(request.params && request.params.userId);
        if (!userId || !isUuid(userId)) {
            writeJsonError(response, 400, "A valid user ID is required.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, role, email, first_name, last_name")
            .eq("id", userId)
            .maybeSingle();

        if (profileResult.error) {
            writeJsonError(response, 400, profileResult.error.message || "Failed to load the selected user profile.");
            return;
        }
        if (!profileResult.data) {
            writeJsonError(response, 404, "Selected user was not found.");
            return;
        }

        const updateResult = await adminClient.auth.admin.updateUserById(userId, {
            email_confirm: true
        });
        const updatedUser = updateResult && updateResult.data
            ? (updateResult.data.user || updateResult.data)
            : null;

        if (updateResult.error || !updatedUser) {
            writeJsonError(
                response,
                400,
                (updateResult.error && updateResult.error.message) || "Manual email confirmation failed."
            );
            return;
        }

        await writeAuditLogEntry(adminClient, {
            module: "user_management",
            action: "confirm_email_login",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: profileResult.data.id,
            target_role: profileResult.data.role,
            target_email: updatedUser.email || profileResult.data.email || "",
            target_label: [profileResult.data.first_name || "", profileResult.data.last_name || ""].join(" ").replace(/\s+/g, " ").trim(),
            record_type: "user",
            record_id: profileResult.data.id,
            summary: "Manually confirmed email login for " + ((updatedUser.email || profileResult.data.email || "selected account").toString()) + ".",
            details: {
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null
            }
        });

        response.status(200).json({
            ok: true,
            user: {
                id: profileResult.data.id,
                role: profileResult.data.role,
                email: updatedUser.email || profileResult.data.email || "",
                first_name: profileResult.data.first_name || "",
                last_name: profileResult.data.last_name || "",
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null
            }
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Manual email confirmation failed.");
    }
});

app.post("/api/super-admin/users/:userId/claim-account", authenticate, async function (request, response) {
    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can claim applicant accounts.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const userId = nullIfBlank(request.params && request.params.userId);
        const newEmail = ((request.body && request.body.newEmail) || "").toString().trim().toLowerCase();
        const newPassword = ((request.body && request.body.newPassword) || "").toString();

        if (!userId || !isUuid(userId)) {
            writeJsonError(response, 400, "A valid applicant user ID is required.");
            return;
        }
        if (!newEmail) {
            writeJsonError(response, 400, "Final login email is required.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            writeJsonError(response, 400, "Enter a valid final login email address.");
            return;
        }
        if (!newPassword) {
            writeJsonError(response, 400, "New password is required.");
            return;
        }

        const passwordError = validateStaffPassword(newPassword);
        if (passwordError) {
            writeJsonError(response, 400, passwordError);
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, role, email, first_name, middle_name, last_name, mobile_number, is_active")
            .eq("id", userId)
            .maybeSingle();

        if (profileResult.error) {
            writeJsonError(response, 400, profileResult.error.message || "Failed to load the selected applicant profile.");
            return;
        }
        if (!profileResult.data) {
            writeJsonError(response, 404, "Selected applicant account was not found.");
            return;
        }
        if (profileResult.data.role !== "applicant") {
            writeJsonError(response, 400, "Only applicant accounts can use the claim-account action.");
            return;
        }

        const existingProfileResult = await adminClient
            .from("profiles")
            .select("id, role, email")
            .eq("email", newEmail)
            .maybeSingle();

        if (existingProfileResult.error) {
            writeJsonError(response, 400, existingProfileResult.error.message || "Failed to check the final login email.");
            return;
        }
        if (existingProfileResult.data && existingProfileResult.data.id !== userId) {
            writeJsonError(response, 400, "Email address is already used by another account.");
            return;
        }

        const authUsers = await listAllAuthUsers(adminClient);
        const authUser = authUsers.find(function (user) {
            return user && user.id === userId;
        }) || null;
        if (!authUser) {
            writeJsonError(response, 404, "The selected applicant does not have an Auth login record.");
            return;
        }

        const duplicateAuthUser = authUsers.find(function (user) {
            return user &&
                user.id !== userId &&
                (user.email || "").toString().trim().toLowerCase() === newEmail;
        }) || null;
        if (duplicateAuthUser) {
            writeJsonError(response, 400, "Email address is already registered.");
            return;
        }

        const previousProfileEmail = ((profileResult.data.email || "").toString().trim().toLowerCase());
        const previousAuthEmail = ((authUser.email || "").toString().trim().toLowerCase());
        const shouldUpdateProfileEmail = newEmail !== previousProfileEmail;

        if (shouldUpdateProfileEmail) {
            const profileUpdateResult = await adminClient
                .from("profiles")
                .update({ email: newEmail })
                .eq("id", userId);

            if (profileUpdateResult.error) {
                writeJsonError(response, 400, explainAccountClaimError(profileUpdateResult.error.message || "Failed to update applicant profile email."));
                return;
            }
        }

        const authUpdatePayload = {
            password: newPassword,
            email_confirm: true
        };
        if (newEmail !== previousAuthEmail) {
            authUpdatePayload.email = newEmail;
        }

        const updateResult = await adminClient.auth.admin.updateUserById(userId, authUpdatePayload);
        const updatedUser = updateResult && updateResult.data
            ? (updateResult.data.user || updateResult.data)
            : null;

        if (updateResult.error || !updatedUser) {
            if (shouldUpdateProfileEmail) {
                try {
                    await adminClient
                        .from("profiles")
                        .update({ email: previousProfileEmail || null })
                        .eq("id", userId);
                } catch (_rollbackError) {
                    // Best effort only; keep the primary auth error below.
                }
            }

            writeJsonError(
                response,
                400,
                explainAccountClaimError((updateResult.error && updateResult.error.message) || "Claim account update failed.")
            );
            return;
        }

        await writeAuditLogEntry(adminClient, {
            module: "user_management",
            action: "claim_applicant_account",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: profileResult.data.id,
            target_role: profileResult.data.role,
            target_email: updatedUser.email || newEmail,
            target_label: buildFullName(
                profileResult.data.first_name || "",
                profileResult.data.middle_name || "",
                profileResult.data.last_name || ""
            ),
            record_type: "user",
            record_id: profileResult.data.id,
            summary: "Claimed applicant login for " + ((updatedUser.email || newEmail || "selected applicant").toString()) + ".",
            details: {
                previous_profile_email: previousProfileEmail || "",
                previous_auth_email: previousAuthEmail || "",
                claimed_email: (updatedUser.email || newEmail || "").toString(),
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null,
                password_reset_by_admin: true
            }
        });

        response.status(200).json({
            ok: true,
            user: {
                id: profileResult.data.id,
                role: profileResult.data.role,
                email: updatedUser.email || newEmail,
                first_name: profileResult.data.first_name || "",
                middle_name: profileResult.data.middle_name || "",
                last_name: profileResult.data.last_name || "",
                mobile_number: profileResult.data.mobile_number || "",
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null
            }
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Claim account update failed.");
    }
});

app.get("/api/super-admin/users/:userId/walk-in-status", authenticate, async function (request, response) {
    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can review walk-in office access.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const userId = nullIfBlank(request.params && request.params.userId);
        if (!userId || !isUuid(userId)) {
            writeJsonError(response, 400, "A valid applicant user ID is required.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, role, email, first_name, middle_name, last_name")
            .eq("id", userId)
            .maybeSingle();

        if (profileResult.error) {
            writeJsonError(response, 400, profileResult.error.message || "Failed to load the selected applicant profile.");
            return;
        }
        if (!profileResult.data) {
            writeJsonError(response, 404, "Selected applicant account was not found.");
            return;
        }
        if (profileResult.data.role !== "applicant") {
            writeJsonError(response, 400, "Only applicant accounts can use walk-in office access.");
            return;
        }

        const status = await loadWalkInOfficeStatus(adminClient, userId);

        response.status(200).json({
            ok: true,
            user: {
                id: profileResult.data.id,
                email: profileResult.data.email || "",
                first_name: profileResult.data.first_name || "",
                middle_name: profileResult.data.middle_name || "",
                last_name: profileResult.data.last_name || ""
            },
            status: status
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Failed to load walk-in office access.");
    }
});

app.post("/api/super-admin/users/:userId/reset-walk-in-password", authenticate, async function (request, response) {
    try {
        if (request.auth.role !== "super_admin") {
            writeJsonError(response, 403, "Only System Administrator can reset walk-in temporary passwords.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const userId = nullIfBlank(request.params && request.params.userId);
        if (!userId || !isUuid(userId)) {
            writeJsonError(response, 400, "A valid applicant user ID is required.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, role, email, first_name, middle_name, last_name, mobile_number")
            .eq("id", userId)
            .maybeSingle();

        if (profileResult.error) {
            writeJsonError(response, 400, profileResult.error.message || "Failed to load the selected applicant profile.");
            return;
        }
        if (!profileResult.data) {
            writeJsonError(response, 404, "Selected applicant account was not found.");
            return;
        }
        if (profileResult.data.role !== "applicant") {
            writeJsonError(response, 400, "Only applicant accounts can use walk-in temporary passwords.");
            return;
        }

        const officeStatus = await loadWalkInOfficeStatus(adminClient, userId);
        if (!officeStatus.is_walk_in_account) {
            writeJsonError(response, 400, "This applicant does not have an office-created walk-in account.");
            return;
        }
        if (officeStatus.is_claimed) {
            writeJsonError(response, 400, "This walk-in account was already claimed. Office temporary password access is already closed.");
            return;
        }

        const authUsers = await listAllAuthUsers(adminClient);
        const authUser = authUsers.find(function (user) {
            return user && user.id === userId;
        }) || null;
        if (!authUser) {
            writeJsonError(response, 404, "The selected applicant does not have an Auth login record.");
            return;
        }

        const temporaryPassword = generateTemporaryApplicantPassword();
        const updateResult = await adminClient.auth.admin.updateUserById(userId, {
            password: temporaryPassword,
            email_confirm: true
        });
        const updatedUser = updateResult && updateResult.data
            ? (updateResult.data.user || updateResult.data)
            : null;

        if (updateResult.error || !updatedUser) {
            writeJsonError(
                response,
                400,
                explainAccountClaimError((updateResult.error && updateResult.error.message) || "Failed to reset walk-in temporary password.")
            );
            return;
        }

        await writeAuditLogEntry(adminClient, {
            module: "user_management",
            action: "reset_walk_in_temporary_password",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: profileResult.data.id,
            target_role: profileResult.data.role,
            target_email: updatedUser.email || profileResult.data.email || "",
            target_label: buildFullName(
                profileResult.data.first_name || "",
                profileResult.data.middle_name || "",
                profileResult.data.last_name || ""
            ),
            record_type: "user",
            record_id: profileResult.data.id,
            summary: "Generated a new office temporary password for " + ((updatedUser.email || profileResult.data.email || "selected applicant").toString()) + ".",
            details: {
                walk_in_created_at: officeStatus.walk_in_created_at || null,
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null,
                office_temp_access_active: true
            }
        });

        response.status(200).json({
            ok: true,
            temporary_password: temporaryPassword,
            user: {
                id: profileResult.data.id,
                role: profileResult.data.role,
                email: updatedUser.email || profileResult.data.email || "",
                first_name: profileResult.data.first_name || "",
                middle_name: profileResult.data.middle_name || "",
                last_name: profileResult.data.last_name || "",
                mobile_number: profileResult.data.mobile_number || "",
                email_confirmed_at: updatedUser.email_confirmed_at || updatedUser.confirmed_at || null
            },
            status: Object.assign({}, officeStatus, {
                has_office_temp_access: true
            })
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Failed to reset walk-in temporary password.");
    }
});

app.post("/api/auth/resolve-login", async function (request, response) {
    try {
        const rateLimit = consumeRateLimit(
            authIdentifierLookupRateLimitState,
            requestClientAddress(request),
            AUTH_IDENTIFIER_LOOKUP_RATE_LIMIT_WINDOW_MS,
            AUTH_IDENTIFIER_LOOKUP_RATE_LIMIT_MAX_REQUESTS
        );
        if (!rateLimit.allowed) {
            response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
            writeJsonError(response, 429, "Too many account lookup attempts. Please wait a few minutes and try again.");
            return;
        }

        const identifier = ((request.body && request.body.identifier) || "").toString().trim();
        if (!identifier) {
            writeJsonError(response, 400, "Email address or mobile number is required.");
            return;
        }

        const normalizedEmail = normalizeEmailAddress(identifier);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            response.status(200).json({
                ok: true,
                email: normalizedEmail,
                matched_by: "email"
            });
            return;
        }

        const mobileNumber = normalizePhoneNumber(identifier);
        if (!mobileNumber) {
            writeJsonError(response, 400, "Enter a valid email address or mobile number.");
            return;
        }

        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, AUTH_IDENTIFIER_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, AUTH_IDENTIFIER_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("email, is_active")
            .eq("mobile_number", mobileNumber)
            .maybeSingle();

        if (profileResult.error) {
            console.error("[auth-resolve-login] profile lookup failed:", profileResult.error.message || profileResult.error);
            writeJsonError(response, 503, AUTH_IDENTIFIER_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const resolvedEmail = normalizeEmailAddress(profileResult.data && profileResult.data.email ? profileResult.data.email : "");
        if (!profileResult.data || !resolvedEmail) {
            writeJsonError(response, 404, "No account matched that email or mobile number.");
            return;
        }
        if (profileResult.data.is_active === false) {
            writeJsonError(response, 403, "This account is inactive. Contact administrator.");
            return;
        }

        response.status(200).json({
            ok: true,
            email: resolvedEmail,
            matched_by: "mobile"
        });
    } catch (error) {
        writeJsonError(
            response,
            500,
            error && error.message ? error.message : AUTH_IDENTIFIER_LOOKUP_UNAVAILABLE_MESSAGE
        );
    }
});

app.post("/api/public/exam-room-lookup", async function (request, response) {
    try {
        const rateLimit = consumeRateLimit(
            publicLookupRateLimitState,
            requestClientAddress(request),
            PUBLIC_LOOKUP_RATE_LIMIT_WINDOW_MS,
            PUBLIC_LOOKUP_RATE_LIMIT_MAX_REQUESTS
        );
        if (!rateLimit.allowed) {
            response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
            writeJsonError(response, 429, "Too many exam room lookup attempts. Please wait a few minutes and try again.");
            return;
        }

        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const fullNameInput = normalizePublicLookupName(request.body && request.body.fullName);
        const applicationNoInput = ((request.body && request.body.applicationNo) || "").toString().replace(/\s+/g, "").trim().toUpperCase();

        if (!fullNameInput) {
            writeJsonError(response, 400, "Full name is required.");
            return;
        }
        if (!applicationNoInput) {
            writeJsonError(response, 400, "LDSP application number is required.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const applicationResult = await adminClient
            .from("applications")
            .select("id, application_no, applicant_id, status, updated_at")
            .eq("application_no", applicationNoInput)
            .maybeSingle();

        if (applicationResult.error) {
            console.error("[public-exam-room-lookup] applications lookup failed:", applicationResult.error.message || applicationResult.error);
            writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }
        if (!applicationResult.data || !applicationResult.data.id || !applicationResult.data.applicant_id) {
            writeJsonError(response, 404, "No posted exam assignment matched those details yet.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, first_name, middle_name, last_name")
            .eq("id", applicationResult.data.applicant_id)
            .maybeSingle();

        if (profileResult.error) {
            console.error("[public-exam-room-lookup] profiles lookup failed:", profileResult.error.message || profileResult.error);
            writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }
        if (!profileResult.data || !profileResult.data.id) {
            writeJsonError(response, 404, "No posted exam assignment matched those details yet.");
            return;
        }

        const allowedNames = [
            normalizePublicLookupName(buildFullName(
                profileResult.data.first_name || "",
                profileResult.data.middle_name || "",
                profileResult.data.last_name || ""
            )),
            normalizePublicLookupName(buildFullName(
                profileResult.data.first_name || "",
                "",
                profileResult.data.last_name || ""
            ))
        ].filter(Boolean);

        if (allowedNames.indexOf(fullNameInput) === -1) {
            writeJsonError(response, 404, "No posted exam assignment matched those details yet.");
            return;
        }

        const matchedApplication = applicationResult.data;
        const applicationMap = {};
        applicationMap[matchedApplication.id] = matchedApplication;
        const applicationIds = [matchedApplication.id];

        let recordResult = await adminClient
            .from("exam_records")
            .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, room_label, room_seat_no, updated_at, created_at")
            .in("application_id", applicationIds)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (recordResult.error && /room_label|room_seat_no/i.test(recordResult.error.message || "")) {
            recordResult = await adminClient
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, updated_at, created_at")
                .in("application_id", applicationIds)
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!recordResult.error && recordResult.data) {
                recordResult.data = Object.assign({}, recordResult.data, {
                    room_label: "",
                    room_seat_no: null
                });
            }
        }

        if (recordResult.error) {
            console.error("[public-exam-room-lookup] exam_records lookup failed:", recordResult.error.message || recordResult.error);
            writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
            return;
        }

        const record = recordResult.data || null;
        const application = record && record.application_id && applicationMap[record.application_id]
            ? applicationMap[record.application_id]
            : matchedApplication;
        let batch = null;
        if (record && record.batch_id) {
            const batchResult = await adminClient
                .from("exam_batches")
                .select("id, batch_label, exam_datetime, venue")
                .eq("id", record.batch_id)
                .maybeSingle();

            if (batchResult.error) {
                console.error("[public-exam-room-lookup] exam_batches lookup failed:", batchResult.error.message || batchResult.error);
                writeJsonError(response, 503, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
                return;
            }
            batch = batchResult.data || null;
        }

        const scheduledAt = record && record.scheduled_at
            ? record.scheduled_at
            : (batch && batch.exam_datetime ? batch.exam_datetime : "");
        const assignmentReady = Boolean(record && (record.room_label || record.room_seat_no != null || scheduledAt || (batch && batch.venue)));
        const applicantName = buildFullName(
            profileResult.data.first_name || "",
            profileResult.data.middle_name || "",
            profileResult.data.last_name || ""
        ) || "Applicant";

        response.status(200).json({
            ok: true,
            assignment_ready: assignmentReady,
            message: assignmentReady
                ? "Exam room assignment found."
                : "Record found, but no room assignment is posted yet. Please check again later.",
            application: {
                id: application && application.id ? application.id : "",
                application_no: application && application.application_no ? application.application_no : applicationNoInput,
                applicant_name: applicantName,
                status: application && application.status ? application.status : ""
            },
            exam: {
                batch_label: batch && batch.batch_label ? batch.batch_label : "",
                schedule_label: formatExamScheduleDateTime(scheduledAt),
                venue: batch && batch.venue ? batch.venue : "",
                room_label: record && record.room_label ? record.room_label : "",
                seat_no: record && record.room_seat_no != null ? String(record.room_seat_no) : "",
                exam_control_no: record && record.exam_control_no ? record.exam_control_no : "",
                record_status: record && record.status ? record.status : ""
            }
        });
    } catch (error) {
        console.error("[public-exam-room-lookup] unexpected error:", error && error.stack ? error.stack : error);
        writeJsonError(response, 500, PUBLIC_LOOKUP_UNAVAILABLE_MESSAGE);
    }
});

app.post("/api/secretary/applicants/:userId/replace-login-email", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can replace applicant login email.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const userId = nullIfBlank(request.params && request.params.userId);
        const newEmail = normalizeEmailAddress((request.body && request.body.newEmail) || "");
        const sendAccessEmail = !request.body || request.body.sendAccessEmail !== false;

        if (!userId || !isUuid(userId)) {
            writeJsonError(response, 400, "A valid applicant user ID is required.");
            return;
        }
        if (!newEmail) {
            writeJsonError(response, 400, "Corrected login email is required.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            writeJsonError(response, 400, "Enter a valid corrected login email address.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const profileResult = await adminClient
            .from("profiles")
            .select("id, role, email, first_name, middle_name, last_name, mobile_number, is_active")
            .eq("id", userId)
            .maybeSingle();

        if (profileResult.error) {
            writeJsonError(response, 400, profileResult.error.message || "Failed to load the selected applicant profile.");
            return;
        }
        if (!profileResult.data) {
            writeJsonError(response, 404, "Selected applicant account was not found.");
            return;
        }
        if (profileResult.data.role !== "applicant") {
            writeJsonError(response, 400, "Only applicant accounts can use the login email replacement action.");
            return;
        }

        const existingProfileResult = await adminClient
            .from("profiles")
            .select("id, role, email")
            .eq("email", newEmail)
            .maybeSingle();

        if (existingProfileResult.error) {
            writeJsonError(response, 400, existingProfileResult.error.message || "Failed to check the corrected login email.");
            return;
        }
        if (existingProfileResult.data && existingProfileResult.data.id !== userId) {
            writeJsonError(response, 400, "Email address is already used by another account.");
            return;
        }

        const authUsers = await listAllAuthUsers(adminClient);
        const authUser = authUsers.find(function (user) {
            return user && user.id === userId;
        }) || null;
        if (!authUser) {
            writeJsonError(response, 404, "The selected applicant does not have an Auth login record.");
            return;
        }

        const duplicateAuthUser = authUsers.find(function (user) {
            return user &&
                user.id !== userId &&
                normalizeEmailAddress(user.email || "") === newEmail;
        }) || null;
        if (duplicateAuthUser) {
            writeJsonError(response, 400, "Email address is already registered.");
            return;
        }

        const previousProfileEmail = normalizeEmailAddress(profileResult.data.email || "");
        const previousAuthEmail = normalizeEmailAddress(authUser.email || "");
        const shouldUpdateProfileEmail = newEmail !== previousProfileEmail;
        const shouldUpdateAuthEmail = newEmail !== previousAuthEmail;

        if (!shouldUpdateProfileEmail && !shouldUpdateAuthEmail && !sendAccessEmail) {
            writeJsonError(response, 400, "The corrected email already matches the current applicant login.");
            return;
        }

        if (shouldUpdateProfileEmail) {
            const profileUpdateResult = await adminClient
                .from("profiles")
                .update({ email: newEmail })
                .eq("id", userId);

            if (profileUpdateResult.error) {
                writeJsonError(response, 400, explainAccountClaimError(profileUpdateResult.error.message || "Failed to update applicant profile email."));
                return;
            }
        }

        let updatedUser = authUser;
        if (shouldUpdateAuthEmail) {
            const updateResult = await adminClient.auth.admin.updateUserById(userId, {
                email: newEmail,
                email_confirm: true
            });

            updatedUser = updateResult && updateResult.data
                ? (updateResult.data.user || updateResult.data)
                : null;

            if (updateResult.error || !updatedUser) {
                if (shouldUpdateProfileEmail) {
                    try {
                        await adminClient
                            .from("profiles")
                            .update({ email: previousProfileEmail || null })
                            .eq("id", userId);
                    } catch (_rollbackError) {
                        // Best effort only; keep the primary auth error below.
                    }
                }

                writeJsonError(
                    response,
                    400,
                    explainAccountClaimError((updateResult.error && updateResult.error.message) || "Login email replacement failed.")
                );
                return;
            }
        }

        const responseUser = {
            id: profileResult.data.id,
            role: profileResult.data.role,
            email: normalizeEmailAddress(updatedUser && updatedUser.email ? updatedUser.email : newEmail),
            first_name: profileResult.data.first_name || "",
            middle_name: profileResult.data.middle_name || "",
            last_name: profileResult.data.last_name || "",
            mobile_number: profileResult.data.mobile_number || "",
            email_confirmed_at: updatedUser && (updatedUser.email_confirmed_at || updatedUser.confirmed_at)
                ? (updatedUser.email_confirmed_at || updatedUser.confirmed_at)
                : null
        };

        const accessEmail = {
            requested: sendAccessEmail,
            sent: false,
            type: sendAccessEmail ? "password_reset" : "none",
            warning: ""
        };

        if (sendAccessEmail) {
            try {
                await sendApplicantAccessResetEmail(responseUser.email, resolveBaseUrl(request));
                accessEmail.sent = true;
            } catch (error) {
                accessEmail.warning = error && error.message
                    ? "Password reset email could not be sent right now: " + error.message
                    : "Password reset email could not be sent right now.";
            }
        }

        await writeAuditLogEntry(adminClient, {
            module: "user_management",
            action: "replace_applicant_login_email",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: profileResult.data.id,
            target_role: profileResult.data.role,
            target_email: responseUser.email,
            target_label: buildFullName(
                profileResult.data.first_name || "",
                profileResult.data.middle_name || "",
                profileResult.data.last_name || ""
            ),
            record_type: "user",
            record_id: profileResult.data.id,
            summary: "Replaced applicant login email for " + (responseUser.email || "selected applicant") + ".",
            details: {
                previous_profile_email: previousProfileEmail || "",
                previous_auth_email: previousAuthEmail || "",
                updated_email: responseUser.email || "",
                password_reset_email_sent: accessEmail.sent,
                password_reset_email_requested: accessEmail.requested,
                password_reset_email_warning: accessEmail.warning || "",
                email_confirmed_at: responseUser.email_confirmed_at
            }
        });

        response.status(200).json({
            ok: true,
            user: responseUser,
            access_email: accessEmail
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Login email replacement failed.");
    }
});

app.post("/api/secretary/walk-in-intake", authenticate, async function (request, response) {
    let createdUserId = "";
    let cleanupCreatedUser = false;

    try {
        if (!WALK_IN_ENABLED_STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can encode walk-in applicants.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const adminClient = createSupabaseAdminClient();
        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const activeSettings = await loadActiveRankingSettingsForOffice(adminClient);
        const officeControls = activeSettings.controls || {};
        if (officeControls.allow_secretary_walk_in_intake !== true) {
            writeJsonError(response, 403, "Walk-in intake is currently disabled by System Administrator.");
            return;
        }

        const firstName = upperTextOrNull(request.body && request.body.firstName);
        const middleName = upperTextOrNull(request.body && request.body.middleName);
        const lastName = upperTextOrNull(request.body && request.body.lastName);
        const email = ((request.body && request.body.email) || "").toString().trim().toLowerCase();
        const mobileNumber = normalizePhoneNumber(request.body && request.body.mobileNumber);
        const officeNote = nullIfBlank(request.body && request.body.officeNote);
        const schoolYearInput = nullIfBlank(request.body && request.body.schoolYear);
        const schoolYear = schoolYearInput || activeSettings.schoolYear || "";
        const scholarshipType = nullIfBlank(request.body && request.body.scholarshipType) || DEFAULT_WALK_IN_SCHOLARSHIP_TYPE;
        const sectorClassification = normalizeSectorClassification(request.body && request.body.sectorClassification);

        if (!firstName || !lastName || !email || !mobileNumber) {
            writeJsonError(response, 400, "First name, last name, email, and mobile number are required.");
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
        if (!schoolYear || !isValidSchoolYear(schoolYear)) {
            writeJsonError(response, 400, "School year is required and must follow YYYY-YYYY format.");
            return;
        }
        if (!scholarshipType) {
            writeJsonError(response, 400, "Scholarship type is required.");
            return;
        }
        if (sectorClassification === "") {
            writeJsonError(response, 400, "Sector classification value is not recognized.");
            return;
        }

        const existingEmailProfileResult = await adminClient
            .from("profiles")
            .select("id, role, email, mobile_number, first_name, middle_name, last_name, is_active")
            .eq("email", email)
            .maybeSingle();

        if (existingEmailProfileResult.error) {
            writeJsonError(response, 400, existingEmailProfileResult.error.message || "Failed to check applicant email.");
            return;
        }

        const existingMobileProfileResult = await adminClient
            .from("profiles")
            .select("id, role, email")
            .eq("mobile_number", mobileNumber)
            .maybeSingle();

        if (existingMobileProfileResult.error) {
            writeJsonError(response, 400, existingMobileProfileResult.error.message || "Failed to check applicant mobile number.");
            return;
        }

        let applicantProfile = existingEmailProfileResult.data || null;
        let temporaryPassword = "";
        let usedExistingApplicant = false;

        if (applicantProfile) {
            if (applicantProfile.role !== "applicant") {
                writeJsonError(response, 400, "The selected email already belongs to a staff account.");
                return;
            }
            if (
                existingMobileProfileResult.data &&
                existingMobileProfileResult.data.id &&
                existingMobileProfileResult.data.id !== applicantProfile.id
            ) {
                writeJsonError(response, 400, "The mobile number already belongs to another account.");
                return;
            }
            usedExistingApplicant = true;
        } else if (existingMobileProfileResult.data && existingMobileProfileResult.data.id) {
            writeJsonError(response, 400, "The mobile number already belongs to another account. Use that existing applicant account instead.");
            return;
        } else {
            temporaryPassword = generateTemporaryApplicantPassword();
            const createResult = await adminClient.auth.admin.createUser({
                email: email,
                password: temporaryPassword,
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
            cleanupCreatedUser = true;
            applicantProfile = {
                id: createdUserId,
                role: "applicant",
                email: email,
                mobile_number: mobileNumber,
                first_name: firstName,
                middle_name: middleName,
                last_name: lastName,
                is_active: true
            };
        }

        const applicantProfileResult = await adminClient
            .from("profiles")
            .upsert({
                id: applicantProfile.id,
                role: "applicant",
                email: email,
                mobile_number: mobileNumber,
                first_name: firstName,
                middle_name: middleName,
                last_name: lastName,
                is_active: true
            }, { onConflict: "id" })
            .select("id, role, email, mobile_number, first_name, middle_name, last_name, is_active")
            .single();

        if (applicantProfileResult.error || !applicantProfileResult.data) {
            if (cleanupCreatedUser && createdUserId) {
                try {
                    await adminClient.auth.admin.deleteUser(createdUserId);
                } catch (_cleanupError) {
                    // Best effort only.
                }
            }
            writeJsonError(response, 400, explainUserCreationError(applicantProfileResult.error && applicantProfileResult.error.message));
            return;
        }

        const submittedAt = new Date().toISOString();
        const remarkLines = [
            "Walk-in intake encoded by office on " + submittedAt + "."
        ];
        if (officeNote) {
            remarkLines.push("Office note: " + officeNote);
        }

        const applicationInsertResult = await adminClient
            .from("applications")
            .insert({
                applicant_id: applicantProfileResult.data.id,
                application_type: "new",
                scholarship_type: scholarshipType,
                school_year: schoolYear,
                sector_classification: sectorClassification || null,
                status: "submitted",
                submitted_at: submittedAt,
                secretary_reviewer_id: request.auth.user.id,
                secretary_remarks: remarkLines.join(" ")
            })
            .select("id, application_no, applicant_id, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
            .single();

        if (applicationInsertResult.error || !applicationInsertResult.data) {
            if (cleanupCreatedUser && createdUserId) {
                try {
                    await adminClient.auth.admin.deleteUser(createdUserId);
                } catch (_cleanupError) {
                    // Best effort only.
                }
            }
            writeJsonError(response, 400, explainWalkInApplicationError(applicationInsertResult.error && applicationInsertResult.error.message));
            return;
        }

        cleanupCreatedUser = false;

        try {
            await adminClient
                .from("application_aux_data")
                .upsert({
                    application_id: applicationInsertResult.data.id,
                    applicant_id: applicantProfileResult.data.id,
                    form_data: {
                        grantAppliedFor: "Degree Course",
                        walkInIntake: true,
                        walkInEncodedAt: submittedAt,
                        walkInEncodedBy: request.auth.user.id,
                        walkInOfficeNote: officeNote || ""
                    }
                }, { onConflict: "application_id" });
        } catch (_auxError) {
            // Non-fatal: walk-in intake can proceed without aux-data metadata.
        }

        try {
            await adminClient
                .from("notifications")
                .insert({
                    recipient_user_id: applicantProfileResult.data.id,
                    sender_user_id: request.auth.user.id,
                    notification_type: "application",
                    title: "Walk-In Application Created",
                    message: "Your scholarship application was encoded by the scholarship office as a walk-in intake record. You may review your account later using your email login.",
                    related_application_id: applicationInsertResult.data.id,
                    is_read: false
                });
        } catch (_notificationError) {
            // Non-fatal: walk-in intake can proceed without notification insert.
        }

        await writeAuditLogEntry(adminClient, {
            module: "walk_in_intake",
            action: "create_walk_in_application",
            actor_id: request.auth.user.id,
            actor_role: request.auth.role,
            target_user_id: applicantProfileResult.data.id,
            target_role: applicantProfileResult.data.role,
            target_email: applicantProfileResult.data.email,
            target_label: buildFullName(firstName, middleName, lastName),
            record_type: "application",
            record_id: applicationInsertResult.data.id,
            summary: "Created walk-in application " + (applicationInsertResult.data.application_no || "") + " for " + (email || "applicant") + ".",
            details: {
                school_year: schoolYear,
                scholarship_type: scholarshipType,
                sector_classification: sectorClassification || "",
                new_user_created: !usedExistingApplicant,
                office_note: officeNote || ""
            }
        });

        response.status(201).json({
            ok: true,
            walk_in_enabled: true,
            user_created: !usedExistingApplicant,
            used_existing_applicant: usedExistingApplicant,
            temporary_password: temporaryPassword,
            applicant: {
                id: applicantProfileResult.data.id,
                email: applicantProfileResult.data.email,
                mobile_number: applicantProfileResult.data.mobile_number,
                first_name: applicantProfileResult.data.first_name,
                middle_name: applicantProfileResult.data.middle_name,
                last_name: applicantProfileResult.data.last_name
            },
            application: applicationInsertResult.data
        });
    } catch (error) {
        if (cleanupCreatedUser && createdUserId) {
            try {
                const adminClient = createSupabaseAdminClient();
                if (adminClient) {
                    await adminClient.auth.admin.deleteUser(createdUserId);
                }
            } catch (_cleanupError) {
                // Best effort only.
            }
        }
        writeJsonError(response, 500, error && error.message ? error.message : "Walk-in intake failed.");
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
        const correctionTarget = nullIfBlank(request.body && request.body.correctionTarget);
        const correctionTargets = parseCorrectionTargetKeys(request.body && request.body.correctionTargets, correctionTarget);
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
        const updateUrl = buildComplianceUpdateUrl(
            baseUrl,
            applicationId,
            correctionTarget,
            correctionTargets,
            remarks
        );

        await sendComplianceEmailMail({
            email: email,
            applicantName: applicantName,
            applicationNo: applicationResult.data.application_no || "LDSP Application",
            remarks: remarks,
            targetSummary: correctionTargetsSummary(correctionTargets),
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

app.post("/api/notifications/exam-schedule", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send exam schedule emails.");
            return;
        }

        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }
        if (!SUPABASE_SERVICE_ROLE_KEY) {
            writeJsonError(
                response,
                503,
                "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY. The queued exam schedule sender needs the Supabase service role key."
            );
            return;
        }

        const batchId = nullIfBlank(request.body && request.body.batchId);
        const customMessage = nullIfBlank(request.body && request.body.customMessage);
        if (!batchId) {
            writeJsonError(response, 400, "Batch ID is required.");
            return;
        }
        if (customMessage && customMessage.length > 500) {
            writeJsonError(response, 400, "Exam schedule email note must stay within 500 characters.");
            return;
        }

        let scheduleData;
        try {
            scheduleData = await loadExamScheduleRecipientsForBatch(request, batchId, []);
        } catch (scheduleError) {
            const message = scheduleError && scheduleError.message ? scheduleError.message : "Failed to load scheduled exam records.";
            writeJsonError(response, /not found/i.test(message) ? 404 : 400, message);
            return;
        }
        const batch = scheduleData.batch;
        const recipients = scheduleData.recipients;
        if (!recipients.length) {
            writeJsonError(response, 400, "This batch does not have any scheduled examinees yet.");
            return;
        }

        let activeQueueJob;
        try {
            activeQueueJob = await ensureNoActiveExamScheduleEmailJob(request.auth.client, batchId);
        } catch (queueCheckError) {
            writeJsonError(response, 400, queueCheckError && queueCheckError.message ? queueCheckError.message : "Unable to verify the exam schedule email queue.");
            return;
        }
        if (activeQueueJob) {
            writeJsonError(
                response,
                409,
                "An exam schedule email queue is already active for this batch. Please wait for it to finish before sending again."
            );
            return;
        }

        const deliverableRecipients = [];
        let emailSkippedCount = 0;
        for (let index = 0; index < recipients.length; index += 1) {
            const recipient = recipients[index];
            if (!recipient.email) {
                emailSkippedCount += 1;
                continue;
            }
            deliverableRecipients.push({
                email: recipient.email,
                applicantName: recipient.applicantName,
                applicationId: recipient.applicationId,
                applicationNo: recipient.applicationNo,
                batchLabel: recipient.batchLabel,
                scheduleLabel: recipient.scheduleLabel,
                venue: recipient.venue,
                roomLabel: recipient.roomLabel,
                seatNo: recipient.seatNo,
                examControlNo: recipient.examControlNo,
                customMessage: customMessage || "",
                detailUrl: recipient.detailUrl,
                lookupUrl: recipient.lookupUrl
            });
        }

        if (!deliverableRecipients.length) {
            response.json({
                ok: true,
                queued: false,
                batch_id: batch.id,
                batch_label: batch.batch_label || "Exam Batch",
                recipient_count: recipients.length,
                queued_email_count: 0,
                status_updated_count: 0,
                status_update_error: "",
                notification_count: 0,
                notification_error: "",
                email_sent_count: 0,
                email_skipped_count: emailSkippedCount,
                email_failed_count: 0
            });
            return;
        }

        let queuedJob;
        try {
            queuedJob = await queueExamScheduleEmailJob(request.auth.client, {
                batchId: batch.id,
                batchLabel: batch.batch_label || "Exam Batch",
                recipientPayloads: deliverableRecipients,
                initialSkippedCount: emailSkippedCount,
                createdBy: request.auth.user.id,
                batchSize: EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_SIZE,
                batchDelayMinutes: EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_DELAY_MINUTES
            });
        } catch (queueError) {
            writeJsonError(response, 400, queueError && queueError.message ? queueError.message : "Unable to queue the exam schedule emails.");
            return;
        }

        const recipientApplicationIds = Array.from(new Set(recipients.map(function (item) {
            return item.applicationId;
        }).filter(Boolean)));
        let statusUpdatedCount = 0;
        let statusUpdateError = "";
        try {
            for (let start = 0; start < recipientApplicationIds.length; start += 200) {
                const chunk = recipientApplicationIds.slice(start, start + 200);
                const updateResult = await request.auth.client
                    .from("applications")
                    .update({
                        status: "exam_scheduled",
                        secretary_reviewer_id: request.auth.user.id
                    })
                    .in("id", chunk);

                if (updateResult.error) {
                    throw new Error(updateResult.error.message || "Failed to update application statuses.");
                }
                statusUpdatedCount += chunk.length;
            }
        } catch (updateError) {
            statusUpdateError = updateError && updateError.message
                ? updateError.message
                : "Failed to update application statuses.";
        }

        let notificationCount = 0;
        let notificationError = "";
        try {
            const notificationPayload = recipients.map(function (item) {
                return buildExamScheduleNotificationEntry(item, request.auth.user.id);
            });

            for (let start = 0; start < notificationPayload.length; start += 100) {
                const chunk = notificationPayload.slice(start, start + 100);
                const insertResult = await request.auth.client
                    .from("notifications")
                    .insert(chunk);

                if (insertResult.error) {
                    throw new Error(insertResult.error.message || "Failed to save applicant notifications.");
                }
                notificationCount += chunk.length;
            }
        } catch (notificationInsertError) {
            notificationError = notificationInsertError && notificationInsertError.message
                ? notificationInsertError.message
                : "Failed to save applicant notifications.";
        }

        triggerExamScheduleEmailProcessor(250);

        response.json({
            ok: true,
            queued: true,
            job_id: queuedJob.id,
            batch_id: batch.id,
            batch_label: batch.batch_label || "Exam Batch",
            recipient_count: recipients.length,
            queued_email_count: deliverableRecipients.length,
            status_updated_count: statusUpdatedCount,
            status_update_error: statusUpdateError,
            notification_count: notificationCount,
            notification_error: notificationError,
            email_sent_count: 0,
            email_skipped_count: emailSkippedCount,
            email_failed_count: 0,
            batch_size: Number(queuedJob.batch_size || EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_SIZE),
            batch_delay_minutes: Number(queuedJob.batch_delay_minutes || EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_DELAY_MINUTES),
            estimated_batches: Math.ceil(deliverableRecipients.length / Math.max(1, Number(queuedJob.batch_size || EXAM_SCHEDULE_EMAIL_DEFAULT_BATCH_SIZE)))
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Exam schedule email failed.");
    }
});

app.post("/api/notifications/exam-schedule/single", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send direct exam schedule emails.");
            return;
        }

        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }

        const batchId = nullIfBlank(request.body && request.body.batchId);
        const applicationId = nullIfBlank(request.body && request.body.applicationId);
        const customMessage = nullIfBlank(request.body && request.body.customMessage);

        if (!batchId) {
            writeJsonError(response, 400, "Batch ID is required.");
            return;
        }
        if (!applicationId) {
            writeJsonError(response, 400, "Application ID is required.");
            return;
        }
        if (customMessage && customMessage.length > 500) {
            writeJsonError(response, 400, "Exam schedule email note must stay within 500 characters.");
            return;
        }

        let scheduleData;
        try {
            scheduleData = await loadExamScheduleRecipientsForBatch(request, batchId, [applicationId]);
        } catch (scheduleError) {
            const message = scheduleError && scheduleError.message ? scheduleError.message : "Failed to load the selected scheduled examinee.";
            writeJsonError(response, /not found/i.test(message) ? 404 : 400, message);
            return;
        }

        const batch = scheduleData.batch;
        const recipient = scheduleData.recipients[0] || null;
        if (!recipient) {
            writeJsonError(response, 404, "The selected scheduled examinee was not found in this batch.");
            return;
        }
        if (!recipient.email) {
            writeJsonError(response, 400, "The selected examinee does not have an email address on file.");
            return;
        }

        await sendExamScheduleEmailMail({
            email: recipient.email,
            applicantName: recipient.applicantName,
            applicationNo: recipient.applicationNo,
            batchLabel: recipient.batchLabel,
            scheduleLabel: recipient.scheduleLabel,
            venue: recipient.venue,
            roomLabel: recipient.roomLabel,
            seatNo: recipient.seatNo,
            examControlNo: recipient.examControlNo,
            customMessage: customMessage || "",
            detailUrl: recipient.detailUrl,
            lookupUrl: recipient.lookupUrl
        });

        let statusUpdated = false;
        let statusUpdateError = "";
        try {
            const updateResult = await request.auth.client
                .from("applications")
                .update({
                    status: "exam_scheduled",
                    secretary_reviewer_id: request.auth.user.id
                })
                .eq("id", recipient.applicationId);

            if (updateResult.error) {
                throw new Error(updateResult.error.message || "Failed to update application status.");
            }
            statusUpdated = true;
        } catch (updateError) {
            statusUpdateError = updateError && updateError.message
                ? updateError.message
                : "Failed to update application status.";
        }

        let notificationSaved = false;
        let notificationError = "";
        try {
            const insertResult = await request.auth.client
                .from("notifications")
                .insert([buildExamScheduleNotificationEntry(recipient, request.auth.user.id)]);

            if (insertResult.error) {
                throw new Error(insertResult.error.message || "Failed to save applicant notification.");
            }
            notificationSaved = true;
        } catch (insertError) {
            notificationError = insertError && insertError.message
                ? insertError.message
                : "Failed to save applicant notification.";
        }

        response.json({
            ok: true,
            batch_id: batch.id,
            batch_label: batch.batch_label || "Exam Batch",
            application_id: recipient.applicationId,
            application_no: recipient.applicationNo,
            applicant_name: recipient.applicantName,
            sent_to_email: recipient.email,
            status_updated: statusUpdated,
            status_update_error: statusUpdateError,
            notification_saved: notificationSaved,
            notification_error: notificationError
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Direct exam schedule email failed.");
    }
});

app.post("/api/notifications/exam-schedule/test", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send test exam schedule emails.");
            return;
        }

        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }

        const batchId = nullIfBlank(request.body && request.body.batchId);
        const applicationId = nullIfBlank(request.body && request.body.applicationId);
        const customMessage = nullIfBlank(request.body && request.body.customMessage);
        const testEmail = normalizeEmailAddress(request.body && request.body.testEmail);

        if (!batchId) {
            writeJsonError(response, 400, "Batch ID is required.");
            return;
        }
        if (!applicationId) {
            writeJsonError(response, 400, "Select one scheduled examinee first.");
            return;
        }
        if (customMessage && customMessage.length > 500) {
            writeJsonError(response, 400, "Exam schedule email note must stay within 500 characters.");
            return;
        }
        if (testEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
            writeJsonError(response, 400, "Enter a valid test receiver email address.");
            return;
        }

        let scheduleData;
        try {
            scheduleData = await loadExamScheduleRecipientsForBatch(request, batchId, [applicationId]);
        } catch (scheduleError) {
            const message = scheduleError && scheduleError.message ? scheduleError.message : "Failed to load the selected scheduled examinee.";
            writeJsonError(response, /not found/i.test(message) ? 404 : 400, message);
            return;
        }

        const batch = scheduleData.batch;
        const recipient = scheduleData.recipients[0] || null;
        if (!recipient) {
            writeJsonError(response, 404, "The selected scheduled examinee was not found in this batch.");
            return;
        }

        const deliveryEmail = testEmail || recipient.email;
        if (!deliveryEmail) {
            writeJsonError(response, 400, "The selected examinee does not have an email address on file. Enter a test receiver email first.");
            return;
        }

        await sendExamScheduleEmailMail({
            email: deliveryEmail,
            applicantName: recipient.applicantName,
            applicationNo: recipient.applicationNo,
            batchLabel: recipient.batchLabel,
            scheduleLabel: recipient.scheduleLabel,
            venue: recipient.venue,
            roomLabel: recipient.roomLabel,
            seatNo: recipient.seatNo,
            examControlNo: recipient.examControlNo,
            customMessage: customMessage || "",
            detailUrl: recipient.detailUrl,
            lookupUrl: recipient.lookupUrl
        });

        response.json({
            ok: true,
            batch_id: batch.id,
            batch_label: batch.batch_label || "Exam Batch",
            application_id: recipient.applicationId,
            application_no: recipient.applicationNo,
            applicant_name: recipient.applicantName,
            sent_to_email: deliveryEmail,
            used_test_email: Boolean(testEmail)
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Test exam schedule email failed.");
    }
});

app.post("/api/notifications/special-exam-reschedule", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send special examination reschedule emails.");
            return;
        }

        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }

        const subject = nullIfBlank(request.body && request.body.subject) || DEFAULT_SPECIAL_EXAM_RESCHEDULE_SUBJECT;
        const scheduleDate = nullIfBlank(request.body && request.body.scheduleDate);
        const reportingTime = nullIfBlank(request.body && request.body.reportingTime);
        const venue = nullIfBlank(request.body && request.body.venue);
        const room = nullIfBlank(request.body && request.body.room);
        const instructions = nullIfBlank(request.body && request.body.instructions);
        const recipientInfo = normalizeSpecialExamRecipientList(request.body && request.body.recipients);

        if (subject.length > 150) {
            writeJsonError(response, 400, "Email subject must stay within 150 characters.");
            return;
        }
        if (!scheduleDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
            writeJsonError(response, 400, "A valid special examination date is required.");
            return;
        }
        if (!reportingTime || !/^\d{2}:\d{2}$/.test(reportingTime)) {
            writeJsonError(response, 400, "A valid reporting time is required.");
            return;
        }
        if (!venue) {
            writeJsonError(response, 400, "Venue is required.");
            return;
        }
        if (venue.length > 180) {
            writeJsonError(response, 400, "Venue must stay within 180 characters.");
            return;
        }
        if (room && room.length > 120) {
            writeJsonError(response, 400, "Room / area must stay within 120 characters.");
            return;
        }
        if (instructions && instructions.length > 1000) {
            writeJsonError(response, 400, "Office reminder must stay within 1000 characters.");
            return;
        }
        if (!recipientInfo.recipients.length) {
            writeJsonError(response, 400, "At least one valid recipient email is required.");
            return;
        }
        if (recipientInfo.recipients.length > SPECIAL_EXAM_RESCHEDULE_MAX_RECIPIENTS) {
            writeJsonError(
                response,
                400,
                "Too many recipients in one send. Keep the special examination batch to " + SPECIAL_EXAM_RESCHEDULE_MAX_RECIPIENTS + " recipients or less."
            );
            return;
        }

        const sent = [];
        const failed = [];

        for (let index = 0; index < recipientInfo.recipients.length; index += 1) {
            const recipient = recipientInfo.recipients[index];
            try {
                await sendSpecialExamRescheduleMail({
                    email: recipient.email,
                    applicantName: recipient.fullName,
                    subject: subject,
                    scheduleDate: scheduleDate,
                    reportingTime: reportingTime,
                    venue: venue,
                    room: room || "",
                    instructions: instructions || ""
                });
                sent.push({
                    full_name: recipient.fullName,
                    email: recipient.email
                });
            } catch (error) {
                failed.push({
                    full_name: recipient.fullName,
                    email: recipient.email,
                    error: error && error.message ? error.message : "Email send failed."
                });
            }
        }

        response.json({
            ok: true,
            requested_count: Array.isArray(request.body && request.body.recipients) ? request.body.recipients.length : 0,
            valid_count: recipientInfo.recipients.length,
            skipped_count: recipientInfo.skipped.length,
            sent_count: sent.length,
            failed_count: failed.length,
            skipped_preview: recipientInfo.skipped.slice(0, 10),
            failed_preview: failed.slice(0, 10)
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Special examination reschedule email failed.");
    }
});

app.post("/api/notifications/special-exam-reschedule/test", authenticate, async function (request, response) {
    try {
        if (!STAFF_ROLES.has(request.auth.role)) {
            writeJsonError(response, 403, "Only staff can send test special examination emails.");
            return;
        }

        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }

        const subject = nullIfBlank(request.body && request.body.subject) || DEFAULT_SPECIAL_EXAM_RESCHEDULE_SUBJECT;
        const scheduleDate = nullIfBlank(request.body && request.body.scheduleDate);
        const reportingTime = nullIfBlank(request.body && request.body.reportingTime);
        const venue = nullIfBlank(request.body && request.body.venue);
        const room = nullIfBlank(request.body && request.body.room);
        const instructions = nullIfBlank(request.body && request.body.instructions);
        const testEmail = normalizeEmailAddress(request.body && request.body.testEmail);
        const sampleRecipient = request.body && request.body.sampleRecipient ? request.body.sampleRecipient : {};
        const applicantName = nullIfBlank(
            sampleRecipient && (
                sampleRecipient.fullName ||
                sampleRecipient.full_name ||
                sampleRecipient.name
            )
        ) || "Applicant";

        if (subject.length > 150) {
            writeJsonError(response, 400, "Email subject must stay within 150 characters.");
            return;
        }
        if (!scheduleDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
            writeJsonError(response, 400, "A valid special examination date is required.");
            return;
        }
        if (!reportingTime || !/^\d{2}:\d{2}$/.test(reportingTime)) {
            writeJsonError(response, 400, "A valid reporting time is required.");
            return;
        }
        if (!venue) {
            writeJsonError(response, 400, "Venue is required.");
            return;
        }
        if (venue.length > 180) {
            writeJsonError(response, 400, "Venue must stay within 180 characters.");
            return;
        }
        if (room && room.length > 120) {
            writeJsonError(response, 400, "Room / area must stay within 120 characters.");
            return;
        }
        if (instructions && instructions.length > 1000) {
            writeJsonError(response, 400, "Office reminder must stay within 1000 characters.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) {
            writeJsonError(response, 400, "Enter a valid test receiver email address.");
            return;
        }

        await sendSpecialExamRescheduleMail({
            email: testEmail,
            applicantName: applicantName,
            subject: subject,
            scheduleDate: scheduleDate,
            reportingTime: reportingTime,
            venue: venue,
            room: room || "",
            instructions: instructions || ""
        });

        response.json({
            ok: true,
            sent_to_email: testEmail,
            applicant_name: applicantName
        });
    } catch (error) {
        writeJsonError(response, 500, error && error.message ? error.message : "Test special examination email failed.");
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

        const recipientIds = uniqueReminderRecipientIds(request.body && request.body.recipientIds);

        if (!recipientIds.length) {
            writeJsonError(response, 400, "Select at least one recipient for the reminder campaign.");
            return;
        }
        if (recipientIds.length > REMINDER_CAMPAIGN_MAX_RECIPIENTS) {
            writeJsonError(response, 400, "Too many recipients at once. Limit each queued reminder campaign to " + REMINDER_CAMPAIGN_MAX_RECIPIENTS + " recipients.");
            return;
        }
        if (!mailServerConfigured()) {
            writeJsonError(response, 503, "Server email is not configured. Add SMTP settings in the Node app environment first.");
            return;
        }

        const baseUrl = resolveBaseUrl(request);
        const reminderLogsProbe = await request.auth.client
            .from(REMINDER_LOGS_TABLE)
            .select("id")
            .limit(1);

        if (reminderLogsProbe.error) {
            writeJsonError(
                response,
                500,
                isMissingTableError(reminderLogsProbe.error, REMINDER_LOGS_TABLE)
                    ? "Reminder log table is not available yet. Run reminder_email_logs_hotfix_2026_03_17.sql first."
                    : (reminderLogsProbe.error.message || "Unable to prepare reminder campaign logging.")
            );
            return;
        }

        const adminClient = createSupabaseAdminClient();
        const reminderSendClient = adminClient || request.auth.client;

        if (recipientIds.length === 1) {
            const results = await sendReminderEmailsForRecipients({
                client: reminderSendClient,
                recipientIds: recipientIds,
                campaignType: campaignType,
                sentBy: request.auth.user.id,
                baseUrl: baseUrl
            });

            response.json({
                ok: true,
                queued: false,
                sentCount: results.sent.length,
                skippedCount: results.skipped.length,
                failedCount: results.failed.length,
                sent: results.sent,
                skipped: results.skipped,
                failed: results.failed
            });
            return;
        }

        if (!adminClient) {
            writeJsonError(response, 503, "Server is missing LDSS_SUPABASE_SERVICE_ROLE_KEY.");
            return;
        }

        const queuedJob = await queueReminderCampaignJob(adminClient, {
            campaignType: campaignType,
            recipientIds: recipientIds,
            createdBy: request.auth.user.id,
            baseUrl: baseUrl,
            batchSize: REMINDER_CAMPAIGN_DEFAULT_BATCH_SIZE,
            batchDelayMinutes: REMINDER_CAMPAIGN_DEFAULT_BATCH_DELAY_MINUTES
        });

        triggerReminderCampaignProcessor(250);

        response.json({
            ok: true,
            queued: true,
            jobId: queuedJob.id,
            totalRecipients: Number(queuedJob.total_recipients || recipientIds.length),
            batchSize: Number(queuedJob.batch_size || REMINDER_CAMPAIGN_DEFAULT_BATCH_SIZE),
            batchDelayMinutes: Number(queuedJob.batch_delay_minutes || REMINDER_CAMPAIGN_DEFAULT_BATCH_DELAY_MINUTES),
            estimatedBatches: Math.ceil(recipientIds.length / Math.max(1, Number(queuedJob.batch_size || REMINDER_CAMPAIGN_DEFAULT_BATCH_SIZE)))
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
    startReminderCampaignProcessor();
    startExamScheduleEmailProcessor();
});

module.exports = server;
