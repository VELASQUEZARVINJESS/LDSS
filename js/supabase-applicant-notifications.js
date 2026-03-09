(function () {
    "use strict";

    const PAGE_SIZE = 10;

    let notificationRows = [];
    let filteredRows = [];
    let currentPage = 1;
    let currentUserId = "";
    let clientRef = null;

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

    function showStatus(message, type) {
        const box = byId("notificationsStatus");
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

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / PAGE_SIZE);
    }

    function resolveNotificationLink(row) {
        const raw = (row.related_url || "").toString().trim();
        if (raw) {
            if (raw.toLowerCase().startsWith("javascript:")) {
                return "applicant-notifications.html";
            }
            return raw;
        }
        if (row.related_application_id) {
            return "application-detail.html?id=" + encodeURIComponent(row.related_application_id);
        }
        return "applicant-dashboard.html";
    }

    function notificationTypeLabel(type) {
        const text = (type || "info").toString().replace(/_/g, " ");
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function notificationTypeChipClass(type) {
        const key = (type || "").toString().toLowerCase();
        if (key === "approval" || key === "application") {
            return "ldss-chip-accent";
        }
        if (key === "release" || key === "certification") {
            return "ldss-chip-success";
        }
        if (key === "reminder") {
            return "ldss-chip-danger";
        }
        return "ldss-chip-neutral";
    }

    function renderUnreadPill(unreadCount) {
        const pill = byId("notificationsUnreadPill");
        const bell = document.querySelector(".ldss-bell-alert");
        if (!pill) {
            return;
        }
        pill.textContent = unreadCount + (unreadCount === 1 ? " unread" : " unread");
        if (unreadCount > 0) {
            pill.classList.remove("d-none");
            if (bell) {
                bell.classList.remove("ldss-bell-muted");
            }
        } else {
            pill.classList.add("d-none");
            if (bell) {
                bell.classList.add("ldss-bell-muted");
            }
        }
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("notificationsPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 notifications";
            return;
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " notifications";
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderPagination(totalRows) {
        const pagination = byId("notificationsPagination");
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

    function rowMarkup(row) {
        const isRead = !!row.is_read;
        const cardClass = isRead ? "border rounded-3 p-3 mb-3" : "border rounded-3 p-3 mb-3 bg-light";
        const link = resolveNotificationLink(row);
        const buttonText = isRead ? "Mark Unread" : "Mark Read";
        const titleClass = isRead ? "fw-600 mb-1" : "fw-700 mb-1";
        return (
            '<div class="' + cardClass + '">' +
            '<div class="d-flex flex-column flex-lg-row justify-content-between gap-2">' +
            '<div class="pe-lg-3">' +
            '<div class="' + titleClass + '">' + escapeHtml(row.title || "Notification") + "</div>" +
            '<div class="small text-muted mb-2">' + escapeHtml(row.message || "-") + "</div>" +
            '<div class="d-flex flex-wrap gap-2">' +
            '<span class="ldss-chip ' + notificationTypeChipClass(row.notification_type) + '">' + escapeHtml(notificationTypeLabel(row.notification_type)) + "</span>" +
            '<span class="ldss-chip ' + (isRead ? "ldss-chip-neutral" : "ldss-chip-accent") + '">' + (isRead ? "Read" : "Unread") + "</span>" +
            '<span class="small text-muted align-self-center">' + escapeHtml(formatDateTime(row.created_at)) + "</span>" +
            "</div>" +
            "</div>" +
            '<div class="d-flex gap-2 align-items-start">' +
            '<a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(link) + '">Open</a>' +
            '<button class="btn btn-outline-dark btn-sm" type="button" data-action="toggle-read" data-id="' + escapeHtml(row.id) + '">' + buttonText + "</button>" +
            "</div>" +
            "</div>" +
            "</div>"
        );
    }

    function renderList(rows) {
        const list = byId("notificationsList");
        if (!list) {
            return;
        }

        if (!rows.length) {
            list.innerHTML =
                '<div class="ldss-shell-placeholder">' +
                '<div class="fw-700 mb-1">No notifications found</div>' +
                '<p class="small mb-0">You are all caught up. New updates will appear here.</p>' +
                "</div>";
            return;
        }

        list.innerHTML = rows.map(rowMarkup).join("");
    }

    function applyFilters(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }

        const search = (byId("notificationsSearchInput") ? byId("notificationsSearchInput").value : "").toLowerCase().trim();
        const readFilter = byId("notificationsReadFilter") ? byId("notificationsReadFilter").value : "all";

        filteredRows = notificationRows.filter(function (row) {
            const title = (row.title || "").toLowerCase();
            const message = (row.message || "").toLowerCase();
            const matchesSearch = !search || title.includes(search) || message.includes(search);
            const matchesRead =
                readFilter === "all" ||
                (readFilter === "unread" && !row.is_read) ||
                (readFilter === "read" && !!row.is_read);
            return matchesSearch && matchesRead;
        });

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pagedRows = filteredRows.slice(start, start + PAGE_SIZE);
        renderList(pagedRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
    }

    async function loadNotifications() {
        showStatus("");
        const result = await clientRef
            .from("notifications")
            .select("id, notification_type, title, message, related_application_id, related_url, is_read, created_at")
            .eq("recipient_user_id", currentUserId)
            .order("created_at", { ascending: false });

        if (result.error) {
            showStatus("Failed to load notifications: " + result.error.message, "alert-danger");
            return;
        }

        notificationRows = result.data || [];
        const unreadCount = notificationRows.filter(function (row) { return !row.is_read; }).length;
        renderUnreadPill(unreadCount);
        applyFilters(false);
    }

    async function toggleReadState(notificationId) {
        const row = notificationRows.find(function (item) {
            return item.id === notificationId;
        });
        if (!row) {
            return;
        }

        const nextRead = !row.is_read;
        const payload = {
            is_read: nextRead,
            read_at: nextRead ? new Date().toISOString() : null
        };

        const result = await clientRef
            .from("notifications")
            .update(payload)
            .eq("id", notificationId)
            .eq("recipient_user_id", currentUserId);

        if (result.error) {
            showStatus("Failed to update notification: " + result.error.message, "alert-danger");
            return;
        }

        row.is_read = nextRead;
        row.read_at = payload.read_at;
        applyFilters(false);
        renderUnreadPill(notificationRows.filter(function (item) { return !item.is_read; }).length);
        showStatus(nextRead ? "Notification marked as read." : "Notification marked as unread.", "alert-success");
    }

    async function markAllAsRead() {
        const unreadRows = notificationRows.filter(function (row) { return !row.is_read; });
        if (unreadRows.length === 0) {
            showStatus("All notifications are already marked as read.", "alert-info");
            return;
        }

        const button = byId("notificationsMarkAllReadBtn");
        if (button) {
            button.disabled = true;
            button.textContent = "Updating...";
        }

        const result = await clientRef
            .from("notifications")
            .update({ is_read: true, read_at: new Date().toISOString() })
            .eq("recipient_user_id", currentUserId)
            .eq("is_read", false);

        if (button) {
            button.disabled = false;
            button.textContent = "Mark All As Read";
        }

        if (result.error) {
            showStatus("Failed to mark notifications as read: " + result.error.message, "alert-danger");
            return;
        }

        notificationRows.forEach(function (row) {
            row.is_read = true;
        });
        applyFilters(false);
        renderUnreadPill(0);
        showStatus("All notifications marked as read.", "alert-success");
    }

    function bindEvents() {
        const applyBtn = byId("notificationsApplyFilterBtn");
        const search = byId("notificationsSearchInput");
        const readFilter = byId("notificationsReadFilter");
        const list = byId("notificationsList");
        const pagination = byId("notificationsPagination");
        const markAll = byId("notificationsMarkAllReadBtn");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                applyFilters(true);
            });
        }
        if (search) {
            search.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFilters(true);
                }
            });
        }
        if (readFilter) {
            readFilter.addEventListener("change", function () {
                applyFilters(true);
            });
        }
        if (markAll) {
            markAll.addEventListener("click", function () {
                markAllAsRead();
            });
        }
        if (list) {
            list.addEventListener("click", function (event) {
                const trigger = event.target.closest('button[data-action="toggle-read"]');
                if (!trigger) {
                    return;
                }
                const notificationId = trigger.getAttribute("data-id");
                if (!notificationId) {
                    return;
                }
                toggleReadState(notificationId);
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
                applyFilters(false);
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        clientRef = context.client;
        currentUserId = context.user.id;
        bindEvents();
        await loadNotifications();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
