(function () {
    "use strict";

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral" }; }
        };
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
        const box = byId("secretaryDashboardStatus");
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

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function buildApplicantName(profile) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        return profile && profile.email ? profile.email : "Unknown Applicant";
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function setMetric(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function isExamStage(status) {
        const normalized = normalizeStatus(status);
        return ["pending_exam", "exam_scheduled", "exam_completed", "failed_exam", "passed_exam", "special_endorsement_review"].includes(normalized);
    }

    function isInterviewStage(status) {
        const normalized = normalizeStatus(status);
        return ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified"].includes(normalized);
    }

    function renderMetrics(rows) {
        setMetric("secretaryDashboardNewSubmissions", rows.filter(function (row) { return normalizeStatus(row.status) === "submitted"; }).length);
        setMetric("secretaryDashboardForValidation", rows.filter(function (row) { return isExamStage(row.status); }).length);
        setMetric("secretaryDashboardInterviewStage", rows.filter(function (row) { return isInterviewStage(row.status); }).length);
        setMetric("secretaryDashboardForAdmin", rows.filter(function (row) { return normalizeStatus(row.status) === "for_approval"; }).length);
    }

    function queueAction(row) {
        const normalized = normalizeStatus(row.status);
        if (normalized === "for_approval") {
            return {
                label: "View",
                href: "../ADMIN/admin-approval-queue.html"
            };
        }
        if (isInterviewStage(normalized) || normalized === "passed_exam") {
            return {
                label: "Verify",
                href: "secretary-interview-verification.html?id=" + encodeURIComponent(row.id)
            };
        }
        if (isExamStage(normalized) || normalized === "submitted") {
            return {
                label: "Exam",
                href: "secretary-exam-batches.html"
            };
        }
        return {
            label: "Open",
            href: "secretary-applications.html"
        };
    }

    function renderQueue(rows) {
        const tbody = byId("secretaryDashboardQueueBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No queue records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.slice(0, 8).map(function (row) {
            const meta = statusMeta(row.status);
            const action = queueAction(row);
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown") + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at || row.created_at)) + "</td>" +
                '<td><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + "</a></td>" +
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
            showStatus("Failed to load dashboard data: " + appResult.error.message, "alert-danger");
            return;
        }

        const rows = appResult.data || [];
        const applicantIds = Array.from(new Set(rows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));

        const profileMap = {};
        if (applicantIds.length > 0) {
            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email")
                .in("id", applicantIds);

            if (!profileResult.error && profileResult.data) {
                profileResult.data.forEach(function (profile) {
                    profileMap[profile.id] = profile;
                });
            }
        }

        const enriched = rows.map(function (row) {
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profileMap[row.applicant_id] || null)
            });
        });

        renderMetrics(enriched);
        renderQueue(enriched);
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        await loadDashboard(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
