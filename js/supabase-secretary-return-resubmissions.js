(function () {
    "use strict";

    const PAGE_SIZE_DEFAULT = 10;
    const PROFILE_BATCH_SIZE = 120;
    const SUPABASE_FETCH_LIMIT = 1000;

    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let pageSize = PAGE_SIZE_DEFAULT;

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
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function showStatus(message, type) {
        const box = byId("secretaryCorrectionStatus");
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

    function setMetric(id, value) {
        const el = byId(id);
        if (el) {
            el.textContent = String(value || 0);
        }
    }

    function pageCount(totalRows) {
        if (totalRows <= 0) {
            return 1;
        }
        return Math.ceil(totalRows / pageSize);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' +
            escapeHtml(label) +
            "</button>" +
            "</li>"
        );
    }

    function isCorrectionNotification(row) {
        const title = (row && row.title ? row.title : "").toString().trim().toLowerCase();
        const message = (row && row.message ? row.message : "").toString().trim().toLowerCase();
        return title.indexOf("returned for correction") !== -1 ||
            title.indexOf("compliance notice") !== -1 ||
            title.indexOf("photo needs change") !== -1 ||
            message.indexOf("returned for correction") !== -1 ||
            message.indexOf("need to comply") !== -1 ||
            message.indexOf("replace your applicant 1x1 photo") !== -1;
    }

    function correctionNoticeLabel(notice, row) {
        const title = (notice && notice.title ? notice.title : "").toString().trim().toLowerCase();
        const status = normalizeStatus(row && row.status);

        if (title.indexOf("photo needs change") !== -1) {
            return "Photo Change";
        }
        if (title.indexOf("compliance notice") !== -1) {
            return "Compliance Notice";
        }
        if (title.indexOf("returned for correction") !== -1 || status === "returned_for_correction") {
            return "Returned for Correction";
        }
        return "Correction Notice";
    }

    async function loadProfilesByIds(context, applicantIds) {
        const profileMap = {};
        let failedBatchCount = 0;
        let lastErrorMessage = "";

        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email")
                .in("id", batchIds);

            if (result.error) {
                failedBatchCount += 1;
                lastErrorMessage = result.error.message || "";
                continue;
            }

            (result.data || []).forEach(function (profile) {
                profileMap[profile.id] = profile;
            });
        }

        return {
            profileMap: profileMap,
            failedBatchCount: failedBatchCount,
            lastErrorMessage: lastErrorMessage
        };
    }

    async function loadLatestCorrectionNoticesByApplicationIds(context, applicationIds) {
        const noticeMap = {};
        let lastError = null;

        for (let start = 0; start < applicationIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicationIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const result = await context.client
                .from("notifications")
                .select("related_application_id, notification_type, title, message, created_at")
                .in("related_application_id", batchIds)
                .in("notification_type", ["application", "reminder"])
                .order("created_at", { ascending: false });

            if (result.error) {
                lastError = result.error;
                continue;
            }

            (result.data || []).forEach(function (row) {
                const applicationId = (row.related_application_id || "").toString().trim();
                if (!applicationId || !isCorrectionNotification(row)) {
                    return;
                }

                const existing = noticeMap[applicationId];
                const currentTime = row.created_at ? new Date(row.created_at).getTime() : 0;
                const existingTime = existing && existing.created_at ? new Date(existing.created_at).getTime() : 0;
                if (!existing || currentTime > existingTime) {
                    noticeMap[applicationId] = row;
                }
            });
        }

        return {
            noticeMap: noticeMap,
            error: lastError
        };
    }

    function buildCorrectionMonitoringRows(rows, correctionMap) {
        return (rows || [])
            .map(function (row) {
                const notice = correctionMap[row.id] || null;
                const status = normalizeStatus(row.status);
                const noticeAt = new Date(notice && notice.created_at ? notice.created_at : 0).getTime();
                const applicationUpdatedAt = new Date(row.updated_at || row.created_at || 0).getTime();
                const hasUpdatedSinceNotice = !!(
                    notice &&
                    noticeAt &&
                    applicationUpdatedAt &&
                    applicationUpdatedAt > noticeAt &&
                    status !== "returned_for_correction"
                );

                if (!notice && status !== "returned_for_correction") {
                    return null;
                }

                return {
                    id: row.id,
                    application_no: row.application_no || "-",
                    applicant_name: row.applicant_name || "Unknown Applicant",
                    notice_label: correctionNoticeLabel(notice, row),
                    applicant_update_label: hasUpdatedSinceNotice ? "Completed Update" : "Pending Update",
                    applicant_update_chip: hasUpdatedSinceNotice ? "ldss-chip-success" : "ldss-chip-danger",
                    follow_up_label: hasUpdatedSinceNotice ? "For Checking Again" : "Waiting for Applicant",
                    follow_up_chip: hasUpdatedSinceNotice ? "ldss-chip-accent" : "ldss-chip-neutral",
                    notice_sent_at: notice && notice.created_at ? notice.created_at : "",
                    updated_at: row.updated_at || row.created_at || "",
                    sort_time: Math.max(noticeAt || 0, applicationUpdatedAt || 0),
                    open_url: "secretary-interview-verification.html?id=" + encodeURIComponent(row.id)
                };
            })
            .filter(Boolean)
            .sort(function (left, right) {
                const leftReady = left.follow_up_label === "For Checking Again" ? 1 : 0;
                const rightReady = right.follow_up_label === "For Checking Again" ? 1 : 0;
                if (leftReady !== rightReady) {
                    return rightReady - leftReady;
                }
                return (right.sort_time || 0) - (left.sort_time || 0);
            });
    }

    function updateMetrics(rows) {
        const safeRows = rows || [];
        setMetric("secretaryCorrectionTotal", safeRows.length);
        setMetric("secretaryCorrectionPending", safeRows.filter(function (row) {
            return row.follow_up_label === "Waiting for Applicant";
        }).length);
        setMetric("secretaryCorrectionReady", safeRows.filter(function (row) {
            return row.follow_up_label === "For Checking Again";
        }).length);
    }

    function matchesSearch(row, query) {
        if (!query) {
            return true;
        }
        const haystack = [
            row.applicant_name,
            row.application_no,
            row.notice_label
        ].join(" ").toLowerCase();
        return haystack.indexOf(query) !== -1;
    }

    function applyFilters() {
        const search = ((byId("secretaryCorrectionSearchInput") || {}).value || "").toString().trim().toLowerCase();
        const updateFilter = ((byId("secretaryCorrectionUpdateFilter") || {}).value || "all").toString().trim().toLowerCase();
        const followUpFilter = ((byId("secretaryCorrectionFollowUpFilter") || {}).value || "all").toString().trim().toLowerCase();

        filteredRows = allRows.filter(function (row) {
            if (!matchesSearch(row, search)) {
                return false;
            }
            if (updateFilter === "pending" && row.applicant_update_label !== "Pending Update") {
                return false;
            }
            if (updateFilter === "completed" && row.applicant_update_label !== "Completed Update") {
                return false;
            }
            if (followUpFilter === "waiting" && row.follow_up_label !== "Waiting for Applicant") {
                return false;
            }
            if (followUpFilter === "ready" && row.follow_up_label !== "For Checking Again") {
                return false;
            }
            return true;
        });

        currentPage = 1;
        renderCurrentPage();
        updateMetrics(filteredRows);
    }

    function renderTable(rows) {
        const tbody = byId("secretaryCorrectionTableBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No return or resubmission records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown") + " - " + (row.application_no || "-")) + '">' +
                '<span class="fw-semibold">' + escapeHtml(row.applicant_name || "Unknown") + "</span>" +
                '<div class="small text-muted">' + escapeHtml(row.application_no || "-") + "</div>" +
                "</td>" +
                "<td>" + escapeHtml(row.notice_label || "-") + '<div class="small text-muted">' + escapeHtml(formatDate(row.notice_sent_at)) + "</div></td>" +
                '<td><span class="ldss-chip ' + row.applicant_update_chip + '">' + escapeHtml(row.applicant_update_label) + "</span></td>" +
                '<td><span class="ldss-chip ' + row.follow_up_chip + '">' + escapeHtml(row.follow_up_label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at)) + "</td>" +
                '<td class="text-end"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(row.open_url) + '">Open</a></td>' +
                "</tr>"
            );
        }).join("");
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("secretaryCorrectionPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function renderPagination(totalRows) {
        const pagination = byId("secretaryCorrectionPagination");
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

    function renderCurrentPage() {
        const totalPages = pageCount(filteredRows.length);
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
    }

    async function loadData(context) {
        showStatus("");

        const rows = [];
        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, status, created_at, updated_at")
                .neq("status", "draft")
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                showStatus("Failed to load applications: " + result.error.message, "alert-danger");
                return;
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        const applicantIds = Array.from(new Set(rows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));
        const applicationIds = Array.from(new Set(rows.map(function (row) {
            return row.id;
        }).filter(Boolean)));

        let profileMap = {};
        if (applicantIds.length) {
            const profileLoad = await loadProfilesByIds(context, applicantIds);
            profileMap = profileLoad.profileMap || {};
            if (profileLoad.failedBatchCount > 0) {
                showStatus(
                    "Some applicant profiles could not be loaded. Showing available data only." +
                    (profileLoad.lastErrorMessage ? " " + profileLoad.lastErrorMessage : ""),
                    "alert-warning"
                );
            }
        }

        const enriched = rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile)
            });
        });

        const correctionNoticeLoad = applicationIds.length
            ? await loadLatestCorrectionNoticesByApplicationIds(context, applicationIds)
            : { noticeMap: {}, error: null };

        if (correctionNoticeLoad.error) {
            showStatus("Correction history could not be loaded completely. Showing available records only.", "alert-warning");
        }

        allRows = buildCorrectionMonitoringRows(enriched, correctionNoticeLoad.noticeMap || {});
        filteredRows = allRows.slice();
        updateMetrics(allRows);
        renderCurrentPage();
    }

    function bindEvents() {
        const applyBtn = byId("secretaryCorrectionApplyFilterBtn");
        if (applyBtn) {
            applyBtn.addEventListener("click", applyFilters);
        }

        const searchInput = byId("secretaryCorrectionSearchInput");
        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFilters();
                }
            });
        }

        const pageSizeSelect = byId("secretaryCorrectionPageSize");
        if (pageSizeSelect) {
            pageSizeSelect.value = String(pageSize);
            pageSizeSelect.addEventListener("change", function () {
                const nextSize = Number(pageSizeSelect.value || PAGE_SIZE_DEFAULT);
                pageSize = Number.isFinite(nextSize) && nextSize > 0 ? nextSize : PAGE_SIZE_DEFAULT;
                currentPage = 1;
                renderCurrentPage();
            });
        }

        const pagination = byId("secretaryCorrectionPagination");
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page"));
                const totalPages = pageCount(filteredRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > totalPages) {
                    return;
                }

                currentPage = nextPage;
                renderCurrentPage();
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents();
        await loadData(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
