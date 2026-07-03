(function () {
    "use strict";

    const PROFILE_CACHE_PREFIX = "ldss:profile-cache:";
    const PROFILE_REMINDER_SESSION_PREFIX = "ldss:profile-reminder:";
    const DISMISSED_NOTIFICATIONS_STORAGE_PREFIX = "ldss:dismissed-notifications:";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const DOC_LABELS = {
        proof_of_enrollment: "Proof of Enrollment",
        report_card: "Report Card",
        barangay_certificate: "Barangay Certificate",
        income_certificate: "Tax Exemption Certificate"
    };

    const DOC_ORDER = ["proof_of_enrollment", "report_card", "barangay_certificate", "income_certificate"];

    const DOC_STATUS_META = {
        pending: { label: "For Review", chipClass: "ldss-chip-accent" },
        verified: { label: "Verified", chipClass: "ldss-chip-success" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        needs_reupload: { label: "Needs Reupload", chipClass: "ldss-chip-danger" },
        missing: { label: "Not Uploaded", chipClass: "ldss-chip-neutral" }
    };

    const INTERVIEW_META = {
        not_scheduled: { label: "Not Scheduled", chipClass: "ldss-chip-neutral" },
        scheduled: { label: "Scheduled", chipClass: "ldss-chip-accent" },
        rescheduled: { label: "Rescheduled", chipClass: "ldss-chip-accent" },
        completed: { label: "Completed", chipClass: "ldss-chip-success" },
        no_show: { label: "No Show", chipClass: "ldss-chip-danger" },
        cancelled: { label: "Cancelled", chipClass: "ldss-chip-danger" }
    };

    const APPLICATION_REMINDER_GROUPS = [
        { label: "Place of Birth", keys: ["placeOfBirth"] },
        { label: "Religion", keys: ["religion"] },
        { label: "Sector Classification", keys: ["additionalData"] },
        {
            label: "Education Background",
            keys: ["highestEducationAttainment", "highestGradeYearLevel", "schoolType", "degreeProgramCourse"]
        },
        {
            label: "Father's Information",
            keys: [
                "fatherStatus",
                "fatherFirstName",
                "fatherMiddleName",
                "fatherLastName",
                "fatherAddress",
                "fatherOccupation",
                "fatherEducationAttainment"
            ]
        },
        {
            label: "Mother's Information",
            keys: [
                "motherStatus",
                "motherFirstName",
                "motherMiddleName",
                "motherMaidenName",
                "motherAddress",
                "motherOccupation",
                "motherEducationAttainment"
            ]
        },
        {
            label: "Family Counts and Income",
            keys: ["totalParentsGrossIncome", "childrenInFamily", "brotherCount", "sisterCount"]
        }
    ];

    const TERMINAL_APPLICATION_STATUSES = ["approved", "waitlisted", "rejected", "released"];
    const MOBILE_DASHBOARD_BREAKPOINT = 768;
    const MOBILE_DASHBOARD_SECTION_IDS = [
        "dashboardRecentActivityCollapse",
        "dashboardRequirementSummaryCollapse",
        "dashboardTimelineCollapse"
    ];

    let notificationsSupportDismissedAt = true;
    let dashboardMobileSectionsBound = false;
    let dashboardMobileSectionMode = "";
    let dashboardRuntime = null;
    let dashboardSelectionRequestId = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) {
                return {
                    label: (status || "-").toString(),
                    chipClass: "ldss-chip-neutral",
                    nextStep: "Wait for an update from the scholarship office."
                };
            },
            nextStepForApplicant: function () {
                return "Wait for an update from the scholarship office.";
            },
            isExamCheckingStage: function () {
                return false;
            },
            examSummaryFromRecord: function () {
                return {
                    controlNo: "-",
                    scoreText: "-",
                    percentageText: "-",
                    status: "pending",
                    statusLabel: "Pending",
                    statusChipClass: "ldss-chip-neutral",
                    resultLabel: "Score Consolidation",
                    resultChipClass: "ldss-chip-accent"
                };
            }
        };
    }

    function profileCacheKey(userId) {
        return PROFILE_CACHE_PREFIX + userId;
    }

    function profileReminderSessionKey(userId) {
        return PROFILE_REMINDER_SESSION_PREFIX + userId;
    }

    function dismissedNotificationsStorageKey(userId) {
        return DISMISSED_NOTIFICATIONS_STORAGE_PREFIX + userId;
    }

    function readDismissedNotificationIds(userId) {
        if (!userId) {
            return new Set();
        }
        try {
            const raw = localStorage.getItem(dismissedNotificationsStorageKey(userId));
            const parsed = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (_error) {
            return new Set();
        }
    }

    function filterDismissedNotifications(rows, userId) {
        if (notificationsSupportDismissedAt) {
            return rows;
        }
        const dismissedIds = readDismissedNotificationIds(userId);
        if (dismissedIds.size === 0) {
            return rows;
        }
        return (rows || []).filter(function (row) {
            return !dismissedIds.has(row.id);
        });
    }

    function isMissingDismissedAtColumnError(error) {
        const message = error && error.message ? error.message : "";
        return /dismissed_at/i.test(message) && /column/i.test(message);
    }

    function valueOrDash(value) {
        const text = (value || "").toString().trim();
        return text || "-";
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

    function hasValue(value) {
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        if (typeof value === "number") {
            return !Number.isNaN(value);
        }
        if (typeof value === "boolean") {
            return true;
        }
        return !!(value || "").toString().trim();
    }

    function joinLabels(labels, limit) {
        const items = (labels || []).filter(Boolean);
        if (!items.length) {
            return "";
        }
        const max = Math.max(1, limit || items.length);
        const visible = items.slice(0, max);
        if (items.length > max) {
            return visible.join(", ") + ", and " + (items.length - max) + " more";
        }
        if (visible.length === 1) {
            return visible[0];
        }
        if (visible.length === 2) {
            return visible[0] + " and " + visible[1];
        }
        return visible.slice(0, -1).join(", ") + ", and " + visible[visible.length - 1];
    }

    function buildReminderListHtml(labels) {
        if (!labels || !labels.length) {
            return "";
        }
        return '<ul class="text-danger ps-3 mb-0">' + labels.map(function (label) {
            return "<li>" + escapeHtml(label) + "</li>";
        }).join("") + "</ul>";
    }

    function profileNeedsGenderReminder(profile) {
        if (!profile) {
            return false;
        }

        return !(profile.sex || "").toString().trim();
    }

    function profileNeedsBarangayReminder(profile) {
        if (!profile) {
            return false;
        }

        const barangay = (profile.barangay || "").toString().trim();
        if (barangay) {
            return false;
        }

        const address = (profile.address || "").toString().trim();
        if (!address) {
            return false;
        }
        return true;
    }

    function getProfileReminderFields(profile) {
        const fields = [];
        if (profileNeedsGenderReminder(profile)) {
            fields.push("gender");
        }
        if (profileNeedsBarangayReminder(profile)) {
            fields.push("barangay");
        }
        return fields;
    }

    function getProfileReminderTarget(profile) {
        const fields = getProfileReminderFields(profile);
        if (fields.indexOf("gender") !== -1) {
            return "gender";
        }
        if (fields.indexOf("barangay") !== -1) {
            return "barangay";
        }
        return "personal";
    }

    function shouldCheckApplicationReminder(latestApplication) {
        if (!latestApplication || !latestApplication.id) {
            return false;
        }
        const normalizedStatus = workflow().normalizeStatus(latestApplication.status);
        return TERMINAL_APPLICATION_STATUSES.indexOf(normalizedStatus) === -1;
    }

    function getApplicationReminderFields(latestApplication, auxMetaState) {
        if (!shouldCheckApplicationReminder(latestApplication) || !auxMetaState || !auxMetaState.available) {
            return [];
        }

        const payload = auxMetaState.payload || {};
        return APPLICATION_REMINDER_GROUPS.reduce(function (labels, group) {
            const isMissing = group.keys.some(function (key) {
                return !hasValue(payload[key]);
            });
            if (isMissing) {
                labels.push(group.label);
            }
            return labels;
        }, []);
    }

    function buildCompletionReminder(profile, latestApplication, auxMetaState) {
        const profileFields = getProfileReminderFields(profile);
        const applicationFields = getApplicationReminderFields(latestApplication, auxMetaState);
        const combinedFields = profileFields.slice();

        if (applicationFields.length) {
            combinedFields.push.apply(combinedFields, applicationFields);
        }
        if (!combinedFields.length) {
            return null;
        }

        const hasActiveApplication = !!(latestApplication && latestApplication.id);
        const applicationNote = hasActiveApplication && latestApplication && latestApplication.submitted_at
            ? " Your submitted application stays active and will not be deleted."
            : "";
        const primaryUrl = hasActiveApplication
            ? "applicant-application-form.html?application_id=" + encodeURIComponent(latestApplication.id)
            : "applicant-profile.html?complete=" + encodeURIComponent(getProfileReminderTarget(profile));
        const buttonLabel = hasActiveApplication ? "Update Information" : "Update My Profile";
        const summaryLabels = profileFields.map(function (field) {
            return field === "gender" ? "Gender" : "Barangay";
        }).concat(applicationFields);
        const summaryText = joinLabels(summaryLabels, 3);
        const title = applicationFields.length
            ? (profileFields.length ? "Complete Your Record" : "Complete Missing Application Details")
            : (profileFields.length === 1 && profileFields[0] === "gender" ? "Update Your Gender" : "Complete Your Profile");

        let leadText = "Please update the missing information below.";
        if (applicationFields.length && hasActiveApplication) {
            leadText = "Please update the missing application details below.";
        }
        if (profileFields.length && applicationFields.length) {
            leadText = "Please update the missing profile and application details below.";
        }

        const modalText = leadText + applicationNote + (hasActiveApplication
            ? " Open your current application and save the missing information."
            : " Open My Profile to complete your record.");

        return {
            title: title,
            buttonLabel: buttonLabel,
            buttonUrl: primaryUrl,
            bannerHtml:
                "Reminder: please complete " + escapeHtml(summaryText) + "." +
                applicationNote +
                ' <a href="' + escapeHtml(primaryUrl) + '" class="alert-link">' + escapeHtml(buttonLabel) + "</a>.",
            modalHtml:
                '<p class="mb-3">' + escapeHtml(modalText) + "</p>" +
                buildReminderListHtml(summaryLabels)
        };
    }

    function workflowControls() {
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS || {};
    }

    function applicantExamScoresVisible() {
        return workflowControls().show_applicant_exam_scores !== false;
    }

    function isMissingApplicationsColumnError(error, columnName) {
        const needle = (columnName || "").toString().trim().toLowerCase();
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        return !!needle && text.includes(needle) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
    }

    function hasSectorClassification(value) {
        const raw = (value || "").toString().trim();
        return !!raw && raw.toLowerCase() !== "none of the above";
    }

    function isSectorSelectedApplication(application, approvalRecord) {
        return Boolean(application && (application.sector_selected === true || application.is_sector_selected === true));
    }

    function postedExamResultMeta(examSummary, specialConsideration, sectorSelected, sectorClassification) {
        return workflow().applicantExamDisplayMeta(examSummary, {
            specialConsideration: specialConsideration === true,
            sectorSelected: sectorSelected === true,
            showFailedScore: applicantExamScoresVisible(),
            sectorClassification: sectorClassification || ""
        });
    }

    function maskedApplicantStatusValue(status, specialConsideration, sectorSelected) {
        if (workflow().applicantVisibleStatus) {
            return workflow().applicantVisibleStatus(status, specialConsideration === true, sectorSelected === true);
        }
        const normalized = workflow().normalizeStatus(status || "");
        if (specialConsideration === true && (normalized === "exam_completed" || normalized === "passed_exam" || normalized === "failed_exam")) {
            return "passed_exam";
        }
        if (sectorSelected === true && (normalized === "exam_completed" || normalized === "passed_exam" || normalized === "failed_exam")) {
            return "selected";
        }
        return normalized;
    }

    function getProfileReminderModal() {
        const modalEl = byId("profileReminderModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        return window.bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    function setProfileReminderDismissed(userId) {
        if (!userId) {
            return;
        }
        try {
            sessionStorage.setItem(profileReminderSessionKey(userId), "dismissed");
        } catch (error) {
            // Non-fatal: sessionStorage may be disabled.
        }
    }

    function clearProfileReminderDismissed(userId) {
        if (!userId) {
            return;
        }
        try {
            sessionStorage.removeItem(profileReminderSessionKey(userId));
        } catch (error) {
            // Non-fatal: sessionStorage may be disabled.
        }
    }

    function shouldShowProfileReminderModal(userId, reminder) {
        if (!userId || !reminder) {
            return false;
        }
        try {
            return sessionStorage.getItem(profileReminderSessionKey(userId)) !== "dismissed";
        } catch (error) {
            return true;
        }
    }

    function showProfileReminderModal(userId, reminder) {
        const modal = getProfileReminderModal();
        const titleEl = byId("profileReminderModalLabel");
        const messageEl = byId("profileReminderModalMessage");
        const updateBtn = byId("profileReminderModalUpdateBtn");

        if (!reminder) {
            return;
        }

        if (titleEl) {
            titleEl.textContent = reminder.title || "Complete Your Record";
        }
        if (messageEl) {
            messageEl.innerHTML = reminder.modalHtml || "";
        }
        if (updateBtn) {
            updateBtn.textContent = reminder.buttonLabel || "Update Now";
            updateBtn.setAttribute("data-reminder-url", reminder.buttonUrl || "applicant-profile.html");
        }
        setProfileReminderDismissed(userId);
        if (modal) {
            modal.show();
        }
    }

    function setText(id, value) {
        const el = byId(id);
        if (el) {
            el.textContent = valueOrDash(value);
        }
    }

    function setHtml(id, value) {
        const el = byId(id);
        if (el) {
            el.innerHTML = value || "";
        }
    }

    function setChip(id, label, chipClass) {
        const el = byId(id);
        if (!el) {
            return;
        }
        el.className = "ldss-chip " + (chipClass || "ldss-chip-neutral");
        el.textContent = valueOrDash(label);
    }

    function showStatus(message, type, isHtml) {
        const el = byId("dashboardStatus");
        if (!el) {
            return;
        }
        if (!message) {
            el.className = "alert d-none";
            el.textContent = "";
            el.innerHTML = "";
            return;
        }
        el.className = "alert " + (type || "alert-info");
        if (isHtml) {
            el.innerHTML = message;
            return;
        }
        el.textContent = message;
    }

    function formatDateOnly(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "-";
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
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
        const dateLabel = formatDateOnly(dateValue);
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

    function statusMeta(status) {
        if (workflow().applicantStatusMeta) {
            return workflow().applicantStatusMeta(status);
        }
        return workflow().statusMeta(status);
    }

    function interviewMeta(status) {
        return INTERVIEW_META[status] || { label: valueOrDash(status), chipClass: "ldss-chip-neutral" };
    }

    function setActionLink(anchorId, href, text, disabled, hint) {
        const el = byId(anchorId);
        if (!el) {
            return;
        }
        el.textContent = text;
        if (disabled) {
            el.href = "javascript:void(0);";
            el.classList.add("ldss-btn-disabled-hint");
            el.setAttribute("aria-disabled", "true");
            if (hint) {
                el.setAttribute("title", hint);
            } else {
                el.removeAttribute("title");
            }
            return;
        }
        el.href = href;
        el.classList.remove("ldss-btn-disabled-hint");
        el.removeAttribute("aria-disabled");
        el.removeAttribute("title");
    }

    function latestDocByType(documents) {
        const map = {};
        (documents || []).forEach(function (doc) {
            const key = doc.document_type;
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

    function renderRequirementSummary(documents) {
        const wrapper = byId("dashboardRequirementSummary");
        if (!wrapper) {
            return;
        }

        const latest = latestDocByType(documents || []);
        const hasUploadedDocument = DOC_ORDER.some(function (docType) {
            return !!latest[docType];
        });

        if (!hasUploadedDocument) {
            wrapper.innerHTML = '<div class="ldss-dashboard-empty">No requirement uploads yet for your current application.</div>';
            return;
        }

        wrapper.innerHTML = DOC_ORDER.map(function (docType, index) {
            const row = latest[docType];
            const status = row ? row.verification_status : "missing";
            const meta = DOC_STATUS_META[status] || DOC_STATUS_META.missing;
            const dateText = row && row.created_at ? shortDateLabel(row.created_at) : "Not uploaded";
            const itemClass = index === DOC_ORDER.length - 1 ? "ldss-dashboard-list-item mb-0" : "ldss-dashboard-list-item";
            return (
                '<div class="' + itemClass + '">' +
                '<div class="d-flex justify-content-between align-items-start gap-3">' +
                '<div class="min-w-0">' +
                '<div class="ldss-dashboard-list-title">' + escapeHtml(DOC_LABELS[docType] || docType) + "</div>" +
                '<div class="ldss-dashboard-list-meta">' + escapeHtml(dateText) + "</div>" +
                "</div>" +
                '<span class="ldss-chip ' + meta.chipClass + '">' + meta.label + "</span>" +
                "</div>" +
                "</div>"
            );
        }).join("");
    }

    function dedupeEvents(events) {
        const seen = new Set();
        return events.filter(function (event) {
            const key = event.label + "|" + (event.at || "");
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    function buildDashboardEvents(application, examRecord, interviewRecord, approvalRecord, notifications, examRank, specialConsideration) {
        const events = [];
        const sectorSelected = isSectorSelectedApplication(application, approvalRecord);
        if (application) {
            events.push({ label: "Draft created", at: application.created_at });
            if (application.submitted_at) {
                events.push({ label: "Application submitted", at: application.submitted_at });
            }
            if (application.updated_at && application.status) {
                events.push({
                    label: "Current status: " + statusMeta(maskedApplicantStatusValue(application.status, approvalRecord && approvalRecord.special_endorsement, sectorSelected)).label,
                    at: application.updated_at
                });
            }
        }

        if (examRecord && examRecord.updated_at) {
            const examSummary = workflow().examSummaryFromRecord(examRecord);
            const postedResult = postedExamResultMeta(examSummary, specialConsideration === true, sectorSelected, application && application.sector_classification);
            const scoresVisible = applicantExamScoresVisible();
            const rankLabel = examRank !== null && typeof examRank !== "undefined" ? ("RANK " + String(examRank)) : "";
            events.push({
                label: examSummary.status === "absent"
                    ? "Examination status: Absent"
                    : (
                        (postedResult.result === "passed" || postedResult.result === "failed")
                            ? ("Exam result: " + postedResult.displayText + ((postedResult.result === "passed" && postedResult.hasScore && rankLabel) ? (" | " + rankLabel) : ""))
                            : (postedResult.result === "selected")
                                ? ("Exam result: " + postedResult.displayText)
                            : (!scoresVisible ? ("Exam result: " + (postedResult.displayText || "Scores are being consolidated")) : ("Exam result: " + examSummary.resultLabel))
                    ),
                at: examRecord.updated_at
            });
        }

        if (interviewRecord && interviewRecord.scheduled_at) {
            events.push({ label: "Interview scheduled", at: interviewRecord.scheduled_at });
        }

        if (approvalRecord && approvalRecord.decided_at && approvalRecord.decision_status) {
            events.push({
                label: "Final decision: " + approvalRecord.decision_status.replace(/_/g, " "),
                at: approvalRecord.decided_at
            });
        }

        (notifications || []).slice(0, 2).forEach(function (row) {
            const label = row.title ? "Notification: " + row.title : "Notification update";
            events.push({ label: label, at: row.created_at });
        });

        return dedupeEvents(events).filter(function (event) {
            return !!event.at;
        });
    }

    function renderRecentActivity(events) {
        const list = byId("dashboardRecentActivityList");
        if (!list) {
            return;
        }

        if (!events.length) {
            list.innerHTML =
                '<li class="list-group-item px-0">' +
                '<div class="small fw-600">No recent activity yet.</div>' +
                '<div class="small text-muted">Start by creating your scholarship application.</div>' +
                "</li>";
            return;
        }

        const rows = events
            .slice()
            .sort(function (a, b) {
                return new Date(b.at).getTime() - new Date(a.at).getTime();
            })
            .slice(0, 5);

        list.innerHTML = rows.map(function (event) {
            return (
                '<li class="list-group-item px-0">' +
                '<div class="small fw-600">' + escapeHtml(event.label) + "</div>" +
                '<div class="small text-muted">' + escapeHtml(formatDateTime(event.at)) + "</div>" +
                "</li>"
            );
        }).join("");
    }

    function renderTimeline(events) {
        const list = byId("dashboardTimelineList");
        if (!list) {
            return;
        }
        if (!events.length) {
            list.innerHTML =
                '<li class="ldss-timeline-item">' +
                '<div class="small fw-600">No timeline yet.</div>' +
                '<div class="small text-muted">Submit your first application to begin tracking.</div>' +
                "</li>";
            return;
        }
        const rows = events
            .slice()
            .sort(function (a, b) {
                return new Date(a.at).getTime() - new Date(b.at).getTime();
            })
            .slice(-6);

        list.innerHTML = rows.map(function (event) {
            return (
                '<li class="ldss-timeline-item">' +
                '<div class="small fw-600">' + escapeHtml(event.label) + "</div>" +
                '<div class="small text-muted">' + escapeHtml(formatDateTime(event.at)) + "</div>" +
                "</li>"
            );
        }).join("");
    }

    function resolveNotificationLink(row) {
        const raw = row.related_url ? row.related_url.trim() : "";
        if (raw) {
            const lower = raw.toLowerCase();
            if (lower.startsWith("javascript:")) {
                return "applicant-notifications.html";
            }
            return raw;
        }
        if (row.related_application_id) {
            return "application-detail.html?id=" + encodeURIComponent(row.related_application_id);
        }
        return "applicant-notifications.html";
    }

    function notificationSummaryLabel(row) {
        const title = (row && row.title ? row.title : "").toString().toLowerCase();
        const message = (row && row.message ? row.message : "").toString().toLowerCase();

        if (title.includes("returned for correction") || message.includes("returned for correction")) {
            return "For Resubmission";
        }
        if (
            title.includes("compliance notice") ||
            title.includes("photo needs change") ||
            message.includes("need to comply") ||
            message.includes("replace your applicant 1x1 photo")
        ) {
            return "For Update";
        }
        return "General Notice";
    }

    function renderNotificationDropdown(rows, unreadCount) {
        const bell = byId("applicantAlerts");
        const bellCount = byId("dashboardAlertsBellCount");
        const pill = byId("dashboardAlertsUnreadPill");
        const list = byId("dashboardAlertsList");
        if (!list || !bell || !pill || !bellCount) {
            return;
        }

        if (unreadCount > 0) {
            const displayCount = unreadCount > 99 ? "99+" : unreadCount.toString();
            pill.textContent = displayCount;
            bellCount.textContent = displayCount;
            pill.classList.remove("d-none");
            bellCount.classList.remove("d-none");
            bell.classList.remove("ldss-bell-muted");
            bell.classList.add("ldss-bell-count-active");
            bell.setAttribute("aria-label", displayCount + " unread notifications");
        } else {
            pill.classList.add("d-none");
            bellCount.classList.add("d-none");
            bell.classList.add("ldss-bell-muted");
            bell.classList.remove("ldss-bell-count-active");
            bell.setAttribute("aria-label", "No unread notifications");
        }

        if (!rows.length) {
            list.innerHTML = '<span class="dropdown-item small text-muted">No notifications yet.</span>';
            return;
        }

        list.classList.add("ldss-applicant-alerts-list");
        list.innerHTML = rows.map(function (row) {
            const link = resolveNotificationLink(row);
            const title = notificationSummaryLabel(row);
            const titleClass = row.is_read ? "" : " fw-600";
            return (
                '<a class="dropdown-item small ldss-applicant-alert-item" href="' + escapeHtml(link) + '">' +
                '<span class="small ldss-applicant-alert-item-title' + titleClass + '">' + escapeHtml(title) + "</span>" +
                "</a>"
            );
        }).join("");
    }

    function renderCards(application, examRecord, interviewRecord, approvalRecord, intakePolicy, specialConsideration, examRank) {
        if (!application) {
            const intakeClosed = !!(intakePolicy && !intakePolicy.isOpen);
            setText("dashboardCurrentApplicationValue", "No Application");
            setChip(
                "dashboardCurrentApplicationChip",
                intakeClosed ? "Filing Closed" : "Start New Application",
                intakeClosed ? "ldss-chip-danger" : "ldss-chip-neutral"
            );

            setText("dashboardExamValue", "No Exam Record");
            setChip("dashboardExamChip", "Pending", "ldss-chip-neutral");

            setText("dashboardInterviewValue", "Not Scheduled");
            setChip("dashboardInterviewChip", "Pending", "ldss-chip-neutral");

            setText("dashboardNextStepValue", intakeClosed ? "Wait for filing to reopen" : "Create Application");
            setChip("dashboardNextStepChip", intakeClosed ? "Closed" : "Draft", intakeClosed ? "ldss-chip-danger" : "ldss-chip-neutral");
            return;
        }

        const sectorSelected = isSectorSelectedApplication(application, approvalRecord);
        const effectiveStatus = maskedApplicantStatusValue(application.status, specialConsideration, sectorSelected);
        const appMeta = statusMeta(effectiveStatus);
        const normalizedStatus = workflow().normalizeStatus(effectiveStatus);

        setText("dashboardCurrentApplicationValue", appMeta.label);
        setChip("dashboardCurrentApplicationChip", application.application_no || "Active Application", appMeta.chipClass);

        const examSummary = workflow().examSummaryFromRecord(examRecord);
        const hasNumericExam = examSummary.scoreText !== "-";
        const examScoresVisible = applicantExamScoresVisible();
        const postedResult = postedExamResultMeta(examSummary, specialConsideration, sectorSelected, application && application.sector_classification);
        const rankLabel = examRank !== null && typeof examRank !== "undefined" ? ("RANK " + String(examRank)) : "";
        let examValue = "No score yet";
        let examHtml = "";

        if ((examSummary.status || "").toString() === "absent") {
            examValue = "Absent from examination";
        } else if (postedResult.result === "passed" || postedResult.result === "failed") {
            examValue = postedResult.displayText;
            if (postedResult.result === "passed" && postedResult.hasScore && rankLabel) {
                examValue += " | " + rankLabel;
            }
        } else if (postedResult.result === "selected") {
            const sectorText = postedResult.sectorClassificationText || "Sector Classification";
            const scorePart = postedResult.hasScore
                ? '<span class="text-danger fw-700">' + escapeHtml(postedResult.scoreText) + '</span><span class="text-muted">|</span>'
                : "";
            examHtml = '<span class="d-inline-flex flex-column align-items-start lh-1">'
                + '<span class="d-inline-flex align-items-center flex-wrap gap-1 lh-1">'
                + scorePart
                + '<span class="text-success fw-700 text-uppercase">SELECTED</span>'
                + '</span>'
                + '<span class="small text-muted fw-semibold mt-1">Sector Classification: ' + escapeHtml(sectorText) + '</span>'
                + "</span>";
        } else if (hasNumericExam && examScoresVisible) {
            examValue = "Raw: " + examSummary.scoreText;
        } else if (hasNumericExam && !examScoresVisible) {
            examValue = "Scores are being consolidated";
        } else if (workflow().isExamCheckingStage && workflow().isExamCheckingStage(application.status)) {
            examValue = "Scores are being consolidated";
        } else if (normalizedStatus === "exam_completed") {
            examValue = "Scores are being consolidated";
        } else if (normalizedStatus === "pending_exam" || normalizedStatus === "exam_scheduled") {
            examValue = "Exam processing";
        }

        if (postedResult.result === "selected") {
            setHtml("dashboardExamValue", examHtml);
        } else {
            setText("dashboardExamValue", examValue);
        }
        setChip(
            "dashboardExamChip",
            examSummary.status === "absent"
                ? "No Result"
                : ((postedResult.result === "passed" || postedResult.result === "failed" || postedResult.result === "selected")
                    ? postedResult.chipLabel
                    : (!examScoresVisible ? postedResult.chipLabel : examSummary.resultLabel)),
            examSummary.status === "absent"
                ? "ldss-chip-neutral"
                : ((postedResult.result === "passed" || postedResult.result === "failed" || postedResult.result === "selected")
                    ? postedResult.chipClass
                    : (!examScoresVisible ? postedResult.chipClass : examSummary.resultChipClass))
        );

        if (interviewRecord && interviewRecord.scheduled_at) {
            const iMeta = interviewMeta(interviewRecord.status);
            setText("dashboardInterviewValue", formatDateOnly(interviewRecord.scheduled_at));
            setChip("dashboardInterviewChip", iMeta.label, iMeta.chipClass);
        } else {
            const waitingInterview = ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified", "for_approval", "approved", "waitlisted", "for_release", "released"].includes(normalizedStatus);
            setText("dashboardInterviewValue", waitingInterview ? "Awaiting/Processed" : "Not Scheduled");
            setChip("dashboardInterviewChip", waitingInterview ? "Follow Tracking" : "Pending", waitingInterview ? "ldss-chip-accent" : "ldss-chip-neutral");
        }

        let nextStep = workflow().nextStepForApplicant(effectiveStatus);
        let nextChipLabel = appMeta.label;
        let nextChipClass = appMeta.chipClass;

        if (approvalRecord && approvalRecord.decision_status) {
            const decision = approvalRecord.decision_status;
            if (decision === "approved") {
                nextStep = "You are approved. Wait for release schedule.";
                nextChipLabel = "Approved";
                nextChipClass = "ldss-chip-success";
            } else if (decision === "waitlisted") {
                nextStep = "You are waitlisted. Monitor slot availability updates.";
                nextChipLabel = "Waitlisted";
                nextChipClass = "ldss-chip-accent";
            } else if (decision === "rejected") {
                nextStep = "Application closed for this cycle.";
                nextChipLabel = "Rejected";
                nextChipClass = "ldss-chip-danger";
            }
        }

        setText("dashboardNextStepValue", nextStep);
        setChip("dashboardNextStepChip", nextChipLabel, nextChipClass);
    }

    function renderStatusOverview(application, approvalRecord, intakePolicy, examRecord, interviewRecord, specialConsideration, examRank) {
        const metaText = byId("dashboardStatusMetaText");
        const grantValue = byId("dashboardGrantValue");
        const submittedValue = byId("dashboardSubmittedOnValue");
        const submittedAt = application && application.submitted_at ? formatDateOnly(application.submitted_at) : "";
        const updatedAt = application ? formatDateOnly(application.updated_at || application.created_at || application.submitted_at) : "";

        renderCards(application, examRecord || null, interviewRecord || null, approvalRecord, intakePolicy, specialConsideration, examRank);

        if (!application) {
            if (metaText) {
                metaText.textContent = (intakePolicy && !intakePolicy.isOpen)
                    ? intakeClosedMessage(intakePolicy)
                    : "You do not have an application yet.";
            }
            if (grantValue) {
                grantValue.textContent = "-";
            }
            if (submittedValue) {
                submittedValue.textContent = "-";
            }
            return;
        }

        if (grantValue) {
            grantValue.textContent = formatScholarshipType(application.scholarship_type);
        }
        if (submittedValue) {
            submittedValue.textContent = submittedAt || "-";
        }

        if (metaText) {
            metaText.textContent = updatedAt && updatedAt !== "-"
                ? "Last updated " + updatedAt + "."
                : "Latest application activity is available in My Applications.";
        }
    }

    function formatScholarshipType(value) {
        const text = (value || "").toString().trim();
        if (!text) {
            return "-";
        }
        return text.replace(/_/g, " ").toUpperCase();
    }

    function formatProfileName(profile) {
        if (!profile) {
            return "";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });
        return parts.join(" ");
    }

    function readProfileCache(userId) {
        if (!userId) {
            return null;
        }
        try {
            const raw = localStorage.getItem(profileCacheKey(userId));
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    function writeProfileCache(userId, profile) {
        if (!userId || !profile) {
            return;
        }
        try {
            localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
        } catch (error) {
            // Non-fatal.
        }
    }

    function renderProfileHeader(profile, fallbackEmail) {
        const accountHeader = byId("dashboardAccountHeader");
        const welcomeText = byId("dashboardWelcomeText");
        const profileName = formatProfileName(profile);
        const displayName = profileName || (fallbackEmail || "").toString().trim() || "Applicant";

        if (accountHeader) {
            accountHeader.textContent = displayName;
        }
        if (welcomeText) {
            welcomeText.textContent = "Welcome, " + displayName + ".";
        }
    }

    function latestApplicationFromList(applications) {
        return Array.isArray(applications) && applications.length ? applications[0] : null;
    }

    function applicationOptionLabel(application) {
        if (!application) {
            return "No application";
        }

        return (application.application_no || "").toString().trim() || "Application Record";
    }

    function renderApplicationSelector(applications, selectedId) {
        const select = byId("dashboardApplicationSelect");
        if (!select) {
            return;
        }

        const rows = Array.isArray(applications) ? applications : [];
        if (!rows.length) {
            select.innerHTML = '<option value="">No applications yet</option>';
            select.disabled = true;
            return;
        }

        select.innerHTML = rows.map(function (application) {
            const label = applicationOptionLabel(application);
            return '<option value="' + escapeHtml(application.id) + '">' + escapeHtml(label) + "</option>";
        }).join("");

        const targetId = rows.some(function (application) { return application.id === selectedId; })
            ? selectedId
            : rows[0].id;

        select.value = targetId;
        select.disabled = false;
    }

    function renderApplicationSelectorMeta(application, applications) {
        const help = byId("dashboardApplicationSelectHelp");
        if (!help) {
            return;
        }

        const total = Array.isArray(applications) ? applications.length : 0;
        if (!application) {
            help.textContent = total
                ? "Choose one of your application records to load its dashboard details."
                : "No application record yet. Start a new application to begin.";
            return;
        }

        help.textContent = total > 1
            ? ("Showing the selected application details. " + total + " records available.")
            : "Showing the selected application details.";
    }

    function setApplicationSelectorBusy(isBusy) {
        const select = byId("dashboardApplicationSelect");
        if (!select) {
            return;
        }

        const hasUsableOption = Array.from(select.options).some(function (option) {
            return !!(option && option.value);
        });

        select.disabled = !!isBusy || !hasUsableOption;
        if (isBusy) {
            select.setAttribute("aria-busy", "true");
        } else {
            select.removeAttribute("aria-busy");
        }
    }

    function shortDateLabel(value) {
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

    function truncateText(value, maxLength) {
        const text = (value || "").toString().trim();
        const limit = Number(maxLength) > 0 ? Number(maxLength) : 120;
        if (!text || text.length <= limit) {
            return text;
        }
        return text.slice(0, limit - 3).trim() + "...";
    }

    function buildInitials(label) {
        const words = (label || "")
            .toString()
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        if (!words.length) {
            return "AP";
        }

        return words
            .slice(0, 2)
            .map(function (word) { return word.charAt(0).toUpperCase(); })
            .join("");
    }

    function effectiveApplicantStatus(application, approvalRecord, specialConsideration) {
        if (!application) {
            return "";
        }
        const sectorSelected = isSectorSelectedApplication(application, approvalRecord);
        return maskedApplicantStatusValue(application.status, specialConsideration, sectorSelected);
    }

    function reviewStarted(application, examRecord, interviewRecord, approvalRecord) {
        if (!application) {
            return false;
        }
        const normalized = workflow().normalizeStatus(application.status);
        return (
            [
                "pending_exam",
                "exam_scheduled",
                "exam_completed",
                "passed_exam",
                "failed_exam",
                "selected",
                "for_interview",
                "interview_scheduled",
                "interview_completed",
                "hard_copy_verified",
                "for_approval",
                "approved",
                "waitlisted",
                "rejected",
                "for_release",
                "released",
                "special_endorsement_review"
            ].indexOf(normalized) !== -1
        ) || !!examRecord || !!interviewRecord || !!approvalRecord;
    }

    function latestDocumentTimestamp(documents) {
        const rows = Array.isArray(documents) ? documents : [];
        if (!rows.length) {
            return "";
        }

        return rows.reduce(function (latest, row) {
            const current = row && row.created_at ? row.created_at : "";
            if (!latest) {
                return current;
            }
            return new Date(current).getTime() > new Date(latest).getTime() ? current : latest;
        }, "");
    }

    function requirementsSummaryMeta(documents) {
        const latest = latestDocByType(documents || []);
        const total = DOC_ORDER.length;
        const uploadedCount = DOC_ORDER.filter(function (docType) {
            return !!latest[docType];
        }).length;
        const verifiedCount = DOC_ORDER.filter(function (docType) {
            return latest[docType] && latest[docType].verification_status === "verified";
        }).length;

        let label = "Pending";
        let chipClass = "ldss-chip-neutral";
        let value = "Not started";
        let help = "Upload the required documents to complete your application.";

        if (uploadedCount > 0 && uploadedCount < total) {
            label = "Incomplete";
            chipClass = "ldss-chip-accent";
            value = uploadedCount + " of " + total + " uploaded";
            help = uploadedCount + " requirement(s) uploaded so far.";
        } else if (uploadedCount === total && total > 0) {
            label = verifiedCount === total ? "Verified" : "Complete";
            chipClass = verifiedCount === total ? "ldss-chip-success" : "ldss-chip-info";
            value = "Complete";
            help = verifiedCount === total
                ? "All visible requirements are already verified."
                : "All visible requirements are uploaded.";
        }

        return {
            total: total,
            uploadedCount: uploadedCount,
            verifiedCount: verifiedCount,
            label: label,
            chipClass: chipClass,
            value: value,
            help: help
        };
    }

    function renderDashboardHero(profile, fallbackEmail, application, approvalRecord, specialConsideration) {
        const displayName = formatProfileName(profile) || (fallbackEmail || "").toString().trim() || "Applicant";
        const effectiveStatus = effectiveApplicantStatus(application, approvalRecord, specialConsideration);
        const appMeta = effectiveStatus ? statusMeta(effectiveStatus) : null;

        setText("dashboardHeroWelcomeName", displayName);
        setText("dashboardProfileInitials", buildInitials(displayName));
        setText(
            "dashboardHeroApplicationNo",
            application && application.application_no
                ? ("Application ID: " + application.application_no)
                : "Application ID: -"
        );

        if (application && application.submitted_at) {
            setText("dashboardHeroSubmittedText", "Submitted on " + formatDateTime(application.submitted_at));
        } else if (application && application.updated_at) {
            setText("dashboardHeroSubmittedText", "Draft updated on " + formatDateTime(application.updated_at));
        } else {
            setText("dashboardHeroSubmittedText", "No submitted record yet.");
        }

        setChip(
            "dashboardHeroStatusChip",
            appMeta ? appMeta.label : "No Application",
            appMeta ? appMeta.chipClass : "ldss-chip-neutral"
        );
        setChip(
            "dashboardHeroProgressChip",
            application ? formatScholarshipType(application.scholarship_type) : "No Grant Yet",
            application ? "ldss-chip-info" : "ldss-chip-neutral"
        );
    }

    function renderDashboardOverviewCards(application, documents, notificationsData, examRecord, examBatch, approvalRecord, intakePolicy, specialConsideration, examRank) {
        const effectiveStatus = effectiveApplicantStatus(application, approvalRecord, specialConsideration);
        const appMeta = effectiveStatus ? statusMeta(effectiveStatus) : null;
        const requirementsMeta = requirementsSummaryMeta(documents);
        const unreadCount = notificationsData && typeof notificationsData.unreadCount === "number"
            ? notificationsData.unreadCount
            : 0;
        const notificationRows = notificationsData && Array.isArray(notificationsData.rows)
            ? notificationsData.rows
            : [];
        const nextStep = application
            ? workflow().nextStepForApplicant(effectiveStatus)
            : ((intakePolicy && !intakePolicy.isOpen)
                ? intakeClosedMessage(intakePolicy)
                : "Create your scholarship application to begin the process.");

        setText("dashboardApplicationStatusValue", appMeta ? appMeta.label : "No Application");
        setChip(
            "dashboardApplicationStatusChip",
            application ? formatScholarshipType(application.scholarship_type) : "Ready to Apply",
            appMeta ? appMeta.chipClass : "ldss-chip-neutral"
        );
        setText("dashboardApplicationStatusHelp", nextStep);

        if (!application) {
            setText("dashboardRequirementsValue", "No application yet");
            setChip("dashboardRequirementsChip", "Pending", "ldss-chip-neutral");
            setText("dashboardRequirementsHelp", "Create an application first before uploading requirements.");
        } else {
            setText("dashboardRequirementsValue", requirementsMeta.value);
            setChip("dashboardRequirementsChip", requirementsMeta.label, requirementsMeta.chipClass);
            setText("dashboardRequirementsHelp", requirementsMeta.help);
        }

        const examSummary = workflow().examSummaryFromRecord(examRecord);
        const postedResult = postedExamResultMeta(
            examSummary,
            specialConsideration === true,
            isSectorSelectedApplication(application, approvalRecord),
            application && application.sector_classification
        );
        const examScheduleAt = (examRecord && examRecord.scheduled_at) || (examBatch && examBatch.exam_datetime) || "";
        const examScheduleValue = examScheduleAt ? shortDateLabel(examScheduleAt) : "Not yet available";
        const examScheduleHelp = examBatch && examBatch.venue
            ? examBatch.venue
            : (application ? "Pending official schedule posting." : "Waiting for your application to be submitted.");
        let examChipLabel = examScheduleAt ? "Scheduled" : "Pending";
        let examChipClass = examScheduleAt ? "ldss-chip-accent" : "ldss-chip-neutral";

        if (postedResult.result === "passed" || postedResult.result === "failed" || postedResult.result === "selected") {
            examChipLabel = postedResult.chipLabel;
            examChipClass = postedResult.chipClass;
        }

        setText("dashboardExamScheduleValue", examScheduleValue);
        setChip("dashboardExamScheduleChip", examChipLabel, examChipClass);
        setText("dashboardExamScheduleHelp", examScheduleHelp);

        setText("dashboardNotificationsValue", String(unreadCount));
        setChip(
            "dashboardNotificationsChip",
            unreadCount > 0 ? "Unread" : "No New",
            unreadCount > 0 ? "ldss-chip-accent" : "ldss-chip-neutral"
        );
        setText(
            "dashboardNotificationsHelp",
            notificationRows.length
                ? truncateText(notificationRows[0].title || notificationRows[0].message || "Latest notification received.", 72)
                : "No notifications yet from the scholarship office."
        );
    }

    function buildDashboardProgressSteps(user, profile, application, auxMetaState, documents, examRecord, interviewRecord, approvalRecord) {
        const payload = auxMetaState && auxMetaState.available && auxMetaState.payload
            ? auxMetaState.payload
            : {};
        const requirementsMeta = requirementsSummaryMeta(documents);
        const personalComplete = !!(
            profile
            && hasValue(profile.first_name)
            && hasValue(profile.last_name)
            && hasValue(profile.sex)
            && hasValue(profile.barangay)
            && hasValue(profile.address)
            && hasValue(profile.mobile_number)
        );
        const familyComplete = !!(
            hasValue(payload.fatherStatus)
            && hasValue(payload.motherStatus)
            && hasValue(payload.totalParentsGrossIncome)
        );
        const educationComplete = !!(
            hasValue(payload.highestEducationAttainment)
            && hasValue(payload.highestGradeYearLevel)
            && hasValue(payload.schoolType)
            && hasValue(payload.degreeProgramCourse)
        );
        const submitted = !!(application && application.submitted_at);
        const officeReview = reviewStarted(application, examRecord, interviewRecord, approvalRecord);
        const officeReviewDate = approvalRecord && (approvalRecord.decided_at || approvalRecord.updated_at)
            ? (approvalRecord.decided_at || approvalRecord.updated_at)
            : interviewRecord && (interviewRecord.updated_at || interviewRecord.scheduled_at)
                ? (interviewRecord.updated_at || interviewRecord.scheduled_at)
                : examRecord && (examRecord.updated_at || examRecord.scheduled_at)
                    ? (examRecord.updated_at || examRecord.scheduled_at)
                    : (application && application.updated_at ? application.updated_at : "");

        const rawSteps = [
            {
                label: "Account Created",
                complete: !!(user && user.created_at),
                meta: user && user.created_at ? shortDateLabel(user.created_at) : "Create account"
            },
            {
                label: "Personal Information",
                complete: personalComplete,
                meta: personalComplete
                    ? shortDateLabel((profile && profile.updated_at) || (application && application.created_at) || (user && user.created_at))
                    : "Complete your profile"
            },
            {
                label: "Family Background",
                complete: familyComplete,
                meta: familyComplete
                    ? shortDateLabel((application && application.updated_at) || (profile && profile.updated_at) || "")
                    : "Add family details"
            },
            {
                label: "Educational Background",
                complete: educationComplete,
                meta: educationComplete
                    ? shortDateLabel((application && application.updated_at) || (profile && profile.updated_at) || "")
                    : "Add education details"
            },
            {
                label: "Requirements Uploaded",
                complete: requirementsMeta.uploadedCount === requirementsMeta.total && requirementsMeta.total > 0,
                meta: requirementsMeta.uploadedCount
                    ? (requirementsMeta.uploadedCount + " of " + requirementsMeta.total + " uploaded")
                    : "Upload requirements"
            },
            {
                label: "Submitted",
                complete: submitted,
                meta: submitted
                    ? shortDateLabel(application.submitted_at)
                    : (application ? "Submit your application" : "Create application")
            },
            {
                label: "Office Review",
                complete: officeReview,
                meta: officeReview
                    ? shortDateLabel(officeReviewDate)
                    : "Waiting for review"
            }
        ];

        let activeAssigned = false;
        return rawSteps.map(function (step) {
            if (step.complete) {
                return Object.assign({ state: "complete" }, step);
            }
            if (!activeAssigned) {
                activeAssigned = true;
                return Object.assign({ state: "active" }, step);
            }
            return Object.assign({ state: "pending" }, step);
        });
    }

    function renderDashboardProgress(steps) {
        const wrapper = byId("dashboardProgressList");
        if (!wrapper) {
            return;
        }

        if (!steps || !steps.length) {
            wrapper.innerHTML = '<div class="ldss-dashboard-empty">No application progress to show yet.</div>';
            return;
        }

        wrapper.innerHTML = '<div class="ldss-dashboard-progress-track">' + steps.map(function (step, index) {
            const nodeLabel = step.state === "complete" ? "&#10003;" : String(index + 1);
            return (
                '<div class="ldss-dashboard-progress-step is-' + escapeHtml(step.state) + '">' +
                '<div class="ldss-dashboard-progress-node">' + nodeLabel + '</div>' +
                '<div class="ldss-dashboard-progress-title">' + escapeHtml(step.label) + "</div>" +
                '<div class="ldss-dashboard-progress-meta">' + escapeHtml(step.meta) + "</div>" +
                "</div>"
            );
        }).join("") + "</div>";
    }

    function renderDashboardAnnouncements(rows, unreadCount) {
        const wrapper = byId("dashboardAnnouncementsList");
        const countChip = byId("dashboardAnnouncementsCount");
        if (!wrapper) {
            return;
        }

        if (countChip) {
            countChip.className = "ldss-chip " + (unreadCount > 0 ? "ldss-chip-accent" : "ldss-chip-neutral");
            countChip.textContent = unreadCount > 0 ? (String(unreadCount) + " Unread") : "0 Unread";
        }

        if (!rows || !rows.length) {
            wrapper.innerHTML = '<div class="ldss-dashboard-empty">No announcements yet from the scholarship office.</div>';
            return;
        }

        wrapper.innerHTML = rows.map(function (row) {
            const link = resolveNotificationLink(row);
            const title = notificationSummaryLabel(row);
            const message = truncateText(row.message || "Open your notification center to view the full update.", 90);
            return (
                '<a class="ldss-dashboard-list-item" href="' + escapeHtml(link) + '">' +
                '<div class="ldss-dashboard-list-title">' + escapeHtml(title) + "</div>" +
                '<div class="ldss-dashboard-list-copy">' + escapeHtml(message) + "</div>" +
                '<div class="ldss-dashboard-list-meta">' + escapeHtml(formatDateTime(row.created_at)) + "</div>" +
                "</a>"
            );
        }).join("");
    }

    function renderDashboardRequirementCard(documents, application) {
        const meta = requirementsSummaryMeta(documents);
        const countChip = byId("dashboardRequirementSummaryCount");
        const link = byId("dashboardRequirementSummaryLink");

        renderRequirementSummary(documents);

        if (countChip) {
            countChip.className = "ldss-chip " + meta.chipClass;
            countChip.textContent = meta.uploadedCount + " of " + meta.total;
        }

        if (link) {
            if (application && application.id) {
                link.href = "application-detail.html?id=" + encodeURIComponent(application.id);
                link.textContent = "View Application";
            } else {
                link.href = "applicant-applications.html";
                link.textContent = "Open Application";
            }
        }
    }

    function renderDashboardSchedule(application, examRecord, examBatch, approvalRecord, specialConsideration) {
        const examSummary = workflow().examSummaryFromRecord(examRecord);
        const effectiveStatus = effectiveApplicantStatus(application, approvalRecord, specialConsideration);
        const nextStep = application
            ? workflow().nextStepForApplicant(effectiveStatus)
            : "Create or submit your application first.";
        const examScheduleAt = (examRecord && examRecord.scheduled_at) || (examBatch && examBatch.exam_datetime) || "";
        const postedResult = postedExamResultMeta(
            examSummary,
            specialConsideration === true,
            isSectorSelectedApplication(application, approvalRecord),
            application && application.sector_classification
        );

        if (!application) {
            setChip("dashboardScheduleChip", "Pending", "ldss-chip-neutral");
            setText("dashboardScheduleHeadline", "Not yet available");
            setText("dashboardScheduleMeta", "Please wait until your application is created and submitted.");
            setText("dashboardExamBatchValue", "-");
            setText("dashboardExamRoomValue", "-");
            setText("dashboardExamSeatValue", "-");
            setText("dashboardExamControlValue", "-");
            setText("dashboardScheduleNextStep", nextStep);
            return;
        }

        setChip(
            "dashboardScheduleChip",
            postedResult.result === "passed" || postedResult.result === "failed" || postedResult.result === "selected"
                ? postedResult.chipLabel
                : (examScheduleAt ? "Scheduled" : "Pending"),
            postedResult.result === "passed" || postedResult.result === "failed" || postedResult.result === "selected"
                ? postedResult.chipClass
                : (examScheduleAt ? "ldss-chip-accent" : "ldss-chip-neutral")
        );
        setText("dashboardScheduleHeadline", examScheduleAt ? formatDateTime(examScheduleAt) : "Not yet available");
        setText(
            "dashboardScheduleMeta",
            examBatch && examBatch.venue
                ? examBatch.venue
                : (examScheduleAt ? "Exam schedule posted." : "Please wait for the official exam schedule and room posting.")
        );
        setText("dashboardExamBatchValue", examBatch && examBatch.batch_label ? examBatch.batch_label : "-");
        setText("dashboardExamRoomValue", examSummary.roomLabel || "-");
        setText("dashboardExamSeatValue", examSummary.seatNo || "-");
        setText("dashboardExamControlValue", examSummary.controlNo || "-");
        setText("dashboardScheduleNextStep", nextStep);
    }

    function dashboardBannerMeta(application, intakePolicy, completionReminder) {
        if (completionReminder) {
            return {
                message: completionReminder.bannerHtml,
                type: "alert-warning",
                isHtml: true
            };
        }

        if (!application) {
            if (intakePolicy && !intakePolicy.isOpen) {
                return {
                    message: intakeClosedMessage(intakePolicy),
                    type: "alert-warning",
                    isHtml: false
                };
            }
            return {
                message: "You can start a new scholarship application from this dashboard when you are ready.",
                type: "alert-info",
                isHtml: false
            };
        }

        if (application.submitted_at) {
            return {
                message: "Your application was successfully submitted. Please wait for further updates from the scholarship office.",
                type: "alert-success",
                isHtml: false
            };
        }

        if (workflow().normalizeStatus(application.status) === "returned_for_correction") {
            return {
                message: "Your application needs correction. Open your application record and complete the required updates.",
                type: "alert-warning",
                isHtml: false
            };
        }

        return {
            message: "Your draft is saved. Continue your application and submit it when all details are complete.",
            type: "alert-info",
            isHtml: false
        };
    }

    async function loadApplicantApplications(context) {
        let result = await context.client
            .from("applications")
            .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, updated_at, sector_classification")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false });

        if (result.error && isMissingApplicationsColumnError(result.error, "sector_classification")) {
            result = await context.client
                .from("applications")
                .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, updated_at")
                .eq("applicant_id", context.user.id)
                .order("created_at", { ascending: false });
        }

        if (result.error || !Array.isArray(result.data)) {
            return [];
        }
        return result.data;
    }

    async function loadLatestApplication(context) {
        const applications = await loadApplicantApplications(context);
        return latestApplicationFromList(applications);
    }

    async function loadLatestEditableDraft(context, schoolYear) {
        let query = context.client
            .from("applications")
            .select("id, status")
            .eq("applicant_id", context.user.id)
            .in("status", ["draft", "returned_for_correction"])
            .order("updated_at", { ascending: false })
            .limit(1);

        if (schoolYear) {
            query = query.eq("school_year", schoolYear);
        }

        const result = await query;

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
    }

    async function loadLatestBlockingApplication(context, schoolYear) {
        let query = context.client
            .from("applications")
            .select("id, application_no, school_year, status, is_locked, created_at, updated_at")
            .eq("applicant_id", context.user.id)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(1);

        if (schoolYear) {
            query = query.eq("school_year", schoolYear);
        }

        const result = await query;

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
    }

    async function loadNotifications(context) {
        const userId = context.user.id;

        if (notificationsSupportDismissedAt) {
            const countPromise = context.client
                .from("notifications")
                .select("id", { count: "exact", head: true })
                .eq("recipient_user_id", userId)
                .eq("is_read", false)
                .is("dismissed_at", null);

            const listPromise = context.client
                .from("notifications")
                .select("id, title, message, related_application_id, related_url, is_read, created_at")
                .eq("recipient_user_id", userId)
                .is("dismissed_at", null)
                .order("created_at", { ascending: false })
                .limit(5);

            const results = await Promise.all([countPromise, listPromise]);
            const countResult = results[0];
            const listResult = results[1];

            if (!(countResult && countResult.error && isMissingDismissedAtColumnError(countResult.error))
                && !(listResult && listResult.error && isMissingDismissedAtColumnError(listResult.error))) {
                return {
                    unreadCount: countResult && !countResult.error ? (countResult.count || 0) : 0,
                    rows: listResult && !listResult.error && listResult.data ? listResult.data : []
                };
            }

            notificationsSupportDismissedAt = false;
        }

        const fallbackResult = await context.client
            .from("notifications")
            .select("id, title, message, related_application_id, related_url, is_read, created_at")
            .eq("recipient_user_id", userId)
            .order("created_at", { ascending: false });

        if (fallbackResult.error) {
            return { unreadCount: 0, rows: [] };
        }

        const visibleRows = filterDismissedNotifications(fallbackResult.data || [], userId);
        return {
            unreadCount: visibleRows.filter(function (row) { return !row.is_read; }).length,
            rows: visibleRows.slice(0, 5)
        };
    }

    async function loadProfileSummary(context) {
        const result = await context.client
            .from("profiles")
            .select("first_name, middle_name, last_name, email, sex, civil_status, date_of_birth, mobile_number, address, barangay, school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income, created_at, updated_at")
            .eq("id", context.user.id)
            .single();

        if (!result.error && result.data) {
            writeProfileCache(context.user.id, result.data);
            return result.data;
        }
        return readProfileCache(context.user.id);
    }

    async function loadLatestApplicationAuxMeta(context, applicationId) {
        if (!context || !context.client || !applicationId) {
            return { available: false, payload: null };
        }

        const result = await context.client
            .from(APPLICATION_AUX_DATA_TABLE)
            .select("payload")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (result.error) {
            return { available: false, payload: null };
        }

        return {
            available: true,
            payload: result.data && result.data.payload ? result.data.payload : {}
        };
    }

    async function loadApplicationDocuments(context, applicationId) {
        if (!context || !context.client || !applicationId) {
            return [];
        }

        const result = await context.client
            .from("application_documents")
            .select("document_type, verification_status, created_at")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: false });

        if (result.error || !Array.isArray(result.data)) {
            return [];
        }

        return result.data;
    }

    function hasMissingExamAssignmentColumns(error) {
        return !!(error && /room_label|room_seat_no/i.test(error.message || ""));
    }

    async function loadExamRecord(context, applicationId, applicationStatus, specialConsideration) {
        const examResult = await context.client
            .from("exam_records")
            .select("application_id, batch_id, exam_control_no, scheduled_at, raw_score, percentage_score, result, status, room_label, room_seat_no, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (!examResult.error) {
            return examResult.data || null;
        }

        if (hasMissingExamAssignmentColumns(examResult.error)) {
            const fallbackAssignments = await context.client
                .from("exam_records")
                .select("application_id, batch_id, exam_control_no, scheduled_at, raw_score, percentage_score, result, status, updated_at")
                .eq("application_id", applicationId)
                .maybeSingle();

            if (!fallbackAssignments.error) {
                return fallbackAssignments.data
                    ? Object.assign({ room_label: "", room_seat_no: null }, fallbackAssignments.data)
                    : null;
            }
        }

        // TODO(Supabase): remove fallback once exam_records is deployed in production.
        const fallback = await context.client
            .from("interviews")
            .select("exam_score, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (fallback.error || !fallback.data) {
            return null;
        }

        const normalized = workflow().normalizeStatus(maskedApplicantStatusValue(applicationStatus, specialConsideration));
        let inferredResult = "pending";
        if (normalized === "passed_exam") {
            inferredResult = "passed";
        } else if (normalized === "failed_exam") {
            inferredResult = "failed";
        }

        return {
            application_id: applicationId,
            batch_id: null,
            exam_control_no: null,
            scheduled_at: null,
            raw_score: fallback.data.exam_score,
            percentage_score: fallback.data.exam_score,
            room_label: "",
            room_seat_no: null,
            result: inferredResult,
            status: "encoded",
            updated_at: fallback.data.updated_at || null
        };
    }

    async function loadExamBatchSummary(context, batchId) {
        if (!context || !context.client || !batchId) {
            return null;
        }

        const result = await context.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue")
            .eq("id", batchId)
            .maybeSingle();

        if (result.error) {
            return null;
        }

        return result.data || null;
    }

    async function loadInterviewRecord(context, applicationId) {
        const primary = await context.client
            .from("interview_records")
            .select("application_id, scheduled_at, venue, status, remarks, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (!primary.error) {
            return primary.data || null;
        }

        // TODO(Supabase): remove fallback once interview_records is deployed in production.
        const fallback = await context.client
            .from("interviews")
            .select("scheduled_at, venue, status, remarks, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (fallback.error) {
            return null;
        }
        return fallback.data || null;
    }

    async function loadApprovalRecord(context, applicationId) {
        const primary = await context.client
            .from("approval_records")
            .select("application_id, decision_status, decided_at, special_endorsement, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (!primary.error) {
            return primary.data || null;
        }

        // TODO(Supabase): remove fallback once approval_records is deployed in production.
        const fallback = await context.client
            .from("approval_queue")
            .select("decision_status, decided_at, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (fallback.error) {
            return null;
        }
        return fallback.data || null;
    }

    async function loadSpecialConsiderationFlag(context, applicationId) {
        if (!context || !context.client || typeof context.client.rpc !== "function" || !applicationId) {
            return false;
        }
        try {
            const result = await context.client.rpc("current_user_application_special_consideration_flags", {
                p_application_ids: [applicationId]
            });

            if (result.error) {
                return false;
            }

            const row = (result.data || []).find(function (item) {
                return item && item.application_id === applicationId;
            });

            return Boolean(row && row.has_special_consideration);
        } catch (_error) {
            return false;
        }
    }

    async function loadSectorSelectionFlag(context, applicationId) {
        if (!context || !context.client || typeof context.client.rpc !== "function" || !applicationId) {
            return false;
        }

        try {
            const result = await context.client.rpc("current_user_application_sector_selection_flags", {
                p_application_ids: [applicationId]
            });

            if (result.error) {
                return false;
            }

            const row = (result.data || []).find(function (item) {
                return item && item.application_id === applicationId;
            });

            return Boolean(row && row.is_sector_selected);
        } catch (_error) {
            return false;
        }
    }

    async function loadExamRank(context, applicationId) {
        if (!context || !context.client || typeof context.client.rpc !== "function" || !applicationId) {
            return null;
        }

        try {
            const result = await context.client.rpc("current_user_application_exam_ranks", {
                p_application_ids: [applicationId]
            });

            if (result.error) {
                return null;
            }

            const row = (result.data || []).find(function (item) {
                return item && item.application_id === applicationId;
            });

            return row && row.exam_rank !== null && typeof row.exam_rank !== "undefined"
                ? Number(row.exam_rank)
                : null;
        } catch (_error) {
            return null;
        }
    }

    function emptyDashboardApplicationBundle() {
        return {
            selectedApplication: null,
            approvalRecord: null,
            examRecord: null,
            examBatch: null,
            interviewRecord: null,
            applicationAuxMeta: { available: false, payload: null },
            documents: [],
            specialConsideration: false,
            examRank: null,
            completionReminder: null
        };
    }

    async function loadSelectedApplicationBundle(context, profileSummary, latestApplication, application) {
        if (!application || !application.id) {
            return emptyDashboardApplicationBundle();
        }

        const applicationId = application.id;
        const initialResults = await Promise.all([
            loadSpecialConsiderationFlag(context, applicationId),
            loadSectorSelectionFlag(context, applicationId),
            loadExamRank(context, applicationId)
        ]);

        const specialConsiderationFlag = initialResults[0];
        const sectorSelectionFlag = initialResults[1];
        const examRank = initialResults[2];
        const recordResults = await Promise.all([
            loadExamRecord(context, applicationId, application.status, specialConsiderationFlag),
            loadApprovalRecord(context, applicationId),
            loadInterviewRecord(context, applicationId),
            loadLatestApplicationAuxMeta(context, applicationId),
            loadApplicationDocuments(context, applicationId)
        ]);

        const examRecord = recordResults[0];
        const approvalRecord = recordResults[1];
        const interviewRecord = recordResults[2];
        const applicationAuxMeta = recordResults[3];
        const documents = recordResults[4];
        const examBatch = examRecord && examRecord.batch_id
            ? await loadExamBatchSummary(context, examRecord.batch_id)
            : null;
        const specialConsideration = Boolean(
            specialConsiderationFlag
            || (approvalRecord && approvalRecord.special_endorsement)
            || workflow().normalizeStatus(application.status) === "special_endorsement_review"
        );
        const selectedApplication = Object.assign({}, application, { sector_selected: sectorSelectionFlag });
        const completionReminder = latestApplication && latestApplication.id === applicationId
            ? buildCompletionReminder(profileSummary, application, applicationAuxMeta)
            : null;

        return {
            selectedApplication: selectedApplication,
            approvalRecord: approvalRecord,
            examRecord: examRecord,
            examBatch: examBatch,
            interviewRecord: interviewRecord,
            applicationAuxMeta: applicationAuxMeta,
            documents: documents,
            specialConsideration: specialConsideration,
            examRank: examRank,
            completionReminder: completionReminder
        };
    }

    function applyDashboardSelection(state, bundle) {
        const currentBundle = bundle || emptyDashboardApplicationBundle();
        const selectedApplication = currentBundle.selectedApplication;
        const progressSteps = buildDashboardProgressSteps(
            state.user,
            state.profileSummary,
            selectedApplication,
            currentBundle.applicationAuxMeta,
            currentBundle.documents,
            currentBundle.examRecord,
            currentBundle.interviewRecord,
            currentBundle.approvalRecord
        );
        const bannerMeta = dashboardBannerMeta(selectedApplication, state.intakePolicy, currentBundle.completionReminder);

        renderApplicationSelector(state.applications, selectedApplication ? selectedApplication.id : "");
        renderApplicationSelectorMeta(selectedApplication, state.applications);
        renderDashboardHero(
            state.profileSummary,
            state.user.email,
            selectedApplication,
            currentBundle.approvalRecord,
            currentBundle.specialConsideration
        );
        renderDashboardOverviewCards(
            selectedApplication,
            currentBundle.documents,
            state.notificationsData,
            currentBundle.examRecord,
            currentBundle.examBatch,
            currentBundle.approvalRecord,
            state.intakePolicy,
            currentBundle.specialConsideration,
            currentBundle.examRank
        );
        renderDashboardProgress(progressSteps);
        renderDashboardRequirementCard(currentBundle.documents, selectedApplication);
        renderDashboardAnnouncements(state.notificationsData.rows, state.notificationsData.unreadCount || 0);
        renderDashboardSchedule(
            selectedApplication,
            currentBundle.examRecord,
            currentBundle.examBatch,
            currentBundle.approvalRecord,
            currentBundle.specialConsideration
        );
        renderNotificationDropdown(state.notificationsData.rows, state.notificationsData.unreadCount || 0);
        showStatus(bannerMeta.message, bannerMeta.type, bannerMeta.isHtml);
    }

    async function loadAndRenderDashboardSelection(applicationId, options) {
        if (!dashboardRuntime || !dashboardRuntime.context) {
            return;
        }

        const settings = options || {};
        const selectedApplication = dashboardRuntime.applications.find(function (application) {
            return application && application.id === applicationId;
        }) || latestApplicationFromList(dashboardRuntime.applications) || null;
        const cacheKey = selectedApplication && selectedApplication.id ? selectedApplication.id : "__none__";
        const requestId = ++dashboardSelectionRequestId;

        dashboardRuntime.selectedApplicationId = selectedApplication ? selectedApplication.id : "";
        renderApplicationSelector(dashboardRuntime.applications, dashboardRuntime.selectedApplicationId);
        renderApplicationSelectorMeta(selectedApplication, dashboardRuntime.applications);
        setApplicationSelectorBusy(true);

        try {
            if (!dashboardRuntime.bundleCache[cacheKey]) {
                dashboardRuntime.bundleCache[cacheKey] = await loadSelectedApplicationBundle(
                    dashboardRuntime.context,
                    dashboardRuntime.profileSummary,
                    dashboardRuntime.latestApplication,
                    selectedApplication
                );
            }

            if (requestId !== dashboardSelectionRequestId) {
                return;
            }

            const bundle = dashboardRuntime.bundleCache[cacheKey];
            dashboardRuntime.selectedApplicationId = bundle.selectedApplication ? bundle.selectedApplication.id : "";
            applyDashboardSelection(dashboardRuntime, bundle);

            if (settings.manageReminderModal) {
                if (bundle.completionReminder) {
                    if (shouldShowProfileReminderModal(dashboardRuntime.user.id, bundle.completionReminder)) {
                        showProfileReminderModal(dashboardRuntime.user.id, bundle.completionReminder);
                    }
                } else if (selectedApplication && dashboardRuntime.latestApplication && selectedApplication.id === dashboardRuntime.latestApplication.id) {
                    clearProfileReminderDismissed(dashboardRuntime.user.id);
                }
            }
        } catch (_error) {
            if (requestId !== dashboardSelectionRequestId) {
                return;
            }
            showStatus("Failed to load the selected application. Please try again.", "alert-warning");
        } finally {
            if (requestId === dashboardSelectionRequestId) {
                setApplicationSelectorBusy(false);
            }
        }
    }

    function bindDashboardApplicationSelector() {
        const select = byId("dashboardApplicationSelect");
        if (!select || select.dataset.ldssBound === "true") {
            return;
        }

        select.dataset.ldssBound = "true";
        select.addEventListener("change", function () {
            loadAndRenderDashboardSelection(select.value, { manageReminderModal: false });
        });
    }

    function renderQuickActions(latestApplication, latestDraft, latestBlockingApplication, intakePolicy) {
        const intakeIsClosed = !!(intakePolicy && !intakePolicy.isOpen);
        const intakeHint = intakeClosedMessage(intakePolicy);
        const blockingYear = latestBlockingApplication && latestBlockingApplication.school_year
            ? String(latestBlockingApplication.school_year)
            : "";
        const blockingHint = blockingYear
            ? ("Only 1 application attempt is allowed for " + blockingYear + ". Update your existing application instead.")
            : "Only 1 application attempt is allowed per school year. Update your existing application instead.";

        if (latestDraft && latestDraft.id) {
            const resumeLabel = latestDraft.status === "returned_for_correction" ? "Continue Application" : "Continue Draft";
            setActionLink(
                "dashboardNewApplicationBtn",
                "applicant-application-form.html?application_id=" + encodeURIComponent(latestDraft.id),
                resumeLabel,
                false
            );
            setActionLink("dashboardMyApplicationsBtn", "applicant-applications.html", "My Applications", false);
            return;
        }

        setActionLink(
            "dashboardNewApplicationBtn",
            "applicant-application-form.html",
            intakeIsClosed ? "Application Closed" : "New Application",
            !!latestBlockingApplication || intakeIsClosed,
            latestBlockingApplication
                ? blockingHint
                : (intakeIsClosed ? intakeHint : "")
        );
        setActionLink("dashboardMyApplicationsBtn", "applicant-applications.html", "My Applications", false);
    }

    function dashboardMobileSections() {
        return MOBILE_DASHBOARD_SECTION_IDS
            .map(function (id) { return byId(id); })
            .filter(Boolean);
    }

    function syncDashboardMobileSections(forceDefaultState) {
        if (!window.bootstrap || !window.bootstrap.Collapse) {
            return;
        }

        const isMobile = window.innerWidth < MOBILE_DASHBOARD_BREAKPOINT;

        dashboardMobileSections().forEach(function (section) {
            const instance = window.bootstrap.Collapse.getOrCreateInstance(section, { toggle: false });

            if (!isMobile) {
                instance.show();
                section.dataset.ldssMobileStateApplied = "";
                return;
            }

            if (!forceDefaultState && section.dataset.ldssMobileStateApplied === "true") {
                return;
            }

            if ((section.getAttribute("data-ldss-mobile-default") || "").toLowerCase() === "open") {
                instance.show();
            } else {
                instance.hide();
            }

            section.dataset.ldssMobileStateApplied = "true";
        });
    }

    function bindDashboardMobileSections() {
        if (dashboardMobileSectionsBound || !dashboardMobileSections().length) {
            return;
        }

        dashboardMobileSectionsBound = true;
        dashboardMobileSectionMode = window.innerWidth < MOBILE_DASHBOARD_BREAKPOINT ? "mobile" : "desktop";

        document.querySelectorAll(".ldss-mobile-section-toggle").forEach(function (toggle) {
            toggle.addEventListener("click", function (event) {
                if (window.innerWidth >= MOBILE_DASHBOARD_BREAKPOINT) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
        });

        window.addEventListener("resize", function () {
            const nextMode = window.innerWidth < MOBILE_DASHBOARD_BREAKPOINT ? "mobile" : "desktop";
            const shouldReset = nextMode !== dashboardMobileSectionMode;
            dashboardMobileSectionMode = nextMode;
            syncDashboardMobileSections(shouldReset);
        });

        syncDashboardMobileSections(true);
    }

    async function init() {
        bindDashboardMobileSections();

        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        if (window.ldssWorkflowControlsReadyPromise && typeof window.ldssWorkflowControlsReadyPromise.then === "function") {
            await window.ldssWorkflowControlsReadyPromise;
        }

        showStatus("");

        try {
            const notificationsPromise = loadNotifications(context);
            const headResults = await Promise.all([
                loadProfileSummary(context),
                loadApplicantApplications(context),
                loadIntakePolicy(context),
                loadActiveSchoolYear(context)
            ]);

            const profileSummary = headResults[0];
            const applications = headResults[1];
            const intakePolicy = headResults[2];
            const activeSchoolYear = headResults[3];
            const latestApplication = latestApplicationFromList(applications);
            const actionResults = await Promise.all([
                loadLatestEditableDraft(context, activeSchoolYear),
                loadLatestBlockingApplication(context, activeSchoolYear)
            ]);
            const latestDraft = actionResults[0];
            const latestBlockingApplication = actionResults[1];
            const notificationsData = await notificationsPromise;

            renderProfileHeader(profileSummary, context.user.email);
            renderQuickActions(latestApplication, latestDraft, latestBlockingApplication, intakePolicy);
            renderDashboardAnnouncements(notificationsData.rows, notificationsData.unreadCount || 0);
            renderNotificationDropdown(notificationsData.rows, notificationsData.unreadCount || 0);
            renderApplicationSelector(applications, latestApplication ? latestApplication.id : "");
            renderApplicationSelectorMeta(latestApplication, applications);
            bindDashboardApplicationSelector();

            dashboardRuntime = {
                context: context,
                user: context.user,
                profileSummary: profileSummary,
                intakePolicy: intakePolicy,
                activeSchoolYear: activeSchoolYear,
                applications: applications,
                latestApplication: latestApplication,
                latestDraft: latestDraft,
                latestBlockingApplication: latestBlockingApplication,
                notificationsData: notificationsData,
                bundleCache: {}
            };

            await loadAndRenderDashboardSelection(
                latestApplication ? latestApplication.id : "",
                { manageReminderModal: true }
            );
        } catch (error) {
            showStatus("Failed to load dashboard data. Please refresh.", "alert-warning");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
    window.addEventListener("DOMContentLoaded", function () {
        const updateBtn = byId("profileReminderModalUpdateBtn");
        if (updateBtn) {
            updateBtn.addEventListener("click", function () {
                const targetUrl = updateBtn.getAttribute("data-reminder-url");
                if (targetUrl) {
                    window.location.href = targetUrl;
                    return;
                }
                const target = updateBtn.getAttribute("data-reminder-target") || "gender";
                window.location.href = "applicant-profile.html?complete=" + encodeURIComponent(target);
            });
        }
    });
})();
