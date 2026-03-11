(function () {
    "use strict";

    const EDITABLE_STATUSES = ["draft", "returned_for_correction"];
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const PAGE_SIZE = 10;

    let applicationRows = [];
    let currentPage = 1;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral", nextStep: "Wait for update." };
            },
            nextStepForApplicant: function () {
                return "Wait for update.";
            },
            examSummaryFromRecord: function () {
                return {
                    scoreText: "-",
                    percentageText: "-",
                    resultLabel: "Pending",
                    resultChipClass: "ldss-chip-neutral"
                };
            }
        };
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
        return workflow().statusMeta(status);
    }

    function toIsoDateOnly(value) {
        if (!value) {
            return "";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "";
        }
        return date.toISOString().slice(0, 10);
    }

    async function loadIntakePolicy(context) {
        const fallback = {
            isOpen: true,
            reason: "open",
            openDate: "",
            closeDate: ""
        };

        const result = await context.client.rpc("application_intake_is_open");
        if (result.error || !result.data || typeof result.data !== "object") {
            return fallback;
        }

        return {
            isOpen: result.data.is_open !== false,
            reason: (result.data.reason || "open").toString(),
            openDate: toIsoDateOnly(result.data.open_date || ""),
            closeDate: toIsoDateOnly(result.data.close_date || "")
        };
    }

    function intakeClosedMessage(policy) {
        if (!policy) {
            return "New application filing is currently closed by System Administrator.";
        }
        if (policy.reason === "before_open_date" && policy.openDate) {
            return "New application filing opens on " + formatDate(policy.openDate) + ".";
        }
        if (policy.reason === "after_close_date" && policy.closeDate) {
            return "New application filing closed on " + formatDate(policy.closeDate) + ".";
        }
        if (policy.reason === "closed_by_admin") {
            return "New application filing is currently turned OFF by System Administrator.";
        }
        return "New application filing is currently closed by System Administrator.";
    }

    function applyIntakeState(policy) {
        const btn = byId("newApplicationBtn");
        if (!btn) {
            return;
        }

        const openHref = btn.getAttribute("data-open-href") || btn.getAttribute("href") || "applicant-application-form.html";
        btn.setAttribute("data-open-href", openHref);

        if (policy && policy.isOpen) {
            btn.classList.remove("disabled");
            btn.setAttribute("href", openHref);
            btn.removeAttribute("aria-disabled");
            btn.removeAttribute("title");
            return;
        }

        const message = intakeClosedMessage(policy);
        btn.classList.add("disabled");
        btn.setAttribute("href", "javascript:void(0);");
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("title", message);
        showStatus(message, "alert-warning");
    }

    async function loadApplicantCourse(context) {
        const result = await context.client
            .from("profiles")
            .select("course_or_strand")
            .eq("id", context.user.id)
            .maybeSingle();

        if (result.error) {
            return "";
        }

        return result.data && result.data.course_or_strand
            ? result.data.course_or_strand
            : "";
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

        if (row.status === "draft") {
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

        if (row.status === "returned_for_correction") {
            return (
                '<div class="dropdown dropup">' +
                '<button class="btn btn-outline-dark btn-sm dropdown-toggle" type="button" id="' + menuId + '" data-bs-toggle="dropdown" aria-expanded="false">Options</button>' +
                '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="' + menuId + '">' +
                '<li><a class="dropdown-item" href="applicant-application-form.html?application_id=' + encodedId + '">Edit and Resubmit</a></li>' +
                '<li><a class="dropdown-item" href="application-detail.html?id=' + encodedId + '">Track Application</a></li>' +
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
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No application records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows
            .map(function (row) {
                const meta = statusMeta(row.status);
                const examSummary = workflow().examSummaryFromRecord(row.exam_record || null);
                const hasExamValue = examSummary.scoreText !== "-" || examSummary.percentageText !== "-";
                const examText = hasExamValue
                    ? ("Raw: " + examSummary.scoreText + " | %: " + examSummary.percentageText)
                    : "No score yet";

                return (
                    "<tr>" +
                    "<td>" + escapeHtml(row.application_no) + "</td>" +
                    "<td>" + escapeHtml(row.degree_course || "-") + "</td>" +
                    "<td>" + escapeHtml(formatDate(row.submitted_at || row.created_at)) + "</td>" +
                    '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                    '<td><div class="small">' + escapeHtml(examText) + '</div><span class="ldss-chip ' + examSummary.resultChipClass + '">' + escapeHtml(examSummary.resultLabel) + "</span></td>" +
                    '<td><div class="small">' + escapeHtml(workflow().nextStepForApplicant(row.status)) + "</div></td>" +
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

    function renderRows() {
        const currentRows = getCurrentPageRows(applicationRows);
        renderTable(currentRows);
        renderPaginationInfo(applicationRows.length);
        renderPaginationControls(applicationRows.length);
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
        if (!targetRow || targetRow.status !== "draft") {
            showStatus("Only draft applications can be deleted. Submitted records cannot be deleted.", "alert-warning");
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

            await loadApplications(context);
            showStatus("Draft deleted successfully." + storageWarning, storageWarning ? "alert-warning" : "alert-success");
        } catch (error) {
            showStatus("Failed to delete draft. Please try again.", "alert-danger");
        } finally {
            setDeleteButtonLoading(triggerButton, false);
        }
    }

    function latestRowByApplication(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            const appId = row.application_id;
            if (!appId) {
                return;
            }
            const existing = map[appId];
            if (!existing) {
                map[appId] = row;
                return;
            }
            const a = new Date(existing.updated_at || existing.created_at || 0).getTime();
            const b = new Date(row.updated_at || row.created_at || 0).getTime();
            if (b > a) {
                map[appId] = row;
            }
        });
        return map;
    }

    async function loadExamMap(context, applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const primary = await context.client
            .from("exam_records")
            .select("application_id, exam_control_no, raw_score, percentage_score, result, status, created_at, updated_at")
            .in("application_id", applicationIds);

        if (!primary.error) {
            return latestRowByApplication(primary.data || []);
        }

        // TODO(Supabase): remove fallback once exam_records is deployed in production.
        const fallback = await context.client
            .from("interviews")
            .select("application_id, exam_score, updated_at, created_at")
            .in("application_id", applicationIds);

        if (fallback.error || !fallback.data) {
            return {};
        }

        const transformed = fallback.data.map(function (row) {
            return {
                application_id: row.application_id,
                exam_control_no: null,
                raw_score: row.exam_score,
                percentage_score: row.exam_score,
                result: "pending",
                status: "encoded",
                created_at: row.created_at,
                updated_at: row.updated_at
            };
        });

        return latestRowByApplication(transformed);
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

        const rows = result.data || [];
        const applicantCourse = await loadApplicantCourse(context);
        const appIds = rows.map(function (row) { return row.id; }).filter(Boolean);
        const examMap = await loadExamMap(context, appIds);

        applicationRows = rows.map(function (row) {
            return Object.assign({}, row, {
                exam_record: examMap[row.id] || null,
                degree_course: applicantCourse || ""
            });
        });

        currentPage = 1;
        renderRows();
    }

    function bindEvents(context) {
        const tableBody = byId("applicationsTableBody");
        const pagination = byId("applicationsPagination");

        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }
                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(applicationRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }
                currentPage = nextPage;
                renderRows();
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
        bindEvents(context);
        await loadApplications(context);
        const intakePolicy = await loadIntakePolicy(context);
        applyIntakeState(intakePolicy);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
