(function () {
    "use strict";

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

    function matchesSearch(row, query) {
        if (!query) {
            return true;
        }
        const haystack = [
            fullName(row),
            row.email || "",
            row.mobile_number || "",
            roleLabel(row.role)
        ].join(" ").toLowerCase();

        return haystack.includes(query);
    }

    function filteredRows() {
        const search = (byId("userMgmtSearch") ? byId("userMgmtSearch").value : "").trim().toLowerCase();
        const roleFilter = (byId("userMgmtRoleFilter") ? byId("userMgmtRoleFilter").value : "all").trim();
        const statusFilter = (byId("userMgmtStatusFilter") ? byId("userMgmtStatusFilter").value : "all").trim();

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
            tbody.innerHTML = '<tr><td class="text-center py-4 text-muted" colspan="6">No users found for current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const contact = [
                row.email || "",
                row.mobile_number || ""
            ].filter(function (value) { return !!value; }).join(" / ");

            return (
                "<tr>" +
                "<td>" + escapeHtml(fullName(row)) + "</td>" +
                "<td>" + escapeHtml(roleLabel(row.role)) + "</td>" +
                "<td>" + escapeHtml(contact || "-") + "</td>" +
                "<td>" + statusChip(row) + "</td>" +
                "<td>" + escapeHtml(formatDate(row.created_at)) + "</td>" +
                "<td>" + rowActionsMarkup(row) + "</td>" +
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

        userRows = result.data || [];
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

        ["userMgmtSearch", "userMgmtRoleFilter", "userMgmtStatusFilter"].forEach(function (id) {
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
