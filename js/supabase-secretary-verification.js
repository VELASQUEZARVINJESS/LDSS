
(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

    const APPLICATION_STATUS_META = {
        submitted: { label: "Submitted", chipClass: "ldss-chip-neutral" },
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

    const REQUIRED_DOCUMENTS = [];

    const DOCUMENT_STATUS_META = {
        pending: { label: "Pending Review", chipClass: "ldss-chip-accent" },
        verified: { label: "Verified", chipClass: "ldss-chip-success" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        needs_reupload: { label: "Needs Reupload", chipClass: "ldss-chip-danger" },
        missing: { label: "Missing", chipClass: "ldss-chip-neutral" }
    };

    const SECTOR_OPTIONS_STORAGE_KEY = "ldss:sector-options:v1";
    const DEFAULT_SECTOR_OPTIONS = [
        "PWD",
        "Solo Parent",
        "Farmer Household",
        "Fisherfolk Household",
        "4Ps Beneficiary",
        "Indigenous Peoples"
    ];
    const REMARKS_SECTOR_META_START = "[[LDSS_SECTOR_TAGS]]";
    const REMARKS_SECTOR_META_END = "[[/LDSS_SECTOR_TAGS]]";

    let authContext = null;
    let currentApplication = null;
    let currentProfile = null;
    let currentInterview = null;
    let latestDocumentByType = {};
    let signedDocumentUrlByType = {};
    let documentNotesById = {};
    let notesModalInstance = null;
    let activeNotesDocId = "";
    let selectedSectorTags = [];
    let sectorOptions = DEFAULT_SECTOR_OPTIONS.slice();
    let cameraStream = null;
    let localPreviewObjectUrl = "";
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

    function statusMeta(status) {
        return APPLICATION_STATUS_META[status] || { label: status || "-", chipClass: "ldss-chip-neutral" };
    }

    function documentMeta(status) {
        return DOCUMENT_STATUS_META[status] || DOCUMENT_STATUS_META.pending;
    }

    function showStatus(message, type) {
        const box = byId("secretaryVerificationStatus");
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

    function toDatetimeLocalValue(value) {
        if (!value) {
            return "";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
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

    function queryApplicationId() {
        const params = new URLSearchParams(window.location.search);
        return params.get("id");
    }

    function normalizeTag(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ");
    }

    function uniqueTags(values) {
        const output = [];
        const seen = new Set();

        (values || []).forEach(function (value) {
            const normalized = normalizeTag(value);
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            output.push(normalized);
        });

        return output;
    }

    function loadSectorOptions() {
        try {
            const raw = localStorage.getItem(SECTOR_OPTIONS_STORAGE_KEY);
            if (!raw) {
                return DEFAULT_SECTOR_OPTIONS.slice();
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return DEFAULT_SECTOR_OPTIONS.slice();
            }

            const options = uniqueTags(parsed).slice(0, 20);
            return options.length > 0 ? options : DEFAULT_SECTOR_OPTIONS.slice();
        } catch (error) {
            return DEFAULT_SECTOR_OPTIONS.slice();
        }
    }

    function parseRemarksWithSectorMeta(value) {
        const source = (value || "").toString();
        if (!source) {
            return { plainRemarks: "", sectorTags: [] };
        }

        let working = source;
        let tags = [];
        const blockPattern = /\[\[LDSS_SECTOR_TAGS\]\]([\s\S]*?)\[\[\/LDSS_SECTOR_TAGS\]\]/i;
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

    function composeRemarksWithSectorMeta(plainRemarks, tags) {
        const cleanRemarks = (plainRemarks || "").toString().trim();
        const cleanTags = uniqueTags(tags);
        if (cleanTags.length === 0) {
            return cleanRemarks;
        }
        const metaBlock = REMARKS_SECTOR_META_START + cleanTags.join("|") + REMARKS_SECTOR_META_END;
        return cleanRemarks ? (cleanRemarks + "\n\n" + metaBlock) : metaBlock;
    }

    function setSectorSelection(values) {
        selectedSectorTags = uniqueTags(values);
    }

    function renderSectorTags() {
        const wrapper = byId("verificationSectorTags");
        if (!wrapper) {
            return;
        }

        const renderOptions = uniqueTags((sectorOptions || []).concat(selectedSectorTags || []));
        if (renderOptions.length === 0) {
            wrapper.innerHTML = '<span class="small text-muted">No sector tags configured.</span>';
            return;
        }

        wrapper.innerHTML = renderOptions.map(function (tag) {
            const selected = selectedSectorTags.some(function (item) {
                return item.toLowerCase() === tag.toLowerCase();
            });
            return (
                '<button class="btn btn-sm ldss-sector-tag' + (selected ? " active" : "") + '" type="button" data-sector-tag="' + escapeHtml(tag) + '">' +
                escapeHtml(tag) +
                "</button>"
            );
        }).join("");
    }

    function updateDocNotePreview(docId) {
        const preview = byId("verificationDocNotePreview-" + docId);
        const button = document.querySelector('[data-doc-note-open="1"][data-doc-id="' + docId + '"]');
        if (!preview) {
            return;
        }

        const noteValue = (documentNotesById[docId] || "").trim();
        if (!noteValue) {
            preview.textContent = "No note added.";
            preview.className = "small text-muted mt-1";
            if (button) {
                button.textContent = "Add Note";
            }
            return;
        }

        const maxLength = 90;
        preview.textContent = noteValue.length > maxLength
            ? (noteValue.slice(0, maxLength) + "...")
            : noteValue;
        preview.className = "small text-dark mt-1";
        if (button) {
            button.textContent = "Edit Note";
        }
    }

    function openNotesModal(docId, requirementLabel, hasUploadedFile) {
        activeNotesDocId = docId || "";

        const title = byId("verificationDocNotesTitle");
        const meta = byId("verificationDocNotesMeta");
        const text = byId("verificationDocNotesText");
        if (title) {
            title.textContent = "Secretary Note";
        }
        if (meta) {
            const nameText = requirementLabel || "Requirement";
            const fileStateText = hasUploadedFile ? "File available" : "File not uploaded";
            meta.textContent = nameText + " | " + fileStateText;
        }
        if (text) {
            text.value = documentNotesById[activeNotesDocId] || "";
            text.focus();
        }

        if (notesModalInstance) {
            notesModalInstance.show();
        }
    }

    function saveNotesFromModal() {
        if (!activeNotesDocId) {
            return;
        }
        const text = byId("verificationDocNotesText");
        if (!text) {
            return;
        }

        documentNotesById[activeNotesDocId] = text.value.trim();
        updateDocNotePreview(activeNotesDocId);
        if (notesModalInstance) {
            notesModalInstance.hide();
        }
    }

    function clearLocalPreviewObjectUrl() {
        if (!localPreviewObjectUrl) {
            return;
        }
        URL.revokeObjectURL(localPreviewObjectUrl);
        localPreviewObjectUrl = "";
    }

    function stopCameraStream() {
        if (cameraStream && cameraStream.getTracks) {
            cameraStream.getTracks().forEach(function (track) {
                track.stop();
            });
        }
        cameraStream = null;

        const video = byId("verificationCameraVideo");
        if (video) {
            video.pause();
            video.srcObject = null;
        }

        const wrap = byId("verificationCameraWrap");
        if (wrap) {
            wrap.classList.add("d-none");
        }

        const startBtn = byId("verificationStartCameraBtn");
        const captureBtn = byId("verificationCapturePhotoBtn");
        const stopBtn = byId("verificationStopCameraBtn");
        if (startBtn) {
            startBtn.disabled = false;
        }
        if (captureBtn) {
            captureBtn.disabled = true;
        }
        if (stopBtn) {
            stopBtn.disabled = true;
        }
    }

    async function startCameraStream() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Camera is not supported in this browser.");
        }

        stopCameraStream();
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user" },
            audio: false
        });
        cameraStream = stream;

        const video = byId("verificationCameraVideo");
        const wrap = byId("verificationCameraWrap");
        if (!video || !wrap) {
            throw new Error("Camera preview area is missing.");
        }

        video.srcObject = stream;
        wrap.classList.remove("d-none");

        const startBtn = byId("verificationStartCameraBtn");
        const captureBtn = byId("verificationCapturePhotoBtn");
        const stopBtn = byId("verificationStopCameraBtn");
        if (startBtn) {
            startBtn.disabled = true;
        }
        if (captureBtn) {
            captureBtn.disabled = false;
        }
        if (stopBtn) {
            stopBtn.disabled = false;
        }
    }

    function applyCapturedPhotoFile(file) {
        const fileInput = byId("verificationVerifiedPhotoFile");
        if (!fileInput) {
            return;
        }

        if (typeof DataTransfer === "undefined") {
            throw new Error("This browser does not support camera file assignment. Use Upload New Verified Photo.");
        }

        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;

        clearLocalPreviewObjectUrl();
        localPreviewObjectUrl = URL.createObjectURL(file);
        setPhotoArea(
            "verificationVerifiedPhotoPreview",
            "verificationVerifiedPhotoPlaceholder",
            "verificationVerifiedPhotoLink",
            localPreviewObjectUrl,
            "No verified interview photo uploaded."
        );
    }

    function captureCameraPhoto() {
        const video = byId("verificationCameraVideo");
        const canvas = byId("verificationCameraCanvas");
        if (!video || !canvas) {
            throw new Error("Camera capture controls are missing.");
        }
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        if (!videoWidth || !videoHeight) {
            throw new Error("Camera stream is not ready yet. Please try again.");
        }

        canvas.width = videoWidth;
        canvas.height = videoHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Unable to process captured image.");
        }
        context.drawImage(video, 0, 0, videoWidth, videoHeight);

        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error("Captured image is empty. Please try again."));
                    return;
                }
                try {
                    const file = new File([blob], "verified-interview-photo-" + Date.now() + ".jpg", { type: "image/jpeg" });
                    applyCapturedPhotoFile(file);
                    resolve(file);
                } catch (error) {
                    reject(error);
                }
            }, "image/jpeg", 0.92);
        });
    }

    async function createSignedUrl(path) {
        if (!path || !authContext || !authContext.client) {
            return "";
        }
        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        return window.ldssUploads.createObjectUrl(authContext, path);
    }

    function latestDocumentsByType(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            const existing = map[row.document_type];
            if (!existing) {
                map[row.document_type] = row;
                return;
            }
            const existingTs = new Date(existing.created_at || 0).getTime();
            const currentTs = new Date(row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[row.document_type] = row;
            }
        });
        return map;
    }

    async function fetchApplication(applicationId) {
        const selectFields = "id, application_no, applicant_id, scholarship_type, school_year, status, submitted_at, created_at, updated_at, secretary_remarks, is_locked";

        if (applicationId) {
            const targetResult = await authContext.client
                .from("applications")
                .select(selectFields)
                .eq("id", applicationId)
                .maybeSingle();

            if (!targetResult.error && targetResult.data) {
                return targetResult.data;
            }
        }

        const fallbackResult = await authContext.client
            .from("applications")
            .select(selectFields)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(1);

        if (fallbackResult.error || !fallbackResult.data || fallbackResult.data.length === 0) {
            return null;
        }

        return fallbackResult.data[0];
    }

    async function fetchProfile(userId) {
        const result = await authContext.client
            .from("profiles")
            .select("id, first_name, middle_name, last_name, email, mobile_number, school_name, course_or_strand, applicant_photo_path, verified_interview_photo_path")
            .eq("id", userId)
            .maybeSingle();

        if (result.error) {
            return null;
        }
        return result.data || null;
    }

    async function fetchInterview(applicationId) {
        let result = await authContext.client
            .from("interview_records")
            .select("id, application_id, scheduled_at, venue, status, result, exam_score, remarks, verified_photo_path, hard_copy_verified, hard_copy_verified_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (result.error) {
            if (!/does not exist|relation/i.test(result.error.message || "")) {
                return null;
            }

            result = await authContext.client
                .from("interviews")
                .select("id, application_id, scheduled_at, venue, status, result, exam_score, remarks, verified_photo_path")
                .eq("application_id", applicationId)
                .maybeSingle();
        }

        if (result.error) {
            return null;
        }

        if (result.data && typeof result.data.hard_copy_verified === "undefined") {
            result.data.hard_copy_verified = false;
            result.data.hard_copy_verified_at = null;
        }
        return result.data || null;
    }

    async function fetchDocuments(applicationId) {
        const result = await authContext.client
            .from("application_documents")
            .select("id, application_id, document_type, storage_path, original_filename, mime_type, file_size_bytes, verification_status, verification_notes, created_at")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: false });

        if (result.error) {
            return [];
        }
        return result.data || [];
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

    function renderHeaderAndSummary() {
        const appNo = currentApplication ? currentApplication.application_no : "-";
        const applicantName = buildApplicantName(currentProfile);

        const meta = byId("secretaryVerificationHeaderMeta");
        if (meta) {
            meta.textContent = "Application ID: " + appNo + " | Applicant: " + applicantName;
        }

        const status = statusMeta(currentApplication ? currentApplication.status : "");
        const statusChip = byId("verificationCurrentStatusChip");
        if (statusChip) {
            statusChip.className = "ldss-chip " + status.chipClass;
            statusChip.textContent = status.label;
        }

        const setText = function (id, value) {
            const el = byId(id);
            if (el) {
                el.textContent = value || "-";
            }
        };

        setText("verificationApplicationNo", appNo);
        setText("verificationApplicantName", applicantName);
        setText("verificationScholarshipType", currentApplication ? currentApplication.scholarship_type : "-");
        setText("verificationSchoolYear", currentApplication ? currentApplication.school_year : "-");

        const schoolName = currentProfile && currentProfile.school_name ? currentProfile.school_name : "";
        const course = currentProfile && currentProfile.course_or_strand ? currentProfile.course_or_strand : "";
        setText("verificationSchoolCourse", [schoolName, course].filter(Boolean).join(" / ") || "-");

        const contact = currentProfile ? (currentProfile.mobile_number || currentProfile.email || "-") : "-";
        setText("verificationContact", contact);
    }

    function renderInterviewForm() {
        const interview = currentInterview || {};
        const remarksSource = interview.remarks || (currentApplication && currentApplication.secretary_remarks) || "";
        const remarksParsed = parseRemarksWithSectorMeta(remarksSource);

        const dateTime = byId("verificationInterviewDateTime");
        const venue = byId("verificationInterviewVenue");
        const status = byId("verificationInterviewStatus");
        const result = byId("verificationInterviewResult");
        const score = byId("verificationExamScore");
        const remarks = byId("verificationRemarks");

        if (dateTime) {
            dateTime.value = toDatetimeLocalValue(interview.scheduled_at || "");
        }
        if (venue) {
            venue.value = interview.venue || "";
        }
        if (status) {
            status.value = interview.status || "not_scheduled";
        }
        if (result) {
            result.value = interview.result || "pending";
        }
        if (score) {
            score.value = interview.exam_score === null || typeof interview.exam_score === "undefined" ? "" : String(interview.exam_score);
        }
        if (remarks) {
            remarks.value = remarksParsed.plainRemarks;
        }

        setSectorSelection(remarksParsed.sectorTags);
        renderSectorTags();

        const recommendation = byId("verificationRecommendationDecision");
        if (recommendation && !recommendation.value) {
            recommendation.value = "approved";
        }

        const priority = byId("verificationQueuePriority");
        if (priority && !priority.value) {
            priority.value = "medium";
        }
    }

    function documentRowMarkup(definition) {
        const documentRow = latestDocumentByType[definition.type] || null;
        const docMeta = documentMeta(documentRow ? documentRow.verification_status : "missing");
        const fileUrl = signedDocumentUrlByType[definition.type] || "";

        const fileCell = documentRow
            ? (
                fileUrl
                    ? '<a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(fileUrl) + '" target="_blank" rel="noopener">View File</a>'
                    : '<div class="small text-muted">Preview unavailable</div>'
            )
            : '<span class="text-muted">Not uploaded</span>';

        const uploadedAt = documentRow ? formatDate(documentRow.created_at) : "-";

        if (!documentRow) {
            return (
                "<tr>" +
                "<td>" + escapeHtml(definition.label) + "</td>" +
                "<td>" + fileCell + "</td>" +
                "<td>" + escapeHtml(uploadedAt) + "</td>" +
                '<td><span class="ldss-chip ' + docMeta.chipClass + '">' + docMeta.label + "</span></td>" +
                '<td><span class="small text-muted">Applicant must upload this requirement.</span></td>' +
                "</tr>"
            );
        }

        const statusId = "verificationDocStatus-" + documentRow.id;
        const notePreviewId = "verificationDocNotePreview-" + documentRow.id;
        const noteValue = documentNotesById[documentRow.id] || "";

        return (
            "<tr>" +
            "<td>" + escapeHtml(definition.label) + "</td>" +
            "<td>" + fileCell + "</td>" +
            "<td>" + escapeHtml(uploadedAt) + "</td>" +
            "<td>" +
            '<select class="form-select form-select-sm ldss-verification-status-select" id="' + escapeHtml(statusId) + '" data-doc-id="' + escapeHtml(documentRow.id) + '" data-doc-type="' + escapeHtml(definition.type) + '">' +
            '<option value="pending"' + (documentRow.verification_status === "pending" ? " selected" : "") + ">Pending Review</option>" +
            '<option value="verified"' + (documentRow.verification_status === "verified" ? " selected" : "") + ">Verified</option>" +
            '<option value="needs_reupload"' + (documentRow.verification_status === "needs_reupload" ? " selected" : "") + ">Needs Reupload</option>" +
            '<option value="rejected"' + (documentRow.verification_status === "rejected" ? " selected" : "") + ">Rejected</option>" +
            "</select>" +
            "</td>" +
            "<td>" +
            '<button class="btn btn-outline-dark btn-sm ldss-doc-note-btn" type="button" data-doc-note-open="1" data-doc-id="' + escapeHtml(documentRow.id) + '" data-doc-label="' + escapeHtml(definition.label) + '">' +
            (noteValue ? "Edit Note" : "Add Note") +
            "</button>" +
            '<div class="small text-muted mt-1" id="' + escapeHtml(notePreviewId) + '"></div>' +
            "</td>" +
            "</tr>"
        );
    }

    function renderDocumentTable() {
        const tbody = byId("verificationDocumentsTableBody");
        if (!tbody) {
            return;
        }

        documentNotesById = {};
        Object.keys(latestDocumentByType).forEach(function (docType) {
            const row = latestDocumentByType[docType];
            if (!row || !row.id) {
                return;
            }
            documentNotesById[row.id] = row.verification_notes || "";
        });

        tbody.innerHTML = REQUIRED_DOCUMENTS.map(documentRowMarkup).join("");
        Object.keys(documentNotesById).forEach(function (docId) {
            updateDocNotePreview(docId);
        });
    }

    function documentVerificationState() {
        return REQUIRED_DOCUMENTS.map(function (definition) {
            const row = latestDocumentByType[definition.type] || null;
            if (!row) {
                return {
                    type: definition.type,
                    label: definition.label,
                    exists: false,
                    status: "missing"
                };
            }

            const statusEl = byId("verificationDocStatus-" + row.id);

            return {
                type: definition.type,
                label: definition.label,
                exists: true,
                row: row,
                status: statusEl ? statusEl.value : (row.verification_status || "pending"),
                notes: Object.prototype.hasOwnProperty.call(documentNotesById, row.id)
                    ? (documentNotesById[row.id] || "").trim()
                    : (row.verification_notes || "")
            };
        });
    }

    function readFormValues() {
        const interviewDateTimeRaw = byId("verificationInterviewDateTime") ? byId("verificationInterviewDateTime").value : "";
        const examScoreRaw = byId("verificationExamScore") ? byId("verificationExamScore").value : "";
        const parsedScore = examScoreRaw === "" ? null : Number(examScoreRaw);

        if (examScoreRaw !== "" && (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100)) {
            return { error: "Interview score must be between 0 and 100." };
        }

        const remarksValue = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        const cleanSectorTags = uniqueTags(selectedSectorTags);

        return {
            interviewDateTimeIso: toIsoFromDatetimeLocal(interviewDateTimeRaw),
            interviewVenue: byId("verificationInterviewVenue") ? byId("verificationInterviewVenue").value.trim() : "",
            interviewStatus: byId("verificationInterviewStatus") ? byId("verificationInterviewStatus").value : "not_scheduled",
            interviewResult: byId("verificationInterviewResult") ? byId("verificationInterviewResult").value : "pending",
            examScore: parsedScore,
            queuePriority: byId("verificationQueuePriority") ? byId("verificationQueuePriority").value : "medium",
            recommendationDecision: byId("verificationRecommendationDecision") ? byId("verificationRecommendationDecision").value : "approved",
            remarks: remarksValue,
            sectorTags: cleanSectorTags,
            remarksWithSectorMeta: composeRemarksWithSectorMeta(remarksValue, cleanSectorTags)
        };
    }

    function actionButtonState(isLoading, activeButtonId, loadingText) {
        const saveBtn = byId("verificationSaveBtn");
        const returnBtn = byId("verificationReturnBtn");
        const recommendBtn = byId("verificationRecommendBtn");

        const setState = function (button, defaultLabel) {
            if (!button) {
                return;
            }
            button.disabled = isLoading;
            if (!isLoading) {
                button.textContent = defaultLabel;
                return;
            }
            if (button.id === activeButtonId) {
                button.textContent = loadingText;
            }
        };

        setState(saveBtn, "Save Verification");
        setState(returnBtn, "Return for Correction");
        setState(recommendBtn, "Recommend to Admin");
    }

    async function maybeUploadVerifiedPhoto() {
        const fileInput = byId("verificationVerifiedPhotoFile");
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            return null;
        }

        const file = fileInput.files[0];
        const mime = (file.type || "").toLowerCase();
        if (!mime.startsWith("image/")) {
            throw new Error("Verified photo must be an image file.");
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            throw new Error("Verified photo exceeds 10MB limit.");
        }

        if (!window.ldssUploads || typeof window.ldssUploads.uploadFile !== "function") {
            throw new Error("Verified photo upload client is not available.");
        }

        const uploadResult = await window.ldssUploads.uploadFile(authContext, file, {
            applicationId: currentApplication.id,
            documentType: "verified_interview_photo"
        });
        const storagePath = uploadResult && uploadResult.path ? uploadResult.path : "";
        if (!storagePath) {
            throw new Error("Verified photo upload failed: upload server did not return a file path.");
        }

        fileInput.value = "";
        return storagePath;
    }

    async function persistDocumentUpdates(docStateRows) {
        for (let i = 0; i < docStateRows.length; i += 1) {
            const row = docStateRows[i];
            if (!row.exists || !row.row) {
                continue;
            }

            const currentStatus = row.row.verification_status || "pending";
            const currentNotes = row.row.verification_notes || "";
            if (row.status === currentStatus && row.notes === currentNotes) {
                continue;
            }

            const updatePayload = {
                verification_status: row.status,
                verification_notes: row.notes || null,
                verified_by: row.status === "pending" ? null : authContext.user.id
            };

            const result = await authContext.client
                .from("application_documents")
                .update(updatePayload)
                .eq("id", row.row.id)
                .eq("application_id", currentApplication.id);

            if (result.error) {
                throw new Error("Failed to update " + row.label + ": " + result.error.message);
            }
        }
    }

    async function upsertInterview(formValues, verifiedPhotoPath, hardCopyVerified) {
        const previousVerifiedPath = (currentInterview && currentInterview.verified_photo_path)
            || (currentProfile && currentProfile.verified_interview_photo_path)
            || "";
        const payload = {
            application_id: currentApplication.id,
            scheduled_at: formValues.interviewDateTimeIso,
            venue: formValues.interviewVenue || null,
            status: formValues.interviewStatus,
            result: formValues.interviewResult,
            exam_score: formValues.examScore,
            remarks: formValues.remarksWithSectorMeta || null,
            encoded_by: authContext.user.id,
            hard_copy_verified: Boolean(hardCopyVerified),
            hard_copy_verified_at: hardCopyVerified ? new Date().toISOString() : null
        };

        const finalVerifiedPath = verifiedPhotoPath
            || (currentInterview && currentInterview.verified_photo_path)
            || null;

        if (finalVerifiedPath) {
            payload.verified_photo_path = finalVerifiedPath;
        }

        let result = await authContext.client
            .from("interview_records")
            .upsert(payload, { onConflict: "application_id" })
            .select("id, application_id, scheduled_at, venue, status, result, exam_score, remarks, verified_photo_path, hard_copy_verified, hard_copy_verified_at")
            .single();

        if (result.error) {
            result = await authContext.client
                .from("interviews")
                .upsert(payload, { onConflict: "application_id" })
                .select("id, application_id, scheduled_at, venue, status, result, exam_score, remarks, verified_photo_path")
                .single();
        }

        if (result.error) {
            throw new Error("Failed to save interview details: " + result.error.message);
        }

        if (verifiedPhotoPath) {
            const profileResult = await authContext.client
                .from("profiles")
                .update({ verified_interview_photo_path: verifiedPhotoPath })
                .eq("id", currentApplication.applicant_id);

            if (profileResult.error) {
                throw new Error("Interview saved but profile verified photo update failed: " + profileResult.error.message);
            }
            if (currentProfile) {
                currentProfile.verified_interview_photo_path = verifiedPhotoPath;
            }
            if (
                previousVerifiedPath &&
                previousVerifiedPath !== verifiedPhotoPath &&
                window.ldssUploads &&
                typeof window.ldssUploads.deleteFiles === "function"
            ) {
                try {
                    await window.ldssUploads.deleteFiles(authContext, [previousVerifiedPath]);
                } catch (cleanupError) {
                    // Best-effort cleanup only. Keep the saved interview update successful.
                }
            }
        }

        return result.data;
    }

    async function updateApplication(targetStatus, remarks, lockState) {
        const payload = {
            status: targetStatus,
            secretary_reviewer_id: authContext.user.id,
            secretary_remarks: remarks || null
        };

        if (typeof lockState === "boolean") {
            payload.is_locked = lockState;
        }

        const result = await authContext.client
            .from("applications")
            .update(payload)
            .eq("id", currentApplication.id);

        if (result.error) {
            throw new Error("Failed to update application status: " + result.error.message);
        }
    }

    async function upsertApprovalQueue(formValues) {
        const queuedAt = new Date().toISOString();
        const approvalRecordPayload = {
            application_id: currentApplication.id,
            priority: formValues.queuePriority,
            recommendation_status: formValues.recommendationDecision,
            recommendation_notes: formValues.remarks || null,
            queued_at: queuedAt,
            decision_status: "pending"
        };
        const queuePayload = {
            application_id: currentApplication.id,
            priority: formValues.queuePriority,
            secretary_recommendation: formValues.recommendationDecision,
            recommendation_notes: formValues.remarks || null,
            queued_at: queuedAt,
            decision_status: "pending"
        };

        const approvalRecordResult = await authContext.client
            .from("approval_records")
            .upsert(approvalRecordPayload, { onConflict: "application_id" });

        if (approvalRecordResult.error) {
            throw new Error("Failed to update approval record: " + approvalRecordResult.error.message);
        }

        const queueResult = await authContext.client
            .from("approval_queue")
            .upsert(queuePayload, { onConflict: "application_id" });

        if (queueResult.error) {
            throw new Error("Failed to update secretary queue: " + queueResult.error.message);
        }
    }

    async function notifyApplicant(type, title, message) {
        const payload = {
            recipient_user_id: currentApplication.applicant_id,
            sender_user_id: authContext.user.id,
            notification_type: type,
            title: title,
            message: message,
            related_application_id: currentApplication.id,
            related_url: "application-detail.html?id=" + encodeURIComponent(currentApplication.id)
        };

        const result = await authContext.client
            .from("notifications")
            .insert(payload);

        if (result.error) {
            throw new Error("Action saved but notification failed: " + result.error.message);
        }
    }

    function allRequiredDocsVerified(docStates) {
        if (!Array.isArray(docStates) || docStates.length === 0) {
            return true;
        }
        return docStates.every(function (row) {
            return row.exists && row.status === "verified";
        });
    }

    function deriveSaveStatus(interviewStatus, docStates) {
        const lockedStatuses = [
            "for_approval",
            "approved",
            "waitlisted",
            "rejected",
            "for_release",
            "released"
        ];

        if (lockedStatuses.includes(currentApplication.status)) {
            return currentApplication.status;
        }

        if (["scheduled", "rescheduled"].includes(interviewStatus)) {
            return "interview_scheduled";
        }

        if (interviewStatus === "completed") {
            if (allRequiredDocsVerified(docStates)) {
                return "hard_copy_verified";
            }
            return "interview_completed";
        }

        return "for_interview";
    }

    async function persistVerification(targetStatus, lockState, includeQueue) {
        const formValues = readFormValues();
        if (formValues.error) {
            throw new Error(formValues.error);
        }

        const docStates = documentVerificationState();
        const uploadedPhotoPath = await maybeUploadVerifiedPhoto();
        const hardCopyVerified = formValues.interviewStatus === "completed" && allRequiredDocsVerified(docStates);

        await persistDocumentUpdates(docStates);
        currentInterview = await upsertInterview(formValues, uploadedPhotoPath, hardCopyVerified);
        await updateApplication(targetStatus, formValues.remarks, lockState);

        if (includeQueue) {
            await upsertApprovalQueue(formValues);
        }

        return {
            formValues: formValues,
            docStates: docStates,
            uploadedPhotoPath: uploadedPhotoPath
        };
    }

    function missingOrUnverifiedRequiredDocs(docStates) {
        const missing = docStates.filter(function (row) {
            return !row.exists;
        });
        const notVerified = docStates.filter(function (row) {
            return row.exists && row.status !== "verified";
        });
        return {
            missing: missing,
            notVerified: notVerified
        };
    }

    async function handleSaveVerification() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        const docStates = documentVerificationState();
        const targetStatus = deriveSaveStatus(formValues.interviewStatus, docStates);
        const result = await persistVerification(targetStatus, null, false);

        if (result.formValues.interviewDateTimeIso && ["scheduled", "rescheduled", "completed"].includes(result.formValues.interviewStatus)) {
            await notifyApplicant(
                "interview",
                "Interview Schedule Updated",
                "Your scholarship interview schedule was updated to " + formatDateTime(result.formValues.interviewDateTimeIso) + ". Please check Application Tracking for details."
            );
        } else {
            await notifyApplicant(
                "application",
                "Application Verification Updated",
                "The scholarship office updated your application verification details."
            );
        }

        return "Verification details saved successfully.";
    }

    async function handleReturnForCorrection() {
        const remarks = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        if (!remarks || remarks.length < 10) {
            showStatus("Please provide clear remarks (at least 10 characters) before returning for correction.", "alert-warning");
            return;
        }

        await persistVerification("submitted", false, false);
        await notifyApplicant(
            "application",
            "Application Returned for Correction",
            "Your application was returned for correction. Remarks: " + remarks
        );

        return "Application returned for correction.";
    }

    async function handleRecommendToAdmin() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        if (formValues.interviewResult === "pending") {
            showStatus("Set an interview result before recommending to admin.", "alert-warning");
            return;
        }

        const docStates = documentVerificationState();
        const checks = missingOrUnverifiedRequiredDocs(docStates);
        if (checks.missing.length > 0) {
            showStatus("Cannot recommend yet. Missing required document(s): " + checks.missing.map(function (row) { return row.label; }).join(", ") + ".", "alert-warning");
            return;
        }
        if (checks.notVerified.length > 0) {
            showStatus("Cannot recommend yet. Verify all required documents first.", "alert-warning");
            return;
        }

        if (!formValues.remarks || formValues.remarks.length < 10) {
            showStatus("Please include recommendation remarks before sending to admin.", "alert-warning");
            return;
        }

        await persistVerification("for_approval", true, true);

        const recommendationText = formValues.recommendationDecision === "approved"
            ? "approved"
            : (formValues.recommendationDecision === "waitlisted" ? "waitlisted" : "not recommended");

        await notifyApplicant(
            "approval",
            "Application Endorsed to Admin",
            "Your application has been endorsed to admin with secretary recommendation: " + recommendationText + "."
        );

        return "Application endorsed to admin approval queue.";
    }

    async function runAction(buttonId, loadingText, action) {
        if (isProcessing || !authContext || !currentApplication) {
            return;
        }

        isProcessing = true;
        actionButtonState(true, buttonId, loadingText);
        showStatus("");

        try {
            const successMessage = await action();
            if (!successMessage) {
                return;
            }
            await loadPageData(currentApplication.id);
            showStatus(successMessage, "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Action failed. Please try again.", "alert-danger");
        } finally {
            isProcessing = false;
            actionButtonState(false);
        }
    }

    function bindActions() {
        const printBtn = byId("verificationPrintBtn");
        const saveBtn = byId("verificationSaveBtn");
        const returnBtn = byId("verificationReturnBtn");
        const recommendBtn = byId("verificationRecommendBtn");
        const sectorTagsWrap = byId("verificationSectorTags");
        const cameraStartBtn = byId("verificationStartCameraBtn");
        const cameraCaptureBtn = byId("verificationCapturePhotoBtn");
        const cameraStopBtn = byId("verificationStopCameraBtn");

        if (printBtn) {
            printBtn.addEventListener("click", function () {
                if (!currentApplication || !currentApplication.id) {
                    showStatus("No application is loaded yet.", "alert-warning");
                    return;
                }
                window.location.href = "secretary-print-form.html?id=" + encodeURIComponent(currentApplication.id);
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                runAction("verificationSaveBtn", "Saving...", handleSaveVerification);
            });
        }

        if (returnBtn) {
            returnBtn.addEventListener("click", function () {
                runAction("verificationReturnBtn", "Returning...", handleReturnForCorrection);
            });
        }

        if (recommendBtn) {
            recommendBtn.addEventListener("click", function () {
                runAction("verificationRecommendBtn", "Submitting...", handleRecommendToAdmin);
            });
        }

        if (sectorTagsWrap) {
            sectorTagsWrap.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-sector-tag]");
                if (!trigger) {
                    return;
                }
                const tag = normalizeTag(trigger.getAttribute("data-sector-tag") || "");
                if (!tag) {
                    return;
                }

                const alreadySelected = selectedSectorTags.some(function (value) {
                    return value.toLowerCase() === tag.toLowerCase();
                });

                if (alreadySelected) {
                    selectedSectorTags = selectedSectorTags.filter(function (value) {
                        return value.toLowerCase() !== tag.toLowerCase();
                    });
                } else {
                    selectedSectorTags = uniqueTags(selectedSectorTags.concat(tag));
                }

                renderSectorTags();
            });
        }

        const photoInput = byId("verificationVerifiedPhotoFile");
        if (photoInput) {
            photoInput.addEventListener("change", function () {
                const file = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
                if (!file) {
                    return;
                }
                clearLocalPreviewObjectUrl();
                const previewUrl = URL.createObjectURL(file);
                localPreviewObjectUrl = previewUrl;
                setPhotoArea(
                    "verificationVerifiedPhotoPreview",
                    "verificationVerifiedPhotoPlaceholder",
                    "verificationVerifiedPhotoLink",
                    previewUrl,
                    "No verified interview photo uploaded."
                );
            });
        }

        if (cameraStartBtn) {
            cameraStartBtn.addEventListener("click", async function () {
                try {
                    await startCameraStream();
                    showStatus("Camera started. Position applicant, then click Capture Photo.", "alert-info");
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Unable to start camera.", "alert-danger");
                }
            });
        }

        if (cameraCaptureBtn) {
            cameraCaptureBtn.addEventListener("click", async function () {
                try {
                    await captureCameraPhoto();
                    showStatus("Interview photo captured. Save verification to upload.", "alert-success");
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Unable to capture photo.", "alert-danger");
                }
            });
        }

        if (cameraStopBtn) {
            cameraStopBtn.addEventListener("click", function () {
                stopCameraStream();
            });
        }

        window.addEventListener("beforeunload", function () {
            stopCameraStream();
            clearLocalPreviewObjectUrl();
        });
    }

    async function loadPageData(targetApplicationId) {
        showStatus("");
        stopCameraStream();
        sectorOptions = loadSectorOptions();

        currentApplication = await fetchApplication(targetApplicationId || queryApplicationId());
        if (!currentApplication) {
            showStatus("No application records are currently available for secretary verification.", "alert-warning");
            setSectorSelection([]);
            renderSectorTags();
            return;
        }

        const dataResults = await Promise.all([
            fetchProfile(currentApplication.applicant_id),
            fetchInterview(currentApplication.id),
            fetchDocuments(currentApplication.id)
        ]);

        currentProfile = dataResults[0];
        currentInterview = dataResults[1];
        latestDocumentByType = latestDocumentsByType(dataResults[2]);

        signedDocumentUrlByType = {};
        for (let i = 0; i < REQUIRED_DOCUMENTS.length; i += 1) {
            const type = REQUIRED_DOCUMENTS[i].type;
            const row = latestDocumentByType[type];
            if (row && row.storage_path) {
                signedDocumentUrlByType[type] = await createSignedUrl(row.storage_path);
            }
        }

        const applicantPhotoPath = (currentProfile && currentProfile.applicant_photo_path)
            || (latestDocumentByType.applicant_photo ? latestDocumentByType.applicant_photo.storage_path : "");

        const verifiedPhotoPath = (currentInterview && currentInterview.verified_photo_path)
            || (currentProfile && currentProfile.verified_interview_photo_path)
            || "";

        const photoUrls = await Promise.all([
            applicantPhotoPath ? createSignedUrl(applicantPhotoPath) : Promise.resolve(""),
            verifiedPhotoPath ? createSignedUrl(verifiedPhotoPath) : Promise.resolve("")
        ]);

        renderHeaderAndSummary();
        renderInterviewForm();

        clearLocalPreviewObjectUrl();

        setPhotoArea(
            "verificationApplicantPhotoPreview",
            "verificationApplicantPhotoPlaceholder",
            "verificationApplicantPhotoLink",
            photoUrls[0],
            "No applicant photo on file."
        );

        setPhotoArea(
            "verificationVerifiedPhotoPreview",
            "verificationVerifiedPhotoPlaceholder",
            "verificationVerifiedPhotoLink",
            photoUrls[1],
            "No verified interview photo uploaded."
        );
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindActions();
        await loadPageData(queryApplicationId());
    }

    window.addEventListener("DOMContentLoaded", init);
})();
