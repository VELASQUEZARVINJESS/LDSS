(function () {
    "use strict";

    const QUEUE_PAGE_SIZE = 8;

    let queueRows = [];
    let queueCurrentPage = 1;

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

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / QUEUE_PAGE_SIZE);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderQueuePaginationInfo(totalRows) {
        const info = byId("secretaryDashboardQueuePaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (queueCurrentPage - 1) * QUEUE_PAGE_SIZE + 1;
        const end = Math.min(queueCurrentPage * QUEUE_PAGE_SIZE, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function renderQueuePagination(totalRows) {
        const pagination = byId("secretaryDashboardQueuePagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", queueCurrentPage - 1, queueCurrentPage <= 1, false, "Previous page"));

        let startPage = Math.max(1, queueCurrentPage - 2);
        let endPage = Math.min(pageCount, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === queueCurrentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", queueCurrentPage + 1, queueCurrentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
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

    function renderQueue(rows) {
        const tbody = byId("secretaryDashboardQueueBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No queue records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown") + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at || row.created_at)) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function applyQueuePagination(resetPage) {
        if (resetPage) {
            queueCurrentPage = 1;
        }

        const pageCount = getPageCount(queueRows.length);
        if (queueCurrentPage > pageCount) {
            queueCurrentPage = pageCount;
        }
        if (queueCurrentPage < 1) {
            queueCurrentPage = 1;
        }

        const start = (queueCurrentPage - 1) * QUEUE_PAGE_SIZE;
        const pageRows = queueRows.slice(start, start + QUEUE_PAGE_SIZE);

        renderQueue(pageRows);
        renderQueuePaginationInfo(queueRows.length);
        renderQueuePagination(queueRows.length);
    }

    function bindEvents() {
        const pagination = byId("secretaryDashboardQueuePagination");
        if (!pagination) {
            return;
        }

        pagination.addEventListener("click", function (event) {
            const button = event.target.closest("button[data-page]");
            if (!button || button.closest(".disabled")) {
                return;
            }

            const nextPage = Number(button.getAttribute("data-page"));
            const pageCount = getPageCount(queueRows.length);
            if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                return;
            }

            queueCurrentPage = nextPage;
            applyQueuePagination(false);
        });
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

        queueRows = enriched;
        renderMetrics(queueRows);
        applyQueuePagination(true);
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents();
        await loadDashboard(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
