(function () {
    "use strict";

    const AUDIT_SELECT = "id,module,action,actor_id,actor_role,target_user_id,target_role,target_email,target_label,record_type,record_id,summary,details,created_at";
    let auditRows = [];
    let profileMap = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function auditHelper() {
        return window.LDSSSuperAdminAudit || null;
    }

    function showStatus(message, type) {
        const box = byId("superAdminAuditStatus");
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

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function fullName(profile) {
        if (!profile) {
            return "";
        }
        return [
            profile.first_name || "",
            profile.middle_name || "",
            profile.last_name || ""
        ].map(function (value) {
            return (value || "").toString().trim();
        }).filter(Boolean).join(" ");
    }

    function profileLabel(profile) {
        if (!profile) {
            return "";
        }
        const name = fullName(profile);
        if (name && profile.email) {
            return name + " (" + profile.email + ")";
        }
        return name || profile.email || "";
    }

    function detailsPreview(details) {
        if (!details || typeof details !== "object" || Array.isArray(details)) {
            return "";
        }
        const keys = Object.keys(details).filter(function (key) {
            return typeof details[key] !== "undefined" && details[key] !== null && String(details[key]).trim() !== "";
        }).slice(0, 4);

        return keys.map(function (key) {
            const label = key.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); });
            return label + ": " + String(details[key]);
        }).join(" | ");
    }

    function actorMarkup(row) {
        const profile = profileMap[row.actor_id] || null;
        const primary = profileLabel(profile) || row.actor_role || "System Administrator";
        const secondary = row.actor_role ? row.actor_role.replace(/_/g, " ") : "";

        return (
            '<div class="fw-600">' + escapeHtml(primary) + "</div>" +
            (secondary ? ('<div class="small text-muted mt-1">' + escapeHtml(secondary) + "</div>") : "")
        );
    }

    function targetMarkup(row) {
        const profile = profileMap[row.target_user_id] || null;
        const primary = row.target_label || profileLabel(profile) || row.target_email || row.record_id || "-";
        const secondary = row.target_email && primary !== row.target_email
            ? row.target_email
            : (row.target_role ? row.target_role.replace(/_/g, " ") : "");

        return (
            '<div class="fw-600">' + escapeHtml(primary) + "</div>" +
            (secondary ? ('<div class="small text-muted mt-1">' + escapeHtml(secondary) + "</div>") : "")
        );
    }

    function actionMarkup(row) {
        const helper = auditHelper();
        const meta = helper && typeof helper.actionMeta === "function"
            ? helper.actionMeta(row.action)
            : { label: row.action || "System Activity", chipClass: "ldss-chip-neutral" };

        return '<span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span>";
    }

    function moduleLabel(row) {
        const moduleValue = (row && row.module ? row.module : "").toString().trim();
        if (moduleValue) {
            if (moduleValue === "user_management") {
                return "User Management";
            }
            if (moduleValue === "scholarship_settings") {
                return "Scholarship Settings";
            }
            return moduleValue.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); });
        }

        const helper = auditHelper();
        const meta = helper && typeof helper.actionMeta === "function"
            ? helper.actionMeta(row.action)
            : null;

        if (meta && meta.moduleLabel) {
            return meta.moduleLabel;
        }
        return "System Administrator";
    }

    function formatTimestamp(value) {
        const helper = auditHelper();
        if (helper && typeof helper.formatTimestamp === "function") {
            return helper.formatTimestamp(value);
        }
        return value || "-";
    }

    async function loadProfiles(context, ids) {
        const profileIds = Array.isArray(ids)
            ? ids.filter(function (value, index, array) {
                return value && array.indexOf(value) === index;
            })
            : [];

        if (!profileIds.length) {
            return {};
        }

        const result = await context.client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, email")
            .in("id", profileIds);

        if (result.error) {
            throw new Error("Failed to load audit profile labels: " + result.error.message);
        }

        return (result.data || []).reduce(function (map, profile) {
            map[profile.id] = profile;
            return map;
        }, {});
    }

    function fillFilterOptions() {
        const actionFilter = byId("superAdminAuditActionFilter");
        const moduleFilter = byId("superAdminAuditModuleFilter");
        const currentAction = actionFilter ? actionFilter.value : "all";
        const currentModule = moduleFilter ? moduleFilter.value : "all";

        if (moduleFilter) {
            const modules = Array.from(new Set(auditRows.map(function (row) {
                return row.module || "system_admin";
            }))).sort();
            moduleFilter.innerHTML = ['<option value="all">All modules</option>'].concat(modules.map(function (module) {
                return '<option value="' + escapeHtml(module) + '">' + escapeHtml(moduleLabel({ module: module, action: "" })) + "</option>";
            })).join("");
            moduleFilter.value = modules.indexOf(currentModule) !== -1 ? currentModule : "all";
        }

        if (actionFilter) {
            const actions = Array.from(new Set(auditRows.map(function (row) {
                return row.action || "";
            }).filter(Boolean))).sort();
            actionFilter.innerHTML = ['<option value="all">All actions</option>'].concat(actions.map(function (action) {
                const helper = auditHelper();
                const meta = helper && typeof helper.actionMeta === "function"
                    ? helper.actionMeta(action)
                    : { label: action };
                return '<option value="' + escapeHtml(action) + '">' + escapeHtml(meta.label) + "</option>";
            })).join("");
            actionFilter.value = actions.indexOf(currentAction) !== -1 ? currentAction : "all";
        }
    }

    function filteredRows() {
        const search = (byId("superAdminAuditSearch") ? byId("superAdminAuditSearch").value : "").trim().toLowerCase();
        const moduleFilter = (byId("superAdminAuditModuleFilter") ? byId("superAdminAuditModuleFilter").value : "all").trim();
        const actionFilter = (byId("superAdminAuditActionFilter") ? byId("superAdminAuditActionFilter").value : "all").trim();

        return auditRows.filter(function (row) {
            if (moduleFilter !== "all" && (row.module || "") !== moduleFilter) {
                return false;
            }
            if (actionFilter !== "all" && (row.action || "") !== actionFilter) {
                return false;
            }
            if (!search) {
                return true;
            }

            const haystack = [
                moduleLabel(row),
                row.action || "",
                row.summary || "",
                row.target_email || "",
                row.target_label || "",
                detailsPreview(row.details),
                profileLabel(profileMap[row.actor_id] || null),
                profileLabel(profileMap[row.target_user_id] || null)
            ].join(" ").toLowerCase();

            return haystack.includes(search);
        });
    }

    function renderRows() {
        const tbody = byId("superAdminAuditTableBody");
        const summary = byId("superAdminAuditSummary");
        if (!tbody) {
            return;
        }

        const rows = filteredRows();
        if (summary) {
            summary.textContent = rows.length + " record" + (rows.length === 1 ? "" : "s");
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td class="text-center py-4 text-muted" colspan="6">No audit logs found for the current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const detailText = detailsPreview(row.details);

            return (
                '<tr class="ldss-secretary-app-row" tabindex="0">' +
                '<td data-label="Timestamp">' + escapeHtml(formatTimestamp(row.created_at)) + "</td>" +
                '<td data-label="Module">' + escapeHtml(moduleLabel(row)) + "</td>" +
                '<td data-label="Action">' + actionMarkup(row) + "</td>" +
                '<td data-label="Actor">' + actorMarkup(row) + "</td>" +
                '<td data-label="Target">' + targetMarkup(row) + "</td>" +
                '<td data-label="Summary">' +
                    '<div class="fw-600">' + escapeHtml(row.summary || "-") + "</div>" +
                    (detailText ? ('<div class="small text-muted mt-1">' + escapeHtml(detailText) + "</div>") : "") +
                "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function setRefreshLoading(isLoading) {
        const btn = byId("superAdminAuditRefreshBtn");
        if (!btn) {
            return;
        }
        btn.disabled = isLoading;
        btn.textContent = isLoading ? "Refreshing..." : "Refresh";
    }

    async function loadAuditLogs(context) {
        showStatus("");
        const result = await context.client
            .from("audit_logs")
            .select(AUDIT_SELECT)
            .order("created_at", { ascending: false })
            .limit(250);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                auditRows = [];
                profileMap = {};
                fillFilterOptions();
                renderRows();
                showStatus("Audit log table is not available yet. Run audit_logs_hotfix_2026_03_22.sql first.", "alert-warning");
                return;
            }
            throw new Error("Failed to load audit logs: " + result.error.message);
        }

        auditRows = result.data || [];
        profileMap = await loadProfiles(
            context,
            auditRows.reduce(function (ids, row) {
                if (row.actor_id) {
                    ids.push(row.actor_id);
                }
                if (row.target_user_id) {
                    ids.push(row.target_user_id);
                }
                return ids;
            }, [])
        );
        fillFilterOptions();
        renderRows();
    }

    function bindEvents(context) {
        ["superAdminAuditSearch", "superAdminAuditModuleFilter", "superAdminAuditActionFilter"].forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", renderRows);
            input.addEventListener("change", renderRows);
        });

        const refreshBtn = byId("superAdminAuditRefreshBtn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", async function () {
                setRefreshLoading(true);
                try {
                    await loadAuditLogs(context);
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh audit logs.", "alert-danger");
                } finally {
                    setRefreshLoading(false);
                }
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }
        if (context.role !== "super_admin") {
            showStatus("Only Super Admin can access this module.", "alert-warning");
            return;
        }

        bindEvents(context);
        setRefreshLoading(true);
        try {
            await loadAuditLogs(context);
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load audit logs.", "alert-danger");
        } finally {
            setRefreshLoading(false);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
