(function () {
    "use strict";

    const DASHBOARD_STATUSES = [
        "for_approval",
        "special_endorsement_review",
        "approved",
        "waitlisted",
        "rejected",
        "for_release",
        "released"
    ];

    const DECISION_META = {
        pending: { label: "Pending", chipClass: "ldss-chip-neutral" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" }
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); }
        };
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showStatus(message, type) {
        const box = byId("adminDashboardStatus");
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

    function setText(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function buildApplicantName(profile) {
        if (!profile) {
            return "Unknown Applicant";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) { return (value || "").toString().trim(); })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : (profile.email || "Unknown Applicant");
    }

    function latestByApplication(rowsInput) {
        const map = {};
        (rowsInput || []).forEach(function (row) {
            if (!row.application_id) {
                return;
            }
            if (!map[row.application_id]) {
                map[row.application_id] = row;
                return;
            }
            const existingTs = new Date(map[row.application_id].updated_at || map[row.application_id].created_at || 0).getTime();
            const currentTs = new Date(row.updated_at || row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[row.application_id] = row;
            }
        });
        return map;
    }

    function decisionMeta(status) {
        return DECISION_META[status] || DECISION_META.pending;
    }

    async function fetchApprovalMap(context, applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        let result = await context.client
            .from("approval_records")
            .select("application_id, decision_status, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (!/does not exist|relation/i.test(result.error.message || "")) {
                throw new Error("Failed to load approval records: " + result.error.message);
            }

            result = await context.client
                .from("approval_queue")
                .select("application_id, decision_status, updated_at, created_at")
                .in("application_id", applicationIds);

            if (result.error) {
                return {};
            }
        }

        return latestByApplication(result.data || []);
    }

    function renderPriorityAlert(queueCount) {
        const alert = byId("adminDashboardPriorityAlert");
        const title = byId("adminDashboardPriorityTitle");
        const text = byId("adminDashboardPriorityText");
        if (!alert || !title || !text) {
            return;
        }

        if (queueCount <= 0) {
            alert.classList.add("d-none");
            return;
        }

        alert.classList.remove("d-none");
        title.textContent = "Priority: Approval Queue Needs Action";
        text.textContent = queueCount + " record(s) require admin decision.";
    }

    function renderRecentTable(rows) {
        const tbody = byId("adminDashboardRecentBody");
        if (!tbody) {
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No recent admin queue records.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.slice(0, 6).map(function (row) {
            const decision = decisionMeta(row.decision_status || "pending");
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td>" +
                "<td><span class=\"ldss-chip " + decision.chipClass + "\">" + escapeHtml(decision.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at || row.created_at)) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    async function loadDashboard(context) {
        showStatus("");

        const appResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, status, created_at, updated_at")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

        if (appResult.error) {
            throw new Error("Failed to load applications: " + appResult.error.message);
        }

        const apps = (appResult.data || []).filter(function (row) {
            return DASHBOARD_STATUSES.includes(normalizeStatus(row.status));
        });

        const appIds = apps.map(function (row) { return row.id; }).filter(Boolean);
        const applicantIds = Array.from(new Set(apps.map(function (row) { return row.applicant_id; }).filter(Boolean)));

        const [approvalMap, profileResult] = await Promise.all([
            fetchApprovalMap(context, appIds),
            applicantIds.length > 0
                ? context.client.from("profiles").select("id, first_name, middle_name, last_name, email").in("id", applicantIds)
                : Promise.resolve({ data: [], error: null })
        ]);

        const profileMap = {};
        if (!profileResult.error) {
            (profileResult.data || []).forEach(function (row) {
                profileMap[row.id] = row;
            });
        }

        const enriched = apps.map(function (row) {
            const approval = approvalMap[row.id] || null;
            return {
                id: row.id,
                application_no: row.application_no,
                status: normalizeStatus(row.status),
                applicant_name: buildApplicantName(profileMap[row.applicant_id] || null),
                decision_status: approval && approval.decision_status ? approval.decision_status : "pending",
                created_at: row.created_at,
                updated_at: row.updated_at
            };
        });

        const pendingCount = enriched.filter(function (row) { return row.status === "for_approval"; }).length;
        const specialCount = enriched.filter(function (row) { return row.status === "special_endorsement_review"; }).length;
        const approvedCount = enriched.filter(function (row) { return row.status === "approved"; }).length;
        const releaseCount = enriched.filter(function (row) { return row.status === "for_release"; }).length;

        setText("adminDashKpiPending", pendingCount);
        setText("adminDashKpiSpecial", specialCount);
        setText("adminDashKpiApproved", approvedCount);
        setText("adminDashKpiRelease", releaseCount);
        setText("adminDashAlertQueue", pendingCount);
        setText("adminDashAlertApproved", approvedCount);
        setText("adminDashAlertRelease", releaseCount);

        renderPriorityAlert(pendingCount);
        renderRecentTable(enriched);
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        try {
            await loadDashboard(context);
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load admin dashboard.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
