(function () {
    "use strict";

    const VISIBLE_STATUSES = [
        "hard_copy_verified",
        "for_approval",
        "special_endorsement_review",
        "approved",
        "waitlisted",
        "rejected",
        "for_release",
        "released"
    ];
    const FINAL_APPLICATION_STATUSES = ["approved", "waitlisted", "rejected", "for_release", "released"];
    const PRIORITY_OPTIONS = ["high", "medium", "low"];
    const RECOMMENDATION_OPTIONS = ["pending", "approved", "waitlisted", "rejected"];
    const STATUS_META = {
        hard_copy_verified: { label: "Ready to Endorse", chipClass: "ldss-chip-success" },
        for_approval: { label: "For Approval", chipClass: "ldss-chip-accent" },
        special_endorsement_review: { label: "Special Review", chipClass: "ldss-chip-accent" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        for_release: { label: "For Release", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };
    const DECISION_META = {
        pending: { label: "Pending", chipClass: "ldss-chip-neutral" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" }
    };

    let authContext = null;
    let rows = [];
    let filteredRows = [];
    let isProcessing = false;

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

    function normalizeStatus(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    function showStatus(message, type) {
        const box = byId("secretaryRecommendationsStatus");
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

    function statusMeta(status) {
        return STATUS_META[normalizeStatus(status)] || { label: status || "-", chipClass: "ldss-chip-neutral" };
    }

    function decisionMeta(status) {
        return DECISION_META[normalizeStatus(status)] || DECISION_META.pending;
    }

    function priorityClass(priority) {
        const value = normalizeStatus(priority || "medium");
        if (value === "high") {
            return "ldss-queue-high";
        }
        if (value === "low") {
            return "ldss-queue-low";
        }
        return "ldss-queue-medium";
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

    function setMetric(id, value) {
        const node = byId(id);
        if (node) {
            node.textContent = String(value);
        }
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

    function interviewResultLabel(result) {
        const normalized = normalizeStatus(result || "pending");
        if (normalized === "recommended") {
            return "Recommended";
        }
        if (normalized === "waitlisted") {
            return "Waitlisted";
        }
        if (normalized === "not_recommended") {
            return "Not Recommended";
        }
        return "Pending";
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

        return (result.data || []).filter(function (row) {
            return VISIBLE_STATUSES.includes(normalizeStatus(row.status));
        });
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

    async function fetchApprovalQueue(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const result = await authContext.client
            .from("approval_queue")
            .select("id, application_id, priority, secretary_recommendation, recommendation_notes, queued_at, decision_status, decision_notes, decided_at, updated_at, created_at")
            .in("application_id", applicationIds);

        if (result.error) {
            throw new Error("Failed to load secretary queue data: " + result.error.message);
        }

        return latestByApplication(result.data || []);
    }

    function enrichRows(applications, profilesById, interviewsByApp, queueByApp) {
        return applications.map(function (application) {
            const profile = profilesById[application.applicant_id] || null;
            const interview = interviewsByApp[application.id] || null;
            const queue = queueByApp[application.id] || null;

            return {
                id: application.id,
                application_no: application.application_no,
                applicant_id: application.applicant_id,
                applicant_name: buildApplicantName(profile),
                applicant_contact: profile ? (profile.mobile_number || profile.email || "-") : "-",
                scholarship_type: application.scholarship_type || "-",
                school_year: application.school_year || "-",
                status: application.status,
                updated_at: application.updated_at || application.created_at,
                interview: interview,
                queue: queue
            };
        });
    }

    function renderKpis() {
        setMetric("secretaryRecommendationsReadyCount", rows.filter(function (row) {
            return normalizeStatus(row.status) === "hard_copy_verified";
        }).length);
        setMetric("secretaryRecommendationsForApprovalCount", rows.filter(function (row) {
            return normalizeStatus(row.status) === "for_approval";
        }).length);
        setMetric("secretaryRecommendationsSpecialCount", rows.filter(function (row) {
            return normalizeStatus(row.status) === "special_endorsement_review";
        }).length);
        setMetric("secretaryRecommendationsFinalCount", rows.filter(function (row) {
            return FINAL_APPLICATION_STATUSES.includes(normalizeStatus(row.status));
        }).length);
    }

    function applyFilters() {
        const search = (byId("secretaryRecommendationsSearchInput") ? byId("secretaryRecommendationsSearchInput").value : "").toLowerCase().trim();
        const statusFilter = byId("secretaryRecommendationsStatusFilter") ? byId("secretaryRecommendationsStatusFilter").value : "all";
        const decisionFilter = byId("secretaryRecommendationsDecisionFilter") ? byId("secretaryRecommendationsDecisionFilter").value : "all";
        const priorityFilter = byId("secretaryRecommendationsPriorityFilter") ? byId("secretaryRecommendationsPriorityFilter").value : "all";

        return rows.filter(function (row) {
            const status = normalizeStatus(row.status);
            const decision = normalizeStatus(row.queue && row.queue.decision_status ? row.queue.decision_status : "pending");
            const priority = normalizeStatus(row.queue && row.queue.priority ? row.queue.priority : "medium");
            const haystack = [
                row.application_no || "",
                row.applicant_name || "",
                row.applicant_contact || "",
                row.scholarship_type || "",
                row.school_year || ""
            ].join(" ").toLowerCase();

            const matchesSearch = !search || haystack.includes(search);
            const matchesStatus = statusFilter === "all" || status === statusFilter;
            const matchesDecision = decisionFilter === "all" || decision === decisionFilter;
            const matchesPriority = priorityFilter === "all" || priority === priorityFilter;
            return matchesSearch && matchesStatus && matchesDecision && matchesPriority;
        });
    }

    function rowIsEditable(row) {
        const status = normalizeStatus(row.status);
        const decision = normalizeStatus(row.queue && row.queue.decision_status ? row.queue.decision_status : "pending");
        return !FINAL_APPLICATION_STATUSES.includes(status) && decision === "pending";
    }

    function priorityOptionsMarkup(selected) {
        return PRIORITY_OPTIONS.map(function (option) {
            return '<option value="' + option + '"' + (normalizeStatus(selected) === option ? " selected" : "") + ">" + option.toUpperCase() + "</option>";
        }).join("");
    }

    function recommendationOptionsMarkup(selected) {
        return RECOMMENDATION_OPTIONS.map(function (option) {
            const label = option === "pending"
                ? "Pending"
                : (option === "approved" ? "Approved" : (option === "waitlisted" ? "Waitlisted" : "Rejected"));
            return '<option value="' + option + '"' + (normalizeStatus(selected) === option ? " selected" : "") + ">" + label + "</option>";
        }).join("");
    }

    function renderTable() {
        const tbody = byId("secretaryRecommendationsBody");
        if (!tbody) {
            return;
        }

        if (!filteredRows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No recommendation records match current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = filteredRows.map(function (row) {
            const status = statusMeta(row.status);
            const decision = decisionMeta(row.queue && row.queue.decision_status ? row.queue.decision_status : "pending");
            const recommendation = normalizeStatus(row.queue && row.queue.secretary_recommendation ? row.queue.secretary_recommendation : "pending");
            const priority = normalizeStatus(row.queue && row.queue.priority ? row.queue.priority : "medium");
            const notes = row.queue && row.queue.recommendation_notes ? row.queue.recommendation_notes : "";
            const interview = row.interview || {};
            const editable = rowIsEditable(row);
            const hardCopyVerified = Boolean(interview.hard_copy_verified || normalizeStatus(row.status) === "hard_copy_verified" || normalizeStatus(row.status) === "for_approval");
            const hardCopyChipClass = hardCopyVerified ? "ldss-chip-success" : "ldss-chip-neutral";
            const hardCopyLabel = hardCopyVerified ? "Verified" : "Pending";
            const queueUpdatedLabel = row.queue && row.queue.queued_at ? formatDate(row.queue.queued_at) : "Not yet queued";
            const decisionNotes = row.queue && row.queue.decision_notes ? row.queue.decision_notes : "";

            return (
                "<tr>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.application_no || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_contact || "-") + "</div>" +
                '<div class="small mt-1">' + escapeHtml((row.scholarship_type || "-") + " | " + (row.school_year || "-")) + "</div>" +
                '<div class="mt-1"><span class="ldss-chip ' + status.chipClass + '">' + escapeHtml(status.label) + "</span></div>" +
                "</td>" +
                "<td>" +
                '<div class="small"><strong>Schedule:</strong> ' + escapeHtml(formatDateTime(interview.scheduled_at)) + "</div>" +
                '<div class="small"><strong>Venue:</strong> ' + escapeHtml(interview.venue || "-") + "</div>" +
                '<div class="small"><strong>Interview Result:</strong> ' + escapeHtml(interviewResultLabel(interview.result)) + "</div>" +
                '<div class="mt-1"><span class="ldss-chip ' + hardCopyChipClass + '">Hard Copy ' + escapeHtml(hardCopyLabel) + "</span></div>" +
                "</td>" +
                "<td>" +
                '<div class="mb-2"><span class="small fw-600 text-uppercase text-muted">Priority</span>' +
                '<select class="form-select form-select-sm mt-1" data-recommend-priority="' + escapeHtml(row.id) + '"' + (editable ? "" : " disabled") + ">" + priorityOptionsMarkup(priority) + "</select></div>" +
                '<div class="mb-2"><span class="small fw-600 text-uppercase text-muted">Recommendation</span>' +
                '<select class="form-select form-select-sm mt-1" data-recommend-decision="' + escapeHtml(row.id) + '"' + (editable ? "" : " disabled") + ">" + recommendationOptionsMarkup(recommendation) + "</select></div>" +
                '<div><span class="small fw-600 text-uppercase text-muted">Notes</span>' +
                '<input class="form-control form-control-sm mt-1" data-recommend-notes="' + escapeHtml(row.id) + '" type="text" value="' + escapeHtml(notes) + '" placeholder="Secretary remarks for admin"' + (editable ? "" : " disabled") + " /></div>" +
                '<div class="small text-muted mt-2">Queued: ' + escapeHtml(queueUpdatedLabel) + "</div>" +
                '<div class="small mt-1"><span class="ldss-queue-priority ' + priorityClass(priority) + '">' + escapeHtml(priority.toUpperCase()) + "</span></div>" +
                "</td>" +
                "<td>" +
                '<div><span class="ldss-chip ' + decision.chipClass + '">' + escapeHtml(decision.label) + "</span></div>" +
                '<div class="small text-muted mt-1">Decided: ' + escapeHtml(formatDate(row.queue && row.queue.decided_at)) + "</div>" +
                '<div class="small mt-2">' + escapeHtml(decisionNotes || "No admin decision notes yet.") + "</div>" +
                "</td>" +
                "<td>" +
                '<div class="d-flex flex-wrap gap-1">' +
                '<button class="btn btn-sm btn-dark" type="button" data-row-action="save" data-app-id="' + escapeHtml(row.id) + '"' + (editable ? "" : " disabled") + ">Save</button>" +
                '<a class="btn btn-sm btn-outline-dark" href="secretary-interview-verification.html?id=' + encodeURIComponent(row.id) + '">Verification</a>' +
                '<a class="btn btn-sm btn-outline-secondary" href="secretary-print-form.html?id=' + encodeURIComponent(row.id) + '">Print</a>' +
                "</div>" +
                "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function applyFiltersAndRender() {
        filteredRows = applyFilters();
        renderTable();
    }

    function getRowById(applicationId) {
        return rows.find(function (row) {
            return row.id === applicationId;
        }) || null;
    }

    function readRowValues(applicationId) {
        const priorityInput = document.querySelector('[data-recommend-priority="' + applicationId + '"]');
        const recommendationInput = document.querySelector('[data-recommend-decision="' + applicationId + '"]');
        const notesInput = document.querySelector('[data-recommend-notes="' + applicationId + '"]');

        const priority = normalizeStatus(priorityInput ? priorityInput.value : "medium");
        const recommendation = normalizeStatus(recommendationInput ? recommendationInput.value : "pending");
        const notes = notesInput ? notesInput.value.trim() : "";

        if (!PRIORITY_OPTIONS.includes(priority)) {
            throw new Error("Invalid priority value.");
        }
        if (!RECOMMENDATION_OPTIONS.includes(recommendation)) {
            throw new Error("Invalid recommendation value.");
        }

        return {
            priority: priority,
            recommendation: recommendation,
            notes: notes
        };
    }

    async function updateApplicationForEndorsement(row, values) {
        if (normalizeStatus(row.status) !== "hard_copy_verified" || values.recommendation === "pending") {
            return false;
        }
        if (!values.notes || values.notes.length < 10) {
            throw new Error("Add recommendation remarks with at least 10 characters before endorsing to admin.");
        }

        const result = await authContext.client
            .from("applications")
            .update({
                status: "for_approval",
                is_locked: true,
                secretary_reviewer_id: authContext.user.id,
                secretary_remarks: values.notes
            })
            .eq("id", row.id);

        if (result.error) {
            throw new Error("Queue saved but application endorsement failed: " + result.error.message);
        }

        return true;
    }

    async function notifyApplicant(row, values) {
        if (!row.applicant_id) {
            return;
        }

        const recommendationText = values.recommendation === "approved"
            ? "approved"
            : (values.recommendation === "waitlisted" ? "waitlisted" : "rejected");

        const payload = {
            recipient_user_id: row.applicant_id,
            sender_user_id: authContext.user.id,
            notification_type: "approval",
            title: "Application Endorsed to Admin",
            message: "Your application has been endorsed to admin with secretary recommendation: " + recommendationText + ".",
            related_application_id: row.id,
            related_url: "application-detail.html?id=" + encodeURIComponent(row.id)
        };

        const result = await authContext.client
            .from("notifications")
            .insert(payload);

        if (result.error) {
            throw new Error("Queue saved but applicant notification failed: " + result.error.message);
        }
    }

    async function upsertQueueData(row, values) {
        const existingQueue = row.queue || {};
        const queuedAt = existingQueue.queued_at || new Date().toISOString();
        const decisionStatus = existingQueue.decision_status || "pending";
        const decisionNotes = existingQueue.decision_notes || null;
        const decidedAt = existingQueue.decided_at || null;

        const approvalRecordPayload = {
            application_id: row.id,
            priority: values.priority,
            recommendation_status: values.recommendation,
            recommendation_notes: values.notes || null,
            queued_at: queuedAt,
            decision_status: decisionStatus,
            decision_notes: decisionNotes,
            decided_at: decidedAt,
            special_endorsement: normalizeStatus(row.status) === "special_endorsement_review"
        };

        const approvalRecordResult = await authContext.client
            .from("approval_records")
            .upsert(approvalRecordPayload, { onConflict: "application_id" });

        if (approvalRecordResult.error) {
            throw new Error("Failed to update admin approval record: " + approvalRecordResult.error.message);
        }

        const queuePayload = {
            application_id: row.id,
            priority: values.priority,
            secretary_recommendation: values.recommendation,
            recommendation_notes: values.notes || null,
            queued_at: queuedAt,
            decision_status: decisionStatus,
            decision_notes: decisionNotes,
            decided_at: decidedAt
        };

        const queueResult = await authContext.client
            .from("approval_queue")
            .upsert(queuePayload, { onConflict: "application_id" });

        if (queueResult.error) {
            throw new Error("Failed to update secretary queue record: " + queueResult.error.message);
        }
    }

    async function saveRow(applicationId) {
        const row = getRowById(applicationId);
        if (!row) {
            showStatus("Selected recommendation row was not found.", "alert-warning");
            return;
        }
        if (!rowIsEditable(row)) {
            showStatus("This record is already finalized and can no longer be changed by Secretary.", "alert-warning");
            return;
        }

        const values = readRowValues(applicationId);
        const willEndorse = normalizeStatus(row.status) === "hard_copy_verified" && values.recommendation !== "pending";

        if (willEndorse && (!values.notes || values.notes.length < 10)) {
            showStatus("Add recommendation remarks with at least 10 characters before endorsing to admin.", "alert-warning");
            return;
        }

        await upsertQueueData(row, values);

        if (await updateApplicationForEndorsement(row, values)) {
            await notifyApplicant(row, values);
        }
    }

    async function loadData() {
        const applications = await fetchApplications();
        const applicationIds = applications.map(function (row) { return row.id; }).filter(Boolean);
        const applicantIds = Array.from(new Set(applications.map(function (row) { return row.applicant_id; }).filter(Boolean)));

        const loaded = await Promise.all([
            fetchProfiles(applicantIds),
            fetchInterviewRecords(applicationIds),
            fetchApprovalQueue(applicationIds)
        ]);

        rows = enrichRows(applications, loaded[0], loaded[1], loaded[2]);
        rows.sort(function (a, b) {
            return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
        });

        renderKpis();
        applyFiltersAndRender();
    }

    function bindEvents() {
        const refreshBtn = byId("secretaryRecommendationsRefreshBtn");
        const searchInput = byId("secretaryRecommendationsSearchInput");
        const statusFilter = byId("secretaryRecommendationsStatusFilter");
        const decisionFilter = byId("secretaryRecommendationsDecisionFilter");
        const priorityFilter = byId("secretaryRecommendationsPriorityFilter");
        const tableBody = byId("secretaryRecommendationsBody");

        [searchInput, statusFilter, decisionFilter, priorityFilter].forEach(function (input) {
            if (!input) {
                return;
            }
            input.addEventListener("input", applyFiltersAndRender);
            input.addEventListener("change", applyFiltersAndRender);
        });

        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                if (isProcessing) {
                    return;
                }
                loadData().catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh recommendation queue.", "alert-danger");
                });
            });
        }

        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-row-action='save']");
                if (!trigger) {
                    return;
                }

                const applicationId = trigger.getAttribute("data-app-id") || "";
                if (!applicationId || isProcessing) {
                    return;
                }

                isProcessing = true;
                showStatus("");
                trigger.disabled = true;
                trigger.textContent = "Saving...";

                saveRow(applicationId)
                    .then(function () {
                        return loadData();
                    })
                    .then(function () {
                        showStatus("Recommendation queue updated successfully.", "alert-success");
                    })
                    .catch(function (error) {
                        showStatus(error && error.message ? error.message : "Failed to update recommendation queue.", "alert-danger");
                    })
                    .finally(function () {
                        isProcessing = false;
                        if (document.body.contains(trigger)) {
                            trigger.disabled = false;
                            trigger.textContent = "Save";
                        }
                    });
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindEvents();
        try {
            await loadData();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load secretary recommendations.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
