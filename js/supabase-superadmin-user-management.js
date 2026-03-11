(function () {
    "use strict";

    const APPLICATION_STATUS_META = {
        draft: { label: "Draft", chipClass: "ldss-chip-neutral" },
        submitted: { label: "Submitted", chipClass: "ldss-chip-success" },
        pending_exam: { label: "Pending Exam", chipClass: "ldss-chip-accent" },
        exam_scheduled: { label: "Exam Scheduled", chipClass: "ldss-chip-accent" },
        exam_completed: { label: "Exam Completed", chipClass: "ldss-chip-accent" },
        passed_exam: { label: "Passed Exam", chipClass: "ldss-chip-success" },
        failed_exam: { label: "Failed Exam", chipClass: "ldss-chip-danger" },
        special_endorsement_review: { label: "Special Endorsement Review", chipClass: "ldss-chip-accent" },
        for_interview: { label: "For Interview", chipClass: "ldss-chip-accent" },
        interview_scheduled: { label: "Interview Scheduled", chipClass: "ldss-chip-accent" },
        interview_completed: { label: "Interview Completed", chipClass: "ldss-chip-accent" },
        hard_copy_verified: { label: "Hard Copy Verified", chipClass: "ldss-chip-success" },
        for_approval: { label: "For Approval", chipClass: "ldss-chip-accent" },
        returned_for_correction: { label: "Returned for Correction", chipClass: "ldss-chip-danger" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        for_release: { label: "For Release", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };

    let userRows = [];
    let authContext = null;

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
        const alert = byId("userManagementStatus");
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

    function roleLabel(role) {
        const map = {
            applicant: "Applicant",
            secretary: "Secretary",
            admin: "Admin",
            super_admin: "Super Admin"
        };
        return map[role] || (role || "-");
    }

    function applicationStatusMeta(status) {
        const normalized = (status || "").toString().trim();
        if (!normalized) {
            return { label: "-", chipClass: "ldss-chip-neutral" };
        }
        if (APPLICATION_STATUS_META[normalized]) {
            return APPLICATION_STATUS_META[normalized];
        }
        return {
            label: normalized.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); }),
            chipClass: "ldss-chip-neutral"
        };
    }

    function fullName(row) {
        const parts = [
            row.first_name || "",
            row.middle_name || "",
            row.last_name || ""
        ].map(function (value) { return value.toString().trim(); })
            .filter(function (value) { return value.length > 0; });

        if (parts.length > 0) {
            return parts.join(" ");
        }
        return "-";
    }

    function statusChip(row) {
        if (row.is_active === false) {
            return '<span class="ldss-chip ldss-chip-danger">Suspended</span>';
        }
        return '<span class="ldss-chip ldss-chip-success">Active</span>';
    }

    function latestApplicationByApplicant(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            if (!row || !row.applicant_id) {
                return;
            }

            const existing = map[row.applicant_id];
            if (!existing) {
                map[row.applicant_id] = row;
                return;
            }

            const existingTs = new Date(existing.updated_at || existing.created_at || 0).getTime();
            const currentTs = new Date(row.updated_at || row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[row.applicant_id] = row;
            }
        });
        return map;
    }

    function submissionMeta(row) {
        if (!row || row.role !== "applicant") {
            return {
                state: "staff",
                label: "Staff Account",
                chipClass: "ldss-chip-neutral"
            };
        }

        const application = row.latest_application || null;
        if (!application) {
            return {
                state: "not_submitted",
                label: "No Form",
                chipClass: "ldss-chip-neutral"
            };
        }

        if (application.submitted_at || (application.status || "").toString() !== "draft") {
            return {
                state: "submitted",
                label: "Submitted",
                chipClass: "ldss-chip-success"
            };
        }

        return {
            state: "not_submitted",
            label: "Draft Only",
            chipClass: "ldss-chip-accent"
        };
    }

    function latestApplicationMarkup(row) {
        if (!row || row.role !== "applicant") {
            return '<span class="small text-muted">N/A</span>';
        }

        const application = row.latest_application || null;
        if (!application) {
            return '<span class="small text-muted">No application record</span>';
        }

        const meta = applicationStatusMeta(application.status);
        const dateText = application.submitted_at
            ? "Submitted " + formatDate(application.submitted_at)
            : "Created " + formatDate(application.created_at);

        return (
            '<div class="fw-600">' + escapeHtml(application.application_no || "-") + "</div>" +
            '<div class="small mt-1"><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></div>" +
            '<div class="small text-muted mt-1">' + escapeHtml(dateText) + "</div>"
        );
    }

    function matchesSearch(row, query) {
        if (!query) {
            return true;
        }
        const submission = submissionMeta(row);
        const latestApplication = row && row.latest_application ? row.latest_application : null;
        const latestStatus = latestApplication ? applicationStatusMeta(latestApplication.status).label : "";
        const haystack = [
            fullName(row),
            row.email || "",
            row.mobile_number || "",
            roleLabel(row.role),
            submission.label,
            latestApplication && latestApplication.application_no ? latestApplication.application_no : "",
            latestStatus
        ].join(" ").toLowerCase();

        return haystack.includes(query);
    }

    function filteredRows() {
        const search = (byId("userMgmtSearch") ? byId("userMgmtSearch").value : "").trim().toLowerCase();
        const roleFilter = (byId("userMgmtRoleFilter") ? byId("userMgmtRoleFilter").value : "all").trim();
        const statusFilter = (byId("userMgmtStatusFilter") ? byId("userMgmtStatusFilter").value : "all").trim();
        const submissionFilter = (byId("userMgmtSubmissionFilter") ? byId("userMgmtSubmissionFilter").value : "all").trim();

        return userRows.filter(function (row) {
            if (roleFilter !== "all" && row.role !== roleFilter) {
                return false;
            }
            if (statusFilter === "active" && row.is_active === false) {
                return false;
            }
            if (statusFilter === "suspended" && row.is_active !== false) {
                return false;
            }
            if (submissionFilter !== "all") {
                const submission = submissionMeta(row);
                if (submissionFilter === "submitted" && submission.state !== "submitted") {
                    return false;
                }
                if (submissionFilter === "not_submitted" && submission.state !== "not_submitted") {
                    return false;
                }
            }
            return matchesSearch(row, search);
        });
    }

    function rowActionsMarkup(row) {
        const isCurrentUser = authContext && authContext.user && authContext.user.id === row.id;
        if (isCurrentUser) {
            return '<span class="small text-muted">Current Account</span>';
        }

        const suspendOrActivateLabel = row.is_active === false ? "Activate" : "Suspend";
        const suspendOrActivateAction = row.is_active === false ? "activate" : "suspend";

        return (
            '<div class="dropdown">' +
            '<button class="btn btn-outline-dark btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">Options</button>' +
            '<ul class="dropdown-menu dropdown-menu-end">' +
            '<li><button class="dropdown-item" type="button" data-action="' + suspendOrActivateAction + '" data-id="' + escapeHtml(row.id) + '">' + suspendOrActivateLabel + '</button></li>' +
            '<li><hr class="dropdown-divider"></li>' +
            '<li><button class="dropdown-item text-danger" type="button" data-action="delete" data-id="' + escapeHtml(row.id) + '">Delete</button></li>' +
            "</ul>" +
            "</div>"
        );
    }

    function renderRows() {
        const tbody = byId("userMgmtTableBody");
        const summary = byId("userMgmtSummary");
        if (!tbody) {
            return;
        }

        const rows = filteredRows();
        if (summary) {
            summary.textContent = rows.length + " user" + (rows.length === 1 ? "" : "s");
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td class="text-center py-4 text-muted" colspan="7">No users found for current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const submission = submissionMeta(row);

            return (
                "<tr>" +
                '<td class="ldss-user-col-name"><span class="ldss-user-name">' + escapeHtml(fullName(row)) + "</span></td>" +
                '<td class="ldss-user-col-role">' + escapeHtml(roleLabel(row.role)) + "</td>" +
                '<td class="ldss-user-col-form"><span class="ldss-chip ' + submission.chipClass + '">' + escapeHtml(submission.label) + "</span></td>" +
                '<td class="ldss-user-col-application">' + latestApplicationMarkup(row) + "</td>" +
                '<td class="ldss-user-col-status">' + statusChip(row) + "</td>" +
                '<td class="ldss-user-col-created d-none d-lg-table-cell">' + escapeHtml(formatDate(row.created_at)) + "</td>" +
                '<td class="ldss-user-col-actions text-nowrap">' + rowActionsMarkup(row) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    async function loadUsers() {
        showStatus("");
        const result = await authContext.client
            .from("profiles")
            .select("id, role, email, mobile_number, first_name, middle_name, last_name, is_active, created_at")
            .order("created_at", { ascending: false });

        if (result.error) {
            showStatus("Failed to load users: " + result.error.message, "alert-danger");
            return;
        }

        const profiles = result.data || [];
        const applicantIds = profiles
            .filter(function (row) { return row.role === "applicant"; })
            .map(function (row) { return row.id; })
            .filter(Boolean);

        let latestByApplicant = {};
        if (applicantIds.length > 0) {
            const appResult = await authContext.client
                .from("applications")
                .select("id, applicant_id, application_no, status, submitted_at, created_at, updated_at")
                .in("applicant_id", applicantIds)
                .order("updated_at", { ascending: false });

            if (appResult.error) {
                showStatus("Users loaded, but application submission data could not be loaded: " + appResult.error.message, "alert-warning");
            } else {
                latestByApplicant = latestApplicationByApplicant(appResult.data || []);
            }
        }

        userRows = profiles.map(function (row) {
            return Object.assign({}, row, {
                latest_application: latestByApplicant[row.id] || null
            });
        });
        renderRows();
    }

    function setRefreshLoading(isLoading) {
        const btn = byId("userMgmtRefreshBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Refreshing..." : "Refresh";
    }

    async function updateUserActiveState(userId, shouldBeActive) {
        const actionLabel = shouldBeActive ? "activate" : "suspend";
        const confirmed = window.confirm(
            (shouldBeActive ? "Activate" : "Suspend") + " this user account?"
        );
        if (!confirmed) {
            return;
        }

        showStatus("");
        const result = await authContext.client
            .from("profiles")
            .update({ is_active: shouldBeActive })
            .eq("id", userId);

        if (result.error) {
            showStatus("Failed to " + actionLabel + " user: " + result.error.message, "alert-danger");
            return;
        }

        showStatus("User account updated successfully.", "alert-success");
        await loadUsers();
    }

    async function deleteUser(userId) {
        const confirmed = window.confirm(
            "Delete this user account permanently? This removes login access and related profile data."
        );
        if (!confirmed) {
            return;
        }

        showStatus("");
        const rpcResult = await authContext.client.rpc("super_admin_delete_user", { p_user_id: userId });
        if (rpcResult.error) {
            const fallback = await authContext.client
                .from("profiles")
                .delete()
                .eq("id", userId);

            if (fallback.error) {
                showStatus("Failed to delete user: " + rpcResult.error.message, "alert-danger");
                return;
            }

            showStatus("Profile deleted. Auth user may still exist until delete RPC is deployed.", "alert-warning");
            await loadUsers();
            return;
        }

        showStatus("User deleted successfully.", "alert-success");
        await loadUsers();
    }

    async function onTableActionClick(event) {
        const trigger = event.target.closest("button[data-action][data-id]");
        if (!trigger) {
            return;
        }

        const action = trigger.getAttribute("data-action");
        const userId = trigger.getAttribute("data-id");
        if (!action || !userId) {
            return;
        }

        trigger.disabled = true;
        try {
            if (action === "suspend") {
                await updateUserActiveState(userId, false);
            } else if (action === "activate") {
                await updateUserActiveState(userId, true);
            } else if (action === "delete") {
                await deleteUser(userId);
            }
        } finally {
            trigger.disabled = false;
        }
    }

    function bindEvents() {
        const table = byId("userMgmtTableBody");
        const refreshBtn = byId("userMgmtRefreshBtn");

        ["userMgmtSearch", "userMgmtRoleFilter", "userMgmtStatusFilter", "userMgmtSubmissionFilter"].forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", renderRows);
            input.addEventListener("change", renderRows);
        });

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async function () {
                setRefreshLoading(true);
                try {
                    await loadUsers();
                } finally {
                    setRefreshLoading(false);
                }
            });
        }

        if (table) {
            table.addEventListener("click", function (event) {
                onTableActionClick(event).catch(function (error) {
                    showStatus(error && error.message ? error.message : "User action failed.", "alert-danger");
                });
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }
        if (authContext.role !== "super_admin") {
            showStatus("Only Super Admin can access this module.", "alert-warning");
            return;
        }

        bindEvents();
        setRefreshLoading(true);
        try {
            await loadUsers();
        } finally {
            setRefreshLoading(false);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
