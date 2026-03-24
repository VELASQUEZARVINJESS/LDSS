(function () {
    "use strict";

    const CONFIG_PLACEHOLDERS = ["YOUR_PROJECT_REF", "YOUR_SUPABASE_ANON_KEY"];

    function formatDate(value) {
        if (!value) {
            return "";
        }
        const parsed = new Date(value + "T12:00:00");
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString("en-US", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function normalizeTimeValue(value) {
        const raw = (value || "").toString().trim();
        const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? (match[1] + ":" + match[2]) : "";
    }

    function formatTimeValue(value) {
        const normalized = normalizeTimeValue(value);
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

    function formatScheduleLabel(dateValue, timeValue) {
        const dateLabel = formatDate(dateValue);
        const timeLabel = formatTimeValue(timeValue);
        if (!dateLabel) {
            return "";
        }
        return timeLabel
            ? (dateLabel + " at " + timeLabel)
            : dateLabel;
    }

    function setModalNotice(message, type) {
        const modalEl = document.querySelector("[data-public-intake-modal='1']");
        const titleEl = document.querySelector("[data-public-intake-modal-title='1']");
        const bodyEl = document.querySelector("[data-public-intake-modal-body='1']");
        if (!modalEl || !titleEl || !bodyEl) {
            return;
        }

        if (!message) {
            return;
        }

        if ((type || "").indexOf("danger") !== -1) {
            titleEl.textContent = "Online Application Closed";
        } else {
            titleEl.textContent = "Online Application Notice";
        }
        bodyEl.textContent = message;

        if (window.bootstrap && window.bootstrap.Modal) {
            const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl, {
                backdrop: true,
                keyboard: true
            });
            modal.show();
        }
    }

    function buildNoticeMessage(policy) {
        if (!policy || policy.is_open === true) {
            return { message: "", type: "" };
        }

        const reason = (policy.reason || "").toString();
        const openDate = (policy.open_date || "").toString();
        const closeDate = (policy.close_date || "").toString();
        const openTime = (policy.open_time || "").toString();
        const closeTime = (policy.close_time || "").toString();

        if (reason === "before_open_date") {
            return {
                message: "Notice: You may still sign in to your account, but new online scholarship application submission is not open yet. Filing starts on " + (formatScheduleLabel(openDate, openTime) || "the scheduled opening date") + ".",
                type: "alert-warning"
            };
        }

        if (reason === "after_close_date") {
            return {
                message: "Notice: You may still sign in to your account, but new online scholarship application submission is now closed for this filing period. Filing closed on " + (formatScheduleLabel(closeDate, closeTime) || "the scheduled deadline") + ".",
                type: "alert-danger"
            };
        }

        if (reason === "closed_by_admin") {
            return {
                message: "Notice: You may still sign in to your account, but new online scholarship application submission is currently closed by the scholarship office. Please wait for the next filing announcement or office instruction.",
                type: "alert-danger"
            };
        }

        return {
            message: "Notice: You may still sign in to your account, but new online scholarship application submission is currently unavailable at this time.",
            type: "alert-warning"
        };
    }

    async function loadPublicIntakeNotice() {
        const modalEl = document.querySelector("[data-public-intake-modal='1']");
        if (!modalEl) {
            return;
        }

        const url = window.LDSS_SUPABASE_URL || "";
        const anonKey = window.LDSS_SUPABASE_ANON_KEY || "";
        const hasPlaceholderConfig = CONFIG_PLACEHOLDERS.some(function (token) {
            return url.includes(token) || anonKey.includes(token);
        });

        if (!window.supabase || !window.supabase.createClient || !url || !anonKey || hasPlaceholderConfig) {
            return;
        }

        try {
            const client = window.supabase.createClient(url, anonKey);
            const result = await client.rpc("application_intake_is_open");
            if (result.error || !result.data || typeof result.data !== "object") {
                return;
            }

            const notice = buildNoticeMessage(result.data);
            setModalNotice(notice.message, notice.type);
        } catch (_error) {
            // Leave the public auth pages usable even if the notice lookup fails.
        }
    }

    window.addEventListener("DOMContentLoaded", function () {
        loadPublicIntakeNotice();
    });
})();
