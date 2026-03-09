(function () {
    "use strict";

    const PAGE_SIZE = 8;
    const BATCH_APPLY_LIMIT = 30;

    const LOCKED_APP_STATUSES = [
        "for_admin_approval",
        "approved",
        "waitlisted",
        "rejected",
        "certification_ready",
        "release_scheduled",
        "released"
    ];

    const APP_STATUS_META = {
        submitted: { label: "Submitted", chipClass: "ldss-chip-neutral" },
        under_secretary_review: { label: "Under Secretary Review", chipClass: "ldss-chip-accent" },
        interview_scheduled: { label: "Interview Scheduled", chipClass: "ldss-chip-accent" },
        recommended: { label: "Recommended", chipClass: "ldss-chip-accent" },
        for_admin_approval: { label: "For Admin Approval", chipClass: "ldss-chip-accent" },
        returned_for_correction: { label: "Returned for Correction", chipClass: "ldss-chip-danger" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        certification_ready: { label: "Certification Ready", chipClass: "ldss-chip-success" },
        release_scheduled: { label: "Release Scheduled", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };

    const INTERVIEW_STATUS_META = {
        not_scheduled: { label: "Not Scheduled" },
        scheduled: { label: "Scheduled" },
        rescheduled: { label: "Rescheduled" },
        completed: { label: "Completed" },
        no_show: { label: "No Show" },
        cancelled: { label: "Cancelled" }
    };

    const STATUS_OPTIONS = ["not_scheduled", "scheduled", "rescheduled", "completed", "no_show", "cancelled"];
    const RESULT_OPTIONS = ["pending", "recommended", "waitlisted", "not_recommended"];

    let authContext = null;
    let allRows = [];
    let filteredRows = [];
    let currentPage = 1;
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

    function showStatus(message, type) {
        const box = byId("secretaryInterviewStatus");
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
        return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
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

    function toDatetimeLocalValue(value) {
        if (!value) {
            return "";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        const offsetMs = parsed.getTimezoneOffset() * 60000;
        return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
    }

    function toIsoFromDatetimeLocal(value) {
        if (!value) {
            return null;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        return parsed.toISOString();
    }

    function buildApplicantName(profile) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const full = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (full) {
            return full;
        }
        return profile && profile.email ? profile.email : "Unknown Applicant";
    }

    function startOfDay(dateValue) {
        const date = new Date(dateValue);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function endOfDay(dateValue) {
        const date = new Date(dateValue);
        date.setHours(23, 59, 59, 999);
        return date;
    }

    function startOfWeek(dateValue) {
        const date = startOfDay(dateValue);
        const day = date.getDay();
        date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
        return date;
    }

    function endOfWeek(dateValue) {
        const start = startOfWeek(dateValue);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return end;
    }

    function isAppLocked(row) {
        return Boolean(row && (row.is_locked || LOCKED_APP_STATUSES.includes(row.application_status)));
    }

    function setMetric(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function renderKpis(rows) {
        const todayStart = startOfDay(new Date());
        const todayEnd = endOfDay(new Date());
        const weekStart = startOfWeek(new Date());
        const weekEnd = endOfWeek(new Date());

        setMetric("secretaryInterviewTodayCount", rows.filter(function (r) {
            return r.scheduled_at && new Date(r.scheduled_at) >= todayStart && new Date(r.scheduled_at) <= todayEnd;
        }).length);

        setMetric("secretaryInterviewWeekCount", rows.filter(function (r) {
            return r.scheduled_at && new Date(r.scheduled_at) >= weekStart && new Date(r.scheduled_at) <= weekEnd;
        }).length);

        setMetric("secretaryInterviewUnscheduledCount", rows.filter(function (r) {
            return !r.scheduled_at || r.interview_status === "not_scheduled";
        }).length);

        setMetric("secretaryInterviewNoShowCount", rows.filter(function (r) {
            return r.interview_status === "no_show";
        }).length);
    }

    function getPageCount(total) {
        return total <= 0 ? 1 : Math.ceil(total / PAGE_SIZE);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + className + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function renderPaginationInfo(totalRows) {
        const info = byId("secretaryInterviewPaginationInfo");
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
        const pagination = byId("secretaryInterviewPagination");
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

    function statusOptionsMarkup(value) {
        return STATUS_OPTIONS.map(function (status) {
            const label = INTERVIEW_STATUS_META[status] ? INTERVIEW_STATUS_META[status].label : status;
            return '<option value="' + escapeHtml(status) + '"' + (value === status ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
        }).join("");
    }

    function resultOptionsMarkup(value) {
        return RESULT_OPTIONS.map(function (result) {
            const label = result.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            return '<option value="' + escapeHtml(result) + '"' + (value === result ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
        }).join("");
    }

    function renderTable(rows) {
        const tbody = byId("secretaryInterviewTableBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No interview records found for the current filter.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const appMeta = APP_STATUS_META[row.application_status] || { label: row.application_status || "-", chipClass: "ldss-chip-neutral" };
            const readOnly = isAppLocked(row);
            const disabledAttr = readOnly ? " disabled" : "";
            const scheduleValue = toDatetimeLocalValue(row.scheduled_at);
            const updateStamp = row.interview_updated_at || row.application_updated_at || row.created_at;

            return (
                "<tr>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.application_no || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_contact || "No contact on file") + "</div>" +
                '<div class="small mt-1">' + escapeHtml((row.scholarship_type || "-") + " | " + (row.school_year || "-")) + "</div>" +
                '<div class="mt-2"><span class="ldss-chip ' + escapeHtml(appMeta.chipClass) + '">' + escapeHtml(appMeta.label) + "</span></div>" +
                "</td>" +
                '<td><input class="form-control form-control-sm" type="datetime-local" data-row-field="scheduled_at" data-app-id="' + escapeHtml(row.id) + '" value="' + escapeHtml(scheduleValue) + '"' + disabledAttr + " /></td>" +
                '<td><input class="form-control form-control-sm" type="text" placeholder="Interview venue" data-row-field="venue" data-app-id="' + escapeHtml(row.id) + '" value="' + escapeHtml(row.venue || "") + '"' + disabledAttr + " /></td>" +
                '<td><select class="form-select form-select-sm" data-row-field="status" data-app-id="' + escapeHtml(row.id) + '"' + disabledAttr + ">" + statusOptionsMarkup(row.interview_status || "not_scheduled") + "</select></td>" +
                '<td><select class="form-select form-select-sm" data-row-field="result" data-app-id="' + escapeHtml(row.id) + '"' + disabledAttr + ">" + resultOptionsMarkup(row.interview_result || "pending") + "</select></td>" +
                "<td>" +
                '<div class="d-flex flex-wrap gap-2 ldss-interview-actions">' +
                '<button class="btn btn-outline-dark btn-sm" type="button" data-action="save-row" data-app-id="' + escapeHtml(row.id) + '"' + disabledAttr + ">Save</button>" +
                '<a class="btn btn-dark btn-sm" href="secretary-interview-verification.html?id=' + encodeURIComponent(row.id) + '">Verification</a>' +
                "</div>" +
                '<div class="small text-muted mt-1">Updated: ' + escapeHtml(formatDate(updateStamp)) + "</div>" +
                (readOnly ? '<div class="small text-muted">Read-only after endorsement/decision.</div>' : "") +
                "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderFocusList(rows) {
        const focus = byId("secretaryInterviewFocusList");
        if (!focus) {
            return;
        }

        const today = startOfDay(new Date());
        const upcoming = rows
            .filter(function (row) {
                return row.scheduled_at && ["scheduled", "rescheduled"].includes(row.interview_status || "") && new Date(row.scheduled_at) >= today;
            })
            .sort(function (a, b) {
                return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
            })
            .slice(0, 5);

        if (!upcoming.length) {
            focus.innerHTML = '<li class="list-group-item small text-muted">No upcoming scheduled interviews in current records.</li>';
            return;
        }

        focus.innerHTML = upcoming.map(function (row) {
            return (
                '<li class="list-group-item">' +
                '<div class="fw-600 small">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.application_no || "-") + " | " + escapeHtml(formatDateTime(row.scheduled_at)) + "</div>" +
                '<a class="small" href="secretary-interview-verification.html?id=' + encodeURIComponent(row.id) + '">Open verification</a>' +
                "</li>"
            );
        }).join("");
    }

    function applyFilterRows() {
        const search = (byId("secretaryInterviewSearchInput") ? byId("secretaryInterviewSearchInput").value : "").toLowerCase().trim();
        const statusFilter = byId("secretaryInterviewStatusFilter") ? byId("secretaryInterviewStatusFilter").value : "all";
        const windowFilter = byId("secretaryInterviewWindowFilter") ? byId("secretaryInterviewWindowFilter").value : "all";

        const now = new Date();
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);
        const weekStart = startOfWeek(now);
        const weekEnd = endOfWeek(now);

        return allRows.filter(function (row) {
            const scheduleDate = row.scheduled_at ? new Date(row.scheduled_at) : null;
            const searchSource = [
                row.application_no || "",
                row.applicant_name || "",
                row.scholarship_type || "",
                row.school_year || "",
                row.applicant_contact || ""
            ].join(" ").toLowerCase();

            const matchesSearch = !search || searchSource.includes(search);
            const matchesStatus = statusFilter === "all" || (row.interview_status || "not_scheduled") === statusFilter;

            let matchesWindow = true;
            if (windowFilter === "today") {
                matchesWindow = Boolean(scheduleDate && scheduleDate >= todayStart && scheduleDate <= todayEnd);
            } else if (windowFilter === "this_week") {
                matchesWindow = Boolean(scheduleDate && scheduleDate >= weekStart && scheduleDate <= weekEnd);
            } else if (windowFilter === "upcoming") {
                matchesWindow = Boolean(scheduleDate && scheduleDate >= todayStart);
            } else if (windowFilter === "unscheduled") {
                matchesWindow = !scheduleDate || (row.interview_status || "not_scheduled") === "not_scheduled";
            } else if (windowFilter === "completed") {
                matchesWindow = (row.interview_status || "") === "completed";
            }

            return matchesSearch && matchesStatus && matchesWindow;
        });
    }

    function applyFiltersAndRender(resetPage) {
        if (resetPage) {
            currentPage = 1;
        }

        filteredRows = applyFilterRows();

        const pageCount = getPageCount(filteredRows.length);
        if (currentPage > pageCount) {
            currentPage = pageCount;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

        renderTable(pageRows);
        renderPaginationInfo(filteredRows.length);
        renderPagination(filteredRows.length);
    }

    async function loadInterviewData() {
        showStatus("");

        const appResult = await authContext.client
            .from("applications")
            .select("id, application_no, applicant_id, scholarship_type, school_year, status, is_locked, created_at, updated_at")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

        if (appResult.error) {
            showStatus("Failed to load interview records: " + appResult.error.message, "alert-danger");
            return;
        }

        const appRows = appResult.data || [];
        const applicationIds = appRows.map(function (row) { return row.id; }).filter(Boolean);
        const applicantIds = Array.from(new Set(appRows.map(function (row) { return row.applicant_id; }).filter(Boolean)));

        const profileMap = {};
        if (applicantIds.length > 0) {
            const profileResult = await authContext.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, mobile_number")
                .in("id", applicantIds);

            if (!profileResult.error && profileResult.data) {
                profileResult.data.forEach(function (profile) {
                    profileMap[profile.id] = profile;
                });
            }
        }

        const interviewMap = {};
        if (applicationIds.length > 0) {
            const interviewResult = await authContext.client
                .from("interviews")
                .select("id, application_id, batch_label, scheduled_at, venue, status, result, remarks, updated_at")
                .in("application_id", applicationIds);

            if (!interviewResult.error && interviewResult.data) {
                interviewResult.data.forEach(function (interview) {
                    interviewMap[interview.application_id] = interview;
                });
            }
        }

        allRows = appRows.map(function (app) {
            const profile = profileMap[app.applicant_id] || null;
            const interview = interviewMap[app.id] || null;

            return {
                id: app.id,
                application_no: app.application_no,
                applicant_id: app.applicant_id,
                scholarship_type: app.scholarship_type,
                school_year: app.school_year,
                application_status: app.status,
                is_locked: Boolean(app.is_locked),
                created_at: app.created_at,
                application_updated_at: app.updated_at,
                applicant_name: buildApplicantName(profile),
                applicant_contact: profile ? (profile.mobile_number || profile.email || "No contact on file") : "No contact on file",
                interview_id: interview ? interview.id : null,
                batch_label: interview ? (interview.batch_label || "") : "",
                scheduled_at: interview ? interview.scheduled_at : null,
                venue: interview ? (interview.venue || "") : "",
                interview_status: interview ? (interview.status || "not_scheduled") : "not_scheduled",
                interview_result: interview ? (interview.result || "pending") : "pending",
                interview_remarks: interview ? (interview.remarks || "") : "",
                interview_updated_at: interview ? interview.updated_at : null
            };
        });

        renderKpis(allRows);
        renderFocusList(allRows);
        applyFiltersAndRender(false);
    }

    function getRowById(appId) {
        return allRows.find(function (row) {
            return row.id === appId;
        }) || null;
    }

    function getRowFieldElement(appId, fieldName) {
        return document.querySelector('[data-row-field="' + fieldName + '"][data-app-id="' + appId + '"]');
    }

    function readRowForm(appId) {
        const scheduleInput = getRowFieldElement(appId, "scheduled_at");
        const venueInput = getRowFieldElement(appId, "venue");
        const statusInput = getRowFieldElement(appId, "status");
        const resultInput = getRowFieldElement(appId, "result");

        const scheduleRaw = scheduleInput ? scheduleInput.value : "";
        const scheduleIso = scheduleRaw ? toIsoFromDatetimeLocal(scheduleRaw) : null;
        const venue = venueInput ? venueInput.value.trim() : "";
        const status = statusInput ? statusInput.value : "not_scheduled";
        const result = resultInput ? resultInput.value : "pending";

        if (scheduleRaw && !scheduleIso) {
            return { error: "Interview schedule is invalid. Please choose a valid date and time." };
        }

        if (["scheduled", "rescheduled", "completed"].includes(status) && !scheduleIso) {
            return { error: "Schedule date/time is required for scheduled, rescheduled, or completed status." };
        }

        if (status === "completed" && result === "pending") {
            return { error: "Set a final interview result when status is completed." };
        }

        return {
            scheduleIso: scheduleIso,
            venue: venue,
            status: status,
            result: result
        };
    }

    async function upsertInterviewRow(row, formValues) {
        const payload = {
            application_id: row.id,
            batch_label: row.batch_label || null,
            scheduled_at: formValues.scheduleIso,
            venue: formValues.venue || null,
            status: formValues.status,
            result: formValues.result,
            encoded_by: authContext.user.id
        };

        const result = await authContext.client
            .from("interviews")
            .upsert(payload, { onConflict: "application_id" })
            .select("id, application_id, scheduled_at, venue, status, result")
            .single();

        if (result.error) {
            throw new Error("Failed to save interview row: " + result.error.message);
        }

        return result.data;
    }

    function deriveApplicationStatus(row, interviewStatus) {
        if (isAppLocked(row)) {
            return row.application_status;
        }

        if (["scheduled", "rescheduled", "completed", "no_show", "cancelled"].includes(interviewStatus)) {
            return "interview_scheduled";
        }

        return "under_secretary_review";
    }

    async function syncApplicationStatus(row, interviewStatus) {
        const targetStatus = deriveApplicationStatus(row, interviewStatus);
        if (targetStatus === row.application_status) {
            return;
        }

        const result = await authContext.client
            .from("applications")
            .update({
                status: targetStatus,
                secretary_reviewer_id: authContext.user.id
            })
            .eq("id", row.id);

        if (result.error) {
            throw new Error("Interview saved but application status update failed: " + result.error.message);
        }
    }

    async function notifyInterviewUpdate(row, formValues) {
        let title = "Interview Update";
        let message = "Your interview details were updated by the scholarship office.";

        if (["scheduled", "rescheduled"].includes(formValues.status) && formValues.scheduleIso) {
            title = formValues.status === "rescheduled" ? "Interview Rescheduled" : "Interview Scheduled";
            message = "Your interview is set on " + formatDateTime(formValues.scheduleIso) + ". Venue: " + (formValues.venue || "LGU Daet Office") + ".";
        } else if (formValues.status === "completed") {
            title = "Interview Completed";
            message = "Your interview was marked as completed. Please monitor your application status for the next update.";
        } else if (formValues.status === "no_show") {
            title = "Interview Attendance Update";
            message = "Your interview attendance was marked as No Show. Contact the scholarship office for rescheduling guidance.";
        } else if (formValues.status === "cancelled") {
            title = "Interview Cancelled";
            message = "Your interview schedule was cancelled by the scholarship office. Please wait for a reschedule notice.";
        }

        const payload = {
            recipient_user_id: row.applicant_id,
            sender_user_id: authContext.user.id,
            notification_type: "interview",
            title: title,
            message: message,
            related_application_id: row.id,
            related_url: "application-detail.html?id=" + encodeURIComponent(row.id)
        };

        const result = await authContext.client
            .from("notifications")
            .insert(payload);

        return !result.error;
    }

    async function saveRow(appId, button) {
        if (isProcessing || !authContext) {
            return;
        }

        const row = getRowById(appId);
        if (!row) {
            showStatus("Interview row not found.", "alert-warning");
            return;
        }

        if (isAppLocked(row)) {
            showStatus("This record is read-only at its current application stage.", "alert-warning");
            return;
        }

        const formValues = readRowForm(appId);
        if (formValues.error) {
            showStatus(formValues.error, "alert-warning");
            return;
        }

        const originalText = button ? button.textContent : "";
        if (button) {
            button.disabled = true;
            button.textContent = "Saving...";
        }

        isProcessing = true;
        showStatus("");

        try {
            await upsertInterviewRow(row, formValues);
            await syncApplicationStatus(row, formValues.status);
            await notifyInterviewUpdate(row, formValues);
            await loadInterviewData();
            showStatus("Interview record updated successfully.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to update interview row.", "alert-danger");
            if (button) {
                button.disabled = false;
                button.textContent = originalText;
            }
        } finally {
            isProcessing = false;
        }
    }

    async function applyBatchSchedule() {
        if (isProcessing || !authContext) {
            return;
        }

        const dateTimeRaw = byId("secretaryInterviewBatchDateTime") ? byId("secretaryInterviewBatchDateTime").value : "";
        const venue = byId("secretaryInterviewBatchVenue") ? byId("secretaryInterviewBatchVenue").value.trim() : "";
        const status = byId("secretaryInterviewBatchStatus") ? byId("secretaryInterviewBatchStatus").value : "scheduled";

        const scheduleIso = toIsoFromDatetimeLocal(dateTimeRaw);

        if (!scheduleIso) {
            showStatus("Batch date/time is required.", "alert-warning");
            return;
        }

        if (!venue) {
            showStatus("Batch venue is required.", "alert-warning");
            return;
        }

        let targets = filteredRows.filter(function (row) {
            return !isAppLocked(row);
        });

        if (targets.length === 0) {
            showStatus("No editable records in the current filtered view.", "alert-warning");
            return;
        }

        let limited = false;
        if (targets.length > BATCH_APPLY_LIMIT) {
            targets = targets.slice(0, BATCH_APPLY_LIMIT);
            limited = true;
        }

        const applyButton = byId("secretaryInterviewApplyBatchBtn");
        if (applyButton) {
            applyButton.disabled = true;
            applyButton.textContent = "Applying...";
        }

        isProcessing = true;
        showStatus("");

        let successCount = 0;
        let failedCount = 0;

        for (let i = 0; i < targets.length; i += 1) {
            const row = targets[i];
            const formValues = {
                scheduleIso: scheduleIso,
                venue: venue,
                status: status,
                result: row.interview_result || "pending"
            };

            try {
                await upsertInterviewRow(row, formValues);
                await syncApplicationStatus(row, status);
                successCount += 1;
            } catch (error) {
                failedCount += 1;
            }
        }

        await loadInterviewData();

        let message = "Batch schedule applied to " + successCount + " record(s).";
        if (failedCount > 0) {
            message += " " + failedCount + " record(s) failed to update.";
        }
        if (limited) {
            message += " Limited to first " + BATCH_APPLY_LIMIT + " filtered records.";
        }

        showStatus(message, failedCount > 0 ? "alert-warning" : "alert-success");

        if (applyButton) {
            applyButton.disabled = false;
            applyButton.textContent = "Apply to Filtered Records";
        }

        isProcessing = false;
    }

    function bindEvents() {
        const applyFilterBtn = byId("secretaryInterviewApplyFilterBtn");
        const searchInput = byId("secretaryInterviewSearchInput");
        const statusFilter = byId("secretaryInterviewStatusFilter");
        const windowFilter = byId("secretaryInterviewWindowFilter");
        const pagination = byId("secretaryInterviewPagination");
        const tableBody = byId("secretaryInterviewTableBody");
        const applyBatchBtn = byId("secretaryInterviewApplyBatchBtn");

        if (applyFilterBtn) {
            applyFilterBtn.addEventListener("click", function () {
                applyFiltersAndRender(true);
            });
        }

        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    applyFiltersAndRender(true);
                }
            });
        }

        if (statusFilter) {
            statusFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (windowFilter) {
            windowFilter.addEventListener("change", function () {
                applyFiltersAndRender(true);
            });
        }

        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const targetPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(filteredRows.length);
                if (Number.isNaN(targetPage) || targetPage < 1 || targetPage > pageCount) {
                    return;
                }

                currentPage = targetPage;
                applyFiltersAndRender(false);
            });
        }

        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const saveBtn = event.target.closest("button[data-action='save-row']");
                if (!saveBtn) {
                    return;
                }

                const appId = saveBtn.getAttribute("data-app-id") || "";
                if (!appId) {
                    return;
                }

                saveRow(appId, saveBtn);
            });
        }

        if (applyBatchBtn) {
            applyBatchBtn.addEventListener("click", function () {
                applyBatchSchedule();
            });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindEvents();
        await loadInterviewData();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
