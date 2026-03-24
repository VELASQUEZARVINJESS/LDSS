(function () {
    "use strict";

    const PAGE_SIZE = 10;
    const PROFILE_BATCH_SIZE = 200;
    const SUPABASE_FETCH_LIMIT = 1000;
    const EXAMINEE_STATUSES = [
        "pending_exam",
        "exam_scheduled",
        "exam_completed",
        "passed_exam",
        "failed_exam"
    ];

    let authContext = null;
    let allRows = [];
    let currentPage = 1;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) {
                return (status || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return {
                    label: (status || "-").toString(),
                    chipClass: "ldss-chip-neutral"
                };
            }
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
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showStatus(message, type) {
        const box = byId("examManagementStatus");
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

    function buildApplicantName(profile) {
        if (!profile) {
            return "Unknown Applicant";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : (profile.email || "Unknown Applicant");
    }

    function pageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / PAGE_SIZE);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderCounter(total) {
        const el = byId("examManagementExamineeCount");
        if (el) {
            el.textContent = String(total);
        }
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("examManagementPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0-0 of 0 records";
            return;
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function renderPagination(totalRows) {
        const pagination = byId("examManagementPagination");
        if (!pagination) {
            return;
        }

        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const totalPages = pageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", currentPage - 1, currentPage <= 1, false, "Previous page"));

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === currentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", currentPage + 1, currentPage >= totalPages, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function renderTable() {
        const tbody = byId("examManagementExamineeTableBody");
        if (!tbody) {
            return;
        }

        if (!allRows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No examinee records yet.</td></tr>';
            renderCounter(0);
            renderPaginationInfo(0);
            renderPagination(0);
            return;
        }

        const totalPages = pageCount(allRows.length);
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = allRows.slice(start, start + PAGE_SIZE);

        tbody.innerHTML = pageRows.map(function (row) {
            const meta = statusMeta(row.status);
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td>" +
                "<td>" + escapeHtml(row.school_name || "-") + "</td>" +
                '<td><span class="ldss-chip ' + escapeHtml(meta.chipClass || "ldss-chip-neutral") + '">' + escapeHtml(meta.label || "-") + "</span></td>" +
                "</tr>"
            );
        }).join("");

        renderCounter(allRows.length);
        renderPaginationInfo(allRows.length);
        renderPagination(allRows.length);
    }

    async function loadProfilesByIds(client, applicantIds) {
        const profileMap = {};

        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const profileResult = await client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, school_name")
                .in("id", batchIds);

            if (profileResult.error) {
                throw new Error("Failed to load applicant profiles: " + profileResult.error.message);
            }

            (profileResult.data || []).forEach(function (profile) {
                profileMap[profile.id] = profile;
            });
        }

        return profileMap;
    }

    async function loadExaminees() {
        if (!authContext || !authContext.client) {
            return;
        }

        showStatus("");

        const applications = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const applicationResult = await authContext.client
                .from("applications")
                .select("id, application_no, applicant_id, status, updated_at, submitted_at, created_at")
                .in("status", EXAMINEE_STATUSES)
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (applicationResult.error) {
                throw new Error("Failed to load examinee records: " + applicationResult.error.message);
            }

            const batch = applicationResult.data || [];
            applications.push.apply(applications, batch);

            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        if (!applications.length) {
            allRows = [];
            renderTable();
            return;
        }

        const applicantIds = Array.from(new Set(applications.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));

        const profileMap = await loadProfilesByIds(authContext.client, applicantIds);

        allRows = applications.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return {
                id: row.id,
                application_no: row.application_no || "",
                status: normalizeStatus(row.status),
                applicant_name: buildApplicantName(profile),
                school_name: profile && profile.school_name ? profile.school_name : ""
            };
        });

        renderTable();
    }

    function bindEvents() {
        const pagination = byId("examManagementPagination");
        if (!pagination) {
            return;
        }

        pagination.addEventListener("click", function (event) {
            const button = event.target.closest("button[data-page]");
            if (!button || button.closest(".disabled")) {
                return;
            }

            const nextPage = Number(button.getAttribute("data-page"));
            const totalPages = pageCount(allRows.length);
            if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > totalPages) {
                return;
            }

            currentPage = nextPage;
            renderTable();
        });
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindEvents();

        try {
            await loadExaminees();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load examinee data.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
