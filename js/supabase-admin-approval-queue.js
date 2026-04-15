(function () {
    "use strict";

    const ADMIN_WORKFLOW_STATUSES = [
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

    const FINAL_DECISION_STATUSES = ["approved", "rejected", "for_release", "released"];
    const SETTINGS_STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const DECISION_META = {
        pending: { label: "Pending", chipClass: "ldss-chip-neutral" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" }
    };
    const DEFAULT_WORKFLOW_CONTROLS = {
        allow_special_endorsement: true,
        allow_secretary_applicant_edits: false,
        allow_secretary_special_consideration: false,
        special_consideration_options: []
    };
    const SPECIAL_CONSIDERATION_VIEW = "special_consideration";

    let authContext = null;
    let rows = [];
    let filteredRows = [];
    let isProcessing = false;
    let workflowControls = Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);

    function byId(id) {
        return document.getElementById(id);
    }

    function currentAdminView() {
        try {
            const params = new URLSearchParams(window.location.search || "");
            return (params.get("view") || "").toString().trim().toLowerCase();
        } catch (_error) {
            return "";
        }
    }

    function isSpecialConsiderationView() {
        return currentAdminView() === SPECIAL_CONSIDERATION_VIEW;
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: status || "-", chipClass: "ldss-chip-neutral" }; },
            examSummaryFromRecord: function () {
                return { controlNo: "-", scoreText: "-", percentageText: "-", resultLabel: "Pending", resultChipClass: "ldss-chip-neutral" };
            }
        };
    }

    function readFallbackControls() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
            }
            const parsed = JSON.parse(raw);
            const controls = parsed && parsed.ranking_basis && parsed.ranking_basis.controls
                ? parsed.ranking_basis.controls
                : {};
            return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS, controls);
        } catch (error) {
            return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
        }
    }

    function isMissingTableError(error, tableName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedTable = (tableName || "").toString().trim().toLowerCase();
        return Boolean(normalizedTable) && text.includes(normalizedTable) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
    }

    async function loadWorkflowControls() {
        const fallback = readFallbackControls();
        const result = await authContext.client
            .from("ranking_settings")
            .select("ranking_basis")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                workflowControls = fallback;
                return workflowControls;
            }
            throw new Error("Failed to load workflow controls: " + result.error.message);
        }

        const active = result.data && result.data.length ? result.data[0] : null;
        const controls = active && active.ranking_basis && active.ranking_basis.controls
            ? active.ranking_basis.controls
            : {};
        workflowControls = Object.assign({}, fallback, controls);
        return workflowControls;
    }

    function setWorkflowMeta() {
        const target = byId("adminApprovalWorkflowMeta");
        if (!target) {
            return;
        }
        const specialConsiderationEnabled = workflowControls.allow_secretary_special_consideration === true;
        if (isSpecialConsiderationView()) {
            target.textContent = "Reserved-slot exception flow is "
                + (specialConsiderationEnabled ? "enabled" : "disabled")
                + ". Special Endorsement is "
                + (workflowControls.allow_special_endorsement ? "enabled" : "disabled")
                + " for final review handling.";
            return;
        }
        target.textContent = "Special Endorsement is "
            + (workflowControls.allow_special_endorsement ? "enabled" : "disabled")
            + " by System Administrator. Reserved-slot exception flow is "
            + (specialConsiderationEnabled ? "enabled" : "disabled")
            + ".";
    }

    function hasReservedSlotException(row) {
        return workflowControls.allow_secretary_special_consideration === true
            && Boolean((row && row.special_consideration_tag ? row.special_consideration_tag : "").toString().trim());
    }

    function applyWorkflowVisibility() {
        const batchSelect = byId("adminApprovalBatchAction");
        if (batchSelect) {
            const specialOption = Array.from(batchSelect.options).find(function (option) {
                return option.value === "special_endorsement_review";
            });
            if (specialOption) {
                specialOption.hidden = !workflowControls.allow_special_endorsement;
            }
            if (!workflowControls.allow_special_endorsement && batchSelect.value === "special_endorsement_review") {
                batchSelect.value = "";
            }
        }
        setWorkflowMeta();
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
        const box = byId("adminApprovalStatus");
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
            return "Unknown Applicant";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) { return (value || "").toString().trim(); })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : (profile.email || "Unknown Applicant");
    }

    function priorityClass(priority) {
        const value = (priority || "medium").toString().toLowerCase();
        if (value === "high") {
            return "ldss-queue-high";
        }
        if (value === "low") {
            return "ldss-queue-low";
        }
        return "ldss-queue-medium";
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function decisionMeta(status) {
        return DECISION_META[status] || DECISION_META.pending;
    }

    function latestByApplication(rowsInput) {
        const map = {};
        (rowsInput || []).forEach(function (row) {
            const appId = row.application_id;
            if (!appId) {
                return;
            }
            if (!map[appId]) {
                map[appId] = row;
                return;
            }

            const existingTs = new Date(map[appId].updated_at || map[appId].created_at || 0).getTime();
            const currentTs = new Date(row.updated_at || row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[appId] = row;
            }
        });
        return map;
    }

    function setMetric(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function rankingDisplayValue(score) {
        if (score === null || typeof score === "undefined" || score === "") {
            return "-";
        }
        const numeric = Number(score);
        if (Number.isNaN(numeric)) {
            return score;
        }
        return numeric.toFixed(2);
    }

    function rankingBasisText(record) {
        const basis = record && record.ranking_basis ? record.ranking_basis : null;
        if (!basis) {
            return "";
        }
        if (typeof basis === "string") {
            return basis;
        }
        if (typeof basis === "object" && basis.label) {
            return String(basis.label);
        }
        return "";
    }

    async function fetchApplications() {
        const result = await authContext.client
            .from("applications")
            .select("id, application_no, applicant_id, scholarship_type, school_year, status, submitted_at, created_at, updated_at, is_locked")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

        if (result.error) {
            throw new Error("Failed to load applications: " + result.error.message);
        }

        return result.data || [];
    }

    async function fetchProfiles(applicantIds) {
        if (!applicantIds.length) {
            return {};
        }

        const result = await authContext.client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, email, mobile_number")
            .in("id", applicantIds);

        if (result.error) {
            return {};
        }

        const map = {};
        (result.data || []).forEach(function (row) {
            map[row.id] = row;
        });
        return map;
    }

    async function fetchExamRecords(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const result = await authContext.client
            .from("exam_records")
            .select("id, application_id, exam_control_no, raw_score, percentage_score, result, status, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                return {};
            }
            throw new Error("Failed to load exam records: " + result.error.message);
        }

        return latestByApplication(result.data || []);
    }

    async function fetchInterviewRecords(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        let result = await authContext.client
            .from("interview_records")
            .select("id, application_id, scheduled_at, venue, status, result, hard_copy_verified, hard_copy_verified_at, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (!/does not exist|relation/i.test(result.error.message || "")) {
                throw new Error("Failed to load interview records: " + result.error.message);
            }

            result = await authContext.client
                .from("interviews")
                .select("id, application_id, scheduled_at, venue, status, result, updated_at, created_at")
                .in("application_id", applicationIds);

            if (result.error) {
                return {};
            }

            const fallbackMap = latestByApplication(result.data || []);
            Object.keys(fallbackMap).forEach(function (appId) {
                fallbackMap[appId].hard_copy_verified = false;
                fallbackMap[appId].hard_copy_verified_at = null;
            });
            return fallbackMap;
        }

        return latestByApplication(result.data || []);
    }

    async function fetchApprovalRecords(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        // TODO(Supabase): ranking_score should be written by ranking engine using ranking_settings basis.
        let result = await authContext.client
            .from("approval_records")
            .select("id, application_id, priority, recommendation_status, recommendation_notes, queued_at, decision_status, decision_notes, decided_at, special_endorsement, ranking_score, ranking_basis, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (!/does not exist|relation/i.test(result.error.message || "")) {
                throw new Error("Failed to load approval records: " + result.error.message);
            }

            result = await authContext.client
                .from("approval_queue")
                .select("id, application_id, priority, secretary_recommendation, recommendation_notes, queued_at, decision_status, decision_notes, decided_at, updated_at, created_at")
                .in("application_id", applicationIds);

            if (result.error) {
                return {};
            }

            const fallbackMap = latestByApplication(result.data || []);
            Object.keys(fallbackMap).forEach(function (appId) {
                const row = fallbackMap[appId];
                row.recommendation_status = row.secretary_recommendation || "pending";
                row.special_endorsement = false;
                row.ranking_score = null;
                row.ranking_basis = null;
            });
            return fallbackMap;
        }

        return latestByApplication(result.data || []);
    }

    async function fetchSpecialConsiderationFlags(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const result = await authContext.client
            .from("application_staff_flags")
            .select("application_id, special_consideration_tag, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (isMissingTableError(result.error, "application_staff_flags")) {
                return {};
            }
            throw new Error("Failed to load reserved-slot exception flags: " + result.error.message);
        }

        const map = {};
        (result.data || []).forEach(function (row) {
            const applicationId = row && row.application_id ? row.application_id : "";
            const tag = (row && row.special_consideration_tag ? row.special_consideration_tag : "").toString().trim();
            if (!applicationId || !tag) {
                return;
            }
            map[applicationId] = {
                application_id: applicationId,
                special_consideration_tag: tag,
                updated_at: row.updated_at || row.created_at || null
            };
        });
        return map;
    }

    function isAdminVisible(row) {
        const status = normalizeStatus(row.status);
        return ADMIN_WORKFLOW_STATUSES.includes(status);
    }

    function enrichRows(applications, profilesById, examByApp, interviewByApp, approvalByApp, staffFlagsByApp) {
        return applications
            .filter(isAdminVisible)
            .map(function (app) {
                const profile = profilesById[app.applicant_id] || null;
                const exam = examByApp[app.id] || null;
                const interview = interviewByApp[app.id] || null;
                const approval = approvalByApp[app.id] || null;
                const staffFlags = staffFlagsByApp[app.id] || null;

                return {
                    id: app.id,
                    application_no: app.application_no,
                    applicant_id: app.applicant_id,
                    applicant_name: buildApplicantName(profile),
                    applicant_contact: profile ? (profile.mobile_number || profile.email || "-") : "-",
                    scholarship_type: app.scholarship_type,
                    school_year: app.school_year,
                    status: app.status,
                    is_locked: Boolean(app.is_locked),
                    submitted_at: app.submitted_at,
                    updated_at: app.updated_at || app.created_at,
                    special_consideration_tag: staffFlags && staffFlags.special_consideration_tag ? staffFlags.special_consideration_tag : "",
                    exam: exam,
                    interview: interview,
                    approval: approval
                };
            })
            .sort(function (a, b) {
                const aRank = a.approval && a.approval.ranking_score !== null && typeof a.approval.ranking_score !== "undefined"
                    ? Number(a.approval.ranking_score)
                    : -1;
                const bRank = b.approval && b.approval.ranking_score !== null && typeof b.approval.ranking_score !== "undefined"
                    ? Number(b.approval.ranking_score)
                    : -1;

                if (bRank !== aRank) {
                    return bRank - aRank;
                }
                return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
            });
    }

    function renderKpis() {
        setMetric("adminQueueForApprovalCount", rows.filter(function (row) { return normalizeStatus(row.status) === "for_approval"; }).length);
        setMetric("adminQueueFailedExamCount", rows.filter(function (row) { return normalizeStatus(row.status) === "failed_exam"; }).length);
        setMetric("adminQueueSpecialReviewCount", rows.filter(function (row) { return normalizeStatus(row.status) === "special_endorsement_review"; }).length);
        setMetric("adminQueueWaitlistedCount", rows.filter(function (row) { return normalizeStatus(row.status) === "waitlisted"; }).length);
    }

    function applyInitialPageMode() {
        const title = byId("adminApprovalPageTitle");
        const subtitle = byId("adminApprovalPageSubtitle");
        const breadcrumb = byId("adminApprovalBreadcrumbLabel");
        const workflowMeta = byId("adminApprovalWorkflowMeta");
        const headerActions = byId("adminApprovalHeaderActions");
        const shell = byId("adminSpecialConsiderationShell");
        const workspace = byId("adminApprovalWorkspace");
        const statusFilter = byId("adminApprovalStatusFilter");
        const decisionFilter = byId("adminApprovalDecisionFilter");
        const searchInput = byId("adminApprovalSearchInput");

        if (!isSpecialConsiderationView()) {
            return;
        }

        if (title) {
            title.innerHTML = '<div class="page-header-icon"><i data-feather="bookmark"></i></div>Special Consideration';
        }
        if (subtitle) {
            subtitle.textContent = "Workspace cleared and ready for your next Special Consideration instructions.";
        }
        if (breadcrumb) {
            breadcrumb.textContent = "Special Consideration";
        }
        if (workflowMeta) {
            workflowMeta.textContent = "";
            workflowMeta.classList.add("d-none");
        }
        if (headerActions) {
            headerActions.classList.add("d-none");
        }
        if (shell) {
            shell.classList.remove("d-none");
        }
        if (workspace) {
            workspace.classList.add("d-none");
        }
        if (statusFilter) {
            statusFilter.value = "special_endorsement_review";
        }
        if (decisionFilter) {
            decisionFilter.value = "all";
        }
        if (searchInput) {
            searchInput.value = "";
        }
    }

    function applyFilterRows() {
        const search = (byId("adminApprovalSearchInput") ? byId("adminApprovalSearchInput").value : "").toLowerCase().trim();
        const statusFilter = byId("adminApprovalStatusFilter") ? byId("adminApprovalStatusFilter").value : "all";
        const decisionFilter = byId("adminApprovalDecisionFilter") ? byId("adminApprovalDecisionFilter").value : "all";

        return rows.filter(function (row) {
            const status = normalizeStatus(row.status);
            const decision = (row.approval && row.approval.decision_status ? row.approval.decision_status : "pending").toString().toLowerCase();
            const examControl = row.exam && row.exam.exam_control_no ? row.exam.exam_control_no : "";
            const searchText = [
                row.application_no || "",
                row.applicant_name || "",
                row.applicant_contact || "",
                examControl || "",
                row.scholarship_type || "",
                row.school_year || "",
                row.special_consideration_tag || ""
            ].join(" ").toLowerCase();

            const matchesSearch = !search || searchText.includes(search);
            const matchesStatus = statusFilter === "all" || status === statusFilter;
            const matchesDecision = decisionFilter === "all" || decision === decisionFilter;
            return matchesSearch && matchesStatus && matchesDecision;
        });
    }

    function isStatusFinal(row) {
        return FINAL_DECISION_STATUSES.includes(normalizeStatus(row.status));
    }

    function rowActionButtons(row) {
        const status = normalizeStatus(row.status);
        const isFinal = isStatusFinal(row);
        const buttons = [];
        const allowSpecialEndorsement = workflowControls.allow_special_endorsement !== false;
        const isFailedExam = status === "failed_exam";
        const hasSpecialConsideration = hasReservedSlotException(row);

        if (!isFinal) {
            if (!isFailedExam || hasSpecialConsideration) {
                buttons.push('<button class="btn btn-sm btn-dark" type="button" data-row-action="approved" data-app-id="' + escapeHtml(row.id) + '">Approve</button>');
                buttons.push('<button class="btn btn-sm btn-outline-dark" type="button" data-row-action="waitlisted" data-app-id="' + escapeHtml(row.id) + '">Waitlist</button>');
            }
            buttons.push('<button class="btn btn-sm btn-outline-secondary" type="button" data-row-action="rejected" data-app-id="' + escapeHtml(row.id) + '">Reject</button>');
        }

        if (isFailedExam && allowSpecialEndorsement && !hasSpecialConsideration) {
            buttons.push('<button class="btn btn-sm btn-outline-dark" type="button" data-row-action="special_endorsement_review" data-app-id="' + escapeHtml(row.id) + '">Special Endorsement Review</button>');
        }
        if (isFailedExam && !allowSpecialEndorsement && !hasSpecialConsideration) {
            buttons.push('<span class="small text-muted">Special endorsement is off.</span>');
        }
        if (isFailedExam && hasSpecialConsideration) {
            buttons.push('<span class="small text-success">Eligible for final review.</span>');
        }

        if (!buttons.length) {
            return '<span class="small text-muted">No action</span>';
        }

        return '<div class="d-flex flex-wrap gap-1">' + buttons.join("") + "</div>";
    }

    function renderTable() {
        const tbody = byId("adminApprovalQueueBody");
        if (!tbody) {
            return;
        }

        if (!filteredRows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No approval records match current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = filteredRows.map(function (row) {
            const appStatus = statusMeta(row.status);
            const exam = workflow().examSummaryFromRecord(row.exam);
            const interview = row.interview || {};
            const decision = decisionMeta(row.approval && row.approval.decision_status ? row.approval.decision_status : "pending");
            const priority = row.approval && row.approval.priority ? row.approval.priority : "medium";
            const recommendation = row.approval && row.approval.recommendation_status
                ? row.approval.recommendation_status
                : "pending";
            const rankingBasis = rankingBasisText(row.approval);
            const specialConsiderationTag = hasReservedSlotException(row);
            const specialConsiderationMarkup = specialConsiderationTag
                ? '<div class="mt-1"><span class="ldss-chip ldss-chip-success">Final Review Eligible</span></div>'
                : "";

            const interviewStatus = interview.status
                ? interview.status.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); })
                : "Not Scheduled";
            const interviewHardCopyLabel = interview.hard_copy_verified ? "Verified" : "Pending";
            const interviewHardCopyClass = interview.hard_copy_verified ? "ldss-chip-success" : "ldss-chip-neutral";

            return (
                "<tr>" +
                '<td><input type="checkbox" data-admin-queue-id="' + escapeHtml(row.id) + '" /></td>' +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.application_no || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_contact || "-") + "</div>" +
                '<div class="small mt-1">' + escapeHtml((row.scholarship_type || "-") + " | " + (row.school_year || "-")) + "</div>" +
                '<div class="mt-1"><span class="ldss-chip ' + appStatus.chipClass + '">' + escapeHtml(appStatus.label) + "</span></div>" +
                specialConsiderationMarkup +
                "</td>" +
                "<td>" +
                '<div class="small"><strong>Control No:</strong> ' + escapeHtml(exam.controlNo || "-") + "</div>" +
                '<div class="small"><strong>Raw Score:</strong> ' + escapeHtml(exam.scoreText || "-") + "</div>" +
                '<div class="small"><strong>Percentage:</strong> ' + escapeHtml(exam.percentageText || "-") + "</div>" +
                '<div class="mt-1"><span class="ldss-chip ' + escapeHtml(exam.resultChipClass || "ldss-chip-neutral") + '">' + escapeHtml(exam.resultLabel || "Pending") + "</span></div>" +
                "</td>" +
                "<td>" +
                '<div class="small"><strong>Schedule:</strong> ' + escapeHtml(formatDateTime(interview.scheduled_at)) + "</div>" +
                '<div class="small"><strong>Venue:</strong> ' + escapeHtml(interview.venue || "-") + "</div>" +
                '<div class="small"><strong>Status:</strong> ' + escapeHtml(interviewStatus) + "</div>" +
                '<div class="mt-1"><span class="ldss-chip ' + interviewHardCopyClass + '">Hard Copy ' + escapeHtml(interviewHardCopyLabel) + "</span></div>" +
                "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(rankingDisplayValue(row.approval && row.approval.ranking_score)) + "</div>" +
                (rankingBasis ? '<div class="small text-muted">' + escapeHtml(rankingBasis) + "</div>" : '<div class="small text-muted">Pending ranking settings</div>') +
                "</td>" +
                "<td>" +
                '<div class="small"><span class="ldss-queue-priority ' + priorityClass(priority) + '">' + escapeHtml(priority.toUpperCase()) + "</span></div>" +
                '<div class="small mt-1"><strong>Recommendation:</strong> ' + escapeHtml(recommendation.replace(/_/g, " ")) + "</div>" +
                '<div class="small mt-1"><span class="ldss-chip ' + decision.chipClass + '">' + escapeHtml(decision.label) + "</span></div>" +
                '<div class="small text-muted mt-1">Queued: ' + escapeHtml(formatDate(row.approval && row.approval.queued_at)) + "</div>" +
                "</td>" +
                "<td>" + rowActionButtons(row) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function applyFiltersAndRender() {
        filteredRows = applyFilterRows();
        renderTable();
    }

    function getRowById(applicationId) {
        return rows.find(function (row) {
            return row.id === applicationId;
        }) || null;
    }

    function actionConfig(action) {
        if (action === "approved") {
            return {
                targetStatus: "approved",
                decisionStatus: "approved",
                notifyTitle: "Application Approved",
                notifyMessage: "Your scholarship application was approved."
            };
        }
        if (action === "waitlisted") {
            return {
                targetStatus: "waitlisted",
                decisionStatus: "waitlisted",
                notifyTitle: "Application Waitlisted",
                notifyMessage: "Your scholarship application is currently waitlisted due to slot limits."
            };
        }
        if (action === "rejected") {
            return {
                targetStatus: "rejected",
                decisionStatus: "rejected",
                notifyTitle: "Application Result Updated",
                notifyMessage: "Your scholarship application result is now available in your dashboard."
            };
        }
        if (action === "special_endorsement_review") {
            return {
                targetStatus: "special_endorsement_review",
                decisionStatus: "pending",
                notifyTitle: "Special Endorsement Review",
                notifyMessage: "Your application is under Special Endorsement Review."
            };
        }
        return null;
    }

    async function updateApplication(row, config) {
        const payload = {
            status: config.targetStatus,
            admin_reviewer_id: authContext.user.id
        };

        const result = await authContext.client
            .from("applications")
            .update(payload)
            .eq("id", row.id);

        if (result.error) {
            throw new Error("Failed to update application status: " + result.error.message);
        }
    }

    async function upsertApprovalRecord(row, action, notes, config) {
        const nowIso = new Date().toISOString();
        const requiresDecisionTimestamp = ["approved", "waitlisted", "rejected"].includes(action);
        const currentApproval = row.approval || {};
        const hasSpecialConsideration = hasReservedSlotException(row);

        const payload = {
            application_id: row.id,
            priority: currentApproval.priority || "medium",
            recommendation_status: currentApproval.recommendation_status || ((action === "special_endorsement_review" || hasSpecialConsideration) ? "special_endorsement_review" : "pending"),
            recommendation_notes: currentApproval.recommendation_notes || null,
            queued_at: currentApproval.queued_at || nowIso,
            decision_status: config.decisionStatus,
            decision_notes: notes || null,
            decided_by: requiresDecisionTimestamp ? authContext.user.id : null,
            decided_at: requiresDecisionTimestamp ? nowIso : null,
            special_endorsement: action === "special_endorsement_review" || hasSpecialConsideration || Boolean(currentApproval.special_endorsement),
            ranking_score: currentApproval.ranking_score == null ? null : currentApproval.ranking_score,
            ranking_basis: currentApproval.ranking_basis || null
        };

        let result = await authContext.client
            .from("approval_records")
            .upsert(payload, { onConflict: "application_id" });

        if (result.error) {
            const fallbackPayload = {
                application_id: row.id,
                priority: payload.priority,
                secretary_recommendation: payload.recommendation_status,
                recommendation_notes: payload.recommendation_notes,
                queued_at: payload.queued_at,
                decision_status: payload.decision_status,
                decision_notes: payload.decision_notes,
                decided_by: payload.decided_by,
                decided_at: payload.decided_at
            };

            result = await authContext.client
                .from("approval_queue")
                .upsert(fallbackPayload, { onConflict: "application_id" });
        }

        if (result.error) {
            throw new Error("Failed to save approval record: " + result.error.message);
        }
    }

    async function notifyApplicant(row, config) {
        if (!row.applicant_id) {
            return;
        }

        const payload = {
            recipient_user_id: row.applicant_id,
            sender_user_id: authContext.user.id,
            notification_type: "approval",
            title: config.notifyTitle,
            message: config.notifyMessage,
            related_application_id: row.id,
            related_url: "application-detail.html?id=" + encodeURIComponent(row.id)
        };

        const result = await authContext.client.from("notifications").insert(payload);
        if (result.error) {
            throw new Error("Decision saved but notification failed: " + result.error.message);
        }
    }

    async function executeAction(row, action, notes) {
        const config = actionConfig(action);
        if (!config) {
            throw new Error("Unsupported action.");
        }

        if (action === "special_endorsement_review" && workflowControls.allow_special_endorsement === false) {
            throw new Error("Special Endorsement is currently disabled in System Administrator settings.");
        }

        if (normalizeStatus(row.status) === "failed_exam" && ["approved", "waitlisted"].includes(action) && !hasReservedSlotException(row)) {
            throw new Error("Failed exam records must go through Special Endorsement Review before approval or waitlist.");
        }

        await updateApplication(row, config);
        await upsertApprovalRecord(row, action, notes, config);
        await notifyApplicant(row, config);
    }

    async function loadData() {
        showStatus("");
        await loadWorkflowControls();
        applyWorkflowVisibility();

        const applications = await fetchApplications();
        const applicationIds = applications.map(function (row) { return row.id; }).filter(Boolean);
        const applicantIds = Array.from(new Set(applications.map(function (row) { return row.applicant_id; }).filter(Boolean)));

        const loaded = await Promise.all([
            fetchProfiles(applicantIds),
            fetchExamRecords(applicationIds),
            fetchInterviewRecords(applicationIds),
            fetchApprovalRecords(applicationIds),
            fetchSpecialConsiderationFlags(applicationIds)
        ]);

        rows = enrichRows(applications, loaded[0], loaded[1], loaded[2], loaded[3], loaded[4]);
        renderKpis();
        applyFiltersAndRender();
    }

    function selectedApplicationIds() {
        return Array.from(document.querySelectorAll("#adminApprovalQueueBody [data-admin-queue-id]:checked"))
            .map(function (input) { return input.getAttribute("data-admin-queue-id") || ""; })
            .filter(Boolean);
    }

    async function runSingleAction(applicationId, action) {
        if (isProcessing) {
            return;
        }

        const row = getRowById(applicationId);
        if (!row) {
            showStatus("Selected application was not found.", "alert-warning");
            return;
        }

        const notes = window.prompt("Decision notes (optional):", "");
        if (notes === null) {
            return;
        }

        const trimmedNotes = notes.trim();
        const needsAuditNote = action === "special_endorsement_review" || normalizeStatus(row.status) === "special_endorsement_review";
        if (needsAuditNote && !trimmedNotes) {
            showStatus("Decision notes are required for Special Endorsement actions.", "alert-warning");
            return;
        }

        isProcessing = true;
        showStatus("");
        try {
            await executeAction(row, action, trimmedNotes);
            await loadData();
            showStatus("Decision applied successfully.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Decision failed.", "alert-danger");
        } finally {
            isProcessing = false;
        }
    }

    async function runBatchAction() {
        if (isProcessing) {
            return;
        }

        const action = byId("adminApprovalBatchAction") ? byId("adminApprovalBatchAction").value : "";
        const notes = byId("adminApprovalBatchNotes") ? byId("adminApprovalBatchNotes").value.trim() : "";
        const ids = selectedApplicationIds();

        if (!action) {
            showStatus("Select a batch action first.", "alert-warning");
            return;
        }
        if (action === "special_endorsement_review" && workflowControls.allow_special_endorsement === false) {
            showStatus("Special Endorsement is currently disabled in System Administrator settings.", "alert-warning");
            return;
        }
        if (!ids.length) {
            showStatus("Select at least one record from the queue table.", "alert-warning");
            return;
        }
        if (action === "special_endorsement_review" && !notes) {
            showStatus("Batch decision notes are required for Special Endorsement Review.", "alert-warning");
            return;
        }

        isProcessing = true;
        showStatus("");

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < ids.length; i += 1) {
            const row = getRowById(ids[i]);
            if (!row) {
                failCount += 1;
                continue;
            }
            try {
                if (normalizeStatus(row.status) === "failed_exam" && ["approved", "waitlisted"].includes(action) && !hasReservedSlotException(row)) {
                    throw new Error("Failed exam records must go through Special Endorsement Review first.");
                }
                if (normalizeStatus(row.status) === "special_endorsement_review" && !notes) {
                    throw new Error("Decision notes are required for Special Endorsement actions.");
                }
                await executeAction(row, action, notes);
                successCount += 1;
            } catch (error) {
                failCount += 1;
            }
        }

        await loadData();
        if (failCount > 0) {
            showStatus("Batch update finished: " + successCount + " success, " + failCount + " failed.", "alert-warning");
        } else {
            showStatus("Batch update finished: " + successCount + " record(s) updated.", "alert-success");
        }
        isProcessing = false;
    }

    function bindEvents() {
        const applyFilterBtn = byId("adminApprovalApplyFilterBtn");
        const searchInput = byId("adminApprovalSearchInput");
        const statusFilter = byId("adminApprovalStatusFilter");
        const decisionFilter = byId("adminApprovalDecisionFilter");
        const refreshBtn = byId("adminApprovalRefreshBtn");
        const openBatchBtn = byId("adminApprovalOpenBatchBtn");
        const batchApplyBtn = byId("adminApprovalBatchApplyBtn");
        const selectAll = byId("adminApprovalSelectAll");
        const tbody = byId("adminApprovalQueueBody");

        if (applyFilterBtn) {
            applyFilterBtn.addEventListener("click", function () {
                applyFiltersAndRender();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFiltersAndRender();
                }
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", function () {
                applyFiltersAndRender();
            });
        }

        if (decisionFilter) {
            decisionFilter.addEventListener("change", function () {
                applyFiltersAndRender();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                loadData().catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh queue.", "alert-danger");
                });
            });
        }

        if (openBatchBtn) {
            openBatchBtn.addEventListener("click", function () {
                const select = byId("adminApprovalBatchAction");
                if (select) {
                    select.focus();
                }
                window.scrollTo({ top: 0, behavior: "smooth" });
            });
        }

        if (batchApplyBtn) {
            batchApplyBtn.addEventListener("click", function () {
                runBatchAction();
            });
        }

        if (selectAll) {
            selectAll.addEventListener("change", function () {
                const checked = Boolean(selectAll.checked);
                document.querySelectorAll("#adminApprovalQueueBody [data-admin-queue-id]").forEach(function (input) {
                    input.checked = checked;
                });
            });
        }

        if (tbody) {
            tbody.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-row-action]");
                if (!trigger) {
                    return;
                }
                const action = trigger.getAttribute("data-row-action") || "";
                const applicationId = trigger.getAttribute("data-app-id") || "";
                if (!action || !applicationId) {
                    return;
                }
                runSingleAction(applicationId, action);
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        applyInitialPageMode();
        if (window.feather && typeof window.feather.replace === "function") {
            window.feather.replace();
        }
        if (isSpecialConsiderationView()) {
            return;
        }
        bindEvents();
        try {
            await loadData();
            if (window.feather && typeof window.feather.replace === "function") {
                window.feather.replace();
            }
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load approval queue.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
