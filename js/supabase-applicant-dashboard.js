(function () {
    "use strict";

    const PROFILE_CACHE_PREFIX = "ldss:profile-cache:";

    const DOC_LABELS = {
        income_certificate: "Tax Exemption Certificate (PDF)"
    };

    const DOC_ORDER = ["income_certificate"];

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
            examSummaryFromRecord: function () {
                return {
                    controlNo: "-",
                    scoreText: "-",
                    percentageText: "-",
                    resultLabel: "Pending",
                    resultChipClass: "ldss-chip-neutral"
                };
            }
        };
    }

    function profileCacheKey(userId) {
        return PROFILE_CACHE_PREFIX + userId;
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

    function setText(id, value) {
        const el = byId(id);
        if (el) {
            el.textContent = valueOrDash(value);
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

    function showStatus(message, type) {
        const el = byId("dashboardStatus");
        if (!el) {
            return;
        }
        if (!message) {
            el.className = "alert d-none";
            el.textContent = "";
            return;
        }
        el.className = "alert " + (type || "alert-info");
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
        return workflow().statusMeta(status);
    }

    function interviewMeta(status) {
        return INTERVIEW_META[status] || { label: valueOrDash(status), chipClass: "ldss-chip-neutral" };
    }

    function setActionLink(anchorId, href, text, disabled) {
        const el = byId(anchorId);
        if (!el) {
            return;
        }
        el.textContent = text;
        if (disabled) {
            el.href = "javascript:void(0);";
            el.classList.add("disabled");
            el.setAttribute("aria-disabled", "true");
            el.setAttribute("tabindex", "-1");
            return;
        }
        el.href = href;
        el.classList.remove("disabled");
        el.removeAttribute("aria-disabled");
        el.removeAttribute("tabindex");
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
        wrapper.innerHTML = DOC_ORDER.map(function (docType, index) {
            const row = latest[docType];
            const status = row ? row.verification_status : "missing";
            const meta = DOC_STATUS_META[status] || DOC_STATUS_META.missing;
            const marginClass = index === DOC_ORDER.length - 1 ? "" : " mb-2";
            return (
                '<div class="d-flex justify-content-between' + marginClass + '">' +
                '<span class="small">' + DOC_LABELS[docType] + "</span>" +
                '<span class="ldss-chip ' + meta.chipClass + '">' + meta.label + "</span>" +
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

    function buildDashboardEvents(application, examRecord, interviewRecord, approvalRecord, notifications) {
        const events = [];
        if (application) {
            events.push({ label: "Draft created", at: application.created_at });
            if (application.submitted_at) {
                events.push({ label: "Application submitted", at: application.submitted_at });
            }
            if (application.updated_at && application.status) {
                events.push({ label: "Current status: " + statusMeta(application.status).label, at: application.updated_at });
            }
        }

        if (examRecord && examRecord.updated_at) {
            const examSummary = workflow().examSummaryFromRecord(examRecord);
            events.push({ label: "Exam result: " + examSummary.resultLabel, at: examRecord.updated_at });
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

    function renderNotificationDropdown(rows, unreadCount) {
        const bell = byId("applicantAlerts");
        const pill = byId("dashboardAlertsUnreadPill");
        const list = byId("dashboardAlertsList");
        if (!list || !bell || !pill) {
            return;
        }

        if (unreadCount > 0) {
            pill.textContent = unreadCount > 99 ? "99+" : unreadCount.toString();
            pill.classList.remove("d-none");
            bell.classList.remove("ldss-bell-muted");
        } else {
            pill.classList.add("d-none");
            bell.classList.add("ldss-bell-muted");
        }

        if (!rows.length) {
            list.innerHTML = '<span class="dropdown-item small text-muted">No notifications yet.</span>';
            return;
        }

        list.innerHTML = rows.map(function (row) {
            const link = resolveNotificationLink(row);
            const title = valueOrDash(row.title || "Notification");
            const message = valueOrDash(row.message || "");
            const titleClass = row.is_read ? "" : " fw-600";
            return (
                '<a class="dropdown-item small" href="' + escapeHtml(link) + '">' +
                '<div class="small' + titleClass + '">' + escapeHtml(title) + "</div>" +
                '<div class="small text-muted">' + escapeHtml(message) + "</div>" +
                '<div class="small text-muted">' + escapeHtml(formatDateTime(row.created_at)) + "</div>" +
                "</a>"
            );
        }).join("");
    }

    function renderCards(application, examRecord, interviewRecord, approvalRecord) {
        if (!application) {
            setText("dashboardCurrentApplicationValue", "No Application");
            setChip("dashboardCurrentApplicationChip", "Start New Application", "ldss-chip-neutral");

            setText("dashboardExamValue", "No Exam Record");
            setChip("dashboardExamChip", "Pending", "ldss-chip-neutral");

            setText("dashboardInterviewValue", "Not Scheduled");
            setChip("dashboardInterviewChip", "Pending", "ldss-chip-neutral");

            setText("dashboardNextStepValue", "Create Application");
            setChip("dashboardNextStepChip", "Draft", "ldss-chip-neutral");
            return;
        }

        const appMeta = statusMeta(application.status);
        const normalizedStatus = workflow().normalizeStatus(application.status);

        setText("dashboardCurrentApplicationValue", appMeta.label);
        setChip("dashboardCurrentApplicationChip", application.application_no || "Active Application", appMeta.chipClass);

        const examSummary = workflow().examSummaryFromRecord(examRecord);
        const hasNumericExam = examSummary.scoreText !== "-" || examSummary.percentageText !== "-";
        const examValue = hasNumericExam
            ? ("Raw: " + examSummary.scoreText + " | %: " + examSummary.percentageText)
            : (normalizedStatus === "pending_exam" || normalizedStatus === "exam_scheduled" || normalizedStatus === "exam_completed"
                ? "Exam processing"
                : "No score yet");

        setText("dashboardExamValue", examValue);
        setChip("dashboardExamChip", examSummary.resultLabel, examSummary.resultChipClass);

        if (interviewRecord && interviewRecord.scheduled_at) {
            const iMeta = interviewMeta(interviewRecord.status);
            setText("dashboardInterviewValue", formatDateOnly(interviewRecord.scheduled_at));
            setChip("dashboardInterviewChip", iMeta.label, iMeta.chipClass);
        } else {
            const waitingInterview = ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified", "for_approval", "approved", "waitlisted", "for_release", "released"].includes(normalizedStatus);
            setText("dashboardInterviewValue", waitingInterview ? "Awaiting/Processed" : "Not Scheduled");
            setChip("dashboardInterviewChip", waitingInterview ? "Follow Tracking" : "Pending", waitingInterview ? "ldss-chip-accent" : "ldss-chip-neutral");
        }

        let nextStep = workflow().nextStepForApplicant(application.status);
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

    async function loadLatestApplication(context) {
        const result = await context.client
            .from("applications")
            .select("id, application_no, status, submitted_at, created_at, updated_at")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
    }

    async function loadLatestEditableDraft(context) {
        const result = await context.client
            .from("applications")
            .select("id")
            .eq("applicant_id", context.user.id)
            .in("status", ["draft", "returned_for_correction"])
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
    }

    async function loadNotifications(context) {
        const countPromise = context.client
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("recipient_user_id", context.user.id)
            .eq("is_read", false);

        const listPromise = context.client
            .from("notifications")
            .select("id, title, message, related_application_id, related_url, is_read, created_at")
            .eq("recipient_user_id", context.user.id)
            .order("created_at", { ascending: false })
            .limit(5);

        const results = await Promise.all([countPromise, listPromise]);
        const countResult = results[0];
        const listResult = results[1];

        return {
            unreadCount: countResult && !countResult.error ? (countResult.count || 0) : 0,
            rows: listResult && !listResult.error && listResult.data ? listResult.data : []
        };
    }

    async function loadProfileSummary(context) {
        const result = await context.client
            .from("profiles")
            .select("first_name, middle_name, last_name, email")
            .eq("id", context.user.id)
            .single();

        if (!result.error && result.data) {
            writeProfileCache(context.user.id, result.data);
            return result.data;
        }
        return readProfileCache(context.user.id);
    }

    async function loadExamRecord(context, applicationId, applicationStatus) {
        const examResult = await context.client
            .from("exam_records")
            .select("application_id, exam_control_no, raw_score, percentage_score, result, status, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (!examResult.error) {
            return examResult.data || null;
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

        const normalized = workflow().normalizeStatus(applicationStatus);
        let inferredResult = "pending";
        if (normalized === "passed_exam") {
            inferredResult = "passed";
        } else if (normalized === "failed_exam") {
            inferredResult = "failed";
        }

        return {
            application_id: applicationId,
            exam_control_no: null,
            raw_score: fallback.data.exam_score,
            percentage_score: fallback.data.exam_score,
            result: inferredResult,
            status: "encoded",
            updated_at: fallback.data.updated_at || null
        };
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
            .select("application_id, decision_status, decided_at, updated_at")
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

    function renderQuickActions(latestApplication, latestDraft) {
        if (latestApplication && latestApplication.id) {
            const detailUrl = "application-detail.html?id=" + encodeURIComponent(latestApplication.id);
            setActionLink("dashboardHeaderViewApplicationBtn", detailUrl, "View My Application", false);
            setActionLink("dashboardQuickViewApplicationBtn", detailUrl, "View My Application", false);
        } else {
            setActionLink("dashboardHeaderViewApplicationBtn", "applicant-application-form.html", "Start Application", false);
            setActionLink("dashboardQuickViewApplicationBtn", "applicant-application-form.html", "Start Application", false);
        }

        if (latestDraft && latestDraft.id) {
            const draftUrl = "applicant-application-form.html?application_id=" + encodeURIComponent(latestDraft.id);
            setActionLink("dashboardContinueDraftBtn", draftUrl, "Continue Draft", false);
        } else {
            setActionLink("dashboardContinueDraftBtn", "javascript:void(0);", "No Draft Yet", true);
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        showStatus("");

        try {
            const headResults = await Promise.all([
                loadProfileSummary(context),
                loadLatestApplication(context),
                loadLatestEditableDraft(context),
                loadNotifications(context)
            ]);

            const profileSummary = headResults[0];
            const latestApplication = headResults[1];
            const latestDraft = headResults[2];
            const notificationPayload = headResults[3];

            renderProfileHeader(profileSummary, context.user.email);
            renderQuickActions(latestApplication, latestDraft);
            renderNotificationDropdown(notificationPayload.rows, notificationPayload.unreadCount);

            if (!latestApplication) {
                renderCards(null, null, null, null);
                renderRequirementSummary([]);
                const eventsWithoutApp = buildDashboardEvents(null, null, null, null, notificationPayload.rows);
                renderRecentActivity(eventsWithoutApp);
                renderTimeline(eventsWithoutApp);
                return;
            }

            const detailResults = await Promise.all([
                loadExamRecord(context, latestApplication.id, latestApplication.status),
                loadInterviewRecord(context, latestApplication.id),
                loadApprovalRecord(context, latestApplication.id),
                context.client
                    .from("application_documents")
                    .select("document_type, verification_status, created_at")
                    .eq("application_id", latestApplication.id)
            ]);

            const examRecord = detailResults[0];
            const interviewRecord = detailResults[1];
            const approvalRecord = detailResults[2];
            const docsResult = detailResults[3];
            const documents = docsResult && !docsResult.error && docsResult.data ? docsResult.data : [];

            renderCards(latestApplication, examRecord, interviewRecord, approvalRecord);
            renderRequirementSummary(documents);

            const events = buildDashboardEvents(latestApplication, examRecord, interviewRecord, approvalRecord, notificationPayload.rows);
            renderRecentActivity(events);
            renderTimeline(events);
        } catch (error) {
            showStatus("Failed to load dashboard data. Please refresh.", "alert-warning");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
