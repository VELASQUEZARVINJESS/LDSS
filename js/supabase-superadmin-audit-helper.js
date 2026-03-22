(function () {
    "use strict";

    const ACTION_META = {
        create_secretary_account: {
            label: "Created Secretary Account",
            chipClass: "ldss-chip-success",
            moduleLabel: "User Management"
        },
        confirm_email_login: {
            label: "Confirmed Email Login",
            chipClass: "ldss-chip-accent",
            moduleLabel: "User Management"
        },
        resend_verification_email: {
            label: "Resent Verification Email",
            chipClass: "ldss-chip-accent",
            moduleLabel: "User Management"
        },
        activate_user_account: {
            label: "Activated User Account",
            chipClass: "ldss-chip-success",
            moduleLabel: "User Management"
        },
        suspend_user_account: {
            label: "Suspended User Account",
            chipClass: "ldss-chip-danger",
            moduleLabel: "User Management"
        },
        delete_user_account: {
            label: "Deleted User Account",
            chipClass: "ldss-chip-danger",
            moduleLabel: "User Management"
        },
        save_scholarship_settings: {
            label: "Saved Scholarship Settings",
            chipClass: "ldss-chip-neutral",
            moduleLabel: "Scholarship Settings"
        },
        update_receive_control: {
            label: "Updated Receive Control",
            chipClass: "ldss-chip-accent",
            moduleLabel: "Scholarship Settings"
        },
        update_applicant_photo_requirement: {
            label: "Updated Photo Requirement",
            chipClass: "ldss-chip-accent",
            moduleLabel: "Scholarship Settings"
        }
    };

    function actionMeta(action) {
        const normalized = (action || "").toString().trim();
        if (ACTION_META[normalized]) {
            return ACTION_META[normalized];
        }
        return {
            label: normalized.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); }) || "System Activity",
            chipClass: "ldss-chip-neutral",
            moduleLabel: "System Administrator"
        };
    }

    function normalizeText(value) {
        const text = (value || "").toString().trim();
        return text || null;
    }

    function normalizeDetails(details) {
        if (!details || typeof details !== "object" || Array.isArray(details)) {
            return {};
        }
        return details;
    }

    async function logEvent(context, entry) {
        if (!context || !context.client || !context.user || !entry || !entry.action) {
            return { ok: false, skipped: "missing_context" };
        }

        const payload = {
            module: normalizeText(entry.module) || "system_admin",
            action: entry.action,
            actor_id: context.user.id,
            actor_role: context.role || "super_admin",
            target_user_id: normalizeText(entry.targetUserId),
            target_role: normalizeText(entry.targetRole),
            target_email: normalizeText(entry.targetEmail),
            target_label: normalizeText(entry.targetLabel),
            record_type: normalizeText(entry.recordType) || "system",
            record_id: normalizeText(entry.recordId),
            summary: normalizeText(entry.summary) || actionMeta(entry.action).label,
            details: normalizeDetails(entry.details)
        };

        const result = await context.client.from("audit_logs").insert(payload);
        if (result.error) {
            const message = (result.error.message || "").toString();
            if (/does not exist|relation/i.test(message)) {
                return { ok: false, skipped: "missing_table", error: result.error };
            }
            throw new Error(message || "Audit log insert failed.");
        }

        return { ok: true };
    }

    function formatTimestamp(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    window.LDSSSuperAdminAudit = {
        actionMeta: actionMeta,
        formatTimestamp: formatTimestamp,
        logEvent: logEvent
    };
})();
