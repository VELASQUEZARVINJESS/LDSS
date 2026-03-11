(function () {
    "use strict";

    const CONFIRM_PHRASE = "DELETE APPLICATION DATA";

    const WORKFLOW_TABLES = [
        "approval_records",
        "interview_records",
        "exam_records",
        "approval_queue",
        "interviews",
        "application_documents",
        "applications",
        "exam_batches"
    ];

    function byId(id) {
        return document.getElementById(id);
    }

    function showStatus(message, type) {
        const box = byId("superAdminSettingsStatus");
        if (!box) {
            return;
        }

        if (!message) {
            box.className = "alert d-none";
            box.textContent = "";
            return;
        }

        box.className = "alert " + (type || "alert-info");
        box.textContent = message;
    }

    function setSummary(lines) {
        const summary = byId("superAdminCleanupSummary");
        if (!summary) {
            return;
        }

        if (!lines || !lines.length) {
            summary.textContent = "No cleanup executed in this session.";
            return;
        }

        summary.textContent = lines.join("\n");
    }

    function normalizeErrorMessage(error) {
        if (!error) {
            return "";
        }
        if (typeof error === "string") {
            return error;
        }
        return error.message || "";
    }

    function isMissingRelationError(error) {
        const message = normalizeErrorMessage(error).toLowerCase();
        return (
            message.includes("does not exist") ||
            message.includes("42p01")
        );
    }

    async function countRows(context, tableName) {
        const result = await context.client
            .from(tableName)
            .select("id", { count: "exact", head: true });

        if (result.error) {
            if (isMissingRelationError(result.error)) {
                return { skipped: true, count: 0 };
            }
            throw new Error("Failed counting " + tableName + ": " + normalizeErrorMessage(result.error));
        }

        return { skipped: false, count: result.count || 0 };
    }

    async function deleteAllRowsById(context, tableName) {
        const result = await context.client
            .from(tableName)
            .delete()
            .not("id", "is", null);

        if (result.error) {
            if (isMissingRelationError(result.error)) {
                return { skipped: true };
            }
            throw new Error("Failed deleting from " + tableName + ": " + normalizeErrorMessage(result.error));
        }

        return { skipped: false };
    }

    async function deleteApplicationNotifications(context) {
        const byRelatedApplication = await context.client
            .from("notifications")
            .delete()
            .not("related_application_id", "is", null);

        if (byRelatedApplication.error) {
            if (isMissingRelationError(byRelatedApplication.error)) {
                return { skipped: true };
            }
            throw new Error("Failed deleting related notifications: " + normalizeErrorMessage(byRelatedApplication.error));
        }

        const byWorkflowType = await context.client
            .from("notifications")
            .delete()
            .in("notification_type", ["application", "interview", "approval", "certification", "release", "reminder"]);

        if (byWorkflowType.error) {
            if (isMissingRelationError(byWorkflowType.error)) {
                return { skipped: true };
            }
            throw new Error("Failed deleting workflow notifications: " + normalizeErrorMessage(byWorkflowType.error));
        }

        return { skipped: false };
    }

    async function runCleanup(context) {
        const summaryLines = [];
        let totalRemoved = 0;
        let hadErrors = false;

        try {
            const notificationCountBefore = await countRows(context, "notifications");
            if (!notificationCountBefore.skipped) {
                await deleteApplicationNotifications(context);
                const notificationCountAfter = await countRows(context, "notifications");
                const removed = Math.max(0, notificationCountBefore.count - notificationCountAfter.count);
                totalRemoved += removed;
                summaryLines.push("notifications (application-related): -" + removed);
            } else {
                summaryLines.push("notifications: skipped (table missing)");
            }
        } catch (error) {
            hadErrors = true;
            summaryLines.push("notifications: error (" + normalizeErrorMessage(error) + ")");
        }

        for (let i = 0; i < WORKFLOW_TABLES.length; i += 1) {
            const tableName = WORKFLOW_TABLES[i];
            try {
                const before = await countRows(context, tableName);

                if (before.skipped) {
                    summaryLines.push(tableName + ": skipped (table missing)");
                    continue;
                }

                await deleteAllRowsById(context, tableName);
                const after = await countRows(context, tableName);
                const removed = Math.max(0, before.count - after.count);
                totalRemoved += removed;
                summaryLines.push(tableName + ": -" + removed);
            } catch (error) {
                hadErrors = true;
                summaryLines.push(tableName + ": error (" + normalizeErrorMessage(error) + ")");
            }
        }

        try {
            const applicationsAfter = await countRows(context, "applications");
            if (!applicationsAfter.skipped) {
                summaryLines.push("applications remaining: " + applicationsAfter.count);
                if (applicationsAfter.count > 0) {
                    hadErrors = true;
                }
            }
        } catch (error) {
            hadErrors = true;
            summaryLines.push("applications remaining: unknown (" + normalizeErrorMessage(error) + ")");
        }

        summaryLines.unshift(hadErrors ? "Cleanup completed with warnings." : "Cleanup completed.");
        summaryLines.push("Total rows removed: " + totalRemoved);
        return {
            lines: summaryLines,
            hadErrors: hadErrors
        };
    }

    function bindConfirmationInput() {
        const input = byId("superAdminCleanupConfirmInput");
        const button = byId("superAdminCleanupBtn");
        if (!input || !button) {
            return;
        }

        input.addEventListener("input", function () {
            button.disabled = input.value.trim().toUpperCase() !== CONFIRM_PHRASE;
        });
    }

    function bindCleanupButton(context) {
        const button = byId("superAdminCleanupBtn");
        const input = byId("superAdminCleanupConfirmInput");
        if (!button || !input) {
            return;
        }

        button.addEventListener("click", async function () {
            if (input.value.trim().toUpperCase() !== CONFIRM_PHRASE) {
                showStatus("Type the full confirmation phrase before cleanup.", "alert-warning");
                return;
            }

            const confirmed = window.confirm(
                "This will permanently delete application workflow data. Continue?"
            );
            if (!confirmed) {
                return;
            }

            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = "Cleaning...";
            showStatus("Cleaning application workflow data...", "alert-info");

            try {
                const cleanupResult = await runCleanup(context);
                setSummary(cleanupResult.lines);
                showStatus(
                    cleanupResult.hadErrors
                        ? "Cleanup finished with warnings. Check summary."
                        : "Cleanup finished successfully.",
                    cleanupResult.hadErrors ? "alert-warning" : "alert-success"
                );
                input.value = "";
            } catch (error) {
                showStatus(error && error.message ? error.message : "Cleanup failed.", "alert-danger");
            } finally {
                button.textContent = originalText;
                button.disabled = true;
            }
        });
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        if (context.role !== "super_admin") {
            showStatus("Only Super Admin can use this module.", "alert-warning");
            return;
        }

        setSummary([]);
        bindConfirmationInput();
        bindCleanupButton(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
