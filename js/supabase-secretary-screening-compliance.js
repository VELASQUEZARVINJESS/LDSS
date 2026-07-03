(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const LOOKUP_BATCH_SIZE = 200;
    const PROFILE_BATCH_SIZE = 120;
    const PAGE_SIZE = 12;
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const HARD_COPY_REQUIREMENTS_PAYLOAD_KEY = "hard_copy_requirements";
    const NO_BATCH_FILTER_VALUE = "__no_batch__";
    const INITIAL_SCREENING_STORAGE_HOTFIX = "supabase/initial_screening_tracking_hotfix_2026_06_30.sql";
    const REQUIREMENTS_STATUS_PENDING = "pending";
    const REQUIREMENTS_STATUS_RECEIVED = "received";
    const REQUIREMENTS_STATUS_NEEDS_CORRECTION = "needs_correction";
    const REQUIREMENTS_STATUS_MISSING = "missing";
    const REQUIREMENTS_STATUS_VALUES = new Set([
        REQUIREMENTS_STATUS_PENDING,
        REQUIREMENTS_STATUS_RECEIVED,
        REQUIREMENTS_STATUS_NEEDS_CORRECTION,
        REQUIREMENTS_STATUS_MISSING
    ]);
    const LONG_BOND_PDF_FORMAT = [612, 936];
    const SELECTION_STORAGE_HOTFIX = "supabase/selection_pool_hotfix_2026_06_30.sql";

    const HARD_COPY_REQUIREMENTS = [
        { key: "application_form", label: "Application Form" },
        { key: "birth_certificate", label: "Birth Certificate" },
        { key: "certification_of_residency", label: "Certification of Residency", fallbackDocumentType: "barangay_certificate" },
        { key: "comelec_voters_certification", label: "COMELEC Voter's Certification" },
        { key: "good_moral_character", label: "Good Moral Character (Certified True Copy)" },
        { key: "form_138", label: "Form 138 (Certified True Copy)", fallbackDocumentType: "report_card" },
        { key: "mswd_certification", label: "Certified True Copy of MSWD" },
        { key: "bir_income_tax_or_tax_exemption", label: "BIR Income Tax Return / Tax Exemption", fallbackDocumentType: "income_certificate" },
        { key: "notarized_sworn_affidavit", label: "Notarized Sworn Affidavit" }
    ];

    const SELECTION_CATEGORY_META = {
        passed_exam: {
            label: "Passed Exam",
            chipClass: "ldss-chip-success"
        },
        sector_classification: {
            label: "Sector Classification",
            chipClass: "ldss-chip-accent"
        },
        manual_office_selection: {
            label: "Manual Office Selection",
            chipClass: "ldss-chip-accent"
        }
    };

    const ATTENDANCE_STATUS_META = {
        not_scheduled: {
            label: "Not Scheduled",
            chipClass: "ldss-chip-neutral"
        },
        scheduled: {
            label: "Scheduled",
            chipClass: "ldss-chip-accent"
        },
        rescheduled: {
            label: "Rescheduled",
            chipClass: "ldss-chip-accent"
        },
        completed: {
            label: "Attended",
            chipClass: "ldss-chip-success"
        },
        no_show: {
            label: "No Show",
            chipClass: "ldss-chip-danger"
        },
        cancelled: {
            label: "Cancelled",
            chipClass: "ldss-chip-danger"
        }
    };

    const REQUIREMENTS_STATE_META = {
        complete: {
            label: "Complete",
            chipClass: "ldss-chip-success"
        },
        incomplete: {
            label: "Incomplete",
            chipClass: "ldss-chip-accent"
        },
        missing: {
            label: "Missing",
            chipClass: "ldss-chip-danger"
        }
    };

    const DECISION_META = {
        ready_final_selection: {
            label: "Ready for Final Interview",
            chipClass: "ldss-chip-success",
            description: "Completed initial screening and requirements."
        },
        hold_requirements: {
            label: "Hold for Requirements",
            chipClass: "ldss-chip-accent",
            description: "Attended screening but still needs document compliance."
        },
        review_no_show: {
            label: "Review No Show",
            chipClass: "ldss-chip-accent",
            description: "Did not attend screening but requirements are complete."
        },
        not_qualified: {
            label: "Not Qualified",
            chipClass: "ldss-chip-danger",
            description: "Did not attend screening and requirements are incomplete."
        },
        pending_screening: {
            label: "Pending Screening",
            chipClass: "ldss-chip-neutral",
            description: "Still waiting for screening schedule or attendance."
        }
    };

    const SCREENING_PRINT_REPORT_META = {
        missing_requirements: {
            label: "No Requirements List",
            emptyMessage: "No applicants without saved hard-copy requirements match the current view."
        },
        attended_initial_screening: {
            label: "Attended Initial Screening",
            emptyMessage: "No applicants marked attended match the current view."
        },
        no_show_initial_screening: {
            label: "No Show Initial Screening",
            emptyMessage: "No applicants marked no show match the current view."
        },
        pending_screening: {
            label: "Pending Screening",
            emptyMessage: "No applicants waiting for initial screening match the current view."
        }
    };

    let authContext = null;
    let batches = [];
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let screeningColumnsAvailable = true;
    let isScreeningSaveBusy = false;
    let isScreeningPdfBusy = false;
    let activeScreeningSaveStatus = "";
    let screeningPrintFrame = null;
    let screeningPdfBrandDataUrlPromise = null;
    const selectedScreeningApplicationIds = new Set();

    function byId(id) {
        return document.getElementById(id);
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
        const box = byId("screeningComplianceStatus");
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
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function upperText(value) {
        return (value || "").toString().trim().toUpperCase();
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function buildApplicantName(profile) {
        if (!profile) {
            return "UNKNOWN APPLICANT";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) {
                return upperText(value);
            })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : upperText(profile.email || "Unknown Applicant");
    }

    function normalizeSelectionCategory(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (raw === "sector") {
            return "sector_classification";
        }
        if (raw === "manual" || raw === "manual_selection") {
            return "manual_office_selection";
        }
        return Object.prototype.hasOwnProperty.call(SELECTION_CATEGORY_META, raw)
            ? raw
            : "manual_office_selection";
    }

    function selectionCategoryMeta(value) {
        return SELECTION_CATEGORY_META[normalizeSelectionCategory(value)] || SELECTION_CATEGORY_META.manual_office_selection;
    }

    function selectionCategoryChip(value) {
        const meta = selectionCategoryMeta(value);
        return '<span class="ldss-chip ' + escapeHtml(meta.chipClass) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function normalizeAttendanceStatus(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(ATTENDANCE_STATUS_META, raw)
            ? raw
            : "not_scheduled";
    }

    function attendanceMeta(value) {
        return ATTENDANCE_STATUS_META[normalizeAttendanceStatus(value)] || ATTENDANCE_STATUS_META.not_scheduled;
    }

    function attendanceChip(value) {
        const meta = attendanceMeta(value);
        return '<span class="ldss-chip ' + escapeHtml(meta.chipClass) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function requirementsStateMeta(value) {
        return REQUIREMENTS_STATE_META[(value || "").toString().trim().toLowerCase()] || REQUIREMENTS_STATE_META.missing;
    }

    function requirementsChip(summary) {
        const meta = requirementsStateMeta(summary && summary.state ? summary.state : "missing");
        return '<span class="ldss-chip ' + escapeHtml(meta.chipClass) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function decisionMeta(value) {
        return DECISION_META[(value || "").toString().trim().toLowerCase()] || DECISION_META.pending_screening;
    }

    function decisionChip(value) {
        const meta = decisionMeta(value);
        return '<span class="ldss-chip ' + escapeHtml(meta.chipClass) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function normalizeRequirementsPayload(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return {};
        }
        return payload;
    }

    function normalizeRequirementStatus(value) {
        const normalized = (value || "").toString().trim().toLowerCase();
        return REQUIREMENTS_STATUS_VALUES.has(normalized)
            ? normalized
            : REQUIREMENTS_STATUS_PENDING;
    }

    function requirementPayloadEntryStatus(entry) {
        if (!entry) {
            return "";
        }
        if (typeof entry === "string") {
            return normalizeRequirementStatus(entry);
        }
        if (typeof entry === "object" && !Array.isArray(entry)) {
            return normalizeRequirementStatus(entry.status || "");
        }
        return "";
    }

    function documentStatusToRequirementStatus(status) {
        const normalized = (status || "").toString().trim().toLowerCase();
        if (normalized === "verified") {
            return REQUIREMENTS_STATUS_RECEIVED;
        }
        if (normalized === "rejected" || normalized === "needs_reupload") {
            return REQUIREMENTS_STATUS_NEEDS_CORRECTION;
        }
        if (normalized === "pending") {
            return REQUIREMENTS_STATUS_PENDING;
        }
        return "";
    }

    function latestRequirementDocStatusByType(documents) {
        const map = {};
        const rows = Array.isArray(documents) ? documents : [];

        rows.forEach(function (doc) {
            const key = (doc && doc.document_type ? doc.document_type : "").toString().trim();
            if (!key) {
                return;
            }
            const existing = map[key];
            if (!existing) {
                map[key] = doc;
                return;
            }
            const existingTime = new Date(existing.created_at || 0).getTime();
            const currentTime = new Date(doc.created_at || 0).getTime();
            if (currentTime > existingTime) {
                map[key] = doc;
            }
        });

        return map;
    }

    function buildRequirementsStatusMap(payload, documents) {
        const normalizedPayload = normalizeRequirementsPayload(payload);
        const payloadChecklist = normalizeRequirementsPayload(normalizedPayload[HARD_COPY_REQUIREMENTS_PAYLOAD_KEY]);
        const latestDocuments = latestRequirementDocStatusByType(documents || []);
        const statusMap = {};

        HARD_COPY_REQUIREMENTS.forEach(function (requirement) {
            const savedStatus = requirementPayloadEntryStatus(payloadChecklist[requirement.key]);
            if (savedStatus) {
                statusMap[requirement.key] = savedStatus;
                return;
            }

            const fallbackType = requirement.fallbackDocumentType || "";
            const fallbackDocument = fallbackType ? latestDocuments[fallbackType] : null;
            const fallbackStatus = fallbackDocument
                ? documentStatusToRequirementStatus(fallbackDocument.verification_status)
                : "";

            statusMap[requirement.key] = fallbackStatus || REQUIREMENTS_STATUS_PENDING;
        });

        return statusMap;
    }

    function summarizeRequirements(statusMap, documents) {
        let receivedCount = 0;
        let needsCorrectionCount = 0;
        let pendingCount = 0;
        const totalCount = HARD_COPY_REQUIREMENTS.length;
        const documentCount = Array.isArray(documents) ? documents.length : 0;

        HARD_COPY_REQUIREMENTS.forEach(function (requirement) {
            const normalized = normalizeRequirementStatus(statusMap && statusMap[requirement.key]);
            if (normalized === REQUIREMENTS_STATUS_RECEIVED) {
                receivedCount += 1;
            } else if (normalized === REQUIREMENTS_STATUS_NEEDS_CORRECTION) {
                needsCorrectionCount += 1;
            } else if (normalized === REQUIREMENTS_STATUS_PENDING || normalized === REQUIREMENTS_STATUS_MISSING) {
                pendingCount += 1;
            }
        });

        const complete = totalCount > 0 && receivedCount === totalCount;
        const hasActivity = receivedCount > 0 || needsCorrectionCount > 0 || documentCount > 0;
        const state = complete
            ? "complete"
            : (hasActivity ? "incomplete" : "missing");

        return {
            state: state,
            complete: complete,
            receivedCount: receivedCount,
            totalCount: totalCount,
            needsCorrectionCount: needsCorrectionCount,
            pendingCount: pendingCount,
            documentCount: documentCount
        };
    }

    function buildRequirementsNote(summary) {
        if (!summary) {
            return "No requirement data available.";
        }
        if (summary.state === "complete") {
            return String(summary.receivedCount) + "/" + String(summary.totalCount) + " received.";
        }
        if (summary.state === "missing") {
            return "No saved hard-copy checklist yet.";
        }
        if (summary.needsCorrectionCount > 0) {
            return String(summary.receivedCount) + "/" + String(summary.totalCount) + " received. Some items need correction.";
        }
        return String(summary.receivedCount) + "/" + String(summary.totalCount) + " received. Follow up remaining requirements.";
    }

    function deriveDecision(row) {
        const requirementsComplete = Boolean(row && row.requirements_summary && row.requirements_summary.complete);
        const attendanceStatus = normalizeAttendanceStatus(row ? row.attendance_status : "");

        if (attendanceStatus === "completed") {
            return requirementsComplete ? "ready_final_selection" : "hold_requirements";
        }

        if (attendanceStatus === "no_show") {
            return requirementsComplete ? "review_no_show" : "not_qualified";
        }

        return "pending_screening";
    }

    function buildDecisionNote(row) {
        const decision = deriveDecision(row);
        const attendanceStatus = normalizeAttendanceStatus(row ? row.attendance_status : "");

        if (decision === "ready_final_selection") {
            return "Attended screening and completed requirements.";
        }
        if (decision === "hold_requirements") {
            return "Attended screening but still needs requirement compliance.";
        }
        if (decision === "review_no_show") {
            return "Requirements are complete, but the applicant was marked as no show.";
        }
        if (decision === "not_qualified") {
            return "No show and requirements are still incomplete.";
        }
        if (attendanceStatus === "scheduled" || attendanceStatus === "rescheduled") {
            return "Waiting for screening attendance to be encoded.";
        }
        if (attendanceStatus === "cancelled") {
            return "Screening schedule was cancelled. Review for rescheduling.";
        }
        return "Still waiting for screening schedule.";
    }

    function compareRows(left, right) {
        const leftTime = new Date(left.selection_updated_at || left.application_submitted_at || 0).getTime();
        const rightTime = new Date(right.selection_updated_at || right.application_submitted_at || 0).getTime();
        if (leftTime !== rightTime) {
            return rightTime - leftTime;
        }
        return String(left.applicant_name || "").localeCompare(String(right.applicant_name || ""), undefined, {
            sensitivity: "base"
        });
    }

    function selectionStorageWarning() {
        return "Selection Pool storage is not installed yet. Apply " + SELECTION_STORAGE_HOTFIX + " first.";
    }

    function isMissingSelectionColumnError(error) {
        const message = error && error.message ? error.message : "";
        return /selection_included|selection_category|selection_notes|selection_updated_at/i.test(message);
    }

    function initialScreeningStorageWarning() {
        return "Initial Screening tracking is not installed yet. Apply " + INITIAL_SCREENING_STORAGE_HOTFIX + " first.";
    }

    function isMissingInitialScreeningColumnError(error) {
        const message = error && error.message ? error.message : "";
        return /initial_screening_batch_label|initial_screening_scheduled_at|initial_screening_venue|initial_screening_status|initial_screening_notes|initial_screening_marked_by|initial_screening_updated_at/i.test(message);
    }

    function normalizeScreeningNote(value) {
        return (value || "").toString().replace(/\s+/g, " ").trim();
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + className + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function pageCount(totalRows) {
        return totalRows <= 0 ? 1 : Math.ceil(totalRows / PAGE_SIZE);
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("screeningCompliancePaginationInfo");
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
        const pagination = byId("screeningCompliancePagination");
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
            items.push(pageItemMarkup(String(page), page, false, page === currentPage, "Page " + String(page)));
        }

        items.push(pageItemMarkup("Next", currentPage + 1, currentPage >= totalPages, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function currentBatchMap() {
        const map = {};
        batches.forEach(function (batch) {
            if (batch && batch.id) {
                map[batch.id] = batch;
            }
        });
        return map;
    }

    function formatBatchLabel(batch) {
        if (!batch) {
            return "No Exam Batch";
        }
        const parts = [batch.batch_label || "Untitled Batch"];
        const dateLabel = formatDate(batch.exam_datetime);
        if (dateLabel !== "-") {
            parts.push(dateLabel);
        }
        return parts.join(" | ");
    }

    function batchLabelForRow(row) {
        if (!row || !row.batch_id) {
            return "No Exam Batch";
        }
        return row.batch_label || "No Exam Batch";
    }

    function requirementsFilterValue(summary) {
        return summary && summary.state ? summary.state : "missing";
    }

    function scheduleMarkup(row) {
        const schedule = row && row.screening_scheduled_at ? formatDateTime(row.screening_scheduled_at) : "-";
        const venue = row && row.screening_venue ? row.screening_venue : "Venue not set";
        return (
            '<div class="fw-600">' + escapeHtml(schedule) + "</div>" +
            '<div class="small text-muted">' + escapeHtml(venue) + "</div>"
        );
    }

    function attendanceUpdateNote(row) {
        if (!screeningColumnsAvailable) {
            return "Apply Initial Screening SQL to encode attendance here.";
        }
        if (row && row.screening_updated_at) {
            return "Updated " + formatDate(row.screening_updated_at) + ".";
        }
        return "Waiting for hard-copy attendance encoding.";
    }

    function currentPageRows() {
        if (!filteredRows.length) {
            return [];
        }
        const totalPages = pageCount(filteredRows.length);
        const safePage = Math.max(1, Math.min(totalPages, currentPage));
        const start = (safePage - 1) * PAGE_SIZE;
        return filteredRows.slice(start, start + PAGE_SIZE);
    }

    function checkedScreeningRows() {
        if (!selectedScreeningApplicationIds.size) {
            return [];
        }
        return allRows.filter(function (row) {
            return row && row.application_id && selectedScreeningApplicationIds.has(row.application_id);
        });
    }

    function toggleScreeningChecked(applicationId, checked) {
        if (!applicationId) {
            return;
        }
        if (checked) {
            selectedScreeningApplicationIds.add(applicationId);
        } else {
            selectedScreeningApplicationIds.delete(applicationId);
        }
    }

    function toggleAllVisibleScreeningRows(checked) {
        currentPageRows().forEach(function (row) {
            if (row && row.application_id) {
                toggleScreeningChecked(row.application_id, checked);
            }
        });
    }

    function syncScreeningSelectionMeta() {
        const target = byId("screeningComplianceSelectionMeta");
        if (!target) {
            return;
        }
        const count = checkedScreeningRows().length;
        target.textContent = count
            ? String(count) + " applicant(s) selected."
            : "Select one or more applicants from the list.";
    }

    function syncScreeningSelectAll() {
        const selectAll = byId("screeningComplianceSelectAll");
        if (!selectAll) {
            return;
        }
        const pageRows = currentPageRows().filter(Boolean);
        const checkedCount = pageRows.filter(function (row) {
            return row.application_id && selectedScreeningApplicationIds.has(row.application_id);
        }).length;
        selectAll.checked = Boolean(pageRows.length) && checkedCount === pageRows.length;
        selectAll.indeterminate = checkedCount > 0 && checkedCount < pageRows.length;
        selectAll.disabled = !pageRows.length || isScreeningSaveBusy;
    }

    function syncScreeningActionButtons() {
        const checkedRows = checkedScreeningRows();
        const markDoneBtn = byId("screeningComplianceMarkDoneBtn");
        const noShowBtn = byId("screeningComplianceNoShowBtn");
        const resetBtn = byId("screeningComplianceResetBtn");
        const disabled = isScreeningSaveBusy || !checkedRows.length || !screeningColumnsAvailable;

        if (markDoneBtn) {
            markDoneBtn.disabled = disabled;
            markDoneBtn.textContent = isScreeningSaveBusy && activeScreeningSaveStatus === "completed"
                ? "Saving..."
                : "Mark Done";
        }
        if (noShowBtn) {
            noShowBtn.disabled = disabled;
            noShowBtn.textContent = isScreeningSaveBusy && activeScreeningSaveStatus === "no_show"
                ? "Saving..."
                : "No Show";
        }
        if (resetBtn) {
            resetBtn.disabled = disabled;
            resetBtn.textContent = isScreeningSaveBusy && activeScreeningSaveStatus === "not_scheduled"
                ? "Saving..."
                : "Reset";
        }
    }

    function renderMetrics(rows) {
        const sourceRows = Array.isArray(rows) ? rows : [];
        const readyCount = sourceRows.filter(function (row) {
            return row.decision_key === "ready_final_selection";
        }).length;
        const holdCount = sourceRows.filter(function (row) {
            return row.decision_key === "hold_requirements";
        }).length;
        const reviewCount = sourceRows.filter(function (row) {
            return row.decision_key === "review_no_show" || row.decision_key === "not_qualified";
        }).length;
        const pendingCount = sourceRows.filter(function (row) {
            return row.decision_key === "pending_screening";
        }).length;

        setMetric("screeningComplianceSelectedCount", sourceRows.length);
        setMetric("screeningComplianceReadyCount", readyCount);
        setMetric("screeningComplianceHoldCount", holdCount);
        setMetric("screeningComplianceReviewCount", reviewCount);
        setMetric("screeningCompliancePendingCount", pendingCount);
    }

    function renderMeta() {
        const meta = byId("screeningComplianceMeta");
        if (!meta) {
            return;
        }

        if (!allRows.length) {
            meta.textContent = "No shortlisted applicants are saved in Selection Pool yet.";
            return;
        }

        const completeCount = filteredRows.filter(function (row) {
            return row.requirements_summary && row.requirements_summary.state === "complete";
        }).length;
        const noShowCount = filteredRows.filter(function (row) {
            return row.attendance_status === "no_show";
        }).length;

        meta.textContent = "Showing " + String(filteredRows.length)
            + " of " + String(allRows.length) + " shortlisted applicant(s). "
            + String(completeCount) + " complete requirements, "
            + String(noShowCount) + " marked no show.";
    }

    function screeningPrintReportMeta(value) {
        return SCREENING_PRINT_REPORT_META[(value || "").toString().trim().toLowerCase()]
            || SCREENING_PRINT_REPORT_META.missing_requirements;
    }

    function selectedOptionText(id, fallback) {
        const select = byId(id);
        if (!select || !select.options || select.selectedIndex < 0) {
            return fallback || "All";
        }
        const option = select.options[select.selectedIndex];
        return option && option.text
            ? option.text
            : (fallback || "All");
    }

    function currentScreeningFilterSummary() {
        const searchInput = byId("screeningComplianceSearchInput");
        const searchValue = searchInput
            ? (searchInput.value || "").toString().trim()
            : "";

        return [
            "Batch: " + selectedOptionText("screeningComplianceBatchFilter", "All Exam Batches"),
            "Requirements: " + selectedOptionText("screeningComplianceRequirementsFilter", "All Requirement Status"),
            "Initial Screening: " + selectedOptionText("screeningComplianceAttendanceFilter", "All Screening Status"),
            "Decision: " + selectedOptionText("screeningComplianceDecisionFilter", "All Decisions"),
            "Search: " + (searchValue || "None")
        ].join(" | ");
    }

    function screeningReportRows(reportType) {
        const sourceRows = Array.isArray(filteredRows) ? filteredRows : [];
        const normalizedType = (reportType || "").toString().trim().toLowerCase();

        if (normalizedType === "attended_initial_screening") {
            return sourceRows.filter(function (row) {
                return normalizeAttendanceStatus(row && row.attendance_status) === "completed";
            });
        }

        if (normalizedType === "no_show_initial_screening") {
            return sourceRows.filter(function (row) {
                return normalizeAttendanceStatus(row && row.attendance_status) === "no_show";
            });
        }

        if (normalizedType === "pending_screening") {
            return sourceRows.filter(function (row) {
                const attendanceStatus = normalizeAttendanceStatus(row && row.attendance_status);
                return ["not_scheduled", "scheduled", "rescheduled", "cancelled"].includes(attendanceStatus);
            });
        }

        return sourceRows.filter(function (row) {
            const summary = row && row.requirements_summary ? row.requirements_summary : null;
            return !summary || summary.state === "missing";
        });
    }

    function currentScreeningReportSelection() {
        if (!filteredRows.length) {
            return {
                errorMessage: "No shortlisted applicants match the current filters for reporting."
            };
        }

        const reportSelect = byId("screeningCompliancePrintReportType");
        const reportType = reportSelect ? (reportSelect.value || "missing_requirements") : "missing_requirements";
        const report = screeningPrintReportMeta(reportType);
        const rows = screeningReportRows(reportType);

        if (!rows.length) {
            return {
                reportType: reportType,
                report: report,
                rows: rows,
                errorMessage: report.emptyMessage
            };
        }

        return {
            reportType: reportType,
            report: report,
            rows: rows
        };
    }

    function currentScreeningPrintFrame() {
        if (screeningPrintFrame && document.body && document.body.contains(screeningPrintFrame)) {
            return screeningPrintFrame;
        }

        const frame = document.createElement("iframe");
        frame.id = "screeningCompliancePrintFrame";
        frame.title = "Initial screening print frame";
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("tabindex", "-1");
        frame.style.position = "fixed";
        frame.style.right = "0";
        frame.style.bottom = "0";
        frame.style.width = "1px";
        frame.style.height = "1px";
        frame.style.border = "0";
        frame.style.opacity = "0";
        frame.style.pointerEvents = "none";
        document.body.appendChild(frame);
        screeningPrintFrame = frame;
        return frame;
    }

    function getPdfGenerator() {
        const jsPdfNamespace = window.jspdf || null;
        if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
            return null;
        }
        return jsPdfNamespace.jsPDF;
    }

    function screeningPdfFileSlug(value, fallback) {
        const slug = (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || fallback;
    }

    function screeningPdfLogoHref() {
        return new URL("../img/daet-lgu.png", window.location.href).href;
    }

    async function imageHrefToDataUrl(href) {
        const response = await fetch(href);
        if (!response.ok) {
            throw new Error("Failed to load branding image.");
        }
        const blob = await response.blob();
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onloadend = function () {
                resolve(typeof reader.result === "string" ? reader.result : "");
            };
            reader.onerror = function () {
                reject(new Error("Failed to convert branding image."));
            };
            reader.readAsDataURL(blob);
        });
    }

    async function loadScreeningPdfLogoDataUrl() {
        if (!screeningPdfBrandDataUrlPromise) {
            screeningPdfBrandDataUrlPromise = imageHrefToDataUrl(screeningPdfLogoHref()).catch(function () {
                return "";
            });
        }
        return screeningPdfBrandDataUrlPromise;
    }

    function screeningPdfFileName(reportType) {
        const batchLabel = selectedOptionText("screeningComplianceBatchFilter", "all-batches");
        return "ldss-initial-screening-" +
            screeningPdfFileSlug(screeningPrintReportMeta(reportType).label, "report") + "-" +
            screeningPdfFileSlug(batchLabel, "all-batches") + ".pdf";
    }

    function buildScreeningPrintHtml(reportType, rows) {
        const report = screeningPrintReportMeta(reportType);
        const logoHref = new URL("../img/daet-lgu.png", window.location.href).href;
        const generatedAt = formatDateTime(new Date());
        const summaryText = currentScreeningFilterSummary();
        const tableRows = (Array.isArray(rows) ? rows : []).map(function (row, index) {
            const requirementsSummary = row && row.requirements_summary ? row.requirements_summary : { state: "missing" };
            const selectionLabel = selectionCategoryMeta(row ? row.selection_category : "").label;
            const requirementsLabel = requirementsStateMeta(requirementsSummary.state || "missing").label;
            const attendanceLabel = attendanceMeta(row ? row.attendance_status : "").label;
            const batchLabel = row && row.batch_label ? row.batch_label : "No exam batch";

            return (
                "<tr>" +
                "<td>" + escapeHtml(String(index + 1)) + "</td>" +
                "<td><strong>" + escapeHtml(row && row.applicant_name ? row.applicant_name : "UNKNOWN APPLICANT") + "</strong><div class=\"subline\">" + escapeHtml(batchLabel) + "</div></td>" +
                "<td>" + escapeHtml(row && row.application_no ? row.application_no : "-") + "</td>" +
                "<td>" + escapeHtml(selectionLabel) + "</td>" +
                "<td>" + escapeHtml(requirementsLabel) + "<div class=\"subline\">" + escapeHtml(buildRequirementsNote(requirementsSummary)) + "</div></td>" +
                "<td>" + escapeHtml(attendanceLabel) + "<div class=\"subline\">" + escapeHtml(attendanceUpdateNote(row || {})) + "</div></td>" +
                "</tr>"
            );
        }).join("");

        return [
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>LDSP Initial Screening Print</title><style>",
            "@page{size:8.5in 13in;margin:0.45in;}body{font-family:Arial,sans-serif;margin:0;color:#0f172a;background:#ffffff;} .sheet{max-width:100%;} .print-header{border-bottom:1.5px solid #0f172a;padding-bottom:12px;margin-bottom:14px;} .logo-row{text-align:center;margin-bottom:8px;} .logo-row img{width:58px;height:58px;object-fit:contain;display:block;margin:0 auto 6px;} .logo-row .kicker{font-size:11px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;} .logo-row .title{font-size:22px;font-weight:800;line-height:1.2;color:#0f172a;} .logo-row .subtitle{font-size:12px;color:#475569;margin-top:4px;} .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;} .summary-card{border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:10px 12px;} .summary-card .label{font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:4px;} .summary-card .value{font-size:14px;font-weight:700;color:#0f172a;} .filter-note{border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;padding:10px 12px;font-size:11px;line-height:1.5;color:#475569;margin-bottom:14px;} table{width:100%;border-collapse:collapse;font-size:11px;} th,td{border:1px solid #94a3b8;padding:8px 9px;vertical-align:top;text-align:left;} th{background:#e2e8f0;font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#334155;} tbody tr:nth-child(even){background:#f8fafc;} td:first-child{width:46px;text-align:center;font-weight:700;} .subline{font-size:10px;color:#64748b;margin-top:3px;} @media print{.sheet{max-width:none;}}",
            "</style></head><body><div class=\"sheet\">",
            "<div class=\"print-header\">",
            "<div class=\"logo-row\">",
            "<img src=\"" + escapeHtml(logoHref) + "\" alt=\"LGU Daet Logo\" />",
            "<div class=\"kicker\">LGU Daet Scholarship System</div>",
            "<div class=\"title\">" + escapeHtml(report.label) + "</div>",
            "<div class=\"subtitle\">Initial Screening printable report</div>",
            "</div>",
            "<div class=\"summary-grid\">",
            "<div class=\"summary-card\"><div class=\"label\">Report</div><div class=\"value\">" + escapeHtml(report.label) + "</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Names</div><div class=\"value\">" + escapeHtml(String(rows.length)) + "</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Source View</div><div class=\"value\">" + escapeHtml(String(filteredRows.length)) + " shortlisted</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Generated</div><div class=\"value\">" + escapeHtml(generatedAt) + "</div></div>",
            "</div>",
            "<div class=\"filter-note\"><strong>Current Filters:</strong> " + escapeHtml(summaryText) + "</div>",
            "<table><thead><tr><th>No.</th><th>Applicant</th><th>Application No.</th><th>Selection Source</th><th>Requirements</th><th>Initial Screening</th></tr></thead><tbody>",
            tableRows,
            "</tbody></table>",
            "</div></body></html>"
        ].join("");
    }

    function openScreeningPrintReport() {
        const selection = currentScreeningReportSelection();
        if (selection.errorMessage) {
            showStatus(selection.errorMessage, "alert-warning");
            return;
        }

        const reportType = selection.reportType;
        const report = selection.report;
        const rows = selection.rows;

        const frame = currentScreeningPrintFrame();
        const frameWindow = frame.contentWindow;
        const frameDoc = frameWindow ? frameWindow.document : null;
        if (!frameWindow || !frameDoc) {
            showStatus("The print report could not be prepared right now. Refresh the page and try again.", "alert-warning");
            return;
        }

        let printTriggered = false;
        frame.onload = function () {
            if (printTriggered) {
                return;
            }
            printTriggered = true;

            window.setTimeout(function () {
                try {
                    frameWindow.focus();
                    frameWindow.print();
                    showStatus(report.label + " print dialog opened for " + String(rows.length) + " applicant(s).", "alert-success");
                } catch (error) {
                    showStatus("The browser could not open the print dialog right now. Try again.", "alert-warning");
                }
            }, 180);
        };

        frameDoc.open();
        frameDoc.write(buildScreeningPrintHtml(reportType, rows));
        frameDoc.close();
    }

    async function saveScreeningPdfReport() {
        if (isScreeningPdfBusy) {
            return;
        }

        const selection = currentScreeningReportSelection();
        if (selection.errorMessage) {
            showStatus(selection.errorMessage, "alert-warning");
            return;
        }

        const reportType = selection.reportType;
        const report = selection.report;
        const rows = selection.rows;
        const JsPdf = getPdfGenerator();
        if (!JsPdf) {
            showStatus("The PDF library is not available right now.", "alert-warning");
            return;
        }

        const pdfButton = byId("screeningCompliancePdfBtn");
        isScreeningPdfBusy = true;
        if (pdfButton) {
            pdfButton.disabled = true;
        }
        showStatus("Preparing PDF report...", "alert-info");

        try {
            const doc = new JsPdf({
                orientation: "portrait",
                unit: "pt",
                format: LONG_BOND_PDF_FORMAT
            });

            if (typeof doc.autoTable !== "function") {
                showStatus("The PDF table helper is not available right now.", "alert-warning");
                return;
            }

            const logoDataUrl = await loadScreeningPdfLogoDataUrl();
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const left = 20;
            const titleLeft = left + 52;
            const printedAt = formatDateTime(new Date());
            const reportBatchLabel = selectedOptionText("screeningComplianceBatchFilter", "All Exam Batches");
            const filterLines = doc.splitTextToSize("Filters: " + currentScreeningFilterSummary(), pageWidth - (left * 2));
            const titleLines = doc.splitTextToSize(report.label, pageWidth - titleLeft - left);
            const titleTopY = 28;
            const titleLineHeight = 18;
            const titleBottomY = titleTopY + ((titleLines.length - 1) * titleLineHeight);

            if (logoDataUrl) {
                doc.addImage(logoDataUrl, "PNG", left, 16, 40, 40);
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text("LGU DAET SCHOLARSHIP SYSTEM", titleLeft, 24);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(15, 23, 42);
            doc.text(titleLines, titleLeft, titleTopY);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            doc.setTextColor(71, 85, 105);
            doc.text("Initial Screening PDF Report", titleLeft, titleBottomY + 16);
            doc.text("Generated: " + printedAt, titleLeft, titleBottomY + 29);
            doc.text("Batch: " + reportBatchLabel, titleLeft, titleBottomY + 42);
            doc.text(filterLines, left, titleBottomY + 62);

            const summaryY = titleBottomY + 62 + (filterLines.length * 11);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.2);
            doc.setTextColor(15, 23, 42);
            doc.text("Applicants: " + String(rows.length) + " | Source View: " + String(filteredRows.length) + " shortlisted", left, summaryY);
            doc.setDrawColor(203, 213, 225);
            doc.line(left, summaryY + 8, pageWidth - left, summaryY + 8);

            doc.autoTable({
                startY: summaryY + 16,
                head: [["No.", "Applicant", "Application No.", "Selection Source", "Requirements", "Initial Screening"]],
                body: rows.map(function (row, index) {
                    const requirementsSummary = row && row.requirements_summary ? row.requirements_summary : { state: "missing" };
                    const applicantBatchLabel = row && row.batch_label ? row.batch_label : "No exam batch";
                    return [
                        String(index + 1),
                        [row && row.applicant_name ? row.applicant_name : "UNKNOWN APPLICANT", applicantBatchLabel].join("\n"),
                        row && row.application_no ? row.application_no : "-",
                        selectionCategoryMeta(row ? row.selection_category : "").label,
                        [
                            requirementsStateMeta(requirementsSummary.state || "missing").label,
                            buildRequirementsNote(requirementsSummary)
                        ].join("\n"),
                        [
                            attendanceMeta(row ? row.attendance_status : "").label,
                            attendanceUpdateNote(row || {})
                        ].join("\n")
                    ];
                }),
                margin: { left: left, right: left, bottom: 24 },
                styles: {
                    font: "helvetica",
                    fontSize: 8,
                    cellPadding: 4.5,
                    lineColor: [203, 213, 225],
                    lineWidth: 0.45,
                    textColor: [15, 23, 42],
                    overflow: "linebreak",
                    valign: "middle"
                },
                headStyles: {
                    fillColor: [226, 232, 240],
                    textColor: [15, 23, 42],
                    fontStyle: "bold",
                    fontSize: 8.3
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: 26, halign: "center" },
                    1: { cellWidth: 150 },
                    2: { cellWidth: 80 },
                    3: { cellWidth: 85 },
                    4: { cellWidth: 125 },
                    5: { cellWidth: 106 }
                },
                didDrawPage: function () {
                    const pageNumber = doc.internal.getNumberOfPages();
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(8.2);
                    doc.setTextColor(100, 116, 139);
                    doc.text("Printed: " + printedAt, left, pageHeight - 12);
                    doc.text("Page " + String(pageNumber), pageWidth - left, pageHeight - 12, { align: "right" });
                }
            });

            doc.save(screeningPdfFileName(reportType));
            showStatus(report.label + " PDF downloaded for " + String(rows.length) + " applicant(s).", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to build the PDF report.", "alert-danger");
        } finally {
            isScreeningPdfBusy = false;
            if (pdfButton) {
                pdfButton.disabled = false;
            }
        }
    }

    function renderTable() {
        const tbody = byId("screeningComplianceTableBody");
        if (!tbody) {
            return;
        }

        if (!allRows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted">No applicants are saved in Selection Pool yet. Open Selection Pool first.</td></tr>';
            renderPaginationInfo(0);
            renderPagination(0);
            renderMetrics([]);
            renderMeta();
            syncScreeningSelectionMeta();
            syncScreeningSelectAll();
            syncScreeningActionButtons();
            return;
        }

        if (!filteredRows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted">No shortlisted applicants match the current filters.</td></tr>';
            renderPaginationInfo(0);
            renderPagination(0);
            renderMetrics([]);
            renderMeta();
            syncScreeningSelectionMeta();
            syncScreeningSelectAll();
            syncScreeningActionButtons();
            return;
        }

        const totalRows = filteredRows.length;
        const totalPages = pageCount(totalRows);
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = currentPageRows();

        tbody.innerHTML = pageRows.map(function (row, index) {
            const requirementsSummary = row.requirements_summary || {
                state: "missing",
                receivedCount: 0,
                totalCount: HARD_COPY_REQUIREMENTS.length
            };
            const decision = decisionMeta(row.decision_key);
            const selectionDate = row.selection_updated_at ? ("Saved " + formatDate(row.selection_updated_at)) : "Selection date not saved";
            const selectionNoteText = row.selection_notes || "No selection remarks saved.";
            const screeningNoteText = row.screening_notes || "";
            const checked = row.application_id && selectedScreeningApplicationIds.has(row.application_id) ? " checked" : "";
            const checkboxDisabled = isScreeningSaveBusy ? " disabled" : "";

            return (
                "<tr>" +
                '<td class="text-center"><input class="form-check-input" data-screening-check="' + escapeHtml(row.application_id || "") + '" type="checkbox" aria-label="' + escapeHtml("Select " + (row.applicant_name || "applicant")) + '"' + checked + checkboxDisabled + " /></td>" +
                '<td>' +
                '    <div class="fw-700">' + escapeHtml(row.applicant_name || "UNKNOWN APPLICANT") + "</div>" +
                '    <div class="small text-muted">' + escapeHtml(row.application_no || "-") + "</div>" +
                "</td>" +
                '<td>' +
                "    " + selectionCategoryChip(row.selection_category) +
                '    <div class="small text-muted mt-1">' + escapeHtml(selectionDate) + "</div>" +
                "</td>" +
                '<td>' +
                "    " + requirementsChip(requirementsSummary) +
                '    <div class="small text-muted mt-1">' + escapeHtml(buildRequirementsNote(requirementsSummary)) + "</div>" +
                "</td>" +
                "<td>" + scheduleMarkup(row) + "</td>" +
                '<td>' +
                "    " + attendanceChip(row.attendance_status) +
                '    <div class="small text-muted mt-1">' + escapeHtml(attendanceUpdateNote(row)) + "</div>" +
                "</td>" +
                '<td>' +
                "    " + decisionChip(row.decision_key) +
                '    <div class="small text-muted mt-1">' + escapeHtml(decision.description) + "</div>" +
                "</td>" +
                '<td>' +
                '    <div class="small text-dark">' + escapeHtml(selectionNoteText) + "</div>" +
                (screeningNoteText ? '    <div class="small text-muted mt-1">' + escapeHtml(screeningNoteText) + "</div>" : "") +
                '    <div class="small text-muted mt-1">' + escapeHtml(buildDecisionNote(row)) + "</div>" +
                "</td>" +
                '<td>' +
                '    <a class="btn btn-outline-dark btn-sm" href="secretary-interview-verification.html?id=' + encodeURIComponent(row.application_id || "") + '">View Data</a>' +
                '    <div class="small text-muted mt-2">No. ' + escapeHtml(String(start + index + 1)) + "</div>" +
                "</td>" +
                "</tr>"
            );
        }).join("");

        renderPaginationInfo(totalRows);
        renderPagination(totalRows);
        renderMetrics(filteredRows);
        renderMeta();
        syncScreeningSelectionMeta();
        syncScreeningSelectAll();
        syncScreeningActionButtons();
    }

    function applyFilters() {
        const batchFilterValue = byId("screeningComplianceBatchFilter")
            ? (byId("screeningComplianceBatchFilter").value || "all")
            : "all";
        const requirementsFilterValueRaw = byId("screeningComplianceRequirementsFilter")
            ? (byId("screeningComplianceRequirementsFilter").value || "all")
            : "all";
        const attendanceFilterValue = byId("screeningComplianceAttendanceFilter")
            ? (byId("screeningComplianceAttendanceFilter").value || "all")
            : "all";
        const decisionFilterValue = byId("screeningComplianceDecisionFilter")
            ? (byId("screeningComplianceDecisionFilter").value || "all")
            : "all";
        const searchValue = byId("screeningComplianceSearchInput")
            ? (byId("screeningComplianceSearchInput").value || "").toString().trim().toLowerCase()
            : "";

        filteredRows = allRows.filter(function (row) {
            const batchMatches = batchFilterValue === "all"
                || (batchFilterValue === NO_BATCH_FILTER_VALUE && !row.batch_id)
                || row.batch_id === batchFilterValue;
            if (!batchMatches) {
                return false;
            }

            const requirementsMatches = requirementsFilterValueRaw === "all"
                || requirementsFilterValue(row.requirements_summary) === requirementsFilterValueRaw;
            if (!requirementsMatches) {
                return false;
            }

            const attendanceStatus = normalizeAttendanceStatus(row.attendance_status);
            let attendanceMatches = attendanceFilterValue === "all" || attendanceStatus === attendanceFilterValue;
            if (attendanceFilterValue === "pending_screening") {
                attendanceMatches = ["not_scheduled", "scheduled", "rescheduled", "cancelled"].includes(attendanceStatus);
            }
            if (!attendanceMatches) {
                return false;
            }

            if (decisionFilterValue !== "all" && row.decision_key !== decisionFilterValue) {
                return false;
            }

            if (!searchValue) {
                return true;
            }

            const haystack = [
                row.applicant_name,
                row.application_no,
                row.school_name,
                row.barangay,
                row.selection_notes,
                row.batch_label
            ].join(" ").toLowerCase();

            return haystack.indexOf(searchValue) !== -1;
        }).sort(compareRows);
    }

    function renderBatchFilter() {
        const select = byId("screeningComplianceBatchFilter");
        if (!select) {
            return;
        }

        const previousValue = select.value || "all";
        const usedBatchIds = {};
        let hasNoBatch = false;

        allRows.forEach(function (row) {
            if (row.batch_id) {
                usedBatchIds[row.batch_id] = true;
            } else {
                hasNoBatch = true;
            }
        });

        const options = ['<option value="all">All Exam Batches</option>'];
        batches.forEach(function (batch) {
            if (!batch || !batch.id || !usedBatchIds[batch.id]) {
                return;
            }
            options.push('<option value="' + escapeHtml(batch.id) + '">' + escapeHtml(formatBatchLabel(batch)) + "</option>");
        });

        if (hasNoBatch) {
            options.push('<option value="' + escapeHtml(NO_BATCH_FILTER_VALUE) + '">No Exam Batch</option>');
        }

        select.innerHTML = options.join("");
        if (previousValue && select.querySelector('option[value="' + previousValue + '"]')) {
            select.value = previousValue;
        } else {
            select.value = "all";
        }
    }

    async function fetchBatches() {
        const result = await authContext.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue")
            .order("exam_datetime", { ascending: false });

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                return [];
            }
            throw new Error("Failed to load exam batches: " + result.error.message);
        }

        return result.data || [];
    }

    async function fetchSelectionPoolFlags() {
        const rows = [];
        screeningColumnsAvailable = true;
        const extendedSelect = "application_id, selection_included, selection_category, selection_notes, selection_updated_at, updated_at, initial_screening_batch_label, initial_screening_scheduled_at, initial_screening_venue, initial_screening_status, initial_screening_notes, initial_screening_updated_at";
        const baseSelect = "application_id, selection_included, selection_category, selection_notes, selection_updated_at, updated_at";

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            let result = await authContext.client
                .from("application_staff_flags")
                .select(screeningColumnsAvailable ? extendedSelect : baseSelect)
                .eq("selection_included", true)
                .order("selection_updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                if (isMissingInitialScreeningColumnError(result.error)) {
                    screeningColumnsAvailable = false;
                    result = await authContext.client
                        .from("application_staff_flags")
                        .select(baseSelect)
                        .eq("selection_included", true)
                        .order("selection_updated_at", { ascending: false })
                        .range(from, from + SUPABASE_FETCH_LIMIT - 1);

                    if (!result.error) {
                        result.data = (result.data || []).map(function (row) {
                            return Object.assign({}, row, {
                                initial_screening_batch_label: "",
                                initial_screening_scheduled_at: "",
                                initial_screening_venue: "",
                                initial_screening_status: "not_scheduled",
                                initial_screening_notes: "",
                                initial_screening_updated_at: ""
                            });
                        });
                    }
                }
            }

            if (result.error) {
                if (isMissingSelectionColumnError(result.error)) {
                    throw new Error(selectionStorageWarning());
                }
                if (/does not exist|relation|schema cache/i.test(result.error.message || "")) {
                    throw new Error("Selection Pool data is not available yet. Run the staff flag SQL first.");
                }
                throw new Error("Failed to load Selection Pool: " + result.error.message);
            }

            const pageRows = result.data || [];
            rows.push.apply(rows, pageRows);
            if (pageRows.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        return rows;
    }

    async function loadApplicationsByIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("applications")
                .select("id, application_no, applicant_id, status, school_year, scholarship_type, submitted_at, created_at")
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to load applications: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                map[row.id] = row;
            });
        }

        return map;
    }

    async function loadProfilesByIds(profileIds) {
        const map = {};
        const wantedIds = Array.from(new Set((profileIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, school_name, barangay")
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to load applicant profiles: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                map[row.id] = row;
            });
        }

        return map;
    }

    async function loadExamRecordsByApplicationIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("exam_records")
                .select("application_id, batch_id, exam_control_no, scheduled_at, updated_at")
                .in("application_id", chunk);

            if (result.error) {
                if (/does not exist|relation/i.test(result.error.message || "")) {
                    return map;
                }
                throw new Error("Failed to load exam records: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = row;
                }
            });
        }

        return map;
    }

    async function loadInterviewRecordsByApplicationIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("interview_records")
                .select("application_id, batch_label, scheduled_at, venue, status, result, remarks, updated_at")
                .in("application_id", chunk);

            if (result.error) {
                if (/does not exist|relation/i.test(result.error.message || "")) {
                    return map;
                }
                throw new Error("Failed to load interview records: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = row;
                }
            });
        }

        return map;
    }

    async function loadRequirementsAuxByApplicationIds(applicationIds) {
        const payloadMap = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += PROFILE_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from(APPLICATION_AUX_DATA_TABLE)
                .select("application_id, payload")
                .in("application_id", chunk);

            if (result.error) {
                return {
                    payloadMap: payloadMap,
                    errorMessage: result.error.message || ""
                };
            }

            (result.data || []).forEach(function (entry) {
                const applicationId = (entry && entry.application_id ? entry.application_id : "").toString().trim();
                if (!applicationId) {
                    return;
                }
                payloadMap[applicationId] = normalizeRequirementsPayload(entry.payload);
            });
        }

        return {
            payloadMap: payloadMap,
            errorMessage: ""
        };
    }

    async function loadRequirementDocumentsByApplicationIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += PROFILE_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await authContext.client
                .from("application_documents")
                .select("application_id, document_type, verification_status, created_at")
                .in("application_id", chunk);

            if (result.error) {
                return {
                    documentsMap: map,
                    errorMessage: result.error.message || ""
                };
            }

            (result.data || []).forEach(function (row) {
                const applicationId = (row && row.application_id ? row.application_id : "").toString().trim();
                if (!applicationId) {
                    return;
                }
                if (!map[applicationId]) {
                    map[applicationId] = [];
                }
                map[applicationId].push(row);
            });
        }

        return {
            documentsMap: map,
            errorMessage: ""
        };
    }

    function updateLocalScreeningState(applicationIds, nextStatus, updatedAt) {
        const wantedIds = new Set(Array.isArray(applicationIds) ? applicationIds : [applicationIds]);
        allRows.forEach(function (row) {
            if (!row || !wantedIds.has(row.application_id)) {
                return;
            }
            row.attendance_status = normalizeAttendanceStatus(nextStatus);
            row.screening_updated_at = updatedAt || "";
            row.decision_key = deriveDecision(row);
        });
    }

    async function saveSelectedInitialScreeningStatus(nextStatus) {
        if (!screeningColumnsAvailable) {
            showStatus(initialScreeningStorageWarning(), "alert-warning");
            return;
        }

        const selectedRows = checkedScreeningRows();
        if (!selectedRows.length) {
            showStatus("Select one or more applicants first before updating Initial Screening.", "alert-info");
            return;
        }

        const savedAt = new Date().toISOString();
        const payload = selectedRows.map(function (row) {
            return {
                application_id: row.application_id,
                selection_included: true,
                selection_category: row.selection_category || "manual_office_selection",
                selection_notes: row.selection_notes || null,
                selection_updated_at: row.selection_updated_at || null,
                initial_screening_batch_label: row.screening_batch_label || null,
                initial_screening_scheduled_at: row.screening_scheduled_at || null,
                initial_screening_venue: row.screening_venue || null,
                initial_screening_status: nextStatus,
                initial_screening_notes: row.screening_notes || null,
                initial_screening_marked_by: authContext.user.id,
                initial_screening_updated_at: savedAt
            };
        });

        isScreeningSaveBusy = true;
        activeScreeningSaveStatus = nextStatus;
        renderTable();
        showStatus("");

        try {
            const result = await authContext.client
                .from("application_staff_flags")
                .upsert(payload, { onConflict: "application_id" });

            if (result.error) {
                if (isMissingInitialScreeningColumnError(result.error)) {
                    screeningColumnsAvailable = false;
                    renderTable();
                    showStatus(initialScreeningStorageWarning(), "alert-warning");
                    return;
                }
                throw new Error("Failed to save initial screening status: " + result.error.message);
            }

            updateLocalScreeningState(selectedRows.map(function (row) {
                return row.application_id;
            }), nextStatus, savedAt);
            selectedScreeningApplicationIds.clear();
            applyFilters();
            renderTable();

            const actionLabel = nextStatus === "completed"
                ? "marked as done in Initial Screening"
                : (nextStatus === "no_show"
                    ? "marked as No Show in Initial Screening"
                    : "reset in Initial Screening");
            showStatus(String(selectedRows.length) + " applicant(s) were " + actionLabel + ".", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to save Initial Screening status.", "alert-danger");
        } finally {
            isScreeningSaveBusy = false;
            activeScreeningSaveStatus = "";
            renderTable();
        }
    }

    async function loadData() {
        showStatus("");
        const refreshButton = byId("screeningComplianceRefreshBtn");
        if (refreshButton) {
            refreshButton.disabled = true;
        }

        try {
            const selectionFlags = await fetchSelectionPoolFlags();
            batches = await fetchBatches();

            if (!selectionFlags.length) {
                allRows = [];
                filteredRows = [];
                renderBatchFilter();
                renderTable();
                showStatus("No applicants are saved in Selection Pool yet. Add shortlisted applicants first.", "alert-info");
                return;
            }

            const applicationIds = Array.from(new Set(selectionFlags.map(function (row) {
                return row && row.application_id ? row.application_id : "";
            }).filter(Boolean)));

            const applicationsMap = await loadApplicationsByIds(applicationIds);
            const applicantIds = Array.from(new Set(applicationIds.map(function (applicationId) {
                return applicationsMap[applicationId] ? applicationsMap[applicationId].applicant_id : "";
            }).filter(Boolean)));

            const [
                profilesMap,
                examRecordsMap,
                interviewRecordsMap,
                requirementsAuxResult,
                requirementDocumentsResult
            ] = await Promise.all([
                loadProfilesByIds(applicantIds),
                loadExamRecordsByApplicationIds(applicationIds),
                loadInterviewRecordsByApplicationIds(applicationIds),
                loadRequirementsAuxByApplicationIds(applicationIds),
                loadRequirementDocumentsByApplicationIds(applicationIds)
            ]);

            const batchMap = currentBatchMap();
            const warnings = [];
            if (!screeningColumnsAvailable) {
                warnings.push(initialScreeningStorageWarning());
            }
            if (requirementsAuxResult.errorMessage) {
                warnings.push("Hard-copy checklist data could not be fully loaded.");
            }
            if (requirementDocumentsResult.errorMessage) {
                warnings.push("Requirement document statuses could not be fully loaded.");
            }

            allRows = selectionFlags.map(function (flagRow) {
                const applicationId = flagRow.application_id;
                const application = applicationsMap[applicationId] || null;
                const profile = application ? (profilesMap[application.applicant_id] || null) : null;
                const examRecord = examRecordsMap[applicationId] || null;
                const interviewRecord = interviewRecordsMap[applicationId] || null;
                const documents = requirementDocumentsResult.documentsMap[applicationId] || [];
                const requirementsPayload = requirementsAuxResult.payloadMap[applicationId] || {};
                const requirementsStatusMap = buildRequirementsStatusMap(requirementsPayload, documents);
                const requirementsSummary = summarizeRequirements(requirementsStatusMap, documents);
                const batch = examRecord && examRecord.batch_id ? (batchMap[examRecord.batch_id] || null) : null;
                const screeningStatus = normalizeAttendanceStatus(
                    flagRow.initial_screening_status
                    || (interviewRecord ? interviewRecord.status : "")
                );
                const screeningScheduledAt = flagRow.initial_screening_scheduled_at
                    || (interviewRecord ? (interviewRecord.scheduled_at || "") : "");
                const screeningVenue = flagRow.initial_screening_venue
                    || (interviewRecord ? (interviewRecord.venue || "") : "");
                const screeningNotes = normalizeScreeningNote(flagRow.initial_screening_notes || "");
                const screeningUpdatedAt = flagRow.initial_screening_updated_at || "";
                const row = {
                    application_id: applicationId,
                    application_no: application ? (application.application_no || "-") : "-",
                    applicant_id: application ? application.applicant_id : "",
                    applicant_name: buildApplicantName(profile),
                    school_name: profile ? (profile.school_name || "") : "",
                    barangay: profile ? (profile.barangay || "") : "",
                    selection_category: normalizeSelectionCategory(flagRow.selection_category || ""),
                    selection_notes: (flagRow.selection_notes || "").toString().replace(/\s+/g, " ").trim(),
                    selection_updated_at: flagRow.selection_updated_at || flagRow.updated_at || "",
                    application_submitted_at: application ? (application.submitted_at || application.created_at || "") : "",
                    batch_id: examRecord ? (examRecord.batch_id || "") : "",
                    batch_label: formatBatchLabel(batch),
                    screening_batch_label: (flagRow.initial_screening_batch_label || "").toString().trim(),
                    screening_scheduled_at: screeningScheduledAt,
                    screening_venue: screeningVenue,
                    attendance_status: screeningStatus,
                    screening_notes: screeningNotes,
                    screening_updated_at: screeningUpdatedAt,
                    interview_result: interviewRecord ? (interviewRecord.result || "pending") : "pending",
                    requirements_summary: requirementsSummary,
                    requirements_status_map: requirementsStatusMap
                };
                row.decision_key = deriveDecision(row);
                return row;
            }).sort(compareRows);

            Array.from(selectedScreeningApplicationIds).forEach(function (applicationId) {
                if (!allRows.some(function (row) { return row.application_id === applicationId; })) {
                    selectedScreeningApplicationIds.delete(applicationId);
                }
            });

            renderBatchFilter();
            applyFilters();
            currentPage = 1;
            renderTable();

            if (warnings.length) {
                showStatus(warnings.join(" "), "alert-warning");
            } else {
                showStatus("");
            }
        } catch (error) {
            allRows = [];
            filteredRows = [];
            renderBatchFilter();
            renderTable();
            showStatus(error && error.message ? error.message : "Failed to load initial screening data.", "alert-danger");
        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
            }
        }
    }

    function bindEvents() {
        const filterIds = [
            "screeningComplianceBatchFilter",
            "screeningComplianceRequirementsFilter",
            "screeningComplianceAttendanceFilter",
            "screeningComplianceDecisionFilter"
        ];

        filterIds.forEach(function (id) {
            const element = byId(id);
            if (!element) {
                return;
            }
            element.addEventListener("change", function () {
                currentPage = 1;
                applyFilters();
                renderTable();
            });
        });

        const searchInput = byId("screeningComplianceSearchInput");
        if (searchInput) {
            searchInput.addEventListener("input", function () {
                currentPage = 1;
                applyFilters();
                renderTable();
            });
        }

        const refreshButton = byId("screeningComplianceRefreshBtn");
        if (refreshButton) {
            refreshButton.addEventListener("click", function () {
                loadData();
            });
        }

        const printButton = byId("screeningCompliancePrintBtn");
        if (printButton) {
            printButton.addEventListener("click", function () {
                openScreeningPrintReport();
            });
        }

        const pdfButton = byId("screeningCompliancePdfBtn");
        if (pdfButton) {
            pdfButton.addEventListener("click", function () {
                saveScreeningPdfReport();
            });
        }

        const markDoneBtn = byId("screeningComplianceMarkDoneBtn");
        if (markDoneBtn) {
            markDoneBtn.addEventListener("click", function () {
                saveSelectedInitialScreeningStatus("completed");
            });
        }

        const noShowBtn = byId("screeningComplianceNoShowBtn");
        if (noShowBtn) {
            noShowBtn.addEventListener("click", function () {
                saveSelectedInitialScreeningStatus("no_show");
            });
        }

        const resetBtn = byId("screeningComplianceResetBtn");
        if (resetBtn) {
            resetBtn.addEventListener("click", function () {
                saveSelectedInitialScreeningStatus("not_scheduled");
            });
        }

        const selectAll = byId("screeningComplianceSelectAll");
        if (selectAll) {
            selectAll.addEventListener("change", function () {
                toggleAllVisibleScreeningRows(selectAll.checked);
                renderTable();
            });
        }

        const pagination = byId("screeningCompliancePagination");
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("[data-page]");
                if (!button) {
                    return;
                }
                const requestedPage = Number(button.getAttribute("data-page"));
                if (!Number.isFinite(requestedPage)) {
                    return;
                }
                const totalPages = pageCount(filteredRows.length);
                currentPage = Math.max(1, Math.min(totalPages, requestedPage));
                renderTable();
            });
        }

        const tbody = byId("screeningComplianceTableBody");
        if (tbody) {
            tbody.addEventListener("change", function (event) {
                const checkbox = event.target.closest("[data-screening-check]");
                if (!checkbox) {
                    return;
                }
                toggleScreeningChecked(checkbox.getAttribute("data-screening-check") || "", checkbox.checked === true);
                syncScreeningSelectionMeta();
                syncScreeningSelectAll();
                syncScreeningActionButtons();
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindEvents();
        loadData();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
