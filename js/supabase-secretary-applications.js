(function () {
    "use strict";

    const DEFAULT_PAGE_SIZE = 10;
    const MAX_PAGE_SIZE = 100;
    const PROFILE_BATCH_SIZE = 120;
    const VERIFICATION_QUEUE_STORAGE_KEY = "ldss:secretary-verification-queue:v1";
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let pageSize = DEFAULT_PAGE_SIZE;
    let authContext = null;
    let photoRenderToken = 0;

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

    function storeVerificationQueue(rows) {
        try {
            const ids = (rows || []).map(function (row) {
                return row && row.id ? row.id : "";
            }).filter(Boolean);
            sessionStorage.setItem(VERIFICATION_QUEUE_STORAGE_KEY, JSON.stringify({
                ids: ids,
                stored_at: new Date().toISOString()
            }));
        } catch (_error) {
            // Non-fatal: sessionStorage may be unavailable.
        }
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

    function safeDomId(value) {
        return (value || "")
            .toString()
            .replace(/[^a-zA-Z0-9\-_:.]/g, "_");
    }

    function buildApplicantName(profile) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        return "Unknown Applicant";
    }

    function applicantInitials(name) {
        const parts = (name || "")
            .toString()
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (!parts.length) {
            return "1x1";
        }
        return parts.slice(0, 2).map(function (part) {
            return part.charAt(0).toUpperCase();
        }).join("");
    }

    async function createSignedUrl(path) {
        if (!authContext || !path || !window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        try {
            return await window.ldssUploads.createObjectUrl(authContext, path);
        } catch (error) {
            return "";
        }
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

            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, course_or_strand, applicant_photo_path")
                .in("id", batchIds);

            if (profileResult.error) {
                failedBatchCount += 1;
                lastErrorMessage = profileResult.error.message || "";
                continue;
            }

            (profileResult.data || []).forEach(function (profile) {
                profileMap[profile.id] = profile;
            });
        }

        return {
            profileMap: profileMap,
            failedBatchCount: failedBatchCount,
            lastErrorMessage: lastErrorMessage
        };
    }

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / pageSize);
    }

    function fillFilters(rows) {
        const sectorFilter = byId("secretaryApplicationsSectorFilter");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        if (!sectorFilter || !statusFilter || !yearFilter) {
            return;
        }

        const selectedSector = sectorFilter.value || "all";
        const selectedStatus = statusFilter.value || "all";
        const selectedYear = yearFilter.value || "all";

        const sectors = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return (row.sector_classification || "").toString().trim();
                    })
                    .filter(Boolean)
            )
        ).sort(function (left, right) {
            return left.localeCompare(right);
        });

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

        sectorFilter.innerHTML = '<option value="all">All</option>';
        sectors.forEach(function (sector) {
            const option = document.createElement("option");
            option.value = sector;
            option.textContent = sector;
            sectorFilter.appendChild(option);
        });
        sectorFilter.value = sectors.includes(selectedSector) ? selectedSector : "all";

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
        const sector = byId("secretaryApplicationsSectorFilter") ? byId("secretaryApplicationsSectorFilter").value : "all";
        const status = byId("secretaryApplicationsStatusFilter") ? byId("secretaryApplicationsStatusFilter").value : "all";
        const schoolYear = byId("secretaryApplicationsYearFilter") ? byId("secretaryApplicationsYearFilter").value : "all";
        const searchQuery = byId("secretaryApplicationsSearchInput")
            ? byId("secretaryApplicationsSearchInput").value.toLowerCase().trim()
            : "";

        return allRows.filter(function (row) {
            const rowSector = (row.sector_classification || "").toString().trim();
            const matchesSector = sector === "all" || rowSector === sector;
            const normalized = normalizeStatus(row.status);
            const matchesStatus = status === "all" || normalized === status;
            const matchesYear = schoolYear === "all" || row.school_year === schoolYear;
            const applicantName = (row.applicant_name || "").toLowerCase();
            const matchesSearch = !searchQuery || applicantName.indexOf(searchQuery) !== -1;
            return matchesSector && matchesStatus && matchesYear && matchesSearch;
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
        const start = (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalRows);
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

    function actionForStatus(_status, appId) {
        return {
            label: "View Data",
            href: "secretary-interview-verification.html?id=" + encodeURIComponent(appId)
        };
    }

    function renderTable(rows) {
        const tbody = byId("secretaryApplicationsTableBody");
        if (!tbody) {
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No application records found.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (row) {
            const normalized = normalizeStatus(row.status);
            const meta = statusMeta(normalized);
            const submitted = row.submitted_at || row.created_at;
            const action = actionForStatus(normalized, row.id);
            const photoDomId = "secretaryApplicantPhoto-" + safeDomId(row.id);
            const placeholderDomId = "secretaryApplicantPhotoPlaceholder-" + safeDomId(row.id);
            const applicantName = row.applicant_name || "Unknown";
            const degreeCourse = row.degree_course || row.scholarship_type || "-";
            const sectorClassification = row.sector_classification || "-";
            return (
                "<tr>" +
                '<td data-label="Applicant">' +
                '<div class="ldss-queue-applicant">' +
                '<div class="ldss-queue-applicant-photo">' +
                '<img class="d-none" id="' + escapeHtml(photoDomId) + '" alt="Applicant 1x1 photo" loading="lazy" decoding="async" />' +
                '<div class="ldss-queue-applicant-photo-placeholder" id="' + escapeHtml(placeholderDomId) + '">' + escapeHtml(applicantInitials(applicantName)) + "</div>" +
                "</div>" +
                '<div class="ldss-queue-applicant-body">' +
                '<span class="ldss-queue-applicant-name ldss-table-ellipsis" title="' + escapeHtml(applicantName) + '">' + escapeHtml(applicantName) + "</span>" +
                "</div>" +
                "</div>" +
                "</td>" +
                '<td data-label="Application ID">' + escapeHtml(row.application_no || "-") + "</td>" +
                '<td data-label="Degree Course"><div class="ldss-queue-degree ldss-table-ellipsis" title="' + escapeHtml(degreeCourse) + '">' + escapeHtml(degreeCourse) + "</div></td>" +
                '<td data-label="Sector Classification"><span class="ldss-table-ellipsis" title="' + escapeHtml(sectorClassification) + '">' + escapeHtml(sectorClassification) + "</span></td>" +
                '<td data-label="Submitted">' + escapeHtml(formatDate(submitted)) + "</td>" +
                '<td data-label="Status"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                '<td data-label="View Data"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + "</a></td>" +
                "</tr>"
            );
        }).join("");
        photoRenderToken += 1;
        void renderApplicantPhotos(rows, photoRenderToken);
    }
    async function renderApplicantPhotos(rows, token) {
        const photoTasks = rows.map(async function (row) {
            const photoPath = (row && row.applicant_photo_path ? row.applicant_photo_path : "").toString().trim();
            if (!photoPath) {
                return null;
            }

            const photoDomId = "secretaryApplicantPhoto-" + safeDomId(row.id);
            const placeholderDomId = "secretaryApplicantPhotoPlaceholder-" + safeDomId(row.id);
            const photoUrl = await createSignedUrl(photoPath);

            return {
                photoDomId: photoDomId,
                placeholderDomId: placeholderDomId,
                photoUrl: photoUrl
            };
        });

        const photoResults = await Promise.all(photoTasks);
        if (token !== photoRenderToken) {
            return;
        }

        photoResults.forEach(function (result) {
            if (!result || !result.photoUrl) {
                return;
            }

            const image = byId(result.photoDomId);
            const placeholder = byId(result.placeholderDomId);
            if (!image || !placeholder) {
                return;
            }

            image.src = result.photoUrl;
            image.classList.remove("d-none");
            placeholder.classList.add("d-none");
        });
    }
    function applyFiltersAndRender(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }

        filteredRows = applyFilterRows();
        storeVerificationQueue(filteredRows);

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
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

    async function loadApplications(context) {
        showStatus("");

        const appResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
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

        const profileLoad = applicantIds.length > 0
            ? await loadProfilesByIds(context, applicantIds)
            : { profileMap: {}, failedBatchCount: 0, lastErrorMessage: "" };
        const profileMap = profileLoad.profileMap;

        allRows = rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile),
                degree_course: (profile && profile.course_or_strand ? profile.course_or_strand : "") || row.scholarship_type || "",
                sector_classification: row.sector_classification || "",
                applicant_photo_path: profile && profile.applicant_photo_path ? profile.applicant_photo_path : ""
            });
        });

        if (profileLoad.failedBatchCount > 0) {
            showStatus(
                "Loaded application queue, but some applicant profiles could not be loaded. " +
                (profileLoad.lastErrorMessage ? ("Last error: " + profileLoad.lastErrorMessage) : "Please refresh and try again."),
                "alert-warning"
            );
        }

        updateKpis(allRows);
        fillFilters(allRows);
        applyFiltersAndRender(false);
    }

    function bindEvents() {
        const applyBtn = byId("secretaryApplicationsApplyFilterBtn");
        const searchInput = byId("secretaryApplicationsSearchInput");
        const sectorFilter = byId("secretaryApplicationsSectorFilter");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        const pagination = byId("secretaryApplicationsPagination");
        const pageSizeSelect = byId("secretaryApplicationsPageSize");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFiltersAndRender(true);
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", function () {
                applyFiltersAndRender(true);
            });
            searchInput.addEventListener("keydown", function (event) {
                if (event.key !== "Enter") {
                    return;
                }
                event.preventDefault();
                applyFiltersAndRender(true);
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (sectorFilter) {
            sectorFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (yearFilter) {
            yearFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.value = String(pageSize);
            pageSizeSelect.addEventListener("change", function () {
                const nextValue = Number(pageSizeSelect.value);
                if (Number.isNaN(nextValue) || nextValue < 1) {
                    pageSizeSelect.value = String(pageSize);
                    return;
                }
                pageSize = Math.min(MAX_PAGE_SIZE, nextValue);
                pageSizeSelect.value = String(pageSize);
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

        authContext = context;

        bindEvents();
        await loadApplications(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
