(function () {
    "use strict";

    const STATUS_META = {
        draft: { label: "Draft", chipClass: "ldss-chip-neutral" },
        submitted: { label: "Submitted", chipClass: "ldss-chip-neutral" },
        under_secretary_review: { label: "Under Secretary Review", chipClass: "ldss-chip-accent" },
        interview_scheduled: { label: "Interview Scheduled", chipClass: "ldss-chip-accent" },
        recommended: { label: "Recommended", chipClass: "ldss-chip-accent" },
        for_admin_approval: { label: "For Admin Approval", chipClass: "ldss-chip-accent" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        returned_for_correction: { label: "Returned for Correction", chipClass: "ldss-chip-danger" },
        certification_ready: { label: "Certification Ready", chipClass: "ldss-chip-success" },
        release_scheduled: { label: "Release Scheduled", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };

    const EDITABLE_STATUSES = ["draft", "returned_for_correction"];
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const PAGE_SIZE = 10;

    let applicationRows = [];
    let currentPage = 1;
    let filteredApplicationRows = [];

    function byId(id) {
        return document.getElementById(id);
    }

    function showStatus(message, type) {
        const alert = byId("applicationsStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.classList.add("d-none");
            alert.textContent = "";
            return;
        }
        alert.className = "alert " + (type || "alert-info");
        alert.textContent = message;
        alert.classList.remove("d-none");
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

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    function statusMeta(status) {
        return STATUS_META[status] || { label: status || "-", chipClass: "ldss-chip-neutral" };
    }

    function fillFilters(rows) {
        const statusFilter = byId("applicationsStatusFilter");
        const yearFilter = byId("applicationsYearFilter");
        if (!statusFilter || !yearFilter) {
            return;
        }

        const selectedStatus = statusFilter.value || "all";
        const selectedYear = yearFilter.value || "all";

        const uniqueStatuses = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return row.status || "";
                    })
                    .filter(function (value) {
                        return value.length > 0;
                    })
            )
        );

        const uniqueYears = Array.from(
            new Set(
                rows
                    .map(function (row) {
                        return row.school_year || "";
                    })
                    .filter(function (value) {
                        return value.length > 0;
                    })
            )
        ).sort().reverse();

        statusFilter.innerHTML = '<option value="all">All</option>';
        uniqueStatuses.forEach(function (status) {
            const meta = statusMeta(status);
            const option = document.createElement("option");
            option.value = status;
            option.textContent = meta.label;
            statusFilter.appendChild(option);
        });
        statusFilter.value = uniqueStatuses.includes(selectedStatus) ? selectedStatus : "all";

        yearFilter.innerHTML = '<option value="all">All</option>';
        uniqueYears.forEach(function (year) {
            const option = document.createElement("option");
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        });
        yearFilter.value = uniqueYears.includes(selectedYear) ? selectedYear : "all";
    }

    function filteredRows() {
        const searchInput = byId("applicationsSearchInput");
        const statusFilter = byId("applicationsStatusFilter");
        const yearFilter = byId("applicationsYearFilter");

        const search = (searchInput ? searchInput.value : "").toLowerCase().trim();
        const status = statusFilter ? statusFilter.value : "all";
        const schoolYear = yearFilter ? yearFilter.value : "all";

        return applicationRows.filter(function (row) {
            const applicationNo = (row.application_no || "").toLowerCase();
            const scholarshipType = (row.scholarship_type || "").toLowerCase();
            const matchesSearch = !search || applicationNo.includes(search) || scholarshipType.includes(search);
            const matchesStatus = status === "all" || row.status === status;
            const matchesYear = schoolYear === "all" || row.school_year === schoolYear;
            return matchesSearch && matchesStatus && matchesYear;
        });
    }

    function dropdownId(rowId) {
        const normalized = (rowId || "")
            .toString()
            .replace(/[^a-zA-Z0-9_-]/g, "");
        return "applicationActionsMenu-" + (normalized || "row");
    }

    function actionButtonMarkup(row) {
        const menuId = dropdownId(row.id);
        const encodedId = encodeURIComponent(row.id);

        if (EDITABLE_STATUSES.includes(row.status)) {
            return (
                '<div class="dropdown dropup">' +
                '<button class="btn btn-outline-dark btn-sm dropdown-toggle" type="button" id="' + menuId + '" data-bs-toggle="dropdown" aria-expanded="false">Options</button>' +
                '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="' + menuId + '">' +
                '<li><a class="dropdown-item" href="applicant-application-form.html?application_id=' + encodedId + '">Continue Draft</a></li>' +
                '<li><hr class="dropdown-divider" /></li>' +
                '<li><button class="dropdown-item text-danger" type="button" data-action="delete-draft" data-id="' + escapeHtml(row.id) + '">Delete Draft</button></li>' +
                "</ul>" +
                "</div>"
            );
        }

        return (
            '<div class="dropdown dropup">' +
            '<button class="btn btn-outline-dark btn-sm dropdown-toggle" type="button" id="' + menuId + '" data-bs-toggle="dropdown" aria-expanded="false">Options</button>' +
            '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="' + menuId + '">' +
            '<li><a class="dropdown-item" href="application-detail.html?id=' + encodedId + '">Track Application</a></li>' +
            "</ul>" +
            "</div>"
        );
    }

    function getPageCount(totalRows) {
        if (totalRows <= 0) {
            return 1;
        }
        return Math.ceil(totalRows / PAGE_SIZE);
    }

    function getCurrentPageRows(rows) {
        const pageCount = getPageCount(rows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }
        const start = (currentPage - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;
        return rows.slice(start, end);
    }

    function renderTable(rows) {
        const tbody = byId("applicationsTableBody");
        if (!tbody) {
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No application records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows
            .map(function (row) {
                const meta = statusMeta(row.status);
                return (
                    "<tr>" +
                    "<td>" + escapeHtml(row.application_no) + "</td>" +
                    "<td>" + escapeHtml(row.scholarship_type || "-") + "</td>" +
                    "<td>" + escapeHtml(formatDate(row.submitted_at || row.created_at)) + "</td>" +
                    '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                    "<td>" + actionButtonMarkup(row) + "</td>" +
                    "</tr>"
                );
            })
            .join("");
    }

    function renderPaginationInfo(totalRows) {
        const target = byId("applicationsPaginationInfo");
        if (!target) {
            return;
        }
        if (totalRows <= 0) {
            target.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, totalRows);
        target.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        const linkLabel = ariaLabel ? ' aria-label="' + escapeHtml(ariaLabel) + '"' : "";
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '"' + linkLabel + ">" + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderPaginationControls(totalRows) {
        const pagination = byId("applicationsPagination");
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

    function applyFilterAndRender(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }
        filteredApplicationRows = filteredRows();
        const currentRows = getCurrentPageRows(filteredApplicationRows);
        renderTable(currentRows);
        renderPaginationInfo(filteredApplicationRows.length);
        renderPaginationControls(filteredApplicationRows.length);
    }

    function setDeleteButtonLoading(button, isLoading) {
        if (!button) {
            return;
        }
        button.disabled = isLoading;
        button.textContent = isLoading ? "Deleting..." : "Delete Draft";
    }

    async function deleteDraftApplication(context, applicationId, triggerButton) {
        const targetRow = applicationRows.find(function (row) {
            return row.id === applicationId;
        });
        if (!targetRow || !EDITABLE_STATUSES.includes(targetRow.status)) {
            showStatus("Only draft applications can be deleted.", "alert-warning");
            return;
        }

        const confirmed = window.confirm("Delete this draft application? This cannot be undone.");
        if (!confirmed) {
            return;
        }

        setDeleteButtonLoading(triggerButton, true);
        showStatus("");

        try {
            const docResult = await context.client
                .from("application_documents")
                .select("storage_path")
                .eq("application_id", applicationId);

            let storageWarning = "";
            if (!docResult.error && docResult.data && docResult.data.length > 0) {
                const storagePaths = docResult.data
                    .map(function (row) {
                        return (row.storage_path || "").toString().trim();
                    })
                    .filter(function (value) {
                        return value.length > 0;
                    });

                if (storagePaths.length > 0) {
                    const removeResult = await context.client.storage
                        .from(STORAGE_BUCKET)
                        .remove(storagePaths);
                    if (removeResult.error) {
                        storageWarning = " Storage files may remain: " + removeResult.error.message;
                    }
                }
            }

            const deleteResult = await context.client
                .from("applications")
                .delete()
                .eq("id", applicationId)
                .eq("applicant_id", context.user.id);

            if (deleteResult.error) {
                showStatus("Failed to delete draft: " + deleteResult.error.message, "alert-danger");
                return;
            }

            const currentPageHasOnlyOneRow = filteredApplicationRows.length > 0 && getCurrentPageRows(filteredApplicationRows).length === 1;
            if (currentPage > 1 && currentPageHasOnlyOneRow) {
                currentPage -= 1;
            }
            await loadApplications(context);
            showStatus("Draft deleted successfully." + storageWarning, storageWarning ? "alert-warning" : "alert-success");
        } catch (error) {
            showStatus("Failed to delete draft. Please try again.", "alert-danger");
        } finally {
            setDeleteButtonLoading(triggerButton, false);
        }
    }

    async function loadApplications(context) {
        showStatus("");
        const result = await context.client
            .from("applications")
            .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false });

        if (result.error) {
            showStatus("Failed to load applications: " + result.error.message, "alert-danger");
            return;
        }

        applicationRows = result.data || [];
        fillFilters(applicationRows);
        applyFilterAndRender(false);
    }

    function bindFilterEvents(context) {
        const applyBtn = byId("applicationsApplyFilterBtn");
        const search = byId("applicationsSearchInput");
        const status = byId("applicationsStatusFilter");
        const year = byId("applicationsYearFilter");
        const tableBody = byId("applicationsTableBody");
        const pagination = byId("applicationsPagination");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFilterAndRender(true);
            });
        }
        if (search) {
            search.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFilterAndRender(true);
                }
            });
        }
        if (status) {
            status.addEventListener("change", function () {
                applyFilterAndRender(true);
            });
        }
        if (year) {
            year.addEventListener("change", function () {
                applyFilterAndRender(true);
            });
        }
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }
                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(filteredApplicationRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }
                currentPage = nextPage;
                applyFilterAndRender(false);
            });
        }
        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const trigger = event.target.closest('button[data-action="delete-draft"]');
                if (!trigger) {
                    return;
                }
                const applicationId = trigger.getAttribute("data-id");
                if (!applicationId) {
                    return;
                }
                deleteDraftApplication(context, applicationId, trigger);
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client) {
            return;
        }
        bindFilterEvents(context);
        await loadApplications(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
