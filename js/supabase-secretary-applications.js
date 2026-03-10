(function () {
    "use strict";

    const PAGE_SIZE = 10;

    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: status || "-", chipClass: "ldss-chip-neutral" }; }
        };
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
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
        const alert = byId("secretaryApplicationsStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.className = "alert d-none";
            alert.textContent = "";
            return;
        }
        alert.className = "alert " + (type || "alert-info");
        alert.textContent = message;
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

    function buildApplicantName(profile, fallbackEmail) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        if (profile && profile.email) {
            return profile.email;
        }
        return fallbackEmail || "Unknown Applicant";
    }

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / PAGE_SIZE);
    }

    function fillFilters(rows) {
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        if (!statusFilter || !yearFilter) {
            return;
        }

        const selectedStatus = statusFilter.value || "all";
        const selectedYear = yearFilter.value || "all";

        const statuses = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return normalizeStatus(row.status || "");
                    })
                    .filter(Boolean)
            )
        );

        const years = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return row.school_year || "";
                    })
                    .filter(Boolean)
            )
        ).sort().reverse();

        statusFilter.innerHTML = '<option value="all">All</option>';
        statuses.forEach(function (status) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = statusMeta(status).label;
            statusFilter.appendChild(option);
        });
        statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : "all";

        yearFilter.innerHTML = '<option value="all">All</option>';
        years.forEach(function (year) {
            const option = document.createElement("option");
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        });
        yearFilter.value = years.includes(selectedYear) ? selectedYear : "all";
    }

    function isExamStage(status) {
        const normalized = normalizeStatus(status);
        return ["submitted", "pending_exam", "exam_scheduled", "exam_completed", "passed_exam", "failed_exam", "special_endorsement_review"].includes(normalized);
    }

    function isInterviewStage(status) {
        const normalized = normalizeStatus(status);
        return ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified"].includes(normalized);
    }

    function updateKpis(rows) {
        const queueTotal = rows.length;
        const forVerification = rows.filter(function (row) {
            return isExamStage(row.status);
        }).length;
        const interviewStage = rows.filter(function (row) {
            return isInterviewStage(row.status);
        }).length;
        const forwarded = rows.filter(function (row) {
            return normalizeStatus(row.status) === "for_approval";
        }).length;

        const queueEl = byId("secretaryApplicationsQueueTotal");
        const verifyEl = byId("secretaryApplicationsForVerification");
        const interviewEl = byId("secretaryApplicationsInterviewStage");
        const forwardedEl = byId("secretaryApplicationsForwarded");

        if (queueEl) {
            queueEl.textContent = String(queueTotal);
        }
        if (verifyEl) {
            verifyEl.textContent = String(forVerification);
        }
        if (interviewEl) {
            interviewEl.textContent = String(interviewStage);
        }
        if (forwardedEl) {
            forwardedEl.textContent = String(forwarded);
        }
    }

    function applyFilterRows() {
        const search = (byId("secretaryApplicationsSearchInput") ? byId("secretaryApplicationsSearchInput").value : "").toLowerCase().trim();
        const status = byId("secretaryApplicationsStatusFilter") ? byId("secretaryApplicationsStatusFilter").value : "all";
        const schoolYear = byId("secretaryApplicationsYearFilter") ? byId("secretaryApplicationsYearFilter").value : "all";

        return allRows.filter(function (row) {
            const appNo = (row.application_no || "").toLowerCase();
            const scholarship = (row.scholarship_type || "").toLowerCase();
            const applicant = (row.applicant_name || "").toLowerCase();
            const normalized = normalizeStatus(row.status);
            const matchesSearch = !search || appNo.includes(search) || scholarship.includes(search) || applicant.includes(search);
            const matchesStatus = status === "all" || normalized === status;
            const matchesYear = schoolYear === "all" || row.school_year === schoolYear;
            return matchesSearch && matchesStatus && matchesYear;
        });
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("secretaryApplicationsPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function renderPagination(totalRows) {
        const pagination = byId("secretaryApplicationsPagination");
        if (!pagination) {
            return;
        }

        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", currentPage - 1, currentPage <= 1, false, "Previous page"));

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(pageCount, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === currentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", currentPage + 1, currentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function actionForStatus(status, appId) {
        const normalized = normalizeStatus(status);
        if (normalized === "for_approval") {
            return { label: "View", href: "../ADMIN/admin-approval-queue.html" };
        }
        if (isInterviewStage(normalized) || normalized === "passed_exam") {
            return { label: "Verify", href: "secretary-interview-verification.html?id=" + encodeURIComponent(appId) };
        }
        if (isExamStage(normalized)) {
            return { label: "Exam", href: "secretary-exam-batches.html" };
        }
        return { label: "Open", href: "secretary-interview-verification.html?id=" + encodeURIComponent(appId) };
    }

    function renderTable(rows) {
        const tbody = byId("secretaryApplicationsTableBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No application records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const normalized = normalizeStatus(row.status);
            const meta = statusMeta(normalized);
            const submitted = row.submitted_at || row.created_at;
            const action = actionForStatus(normalized, row.id);

            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" +
                '<div class="fw-600">' + escapeHtml(row.applicant_name || "Unknown") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_contact || "-") + "</div>" +
                "</td>" +
                "<td>" + escapeHtml(row.scholarship_type || "-") + "</td>" +
                "<td>" + escapeHtml(formatDate(submitted)) + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                '<td><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + "</a></td>" +
                "</tr>"
            );
        }).join("");
    }

    function applyFiltersAndRender(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }

        filteredRows = applyFilterRows();

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
    }

    async function loadApplications(context) {
        showStatus("");

        const appResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, scholarship_type, school_year, status, submitted_at, created_at, updated_at")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

        if (appResult.error) {
            showStatus("Failed to load application queue: " + appResult.error.message, "alert-danger");
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
                .select("id, first_name, middle_name, last_name, email, mobile_number")
                .in("id", applicantIds);

            if (!profileResult.error && profileResult.data) {
                profileResult.data.forEach(function (profile) {
                    profileMap[profile.id] = profile;
                });
            }
        }

        allRows = rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile, ""),
                applicant_contact: (profile && (profile.mobile_number || profile.email)) ? (profile.mobile_number || profile.email) : "No contact on file"
            });
        });

        updateKpis(allRows);
        fillFilters(allRows);
        applyFiltersAndRender(false);
    }

    function bindEvents() {
        const applyBtn = byId("secretaryApplicationsApplyFilterBtn");
        const searchInput = byId("secretaryApplicationsSearchInput");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        const pagination = byId("secretaryApplicationsPagination");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFiltersAndRender(true);
            });
        }

        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFiltersAndRender(true);
                }
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (yearFilter) {
            yearFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }
                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(filteredRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }
                currentPage = nextPage;
                applyFiltersAndRender(false);
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents();
        await loadApplications(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
