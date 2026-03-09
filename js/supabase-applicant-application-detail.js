(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const REMARKS_SECTOR_META_START = "[[LDSS_SECTOR_TAGS]]";
    const REMARKS_SECTOR_META_END = "[[/LDSS_SECTOR_TAGS]]";

    const STATUS_META = {
        draft: { label: "Draft", chipClass: "ldss-chip-neutral" },
        submitted: { label: "Submitted", chipClass: "ldss-chip-neutral" },
        under_secretary_review: { label: "Under Secretary Review", chipClass: "ldss-chip-accent" },
        interview_scheduled: { label: "Interview Scheduled", chipClass: "ldss-chip-accent" },
        recommended: { label: "Recommended", chipClass: "ldss-chip-accent" },
        for_admin_approval: { label: "For Admin Approval", chipClass: "ldss-chip-accent" },
        approved: { label: "Approved", chipClass: "ldss-chip-success" },
        waitlisted: { label: "Waitlisted", chipClass: "ldss-chip-accent" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        returned_for_correction: { label: "Returned for Correction", chipClass: "ldss-chip-danger" },
        certification_ready: { label: "Certification Ready", chipClass: "ldss-chip-success" },
        release_scheduled: { label: "Release Scheduled", chipClass: "ldss-chip-accent" },
        released: { label: "Released", chipClass: "ldss-chip-success" }
    };

    const DOC_TYPE_LABELS = {
        proof_of_enrollment: "Proof of Enrollment",
        report_card: "Latest Report Card",
        barangay_certificate: "Barangay Certificate",
        income_certificate: "Income Certificate"
    };

    const DOC_STATUS_META = {
        pending: { label: "For Review", chipClass: "ldss-chip-accent" },
        verified: { label: "Verified", chipClass: "ldss-chip-success" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        needs_reupload: { label: "Needs Reupload", chipClass: "ldss-chip-danger" },
        missing: { label: "Not Uploaded", chipClass: "ldss-chip-neutral" }
    };

    function byId(id) {
        return document.getElementById(id);
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
        return STATUS_META[status] || { label: status || "-", chipClass: "ldss-chip-neutral" };
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

        const legacyPattern = /^\s*Sector Tags\s*:\s*(.+)$/im;
        const legacyMatch = working.match(legacyPattern);
        if (legacyMatch && legacyMatch[1]) {
            tags = uniqueTags(tags.concat(legacyMatch[1].split(",")));
            working = working.replace(legacyPattern, "");
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

        const result = await context.client.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(path, 60 * 30);

        if (result.error || !result.data || !result.data.signedUrl) {
            return "";
        }
        return result.data.signedUrl;
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

    function renderHeader(application) {
        setText("detailApplicationIdDisplay", "Application ID: " + application.application_no);
    }

    function renderStatusCards(application, interview, approval) {
        const appStatus = statusMeta(application.status);
        setText("detailOverallStatus", appStatus.label);

        const submitted = !!application.submitted_at || application.status !== "draft";
        setChip("detailSubmissionCheckChip", submitted ? "Completed" : "Pending", submitted ? "ldss-chip-success" : "ldss-chip-neutral");

        const hardcopyReadyStates = ["under_secretary_review", "interview_scheduled", "recommended", "for_admin_approval", "approved", "waitlisted", "rejected", "certification_ready", "release_scheduled", "released"];
        const hardcopyDoneStates = ["for_admin_approval", "approved", "waitlisted", "rejected", "certification_ready", "release_scheduled", "released"];
        if (hardcopyDoneStates.includes(application.status)) {
            setChip("detailHardcopyChip", "Completed", "ldss-chip-success");
        } else if (hardcopyReadyStates.includes(application.status)) {
            setChip("detailHardcopyChip", "In Progress", "ldss-chip-accent");
        } else {
            setChip("detailHardcopyChip", "Pending", "ldss-chip-neutral");
        }

        if (interview && interview.status && interview.status !== "not_scheduled") {
            const interviewDone = interview.status === "completed";
            setChip("detailInterviewChip", interviewDone ? "Completed" : "Scheduled", interviewDone ? "ldss-chip-success" : "ldss-chip-accent");
        } else {
            setChip("detailInterviewChip", "Not Scheduled", "ldss-chip-neutral");
        }

        if (approval && approval.decision_status && approval.decision_status !== "pending") {
            const decision = approval.decision_status;
            if (decision === "approved") {
                setChip("detailAdminDecisionChip", "Approved", "ldss-chip-success");
            } else if (decision === "waitlisted") {
                setChip("detailAdminDecisionChip", "Waitlisted", "ldss-chip-accent");
            } else {
                setChip("detailAdminDecisionChip", "Rejected/Returned", "ldss-chip-danger");
            }
        } else {
            setChip("detailAdminDecisionChip", "Pending", "ldss-chip-neutral");
        }
    }

    function renderInterview(interview) {
        const parsedRemarks = parseRemarksWithSectorMeta(interview && interview.remarks ? interview.remarks : "");

        if (!interview || !interview.scheduled_at) {
            setText("detailInterviewDate", "-");
            setText("detailInterviewTime", "-");
            setText("detailInterviewVenue", "-");
            setText("detailInterviewNote", "Interview is not yet scheduled.");
            return;
        }

        setText("detailInterviewDate", formatDateOnly(interview.scheduled_at));
        setText("detailInterviewTime", formatTimeOnly(interview.scheduled_at));
        setText("detailInterviewVenue", interview.venue || "-");
        setText("detailInterviewNote", parsedRemarks.plainRemarks || "Bring original hard-copy requirements and school ID for verification.");
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
        const requiredOrder = ["proof_of_enrollment", "report_card", "barangay_certificate", "income_certificate"];

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

    function renderTimeline(application, interview, approval) {
        const timeline = byId("detailTimelineList");
        if (!timeline) {
            return;
        }

        const events = [];
        events.push({ label: "Draft created", at: application.created_at });

        if (application.submitted_at) {
            events.push({ label: "Application submitted", at: application.submitted_at });
        }
        if (interview && interview.scheduled_at) {
            events.push({ label: "Interview scheduled", at: interview.scheduled_at });
        }
        if (approval && approval.decided_at) {
            events.push({ label: "Admin decision: " + (approval.decision_status || "updated"), at: approval.decided_at });
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

        const [interviewResult, docsResult, approvalResult] = await Promise.all([
            context.client
                .from("interviews")
                .select("scheduled_at, venue, status, result, remarks, verified_photo_path, created_at")
                .eq("application_id", application.id)
                .maybeSingle(),
            context.client
                .from("application_documents")
                .select("document_type, verification_status, created_at")
                .eq("application_id", application.id),
            context.client
                .from("approval_queue")
                .select("decision_status, decided_at")
                .eq("application_id", application.id)
                .maybeSingle()
        ]);

        const profileResult = await context.client
            .from("profiles")
            .select("applicant_photo_path, verified_interview_photo_path")
            .eq("id", context.user.id)
            .maybeSingle();

        const interview = interviewResult && !interviewResult.error ? interviewResult.data : null;
        const documents = docsResult && !docsResult.error ? docsResult.data : [];
        const approval = approvalResult && !approvalResult.error ? approvalResult.data : null;
        const profile = profileResult && !profileResult.error ? profileResult.data : null;

        const sectorMeta = parseRemarksWithSectorMeta((interview && interview.remarks) || application.secretary_remarks || "");

        const applicantPhotoPath = profile && profile.applicant_photo_path ? profile.applicant_photo_path : "";
        const verifiedPhotoPath = (interview && interview.verified_photo_path)
            || (profile && profile.verified_interview_photo_path)
            || "";

        const [applicantPhotoUrl, verifiedPhotoUrl] = await Promise.all([
            applicantPhotoPath ? createSignedUrl(context, applicantPhotoPath) : Promise.resolve(""),
            verifiedPhotoPath ? createSignedUrl(context, verifiedPhotoPath) : Promise.resolve("")
        ]);

        renderHeader(application);
        renderStatusCards(application, interview, approval);
        renderInterview(interview);
        renderRequirements(documents);
        renderTimeline(application, interview, approval);
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
