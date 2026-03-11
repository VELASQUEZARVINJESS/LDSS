(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const REMARKS_SECTOR_META_START = "[[LDSS_SECTOR_TAGS]]";
    const REMARKS_SECTOR_META_END = "[[/LDSS_SECTOR_TAGS]]";

    const DOC_TYPE_LABELS = {
        income_certificate: "Tax Exemption Certificate (PDF)"
    };

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
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral", nextStep: "Wait for update." };
            },
            nextStepForApplicant: function () {
                return "Wait for update.";
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

    function showStatus(message, type) {
        const alert = byId("detailStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.classList.add("d-none");
            alert.textContent = "";
            return;
        }
        alert.className = "alert " + (type || "alert-info");
        alert.textContent = message;
        alert.classList.remove("d-none");
    }

    function setText(id, value) {
        const target = byId(id);
        if (!target) {
            return;
        }
        target.textContent = (value || "").toString().trim() || "-";
    }

    function setChip(id, label, chipClass) {
        const chip = byId(id);
        if (!chip) {
            return;
        }
        chip.className = "ldss-chip " + (chipClass || "ldss-chip-neutral");
        chip.textContent = label || "-";
    }

    function statusMeta(status) {
        return workflow().statusMeta(status);
    }

    function interviewMeta(status) {
        return INTERVIEW_META[status] || { label: status || "-", chipClass: "ldss-chip-neutral" };
    }

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function formatDateOnly(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function formatTimeOnly(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function parseQueryParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            id: params.get("id"),
            applicationNo: params.get("application_no")
        };
    }

    function uniqueTags(values) {
        const out = [];
        const seen = new Set();
        (values || []).forEach(function (value) {
            const clean = (value || "").toString().trim().replace(/\s+/g, " ");
            if (!clean) {
                return;
            }
            const key = clean.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            out.push(clean);
        });
        return out;
    }

    function parseRemarksWithSectorMeta(value) {
        const source = (value || "").toString();
        if (!source) {
            return { plainRemarks: "", sectorTags: [] };
        }

        let working = source;
        let tags = [];
        const escapedStart = REMARKS_SECTOR_META_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedEnd = REMARKS_SECTOR_META_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const blockPattern = new RegExp(escapedStart + "([\\s\\S]*?)" + escapedEnd, "i");
        const blockMatch = working.match(blockPattern);

        if (blockMatch && blockMatch[1]) {
            tags = uniqueTags(blockMatch[1].split("|"));
            working = working.replace(blockMatch[0], "");
        }

        return {
            plainRemarks: working.replace(/\n{3,}/g, "\n\n").trim(),
            sectorTags: tags
        };
    }

    function renderSectorTags(tags) {
        const wrapper = byId("detailSectorTags");
        if (!wrapper) {
            return;
        }

        const unique = uniqueTags(tags);
        if (!unique.length) {
            wrapper.innerHTML = '<span class="small text-muted">No sector tags assigned yet.</span>';
            return;
        }

        wrapper.innerHTML = unique.map(function (tag) {
            return '<span class="ldss-chip ldss-chip-neutral">' + tag.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</span>";
        }).join("");
    }

    async function createSignedUrl(context, path) {
        if (!path) {
            return "";
        }
        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        return window.ldssUploads.createObjectUrl(context, path);
    }

    function setPhotoArea(imageId, placeholderId, linkId, url, placeholderText) {
        const image = byId(imageId);
        const placeholder = byId(placeholderId);
        const link = byId(linkId);

        if (!image || !placeholder || !link) {
            return;
        }

        if (url) {
            image.src = url;
            image.classList.remove("d-none");
            placeholder.classList.add("d-none");
            link.href = url;
            link.classList.remove("d-none");
            return;
        }

        image.src = "";
        image.classList.add("d-none");
        placeholder.textContent = placeholderText;
        placeholder.classList.remove("d-none");
        link.removeAttribute("href");
        link.classList.add("d-none");
    }

    async function fetchTargetApplication(context) {
        const client = context.client;
        const query = parseQueryParams();
        let result;

        if (query.id) {
            result = await client
                .from("applications")
                .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, updated_at, secretary_remarks, admin_remarks")
                .eq("id", query.id)
                .eq("applicant_id", context.user.id)
                .single();
            if (!result.error && result.data) {
                return result.data;
            }
        }

        if (query.applicationNo) {
            result = await client
                .from("applications")
                .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, updated_at, secretary_remarks, admin_remarks")
                .eq("application_no", query.applicationNo)
                .eq("applicant_id", context.user.id)
                .single();
            if (!result.error && result.data) {
                return result.data;
            }
        }

        const fallback = await client
            .from("applications")
            .select("id, application_no, scholarship_type, school_year, status, submitted_at, created_at, updated_at, secretary_remarks, admin_remarks")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

        if (fallback.error || !fallback.data || fallback.data.length === 0) {
            return null;
        }
        return fallback.data[0];
    }

    async function fetchExamRecord(context, application) {
        const primary = await context.client
            .from("exam_records")
            .select("application_id, exam_control_no, raw_score, percentage_score, result, status, remarks, updated_at")
            .eq("application_id", application.id)
            .maybeSingle();

        if (!primary.error) {
            return primary.data || null;
        }

        // TODO(Supabase): remove fallback once exam_records is deployed in production.
        const fallback = await context.client
            .from("interviews")
            .select("exam_score, updated_at")
            .eq("application_id", application.id)
            .maybeSingle();

        if (fallback.error || !fallback.data) {
            return null;
        }

        const normalizedStatus = workflow().normalizeStatus ? workflow().normalizeStatus(application.status) : (application.status || "");
        let inferredResult = "pending";
        if (normalizedStatus === "passed_exam") {
            inferredResult = "passed";
        } else if (normalizedStatus === "failed_exam") {
            inferredResult = "failed";
        }

        return {
            application_id: application.id,
            exam_control_no: null,
            raw_score: fallback.data.exam_score,
            percentage_score: fallback.data.exam_score,
            result: inferredResult,
            status: "encoded",
            remarks: null,
            updated_at: fallback.data.updated_at
        };
    }

    async function fetchInterviewRecord(context, applicationId) {
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
            .select("scheduled_at, venue, status, remarks, updated_at, verified_photo_path")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (fallback.error) {
            return null;
        }
        return fallback.data || null;
    }

    async function fetchApprovalRecord(context, applicationId) {
        const primary = await context.client
            .from("approval_records")
            .select("application_id, decision_status, decided_at, decision_notes")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (!primary.error) {
            return primary.data || null;
        }

        // TODO(Supabase): remove fallback once approval_records is deployed in production.
        const fallback = await context.client
            .from("approval_queue")
            .select("decision_status, decided_at, decision_notes")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (fallback.error) {
            return null;
        }
        return fallback.data || null;
    }

    function renderHeader(application) {
        setText("detailApplicationIdDisplay", "Application ID: " + application.application_no);
    }

    function renderStatusCards(application, examRecord, interviewRecord, approvalRecord) {
        const appStatus = statusMeta(application.status);
        setText("detailOverallStatus", appStatus.label);
        setText("detailSubmittedAt", formatDateTime(application.submitted_at || application.created_at));
        setChip("detailWorkflowChip", appStatus.label, appStatus.chipClass);

        let finalLabel = "Pending";
        let finalClass = "ldss-chip-neutral";

        if (approvalRecord && approvalRecord.decision_status) {
            if (approvalRecord.decision_status === "approved") {
                finalLabel = "Approved";
                finalClass = "ldss-chip-success";
            } else if (approvalRecord.decision_status === "waitlisted") {
                finalLabel = "Waitlisted";
                finalClass = "ldss-chip-accent";
            } else if (approvalRecord.decision_status === "rejected") {
                finalLabel = "Rejected";
                finalClass = "ldss-chip-danger";
            }
        } else {
            const normalized = workflow().normalizeStatus ? workflow().normalizeStatus(application.status) : (application.status || "");
            if (["approved", "released", "for_release"].includes(normalized)) {
                finalLabel = "Approved";
                finalClass = "ldss-chip-success";
            } else if (normalized === "waitlisted") {
                finalLabel = "Waitlisted";
                finalClass = "ldss-chip-accent";
            } else if (normalized === "rejected") {
                finalLabel = "Rejected";
                finalClass = "ldss-chip-danger";
            }
        }

        setChip("detailFinalDecisionChip", finalLabel, finalClass);

        const examSummary = workflow().examSummaryFromRecord(examRecord);
        setText("detailExamControlNo", examSummary.controlNo || "-");
        setText("detailExamRawScore", examSummary.scoreText || "-");
        setText("detailExamPercentage", examSummary.percentageText || "-");
        setChip("detailExamResultChip", examSummary.resultLabel || "Pending", examSummary.resultChipClass || "ldss-chip-neutral");

        setText("detailNextStepText", workflow().nextStepForApplicant(application.status));

        if (interviewRecord && interviewRecord.scheduled_at) {
            const iMeta = interviewMeta(interviewRecord.status || "scheduled");
            setText("detailInterviewDate", formatDateOnly(interviewRecord.scheduled_at));
            setText("detailInterviewTime", formatTimeOnly(interviewRecord.scheduled_at));
            setText("detailInterviewVenue", interviewRecord.venue || "-");
            setText("detailInterviewNote", interviewRecord.remarks || "Bring your complete hard-copy requirements and printed official application form.");
            setChip("detailInterviewChip", iMeta.label, iMeta.chipClass);
        } else {
            setText("detailInterviewDate", "-");
            setText("detailInterviewTime", "-");
            setText("detailInterviewVenue", "-");
            setText("detailInterviewNote", "Interview is not yet scheduled.");
            setChip("detailInterviewChip", "Not Scheduled", "ldss-chip-neutral");
        }
    }

    function latestDocStatusByType(documents) {
        const map = {};
        (documents || []).forEach(function (doc) {
            const existing = map[doc.document_type];
            if (!existing) {
                map[doc.document_type] = doc;
                return;
            }
            const existingDate = new Date(existing.created_at || 0).getTime();
            const currentDate = new Date(doc.created_at || 0).getTime();
            if (currentDate > existingDate) {
                map[doc.document_type] = doc;
            }
        });
        return map;
    }

    function renderRequirements(documents) {
        const wrapper = byId("detailRequirementChecklist");
        if (!wrapper) {
            return;
        }

        const latest = latestDocStatusByType(documents || []);
        const requiredOrder = ["income_certificate"];

        wrapper.innerHTML = requiredOrder
            .map(function (docType) {
                const row = latest[docType];
                const status = row ? row.verification_status : "missing";
                const meta = DOC_STATUS_META[status] || DOC_STATUS_META.missing;
                const label = DOC_TYPE_LABELS[docType] || docType;
                return (
                    '<div class="d-flex justify-content-between mb-2">' +
                    '<span class="small">' + label + "</span>" +
                    '<span class="ldss-chip ' + meta.chipClass + '">' + meta.label + "</span>" +
                    "</div>"
                );
            })
            .join("");
    }

    function renderTimeline(application, examRecord, interviewRecord, approvalRecord) {
        const timeline = byId("detailTimelineList");
        if (!timeline) {
            return;
        }

        const events = [];
        events.push({ label: "Draft created", at: application.created_at });

        if (application.submitted_at) {
            events.push({ label: "Application submitted", at: application.submitted_at });
        }
        if (examRecord && examRecord.updated_at) {
            const summary = workflow().examSummaryFromRecord(examRecord);
            events.push({ label: "Exam result: " + summary.resultLabel, at: examRecord.updated_at });
        }
        if (interviewRecord && interviewRecord.scheduled_at) {
            events.push({ label: "Interview scheduled", at: interviewRecord.scheduled_at });
        }
        if (approvalRecord && approvalRecord.decided_at) {
            events.push({ label: "Final decision: " + (approvalRecord.decision_status || "updated"), at: approvalRecord.decided_at });
        }
        if (application.updated_at) {
            const current = statusMeta(application.status).label;
            events.push({ label: "Current status: " + current, at: application.updated_at });
        }

        events.sort(function (a, b) {
            return new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime();
        });

        timeline.innerHTML = events
            .map(function (event) {
                return (
                    '<li class="ldss-timeline-item">' +
                    '<div class="small fw-600">' + event.label + "</div>" +
                    '<div class="small text-muted">' + formatDateTime(event.at) + "</div>" +
                    "</li>"
                );
            })
            .join("");
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client) {
            return;
        }

        showStatus("");
        const application = await fetchTargetApplication(context);
        if (!application) {
            showStatus("No application record found for your account.", "alert-warning");
            return;
        }

        const dataResults = await Promise.all([
            fetchExamRecord(context, application),
            fetchInterviewRecord(context, application.id),
            fetchApprovalRecord(context, application.id),
            context.client
                .from("application_documents")
                .select("document_type, verification_status, created_at")
                .eq("application_id", application.id),
            context.client
                .from("profiles")
                .select("applicant_photo_path, verified_interview_photo_path")
                .eq("id", context.user.id)
                .maybeSingle()
        ]);

        const examRecord = dataResults[0];
        const interviewRecord = dataResults[1];
        const approvalRecord = dataResults[2];
        const docsResult = dataResults[3];
        const profileResult = dataResults[4];

        const documents = docsResult && !docsResult.error ? docsResult.data : [];
        const profile = profileResult && !profileResult.error ? profileResult.data : null;

        const sectorMeta = parseRemarksWithSectorMeta((interviewRecord && interviewRecord.remarks) || application.secretary_remarks || "");

        const applicantPhotoPath = profile && profile.applicant_photo_path ? profile.applicant_photo_path : "";
        const verifiedPhotoPath = (interviewRecord && interviewRecord.verified_photo_path)
            || (profile && profile.verified_interview_photo_path)
            || "";

        const urlResults = await Promise.all([
            applicantPhotoPath ? createSignedUrl(context, applicantPhotoPath) : Promise.resolve(""),
            verifiedPhotoPath ? createSignedUrl(context, verifiedPhotoPath) : Promise.resolve("")
        ]);

        const applicantPhotoUrl = urlResults[0];
        const verifiedPhotoUrl = urlResults[1];

        renderHeader(application);
        renderStatusCards(application, examRecord, interviewRecord, approvalRecord);
        renderRequirements(documents);
        renderTimeline(application, examRecord, interviewRecord, approvalRecord);
        renderSectorTags(sectorMeta.sectorTags);

        setPhotoArea(
            "detailApplicantPhotoPreview",
            "detailApplicantPhotoPlaceholder",
            "detailApplicantPhotoLink",
            applicantPhotoUrl,
            "No applicant photo on file."
        );
        setPhotoArea(
            "detailVerifiedPhotoPreview",
            "detailVerifiedPhotoPlaceholder",
            "detailVerifiedPhotoLink",
            verifiedPhotoUrl,
            "No verified interview photo yet."
        );
    }

    window.addEventListener("DOMContentLoaded", init);
})();
