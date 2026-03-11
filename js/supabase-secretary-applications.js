(function () {
    "use strict";

    const DEFAULT_PAGE_SIZE = 10;
    const MAX_PAGE_SIZE = 100;
    const SECTOR_CLASSIFICATION_ORDER = [
        "Person with Disability (PWD)",
        "Solo Parent",
        "Child of Solo Parent",
        "Child of Farmer",
        "Child of Fisherfolk",
        "Orphan",
        "None of the above"
    ];

    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let currentPageRows = [];
    let pageSize = DEFAULT_PAGE_SIZE;
    let authContext = null;
    let photoRenderToken = 0;
    let selectedApplicationIds = new Set();
    let bulkActionLoading = false;

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

    function safeDomId(value) {
        return (value || "")
            .toString()
            .replace(/[^a-zA-Z0-9\-_:.]/g, "_");
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

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / pageSize);
    }

    function canMarkForExamination(row) {
        return normalizeStatus(row && row.status) === "submitted";
    }

    function pruneSelectedApplicationIds() {
        const selectableIds = new Set(
            allRows
                .filter(function (row) { return canMarkForExamination(row); })
                .map(function (row) { return row.id; })
        );

        selectedApplicationIds = new Set(
            Array.from(selectedApplicationIds).filter(function (id) {
                return selectableIds.has(id);
            })
        );
    }

    function visibleSelectableRows() {
        return currentPageRows.filter(function (row) {
            return canMarkForExamination(row);
        });
    }

    function updateSelectionControls() {
        const selectAll = byId("secretaryApplicationsSelectAll");
        const markExamBtn = byId("secretaryApplicationsMarkExamBtn");
        const summary = byId("secretaryApplicationsSelectionSummary");
        const rowCheckboxes = document.querySelectorAll("input[data-select-application='true']");
        const visibleRows = visibleSelectableRows();
        const visibleSelectedCount = visibleRows.filter(function (row) {
            return selectedApplicationIds.has(row.id);
        }).length;
        const totalSelectedCount = selectedApplicationIds.size;

        if (summary) {
            summary.textContent = totalSelectedCount + " selected";
        }

        if (selectAll) {
            const hasVisibleSelectable = visibleRows.length > 0;
            selectAll.checked = hasVisibleSelectable && visibleSelectedCount === visibleRows.length;
            selectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleRows.length;
            selectAll.disabled = bulkActionLoading || !hasVisibleSelectable;
        }

        if (markExamBtn) {
            markExamBtn.disabled = bulkActionLoading || totalSelectedCount === 0;
            markExamBtn.textContent = bulkActionLoading ? "Updating..." : "Set For Examination";
        }

        rowCheckboxes.forEach(function (checkbox) {
            const appId = checkbox.getAttribute("data-app-id");
            if (!appId) {
                return;
            }
            checkbox.checked = selectedApplicationIds.has(appId);
        });
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
            const degreeCourse = (row.degree_course || row.scholarship_type || "").toLowerCase();
            const sectorClassification = (row.sector_classification || "").toLowerCase();
            const applicant = (row.applicant_name || "").toLowerCase();
            const normalized = normalizeStatus(row.status);
            const matchesSearch = !search || appNo.includes(search) || degreeCourse.includes(search) || sectorClassification.includes(search) || applicant.includes(search);
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

    function renderSectorCounters(rows) {
        const container = byId("secretaryApplicationsSectorCounters");
        if (!container) {
            return;
        }

        const counts = {};
        let unspecifiedCount = 0;

        rows.forEach(function (row) {
            const value = (row && row.sector_classification ? row.sector_classification : "").toString().trim();
            if (!value) {
                unspecifiedCount += 1;
                return;
            }
            counts[value] = (counts[value] || 0) + 1;
        });

        const orderedLabels = SECTOR_CLASSIFICATION_ORDER.filter(function (label) {
            return counts[label] > 0;
        });

        Object.keys(counts)
            .sort(function (left, right) {
                return left.localeCompare(right);
            })
            .forEach(function (label) {
                if (!orderedLabels.includes(label)) {
                    orderedLabels.push(label);
                }
            });

        if (unspecifiedCount > 0) {
            orderedLabels.push("Unspecified");
        }

        if (!orderedLabels.length) {
            container.innerHTML = '<span class="small text-muted">No sector classification data.</span>';
            return;
        }

        container.innerHTML = orderedLabels.map(function (label) {
            const value = label === "Unspecified" ? unspecifiedCount : counts[label];
            return (
                '<span class="ldss-sector-counter">' +
                '<span>' + escapeHtml(label) + "</span>" +
                '<span class="ldss-sector-counter-value">' + escapeHtml(String(value)) + "</span>" +
                "</span>"
            );
        }).join("");
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
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No application records found.</td></tr>';
            updateSelectionControls();
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
            const selectable = canMarkForExamination(row);
            const checked = selectable && selectedApplicationIds.has(row.id);
            return (
                "<tr>" +
                '<td data-label="Select" class="text-center align-middle">' +
                '<input class="form-check-input" type="checkbox" data-select-application="true" data-app-id="' + escapeHtml(row.id || "") + '"' +
                (checked ? ' checked="checked"' : "") +
                (selectable && !bulkActionLoading ? "" : ' disabled="disabled"') +
                ' aria-label="Select application ' + escapeHtml(row.application_no || row.id || "") + '"' +
                (selectable ? "" : ' title="Only submitted applications can be moved to examination."') +
                " />" +
                "</td>" +
                '<td data-label="Applicant">' +
                '<div class="ldss-queue-applicant" style="display:flex;align-items:center;gap:0.75rem;min-width:0;">' +
                '<div class="ldss-queue-applicant-photo" style="width:2.75rem;height:2.75rem;min-width:2.75rem;max-width:2.75rem;flex:0 0 2.75rem;border-radius:50%;overflow:hidden;border:1px solid #d1d5db;background:#f8f9fb;display:flex;align-items:center;justify-content:center;">' +
                '<img class="d-none" id="' + escapeHtml(photoDomId) + '" alt="Applicant 1x1 photo" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;object-position:center;display:block;" />' +
                '<div class="ldss-queue-applicant-photo-placeholder" id="' + escapeHtml(placeholderDomId) + '" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;letter-spacing:0.02em;color:#4b5563;text-transform:uppercase;">' + escapeHtml(applicantInitials(applicantName)) + "</div>" +
                "</div>" +
                '<div class="ldss-queue-applicant-body">' +
                '<span class="ldss-queue-applicant-name">' + escapeHtml(applicantName) + "</span>" +
                '<span class="small ldss-queue-applicant-contact">' + escapeHtml(row.applicant_contact || "-") + "</span>" +
                "</div>" +
                "</div>" +
                "</td>" +
                '<td data-label="Application ID">' + escapeHtml(row.application_no || "-") + "</td>" +
                '<td data-label="Degree Course"><div class="ldss-queue-degree">' + escapeHtml(degreeCourse) + "</div></td>" +
                '<td data-label="Sector Classification">' + escapeHtml(sectorClassification) + "</td>" +
                '<td data-label="Submitted">' + escapeHtml(formatDate(submitted)) + "</td>" +
                '<td data-label="Status"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                '<td data-label="View Data"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + "</a></td>" +
                "</tr>"
            );
        }).join("");
        photoRenderToken += 1;
        void renderApplicantPhotos(rows, photoRenderToken);
        updateSelectionControls();
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

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        currentPageRows = pageRows;

        renderSectorCounters(filteredRows);
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

        const profileMap = {};
        if (applicantIds.length > 0) {
            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, mobile_number, course_or_strand, applicant_photo_path")
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
                applicant_contact: (profile && (profile.mobile_number || profile.email)) ? (profile.mobile_number || profile.email) : "No contact on file",
                degree_course: (profile && profile.course_or_strand ? profile.course_or_strand : "") || row.scholarship_type || "",
                sector_classification: row.sector_classification || "",
                applicant_photo_path: profile && profile.applicant_photo_path ? profile.applicant_photo_path : ""
            });
        });

        pruneSelectedApplicationIds();
        updateKpis(allRows);
        fillFilters(allRows);
        applyFiltersAndRender(false);
    }

    async function handleMarkSelectedForExam() {
        if (bulkActionLoading || !authContext || !authContext.client || !authContext.user) {
            return;
        }

        const selectedRows = allRows.filter(function (row) {
            return selectedApplicationIds.has(row.id);
        });
        const targetRows = selectedRows.filter(function (row) {
            return canMarkForExamination(row);
        });
        const skippedCount = selectedRows.length - targetRows.length;

        if (!targetRows.length) {
            showStatus("Select at least one submitted application to move into examination.", "alert-warning");
            updateSelectionControls();
            return;
        }

        const confirmed = window.confirm(
            "Move " + targetRows.length + " selected submitted application(s) to Pending Exam?"
        );
        if (!confirmed) {
            return;
        }

        bulkActionLoading = true;
        updateSelectionControls();
        showStatus("");

        try {
            const targetIds = targetRows.map(function (row) {
                return row.id;
            });

            const result = await authContext.client
                .from("applications")
                .update({
                    status: "pending_exam",
                    secretary_reviewer_id: authContext.user.id,
                    is_locked: false
                })
                .in("id", targetIds)
                .eq("status", "submitted");

            if (result.error) {
                throw new Error(result.error.message);
            }

            selectedApplicationIds.clear();
            await loadApplications(authContext);

            let message = targetIds.length + " application(s) moved to Pending Exam.";
            if (skippedCount > 0) {
                message += " Skipped " + skippedCount + " row(s) that were no longer submitted.";
            }
            showStatus(message, "alert-success");
        } catch (error) {
            showStatus("Failed to update selected applications: " + (error && error.message ? error.message : "Unknown error"), "alert-danger");
        } finally {
            bulkActionLoading = false;
            updateSelectionControls();
        }
    }

    function bindEvents() {
        const applyBtn = byId("secretaryApplicationsApplyFilterBtn");
        const searchInput = byId("secretaryApplicationsSearchInput");
        const statusFilter = byId("secretaryApplicationsStatusFilter");
        const yearFilter = byId("secretaryApplicationsYearFilter");
        const pagination = byId("secretaryApplicationsPagination");
        const selectAll = byId("secretaryApplicationsSelectAll");
        const tbody = byId("secretaryApplicationsTableBody");
        const markExamBtn = byId("secretaryApplicationsMarkExamBtn");
        const pageSizeSelect = byId("secretaryApplicationsPageSize");

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

        if (selectAll) {
            selectAll.addEventListener("change", function () {
                visibleSelectableRows().forEach(function (row) {
                    if (selectAll.checked) {
                        selectedApplicationIds.add(row.id);
                    } else {
                        selectedApplicationIds.delete(row.id);
                    }
                });
                updateSelectionControls();
            });
        }

        if (tbody) {
            tbody.addEventListener("change", function (event) {
                const checkbox = event.target.closest("input[data-select-application='true']");
                if (!checkbox) {
                    return;
                }

                const appId = checkbox.getAttribute("data-app-id");
                if (!appId) {
                    return;
                }

                if (checkbox.checked) {
                    selectedApplicationIds.add(appId);
                } else {
                    selectedApplicationIds.delete(appId);
                }
                updateSelectionControls();
            });
        }

        if (markExamBtn) {
            markExamBtn.addEventListener("click", function () {
                void handleMarkSelectedForExam();
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
