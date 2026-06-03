(function () {
    "use strict";

    const EDITABLE_STATUSES = ["draft", "returned_for_correction", "submitted"];
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const PAGE_SIZE = 10;

    let applicationRows = [];
    let currentPage = 1;
    let activeSchoolYear = "";

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) {
                return (status || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral", nextStep: "Wait for update." };
            },
            nextStepForApplicant: function () {
                return "Wait for update.";
            },
            isExamCheckingStage: function () {
                return false;
            },
            examSummaryFromRecord: function () {
                return {
                    scoreText: "-",
                    percentageText: "-",
                    roomLabel: "",
                    seatNo: "",
                    resultLabel: "Score Consolidation",
                    resultChipClass: "ldss-chip-accent"
                };
            }
        };
    }

    function applicantExamScoresVisible() {
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS && window.LDSS_ACTIVE_WORKFLOW_CONTROLS.show_applicant_exam_scores !== false;
    }

    function maskedApplicantStatusValue(status, specialConsideration, sectorSelected) {
        if (workflow().applicantVisibleStatus) {
            return workflow().applicantVisibleStatus(status, specialConsideration === true, sectorSelected === true);
        }
        const normalized = normalizeStatusValue(status || "");
        if (specialConsideration === true && (normalized === "exam_completed" || normalized === "passed_exam" || normalized === "failed_exam")) {
            return "passed_exam";
        }
        if (sectorSelected === true && (normalized === "exam_completed" || normalized === "passed_exam" || normalized === "failed_exam")) {
            return "selected";
        }
        return normalized;
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
        if (workflow().applicantStatusMeta) {
            return workflow().applicantStatusMeta(status);
        }
        return workflow().statusMeta(status);
    }

    function normalizeStatusValue(status) {
        if (workflow() && typeof workflow().normalizeStatus === "function") {
            return workflow().normalizeStatus(status || "");
        }
        return (status || "").toString().trim().toLowerCase();
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

    function normalizeTimeValue(value) {
        const raw = (value || "").toString().trim();
        const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        return match ? (match[1] + ":" + match[2]) : "";
    }

    function formatTimeValue(value) {
        const normalized = normalizeTimeValue(value);
        if (!normalized) {
            return "";
        }
        const parts = normalized.split(":");
        const hours = Number(parts[0]);
        const minutes = parts[1];
        const suffix = hours >= 12 ? "PM" : "AM";
        const hour12 = hours % 12 || 12;
        return hour12 + ":" + minutes + " " + suffix;
    }

    function formatScheduleLabel(dateValue, timeValue) {
        if (!dateValue) {
            return "-";
        }
        const dateLabel = formatDate(dateValue);
        const timeLabel = formatTimeValue(timeValue);
        return timeLabel ? (dateLabel + " at " + timeLabel) : dateLabel;
    }

    async function loadIntakePolicy(context) {
        const fallback = {
            isOpen: true,
            reason: "open",
            openDate: "",
            closeDate: "",
            openTime: "",
            closeTime: ""
        };

        const result = await context.client.rpc("application_intake_is_open");
        if (result.error || !result.data || typeof result.data !== "object") {
            return fallback;
        }

        return {
            isOpen: result.data.is_open !== false,
            reason: (result.data.reason || "open").toString(),
            schoolYear: (result.data.school_year || "").toString().trim(),
            openDate: toIsoDateOnly(result.data.open_date || ""),
            closeDate: toIsoDateOnly(result.data.close_date || ""),
            openTime: normalizeTimeValue(result.data.open_time || ""),
            closeTime: normalizeTimeValue(result.data.close_time || "")
        };
    }

    async function loadActiveSchoolYear(context) {
        const policy = await loadIntakePolicy(context);
        return policy && policy.schoolYear ? policy.schoolYear : "";
    }

    function workflowControls() {
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS || {};
    }

    function intakeClosedMessage(policy) {
        if (!policy) {
            return "New application filing is currently closed by System Administrator.";
        }
        if (policy.reason === "before_open_date" && policy.openDate) {
            return "New application filing opens on " + formatScheduleLabel(policy.openDate, policy.openTime) + ".";
        }
        if (policy.reason === "after_close_date" && policy.closeDate) {
            return "New application filing closed on " + formatScheduleLabel(policy.closeDate, policy.closeTime) + ".";
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

        const latestBlockingApplication = applicationRows.find(function (row) {
            if ((row.status || "").toString().trim().toLowerCase() === "draft") {
                return false;
            }
            if (activeSchoolYear) {
                return (row.school_year || "").toString().trim() === activeSchoolYear;
            }
            return true;
        }) || null;

        if (latestBlockingApplication) {
            const blockingYear = (latestBlockingApplication.school_year || "").toString().trim();
            btn.classList.add("ldss-btn-disabled-hint");
            btn.textContent = "Application Locked";
            btn.setAttribute("href", "javascript:void(0);");
            btn.setAttribute("aria-disabled", "true");
            btn.setAttribute(
                "title",
                blockingYear
                    ? ("Only 1 application attempt is allowed for " + blockingYear + ". Update your existing application instead.")
                    : "Only 1 application attempt is allowed per school year. Update your existing application instead."
            );
            return;
        }

        if (policy && policy.isOpen) {
            btn.classList.remove("ldss-btn-disabled-hint");
            btn.textContent = "New Application";
            btn.setAttribute("href", openHref);
            btn.removeAttribute("aria-disabled");
            btn.removeAttribute("title");
            return;
        }

        const message = intakeClosedMessage(policy);
        btn.classList.add("ldss-btn-disabled-hint");
        btn.textContent = "Application Closed";
        btn.setAttribute("href", "javascript:void(0);");
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("title", message);
        showStatus(message, "alert-warning");
    }

    function canDownloadApplication(status) {
        return (status || "").toString() !== "draft";
    }

    function viewButtonMarkup(row) {
        const encodedId = encodeURIComponent(row.id);
        const viewHref = "applicant-application-form.html?application_id=" + encodedId;
        const editHref = viewHref + "&force_edit=1";
        const printButton = canDownloadApplication(row.status)
            ? '<a class="btn btn-dark btn-sm ldss-applications-action-btn" href="applicant-print-form.html?id=' + encodedId + '&download=1">Download PDF</a>'
            : "";
        return (
            '<div class="ldss-row-actions">' +
            '<a class="btn btn-outline-dark btn-sm ldss-applications-action-btn" href="' + viewHref + '">View</a>' +
            '<a class="btn btn-outline-dark btn-sm ldss-applications-action-btn" href="' + editHref + '">Edit</a>' +
            printButton +
            '</div>'
        );
    }

    function hasSectorClassification(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return false;
        }
        return raw.toLowerCase() !== "none of the above";
    }

    function isMissingApplicationsColumnError(error, columnName) {
        const needle = (columnName || "").toString().trim().toLowerCase();
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        return !!needle && text.includes(needle) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
    }

    function isSectorSelectedRow(row) {
        return Boolean(row && (row.sector_selected === true || row.is_sector_selected === true));
    }

    function submittedOnMarkup(row) {
        if (row.submitted_at) {
            return '<div class="fw-600">' + escapeHtml(formatDate(row.submitted_at)) + "</div>";
        }
        return (
            '<div class="fw-600">Not yet submitted</div>' +
            '<div class="small text-muted">Created ' + escapeHtml(formatDate(row.created_at)) + "</div>"
        );
    }

    function examResultMarkup(row) {
        const examSummary = workflow().examSummaryFromRecord(row.exam_record || null);
        if (!row.exam_record) {
            return '<span class="ldss-chip ldss-chip-neutral">Not Taken</span>';
        }
        if ((examSummary.status || "").toString() === "absent") {
            return '<span class="ldss-chip ldss-chip-neutral">No Result</span>';
        }

        const specialConsideration = Boolean(row.special_consideration);
        const sectorSelected = isSectorSelectedRow(row);
        const scoresVisible = applicantExamScoresVisible();
        const postedResult = workflow().applicantExamDisplayMeta(examSummary, {
            specialConsideration: specialConsideration,
            sectorSelected: sectorSelected,
            showFailedScore: scoresVisible,
            sectorClassification: row.sector_classification || ""
        });
        const rankLabel = row && row.exam_rank !== null && typeof row.exam_rank !== "undefined"
            ? ("RANK " + String(row.exam_rank))
            : "";
        if (postedResult.result === "passed") {
            if (postedResult.hasScore) {
                return '<div class="fw-700 d-inline-flex align-items-center flex-wrap gap-1 text-success lh-1">'
                    + '<span>' + escapeHtml(postedResult.displayText) + '</span>'
                    + (rankLabel ? '<span class="text-muted">|</span><span class="text-uppercase text-muted fw-semibold">' + escapeHtml(rankLabel) + '</span>' : "")
                    + "</div>";
            }
            return '<span class="ldss-chip ldss-chip-success">PASSED</span>';
        }
        if (postedResult.result === "selected") {
            const sectorText = postedResult.sectorClassificationText || "Sector Classification";
            return '<div class="d-inline-flex flex-column align-items-start lh-1">'
                + '<div class="fw-700 d-inline-flex align-items-center flex-wrap gap-1 lh-1">'
                + (postedResult.hasScore ? '<span class="text-danger">' + escapeHtml(postedResult.scoreText) + '</span><span class="text-muted">|</span>' : "")
                + '<span class="text-success text-uppercase">SELECTED</span>'
                + '</div>'
                + '<div class="small text-muted fw-semibold mt-1">Sector Classification: ' + escapeHtml(sectorText) + '</div>'
                + "</div>";
        }
        if (postedResult.result === "failed") {
            if (postedResult.hasScore) {
                const rankLabel = row && row.exam_rank !== null && typeof row.exam_rank !== "undefined"
                    ? ("RANK " + String(row.exam_rank))
                    : "";
                return '<div class="fw-700 d-inline-flex align-items-center flex-wrap gap-1 text-danger lh-1">'
                    + '<span>' + escapeHtml(postedResult.scoreText) + '</span>'
                    + '<span class="text-muted">|</span>'
                    + '<span class="text-uppercase">FAIL</span>'
                    + (rankLabel ? '<span class="text-muted">|</span><span class="text-uppercase text-muted fw-semibold">' + escapeHtml(rankLabel) + '</span>' : "")
                    + "</div>";
            }
            return '<span class="ldss-chip ldss-chip-danger">FAIL</span>';
        }

        if (!scoresVisible) {
            return '<span class="ldss-chip ' + postedResult.chipClass + '">' + escapeHtml(postedResult.chipLabel || "Score Consolidation") + "</span>";
        }

        return '<span class="ldss-chip ' + examSummary.resultChipClass + '">' + escapeHtml(examSummary.resultLabel) + "</span>";
    }

    function examStatusMetaForRow(row) {
        const examSummary = workflow().examSummaryFromRecord(row.exam_record || null);
        const specialConsideration = Boolean(row.special_consideration);
        const sectorSelected = isSectorSelectedRow(row);
        if (row.exam_record) {
            return {
                label: examSummary.statusLabel || "Pending",
                chipClass: examSummary.statusChipClass || "ldss-chip-neutral"
            };
        }

        const applicationStatus = normalizeStatusValue(maskedApplicantStatusValue(row && row.status ? row.status : "", specialConsideration, sectorSelected));
        const completedStatuses = [
            "exam_completed",
            "passed_exam",
            "failed_exam",
            "special_endorsement_review",
            "for_interview",
            "interview_scheduled",
            "interview_completed",
            "hard_copy_verified",
            "for_approval",
            "approved",
            "waitlisted",
            "rejected",
            "for_release",
            "released"
        ];

        if (applicationStatus === "exam_scheduled") {
            return { label: "Scheduled", chipClass: "ldss-chip-accent" };
        }
        if (completedStatuses.includes(applicationStatus)) {
            return { label: "Completed", chipClass: "ldss-chip-success" };
        }
        return { label: "Pending", chipClass: "ldss-chip-neutral" };
    }

    function examStatusMarkup(row) {
        const meta = examStatusMetaForRow(row);
        return '<span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span>";
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
            .map(function (row, index) {
                const rowNumber = ((currentPage - 1) * PAGE_SIZE) + index + 1;

                return (
                    "<tr>" +
                    '<td data-label="No."><div class="small fw-700">' + escapeHtml(String(rowNumber)) + "</div></td>" +
                    '<td data-label="School Year"><div class="small fw-600">' + escapeHtml((row.school_year || "-").toString()) + "</div></td>" +
                    '<td data-label="Applicant ID"><div class="fw-700 ldss-table-id">' + escapeHtml(row.application_no) + "</div></td>" +
                    '<td data-label="Submitted On">' + submittedOnMarkup(row) + "</td>" +
                    '<td data-label="Examination Status">' + examStatusMarkup(row) + "</td>" +
                    '<td data-label="Exam Result">' + examResultMarkup(row) + "</td>" +
                    '<td data-label="Option" class="ldss-actions-cell">' + viewButtonMarkup(row) + "</td>" +
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
                    if (window.ldssUploads && typeof window.ldssUploads.deleteFiles === "function") {
                        const removeResult = await window.ldssUploads.deleteFiles(context, storagePaths);
                        if (removeResult.warnings && removeResult.warnings.length > 0) {
                            storageWarning = " Storage files may remain: " + removeResult.warnings.join(" | ");
                        }
                    } else {
                        storageWarning = " Storage files may remain: upload client is unavailable.";
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

    function hasMissingExamAssignmentColumns(error) {
        return !!(error && /room_label|room_seat_no/i.test(error.message || ""));
    }

    async function loadExamMap(context, applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const primary = await context.client
            .from("exam_records")
            .select("application_id, exam_control_no, raw_score, percentage_score, result, status, room_label, room_seat_no, created_at, updated_at")
            .in("application_id", applicationIds);

        if (!primary.error) {
            return latestRowByApplication(primary.data || []);
        }

        if (hasMissingExamAssignmentColumns(primary.error)) {
            const withoutAssignments = await context.client
                .from("exam_records")
                .select("application_id, exam_control_no, raw_score, percentage_score, result, status, created_at, updated_at")
                .in("application_id", applicationIds);

            if (!withoutAssignments.error) {
                return latestRowByApplication((withoutAssignments.data || []).map(function (row) {
                    return Object.assign({ room_label: "", room_seat_no: null }, row);
                }));
            }
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
                room_label: "",
                room_seat_no: null,
                result: "pending",
                status: "encoded",
                created_at: row.created_at,
                updated_at: row.updated_at
            };
        });

        return latestRowByApplication(transformed);
    }

    async function loadSpecialConsiderationFlags(context, applicationIds) {
        const map = {};
        if (!context || !context.client || typeof context.client.rpc !== "function") {
            return map;
        }

        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));
        if (!wantedIds.length) {
            return map;
        }

        try {
            const result = await context.client.rpc("current_user_application_special_consideration_flags", {
                p_application_ids: wantedIds
            });

            if (result.error) {
                return map;
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = Boolean(row.has_special_consideration);
                }
            });
        } catch (_error) {
            return map;
        }

        return map;
    }

    async function loadSectorSelectionFlags(context, applicationIds) {
        const map = {};
        if (!context || !context.client || typeof context.client.rpc !== "function") {
            return map;
        }

        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));
        if (!wantedIds.length) {
            return map;
        }

        try {
            const result = await context.client.rpc("current_user_application_sector_selection_flags", {
                p_application_ids: wantedIds
            });

            if (result.error) {
                return map;
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = row.is_sector_selected === true;
                }
            });
        } catch (_error) {
            return map;
        }

        return map;
    }

    async function loadExamRankMap(context, applicationIds) {
        const map = {};
        if (!context || !context.client || typeof context.client.rpc !== "function") {
            return map;
        }

        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));
        if (!wantedIds.length) {
            return map;
        }

        try {
            const result = await context.client.rpc("current_user_application_exam_ranks", {
                p_application_ids: wantedIds
            });

            if (result.error) {
                return map;
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = row.exam_rank == null ? null : Number(row.exam_rank);
                }
            });
        } catch (_error) {
            return map;
        }

        return map;
    }

    async function loadApplications(context) {
        showStatus("");
        let result = await context.client
            .from("applications")
            .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, is_locked, sector_classification")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false });

        if (result.error && isMissingApplicationsColumnError(result.error, "sector_classification")) {
            result = await context.client
                .from("applications")
                .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, is_locked")
                .eq("applicant_id", context.user.id)
                .order("created_at", { ascending: false });
        }

        if (result.error) {
            showStatus("Failed to load applications: " + result.error.message, "alert-danger");
            return;
        }

        const rows = result.data || [];
        const appIds = rows.map(function (row) { return row.id; }).filter(Boolean);
        const loadedMaps = await Promise.all([
            loadExamMap(context, appIds),
            loadSpecialConsiderationFlags(context, appIds),
            loadSectorSelectionFlags(context, appIds),
            loadExamRankMap(context, appIds)
        ]);
        const examMap = loadedMaps[0];
        const specialFlagMap = loadedMaps[1];
        const sectorSelectionMap = loadedMaps[2];
        const examRankMap = loadedMaps[3];

        applicationRows = rows.map(function (row) {
            const specialReviewStatus = normalizeStatusValue(row.status || "") === "special_endorsement_review";
            return Object.assign({}, row, {
                exam_record: examMap[row.id] || null,
                exam_rank: Object.prototype.hasOwnProperty.call(examRankMap, row.id) ? examRankMap[row.id] : null,
                sector_classification: row.sector_classification || "",
                sector_selected: Boolean(sectorSelectionMap[row.id]),
                special_consideration: Boolean(
                    specialFlagMap[row.id]
                    || specialReviewStatus
                )
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
        if (window.ldssWorkflowControlsReadyPromise && typeof window.ldssWorkflowControlsReadyPromise.then === "function") {
            await window.ldssWorkflowControlsReadyPromise;
        }
        bindEvents(context);
        await loadApplications(context);
        activeSchoolYear = await loadActiveSchoolYear(context);
        const intakePolicy = await loadIntakePolicy(context);
        applyIntakeState(intakePolicy);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
