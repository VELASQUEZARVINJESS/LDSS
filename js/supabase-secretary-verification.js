
(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
    const SETTINGS_STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const DAET_MUNICIPALITY = "DAET";
    const DAET_BARANGAYS = [
        "Alawihao",
        "Awitan",
        "Bagasbas",
        "Barangay I",
        "Barangay II",
        "Barangay III",
        "Barangay IV",
        "Barangay V",
        "Barangay VI",
        "Barangay VII",
        "Barangay VIII",
        "Bibirao",
        "Borabod",
        "Calasgasan",
        "Camambugan",
        "Cobangbang",
        "Dogongan",
        "Gahonon",
        "Gubat",
        "Lag-on",
        "Magang",
        "Mambalite",
        "Mancruz",
        "Pamorangon",
        "San Isidro"
    ];
    const DEFAULT_WORKFLOW_CONTROLS = {
        allow_special_endorsement: true,
        allow_secretary_applicant_edits: false,
        allow_secretary_draft_completion: false,
        require_applicant_photo_on_submit: true
    };

    const APPLICATION_STATUS_META = {
        draft: { label: "Draft", chipClass: "ldss-chip-neutral" },
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

    const COUNSELOR_OPTIONS_STORAGE_KEY = "ldss:counselor-options:v1";
    const INTERVIEW_SCHEDULE_STORAGE_KEY = "ldss:default-interview-schedule:v1";
    const INTERVIEW_VENUE_STORAGE_KEY = "ldss:default-interview-venue:v1";
    const VERIFICATION_QUEUE_STORAGE_KEY = "ldss:secretary-verification-queue:v1";
    const COMPLIANCE_EMAIL_API_PATH = "/api/notifications/compliance-email";
    const DEFAULT_COUNSELOR_OPTIONS = [];
    const PHOTO_CHANGE_REMARK = "Please replace your applicant 1x1 photo with a clear picture on a white background while wearing formal attire or your school uniform.";
    const COMPLIANCE_NOTICE_TITLE = "Compliance Notice: Update Your Application";
    const REMARKS_COUNSELOR_META_START = "[[LDSS_COUNSELOR]]";
    const REMARKS_COUNSELOR_META_END = "[[/LDSS_COUNSELOR]]";
    const REMARKS_SECTOR_META_START = "[[LDSS_SECTOR_TAGS]]";
    const REMARKS_SECTOR_META_END = "[[/LDSS_SECTOR_TAGS]]";
    const CORRECTION_TARGET_LABELS = {
        full_application: "Entire Application Form",
        applicant_photo: "Applicant 1x1 Photo",
        personal_information: "Personal Information",
        address_contact: "Address and Contact",
        education_background: "Education Background",
        family_background: "Family Background",
        spouse_information: "Married / Spouse Section"
    };
    const CORRECTION_TARGET_KEYS = Object.keys(CORRECTION_TARGET_LABELS);

    let authContext = null;
    let currentApplication = null;
    let currentProfile = null;
    let currentAuxMeta = {};
    let currentInterview = null;
    let currentFormSnapshot = "";
    let applicationNavigationIds = [];
    let currentNavigationIndex = -1;
    let latestDocumentByType = {};
    let signedDocumentUrlByType = {};
    let documentNotesById = {};
    let notesModalInstance = null;
    let applicantEditModalInstance = null;
    let returnCorrectionModalInstance = null;
    let activeNotesDocId = "";
    let counselorOptions = DEFAULT_COUNSELOR_OPTIONS.slice();
    let selectedCounselor = "";
    let cameraStream = null;
    let localPreviewObjectUrl = "";
    let draftApplicantPhotoPreviewObjectUrl = "";
    let isProcessing = false;
    let profilesSupportsPlaceOfBirth = true;
    let applicationAuxDataAvailable = true;
    let workflowControls = Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
    let latestCorrectionNotice = null;
    let pageLoadToken = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function isActivePageLoad(loadToken) {
        return loadToken === pageLoadToken;
    }

    function escapeRegExp(value) {
        return (value || "").toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function dedupeFixedRemark(text, fixedRemark) {
        const normalizedText = (text || "").toString().replace(/\s+/g, " ").trim();
        const normalizedFixed = (fixedRemark || "").toString().replace(/\s+/g, " ").trim();
        if (!normalizedText || !normalizedFixed) {
            return normalizedText;
        }

        const fixedBase = normalizedFixed.replace(/\.+$/g, "");
        const fixedPattern = new RegExp(escapeRegExp(fixedBase) + "\\.?", "gi");
        let seenFixed = false;
        let cleaned = normalizedText.replace(fixedPattern, function () {
            if (seenFixed) {
                return " ";
            }
            seenFixed = true;
            return fixedBase + ".";
        });

        cleaned = cleaned
            .replace(/\s+/g, " ")
            .replace(/\s+([,.;:!?])/g, "$1")
            .replace(/([.?!]){2,}/g, "$1")
            .trim();

        return cleaned;
    }

    function appendFixedRemarkOnce(text, fixedRemark) {
        const normalizedFixed = (fixedRemark || "").toString().replace(/\s+/g, " ").trim();
        const deduped = dedupeFixedRemark(text, normalizedFixed);
        if (!normalizedFixed) {
            return deduped;
        }
        const fixedBase = normalizedFixed.replace(/\.+$/g, "");
        const alreadyHasFixed = new RegExp(escapeRegExp(fixedBase) + "\\.?", "i").test(deduped);
        if (!deduped) {
            return normalizedFixed;
        }
        if (alreadyHasFixed) {
            return deduped;
        }
        return deduped + (/[.!?]$/.test(deduped) ? "" : ".") + " " + normalizedFixed;
    }

    async function getAccessToken() {
        if (!authContext || !authContext.client || !authContext.client.auth || typeof authContext.client.auth.getSession !== "function") {
            throw new Error("Supabase session is not available.");
        }

        const result = await authContext.client.auth.getSession();
        const session = result && result.data ? result.data.session : null;
        const token = session && session.access_token ? session.access_token : "";
        if (!token) {
            throw new Error("No active access token found. Please sign in again.");
        }
        return token;
    }

    async function requestJson(path, options) {
        const token = await getAccessToken();
        const fetchOptions = Object.assign({ method: "GET" }, options || {});
        const headers = new Headers(fetchOptions.headers || {});
        headers.set("Authorization", "Bearer " + token);
        fetchOptions.headers = headers;

        const response = await fetch(path, fetchOptions);
        const responseText = await response.text();
        let payload = null;

        if (responseText) {
            try {
                payload = JSON.parse(responseText);
            } catch (_error) {
                payload = null;
            }
        }

        if (!response.ok) {
            const fallbackMessage = response.status === 404
                ? "Compliance email API route was not found. Open the site through the Node server."
                : "Request failed.";
            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
    }

    function getApplicantEditModal() {
        if (!applicantEditModalInstance) {
            const modalEl = byId("verificationApplicantEditModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                applicantEditModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return applicantEditModalInstance;
    }

    function getReturnCorrectionModal() {
        if (!returnCorrectionModalInstance) {
            const modalEl = byId("verificationReturnModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                returnCorrectionModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return returnCorrectionModalInstance;
    }

    function setApplicantEditStatus(message, type) {
        const box = byId("verificationApplicantEditStatus");
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

    function valueOrDash(value) {
        const text = (value || "").toString().trim();
        return text || "-";
    }

    function nullIfBlank(value) {
        const text = (value || "").toString().trim();
        return text || null;
    }

    function upperTextOrNull(value) {
        const text = nullIfBlank(value);
        return text ? text.toUpperCase() : null;
    }

    function normalizeMiddleNameValue(value) {
        const text = (value || "").toString().trim();
        if (!text) {
            return "N/A";
        }
        if (/^n\s*\/?\s*a$/i.test(text)) {
            return "N/A";
        }
        return text.toUpperCase();
    }

    function normalizeMobileForStorage(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return null;
        }
        const cleaned = raw.replace(/[\s()-]/g, "");
        const digits = cleaned.replace(/\D/g, "");
        if (/^09\d{9}$/.test(digits)) {
            return "+63" + digits.slice(1);
        }
        if (/^9\d{9}$/.test(digits)) {
            return "+63" + digits;
        }
        if (/^63\d{10}$/.test(digits)) {
            return "+" + digits;
        }
        if (/^\+\d{10,15}$/.test(cleaned)) {
            return cleaned;
        }
        return raw;
    }

    function readFallbackWorkflowControls() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
            }
            const parsed = JSON.parse(raw);
            const controls = parsed && parsed.ranking_basis && parsed.ranking_basis.controls
                ? parsed.ranking_basis.controls
                : {};
            return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS, controls);
        } catch (error) {
            return Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
        }
    }

    async function loadWorkflowControls() {
        const fallback = readFallbackWorkflowControls();
        const rpcResult = await authContext.client.rpc("active_workflow_controls");
        if (!rpcResult.error && rpcResult.data && typeof rpcResult.data === "object") {
            workflowControls = Object.assign({}, fallback, rpcResult.data);
            return workflowControls;
        }

        if (rpcResult.error && !/does not exist|function|permission/i.test(rpcResult.error.message || "")) {
            throw new Error("Failed to load workflow controls: " + rpcResult.error.message);
        }

        workflowControls = fallback;
        return workflowControls;
    }

    function setControlValue(id, value) {
        const input = byId(id);
        if (input) {
            input.value = value == null ? "" : String(value);
        }
    }

    function setSelectValue(id, value) {
        const select = byId(id);
        if (!select) {
            return;
        }
        const normalized = (value || "").toString().trim().toLowerCase();
        if (!normalized) {
            select.value = "";
            return;
        }
        const match = Array.from(select.options).find(function (option) {
            return (option.value || "").toString().trim().toLowerCase() === normalized;
        });
        if (match) {
            select.value = match.value;
            return;
        }
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
        select.value = value;
    }

    function removeAddressToken(value, token) {
        const normalizedToken = (token || "").toString().trim();
        if (!normalizedToken) {
            return (value || "")
                .toString()
                .replace(/\s*,\s*/g, ", ")
                .replace(/,\s*,+/g, ", ")
                .replace(/\s{2,}/g, " ")
                .replace(/^[,\s]+|[,\s]+$/g, "")
                .trim();
        }
        const pattern = new RegExp("\\b" + normalizedToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "\\b", "gi");
        return (value || "")
            .toString()
            .replace(pattern, " ")
            .replace(/\s*,\s*/g, ", ")
            .replace(/,\s*,+/g, ", ")
            .replace(/\s{2,}/g, " ")
            .replace(/^[,\s]+|[,\s]+$/g, "")
            .trim();
    }

    function stripPermanentAddressDecorators(value, selectedBarangay) {
        let cleaned = removeAddressToken(value, DAET_MUNICIPALITY);
        if (selectedBarangay) {
            cleaned = removeAddressToken(cleaned, selectedBarangay);
        }
        return removeAddressToken(cleaned, "");
    }

    function normalizeBarangayValue(value) {
        const cleaned = stripPermanentAddressDecorators(value, "");
        if (!cleaned) {
            return "";
        }
        const matched = DAET_BARANGAYS.find(function (barangay) {
            return (barangay || "").toString().trim().toLowerCase() === cleaned.toLowerCase();
        });
        return matched || cleaned;
    }

    function parsePermanentAddress(address, barangay) {
        const selectedBarangay = normalizeBarangayValue(barangay);
        return {
            barangay: selectedBarangay,
            line: stripPermanentAddressDecorators(address, selectedBarangay)
        };
    }

    function composePermanentAddress(line, barangay) {
        const pieces = [];
        const cleanLine = upperTextOrNull(stripPermanentAddressDecorators(line, barangay));
        const cleanBarangay = nullIfBlank(normalizeBarangayValue(barangay));
        if (cleanLine) {
            pieces.push(cleanLine);
        }
        if (cleanBarangay) {
            pieces.push(cleanBarangay.toUpperCase());
        }
        if (pieces.length === 0) {
            return null;
        }
        pieces.push(DAET_MUNICIPALITY);
        return pieces.join(", ");
    }

    function populateApplicantEditBarangays() {
        const select = byId("verificationEditBarangay");
        if (!select) {
            return;
        }
        const current = select.value;
        select.innerHTML = '<option value="">Select barangay</option>' + DAET_BARANGAYS.map(function (barangay) {
            return '<option value="' + escapeHtml(barangay) + '">' + escapeHtml(barangay) + "</option>";
        }).join("");
        if (current) {
            setSelectValue("verificationEditBarangay", current);
        }
    }

    function setText(id, value) {
        const el = byId(id);
        if (!el) {
            return;
        }
        el.textContent = valueOrDash(value);
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

    function normalizeStatus(status) {
        return (status || "")
            .toString()
            .trim()
            .toLowerCase();
    }

    function normalizedApplicationStatus() {
        return normalizeStatus(currentApplication && currentApplication.status);
    }

    function isDraftApplication(application) {
        return (((application || {}).status) || "")
            .toString()
            .trim()
            .toLowerCase() === "draft";
    }

    function isSecretaryDraftCompletionEnabled() {
        return workflowControls.allow_secretary_draft_completion === true;
    }

    function isDraftViewOnlyRequest() {
        return queryDraftMode() === "view";
    }

    function isDraftCompletionMode() {
        return isDraftApplication(currentApplication)
            && isSecretaryDraftCompletionEnabled()
            && !isDraftViewOnlyRequest();
    }

    function isDraftReadOnlyMode() {
        return isDraftApplication(currentApplication)
            && (!isSecretaryDraftCompletionEnabled() || isDraftViewOnlyRequest());
    }

    function isApplicantPhotoRequiredOnSubmit() {
        return workflowControls.require_applicant_photo_on_submit !== false;
    }

    function currentApplicantPhotoPath() {
        return (currentProfile && currentProfile.applicant_photo_path)
            || (latestDocumentByType.applicant_photo && latestDocumentByType.applicant_photo.storage_path)
            || "";
    }

    function selectedDraftApplicantPhotoFile() {
        const input = byId("verificationDraftApplicantPhotoFile");
        return input && input.files && input.files[0] ? input.files[0] : null;
    }

    function buildVerificationUrl(applicationId) {
        return "secretary-interview-verification.html?id=" + encodeURIComponent(applicationId || "");
    }

    function correctionTargetLabel(targetKey) {
        return CORRECTION_TARGET_LABELS[targetKey] || CORRECTION_TARGET_LABELS.full_application;
    }

    function normalizeCorrectionTargetKey(targetKey) {
        const normalized = (targetKey || "").toString().trim().toLowerCase();
        return CORRECTION_TARGET_LABELS[normalized] ? normalized : "";
    }

    function normalizeCorrectionTargetKeys(rawValue) {
        let values = [];
        if (Array.isArray(rawValue)) {
            values = rawValue.slice();
        } else if (typeof rawValue === "string") {
            values = rawValue.split(",");
        } else if (rawValue) {
            values = [rawValue];
        }

        const seen = {};
        const keys = values
            .map(function (item) {
                return normalizeCorrectionTargetKey(item);
            })
            .filter(function (item) {
                if (!item || seen[item]) {
                    return false;
                }
                seen[item] = true;
                return true;
            });
        return keys;
    }

    function parseCorrectionTargetKeys(rawValue) {
        const keys = normalizeCorrectionTargetKeys(rawValue);
        if (keys.includes("full_application")) {
            return ["full_application"];
        }
        return keys;
    }

    function checkedCorrectionTargetKeys() {
        return normalizeCorrectionTargetKeys(
            Array.from(document.querySelectorAll("input[name='verificationCorrectionTargets']:checked")).map(function (input) {
                return input.value;
            })
        );
    }

    function selectedCorrectionTargets() {
        const keys = checkedCorrectionTargetKeys();
        return keys.length ? keys : ["full_application"];
    }

    function selectedCorrectionTarget() {
        return selectedCorrectionTargets()[0];
    }

    function correctionTargetsLabelText(targetKeys) {
        const labels = selectedOrProvidedCorrectionTargetLabels(targetKeys);
        if (labels.length === 1) {
            return labels[0];
        }
        if (labels.length === 2) {
            return labels[0] + " and " + labels[1];
        }
        return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
    }

    function selectedOrProvidedCorrectionTargetLabels(targetKeys) {
        return (parseCorrectionTargetKeys(targetKeys).length ? parseCorrectionTargetKeys(targetKeys) : ["full_application"]).map(function (key) {
            return correctionTargetLabel(key);
        });
    }

    function setCorrectionTargetCheckboxState(targetKeys) {
        const rawTargets = normalizeCorrectionTargetKeys(targetKeys);
        const normalizedTargets = rawTargets.length ? rawTargets : ["full_application"];
        const fullApplicationOnly = normalizedTargets.includes("full_application");

        CORRECTION_TARGET_KEYS.forEach(function (targetKey) {
            const input = document.querySelector("input[name='verificationCorrectionTargets'][value='" + targetKey + "']");
            if (!input) {
                return;
            }
            input.checked = fullApplicationOnly
                ? targetKey === "full_application"
                : normalizedTargets.includes(targetKey);
            if (input.parentElement) {
                input.parentElement.classList.toggle("is-selected", !!input.checked);
            }
        });

        updateReturnCorrectionSelectionSummary();
    }

    function updateReturnCorrectionSelectionSummary() {
        const summary = byId("verificationCorrectionSelectionSummary");
        if (!summary) {
            return;
        }

        const targets = selectedCorrectionTargets();
        const primaryTarget = targets[0] || "full_application";
        const targetText = correctionTargetsLabelText(targets);

        if (targets.length === 1 && primaryTarget === "full_application") {
            summary.textContent = "Applicant will reopen the full application form.";
            return;
        }

        summary.textContent = "Selected sections: " + targetText + ". Applicant will open " + correctionTargetLabel(primaryTarget) + " first.";
    }

    function handleCorrectionTargetCheckboxChange(event) {
        const input = event && event.target ? event.target : null;
        const changedTarget = normalizeCorrectionTargetKey(input && input.value ? input.value : "");
        let targets = checkedCorrectionTargetKeys();

        if (!changedTarget) {
            setCorrectionTargetCheckboxState(targets);
            return;
        }

        if (changedTarget === "full_application") {
            if (input && input.checked) {
                targets = ["full_application"];
            } else if (!targets.length) {
                targets = ["full_application"];
            }
        } else {
            targets = targets.filter(function (targetKey) {
                return targetKey !== "full_application";
            });
            if (!targets.length) {
                targets = ["full_application"];
            }
        }

        setCorrectionTargetCheckboxState(targets);
    }

    function setReturnCorrectionRemarksPreview(message) {
        const preview = byId("verificationCorrectionRemarksPreview");
        if (!preview) {
            return;
        }
        preview.textContent = valueOrDash(message);
    }

    function openReturnCorrectionModal() {
        const remarksEl = byId("verificationRemarks");
        const remarks = remarksEl ? remarksEl.value.trim() : "";
        setReturnCorrectionRemarksPreview(remarks);
        updateReturnCorrectionSelectionSummary();
        const modal = getReturnCorrectionModal();
        if (modal) {
            modal.show();
        }
    }

    function isSecretaryCheckingStage(status) {
        return ["submitted", "pending_exam", "returned_for_correction"].includes((status || "").toString().toLowerCase());
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

    function isCorrectionNotification(row) {
        const title = (row && row.title ? row.title : "").toString().trim().toLowerCase();
        const message = (row && row.message ? row.message : "").toString().trim().toLowerCase();
        return title.indexOf("returned for correction") !== -1 ||
            title.indexOf("compliance notice") !== -1 ||
            title.indexOf("photo needs change") !== -1 ||
            message.indexOf("returned for correction") !== -1 ||
            message.indexOf("need to comply") !== -1 ||
            message.indexOf("replace your applicant 1x1 photo") !== -1;
    }

    function correctionNoticeLabel(notice, application) {
        const title = (notice && notice.title ? notice.title : "").toString().trim().toLowerCase();
        const status = normalizeStatus(application && application.status);

        if (title.indexOf("photo needs change") !== -1) {
            return "Photo Change";
        }
        if (title.indexOf("compliance notice") !== -1) {
            return "Compliance Notice";
        }
        if (title.indexOf("returned for correction") !== -1 || status === "returned_for_correction") {
            return "Returned for Correction";
        }
        return "Correction Notice";
    }

    function hasApplicationUpdatedSinceNotice(application, notice) {
        const noticeAt = new Date(notice && notice.created_at ? notice.created_at : 0).getTime();
        const applicationUpdatedAt = new Date(
            (application && (application.updated_at || application.created_at)) || 0
        ).getTime();

        return !!(
            notice &&
            noticeAt &&
            applicationUpdatedAt &&
            applicationUpdatedAt > noticeAt
        );
    }

    function hasApplicationReturnedRecordBeenUpdated(application, notice) {
        const status = normalizeStatus(application && application.status);
        return hasApplicationUpdatedSinceNotice(application, notice) && status !== "returned_for_correction";
    }

    function hasApplicantUpdatedReturnedApplication(application, notice) {
        return hasApplicationUpdatedSinceNotice(application, notice);
    }

    function renderCorrectionHistoryNotice() {
        const box = byId("verificationCorrectionHistoryNotice");
        if (!box) {
            return;
        }

        if (!latestCorrectionNotice || !currentApplication) {
            box.className = "alert alert-light d-none";
            box.textContent = "";
            return;
        }

        const label = correctionNoticeLabel(latestCorrectionNotice, currentApplication);
        const sentAt = formatDateTime(latestCorrectionNotice.created_at);
        const hasUpdated = hasApplicationReturnedRecordBeenUpdated(currentApplication, latestCorrectionNotice);

        if (hasUpdated) {
            box.className = "alert alert-info";
            box.textContent = "Resubmitted after " + label + " sent on " + sentAt + ". This record is back in the verification queue for secretary re-check.";
            return;
        }

        box.className = "alert alert-warning";
        box.textContent = label + " sent on " + sentAt + ". Waiting for applicant update or completion.";
    }

    function updateVerificationNavigationButtons() {
        const prevBtn = byId("verificationPrevBtn");
        const nextBtn = byId("verificationNextBtn");
        const forExamBtn = byId("verificationForExamBtn");
        const notQualifiedBtn = byId("verificationNotQualifiedBtn");
        const hasPrevious = currentNavigationIndex > 0;
        const hasNext = currentNavigationIndex > -1 && currentNavigationIndex < applicationNavigationIds.length - 1;
        const canDecideQualification = !!currentApplication &&
            !isDraftApplication(currentApplication) &&
            isSecretaryCheckingStage(normalizedApplicationStatus());

        if (prevBtn) {
            prevBtn.disabled = isProcessing || !hasPrevious;
        }
        if (nextBtn) {
            nextBtn.disabled = isProcessing || !hasNext;
        }
        if (forExamBtn) {
            forExamBtn.disabled = isProcessing || !canDecideQualification;
        }
        if (notQualifiedBtn) {
            notQualifiedBtn.disabled = isProcessing || !canDecideQualification;
        }
        syncDraftReadOnlyState();
    }

    function saveActionLabel() {
        return isDraftCompletionMode() ? "Finish Draft" : "Save Checking";
    }

    function syncVerificationActionLabels() {
        const saveBtn = byId("verificationSaveBtn");
        if (saveBtn && !isProcessing) {
            saveBtn.textContent = saveActionLabel();
        }
    }

    function clearDraftApplicantPhotoPreviewObjectUrl() {
        if (!draftApplicantPhotoPreviewObjectUrl) {
            return;
        }
        URL.revokeObjectURL(draftApplicantPhotoPreviewObjectUrl);
        draftApplicantPhotoPreviewObjectUrl = "";
    }

    function syncDraftApplicantPhotoUploadState() {
        const wrap = byId("verificationDraftApplicantPhotoWrap");
        const input = byId("verificationDraftApplicantPhotoFile");
        const help = byId("verificationDraftApplicantPhotoHelp");
        const draftCompletionMode = isDraftCompletionMode();
        const hasStoredPhoto = Boolean(currentApplicantPhotoPath());

        if (wrap) {
            wrap.classList.toggle("d-none", !draftCompletionMode);
        }
        if (input) {
            input.disabled = !draftCompletionMode || isProcessing;
        }
        if (help) {
            if (!draftCompletionMode) {
                help.textContent = "Use this only when System Administrator enables draft completion for Secretary.";
            } else if (hasStoredPhoto) {
                help.textContent = "Optional replacement. If you choose a new JPG or PNG here, it uploads when you click Finish Draft.";
            } else if (isApplicantPhotoRequiredOnSubmit()) {
                help.textContent = "Applicant 1x1 photo is required before finishing this draft. Choose a JPG or PNG, then click Finish Draft.";
            } else {
                help.textContent = "Applicant photo is temporarily optional for submission. If available, attach it here before finishing the draft.";
            }
        }
    }


    function syncDraftReadOnlyState() {
        const draftReadOnly = isDraftReadOnlyMode();
        const draftApplication = isDraftApplication(currentApplication);
        const draftCompletionMode = isDraftCompletionMode();
        const notice = byId("verificationDraftReadOnlyNotice");
        const remarks = byId("verificationRemarks");
        const interviewDateTime = byId("verificationInterviewDateTime");
        const interviewVenue = byId("verificationInterviewVenue");
        const counselorSelect = byId("verificationCounselorEndorsement");
        const recommendationSelect = byId("verificationRecommendationDecision");
        const verifiedPhotoInput = byId("verificationVerifiedPhotoFile");
        const cameraStartBtn = byId("verificationStartCameraBtn");
        const cameraCaptureBtn = byId("verificationCapturePhotoBtn");
        const cameraStopBtn = byId("verificationStopCameraBtn");
        const saveBtn = byId("verificationSaveBtn");
        const complianceBtn = byId("verificationComplianceBtn");
        const returnBtn = byId("verificationReturnBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const photoActionBtn = byId("verificationPhotoActionBtn");
        const approvePhotoBtn = byId("verificationApprovePhotoBtn");
        const photoChangeBtn = byId("verificationRequestPhotoChangeBtn");
        const notQualifiedBtn = byId("verificationNotQualifiedBtn");
        const canDecideQualification = !!currentApplication &&
            !draftApplication &&
            isSecretaryCheckingStage(normalizedApplicationStatus());
        const editApplicantSaveBtn = byId("verificationApplicantEditSaveBtn");

        if (notice) {
            if (draftReadOnly) {
                notice.className = "alert alert-info";
                notice.textContent = isDraftViewOnlyRequest()
                    ? "Draft view only. Use Finish Draft from the application queue when the office is ready to complete this record."
                    : "Draft preview only. Secretary checking, correction routing, photo actions, and workflow updates stay disabled until the applicant submits the application.";
            } else if (draftCompletionMode) {
                notice.className = "alert alert-warning";
                notice.textContent = "Draft completion mode is enabled by System Administrator. Secretary can complete applicant details here, attach the applicant 1x1 photo if needed, then click Finish Draft. Checking, correction routing, and interview actions stay disabled until the draft is completed.";
            } else {
                notice.className = "alert alert-info d-none";
                notice.textContent = "";
            }
        }

        if (remarks) {
            remarks.readOnly = draftReadOnly;
        }
        if (interviewDateTime) {
            interviewDateTime.disabled = draftApplication;
        }
        if (interviewVenue) {
            interviewVenue.disabled = draftApplication;
        }
        if (counselorSelect) {
            counselorSelect.disabled = draftApplication;
        }
        if (recommendationSelect) {
            recommendationSelect.disabled = draftApplication;
        }
        if (verifiedPhotoInput) {
            verifiedPhotoInput.disabled = draftApplication;
        }
        if (cameraStartBtn) {
            cameraStartBtn.disabled = draftApplication;
        }
        if (cameraCaptureBtn) {
            cameraCaptureBtn.disabled = draftApplication;
        }
        if (cameraStopBtn) {
            cameraStopBtn.disabled = draftApplication;
        }
        if (saveBtn) {
            saveBtn.disabled = draftReadOnly || isProcessing || !currentApplication;
        }
        if (complianceBtn) {
            complianceBtn.disabled = draftApplication || isProcessing || !currentApplication;
        }
        if (returnBtn) {
            returnBtn.disabled = draftApplication || isProcessing || !currentApplication;
        }
        if (returnConfirmBtn) {
            returnConfirmBtn.disabled = draftApplication || isProcessing;
        }
        if (notQualifiedBtn) {
            notQualifiedBtn.disabled = draftApplication || isProcessing || !currentApplication || !canDecideQualification;
        }
        if (photoActionBtn) {
            photoActionBtn.disabled = draftApplication || isProcessing;
        }
        if (approvePhotoBtn) {
            approvePhotoBtn.disabled = draftApplication || isProcessing;
        }
        if (photoChangeBtn) {
            photoChangeBtn.disabled = draftApplication || isProcessing;
        }
        if (editApplicantSaveBtn) {
            editApplicantSaveBtn.disabled = draftReadOnly || isProcessing;
        }

        document.querySelectorAll(".ldss-verification-status-select, [data-doc-note-open='1']").forEach(function (element) {
            element.disabled = draftApplication;
        });

        syncDraftApplicantPhotoUploadState();
        syncVerificationActionLabels();
    }

    function readStoredVerificationQueue() {
        try {
            const raw = sessionStorage.getItem(VERIFICATION_QUEUE_STORAGE_KEY);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            const ids = parsed && Array.isArray(parsed.ids) ? parsed.ids : [];
            return ids.filter(Boolean);
        } catch (_error) {
            return [];
        }
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

    function formatMoney(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "-";
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return valueOrDash(value);
        }
        return "PHP " + numeric.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
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

    function normalizeAddressSegment(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\.+$/g, "")
            .toLowerCase();
    }

    function cleanupAddressDisplay(value) {
        return (value || "")
            .toString()
            .replace(/\s*,\s*/g, ", ")
            .replace(/,\s*,+/g, ", ")
            .replace(/\s{2,}/g, " ")
            .replace(/^[,\s]+|[,\s]+$/g, "")
            .trim();
    }

    function dedupeAddressSegments(value) {
        const seen = new Set();
        return cleanupAddressDisplay(value)
            .split(",")
            .map(function (segment) {
                return cleanupAddressDisplay(segment);
            })
            .filter(function (segment) {
                const key = normalizeAddressSegment(segment);
                if (!key || key === "barangay" || key === "brgy" || seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
            .join(", ");
    }

    function normalizeBarangayDisplay(value) {
        const seen = new Set();
        return cleanupAddressDisplay(value)
            .split(",")
            .map(function (segment) {
                return cleanupAddressDisplay(segment);
            })
            .filter(function (segment) {
                const key = normalizeAddressSegment(segment);
                if (!key || key === "daet" || seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
            .join(", ");
    }

    function buildAddress(profile) {
        const address = dedupeAddressSegments(profile && profile.address ? profile.address : "");
        const barangay = normalizeBarangayDisplay(profile && profile.barangay ? profile.barangay : "");
        if (!address && !barangay) {
            return "-";
        }
        if (!address) {
            return barangay || "-";
        }
        if (!barangay) {
            return address;
        }

        const addressSegments = address
            .split(",")
            .map(normalizeAddressSegment)
            .filter(Boolean);
        const barangaySegments = cleanupAddressDisplay(barangay)
            .split(",")
            .map(normalizeAddressSegment)
            .filter(Boolean);
        const namedBarangayKey = barangaySegments.find(function (segment) {
            return segment !== "daet" && segment !== "barangay" && segment !== "brgy";
        });

        if (namedBarangayKey && addressSegments.includes(namedBarangayKey)) {
            return address;
        }
        if (
            namedBarangayKey &&
            addressSegments.includes("barangay " + namedBarangayKey)
        ) {
            return address;
        }

        return cleanupAddressDisplay([address, barangay].filter(Boolean).join(", "));
    }

    function applicationTypeLabel(type) {
        if (type === "renewal") {
            return "Renewal";
        }
        if (type === "new") {
            return "New Applicant";
        }
        return valueOrDash(type);
    }

    function queryApplicationId() {
        const params = new URLSearchParams(window.location.search);
        return params.get("id");
    }

    function queryDraftMode() {
        const params = new URLSearchParams(window.location.search);
        return (params.get("draft_mode") || "")
            .toString()
            .trim()
            .toLowerCase();
    }

    function auxMetaKey(userId, applicationId) {
        return "ldss:application-form-meta:" + userId + ":" + (applicationId || "new");
    }

    function readAuxMeta(userId, applicationId) {
        try {
            const raw = window.localStorage.getItem(auxMetaKey(userId, applicationId));
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function normalizeAuxMetaPayload(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return {};
        }
        return payload;
    }

    function writeAuxMeta(userId, applicationId, payloadInput) {
        if (!userId || !applicationId) {
            return;
        }
        const payload = normalizeAuxMetaPayload(payloadInput);
        try {
            localStorage.setItem(auxMetaKey(userId, applicationId), JSON.stringify(payload));
        } catch (error) {
            // Non-fatal browser fallback only.
        }
    }

    function isMissingAuxDataTableError(error) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        return text.includes(APPLICATION_AUX_DATA_TABLE) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
    }

    async function fetchSharedAuxMeta(applicationId) {
        if (!authContext || !authContext.client || !applicationId || !applicationAuxDataAvailable) {
            return null;
        }

        const result = await authContext.client
            .from(APPLICATION_AUX_DATA_TABLE)
            .select("payload")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (result.error) {
            if (isMissingAuxDataTableError(result.error)) {
                applicationAuxDataAvailable = false;
            }
            return null;
        }

        return result.data && result.data.payload
            ? normalizeAuxMetaPayload(result.data.payload)
            : null;
    }

    async function persistSharedAuxMeta(applicationId, applicantId, payload) {
        if (!authContext || !authContext.client || !applicationAuxDataAvailable || !applicationId || !applicantId) {
            return;
        }

        const result = await authContext.client
            .from(APPLICATION_AUX_DATA_TABLE)
            .upsert({
                application_id: applicationId,
                applicant_id: applicantId,
                payload: normalizeAuxMetaPayload(payload)
            }, { onConflict: "application_id" });

        if (result.error && isMissingAuxDataTableError(result.error)) {
            applicationAuxDataAvailable = false;
        }
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

    function normalizeAwardList(awards) {
        if (!Array.isArray(awards)) {
            return [];
        }
        return awards
            .map(function (award) {
                const row = award && typeof award === "object" ? award : {};
                return {
                    awardNatureDescription: upperTextOrNull(row.awardNatureDescription || row.nature || ""),
                    awardSchoolName: upperTextOrNull(row.awardSchoolName || row.school || ""),
                    awardSchoolYear: nullIfBlank(row.awardSchoolYear || row.schoolYear || "")
                };
            })
            .filter(function (award) {
                return award.awardNatureDescription || award.awardSchoolName || award.awardSchoolYear;
            })
            .slice(0, 5);
    }

    function awardsToTextarea(awards) {
        return normalizeAwardList(awards).map(function (award) {
            return [
                award.awardNatureDescription || "",
                award.awardSchoolName || "",
                award.awardSchoolYear || ""
            ].join(" | ").replace(/\s+\|\s+\|\s+$/, "").trim();
        }).join("\n");
    }

    function awardsFromTextarea(value) {
        return normalizeAwardList((value || "")
            .toString()
            .split(/\r?\n/)
            .map(function (line) {
                const parts = line.split("|").map(function (part) {
                    return part.trim();
                });
                if (!parts.some(Boolean)) {
                    return null;
                }
                return {
                    awardNatureDescription: parts[0] || "",
                    awardSchoolName: parts[1] || "",
                    awardSchoolYear: parts[2] || ""
                };
            })
            .filter(Boolean));
    }

    function cleanNamePart(value) {
        const text = (value || "").toString().trim();
        if (!text || /^n\s*\/?\s*a$/i.test(text)) {
            return "";
        }
        return text;
    }

    function buildPersonName(parts, fallback) {
        const fullName = (parts || [])
            .map(cleanNamePart)
            .filter(function (value) {
                return value.length > 0;
            })
            .join(" ");

        return fullName || valueOrDash(fallback);
    }

    function normalizedParentStatus(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (!raw) {
            return "-";
        }
        if (raw === "living" || raw === "alive") {
            return "Living";
        }
        if (raw === "deceased") {
            return "Deceased";
        }
        return valueOrDash(value);
    }

    function profileSelectFields() {
        const base = "id, first_name, middle_name, last_name, sex, civil_status, date_of_birth, barangay, address, email, mobile_number, school_name, course_or_strand, year_level, student_number, guardian_name, guardian_occupation, monthly_income, applicant_photo_path, verified_interview_photo_path";
        if (profilesSupportsPlaceOfBirth) {
            return base + ", place_of_birth";
        }
        return base;
    }

    function isMissingProfilesColumnError(error, columnName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedColumn = (columnName || "").toString().toLowerCase();
        if (!text || !normalizedColumn) {
            return false;
        }
        return text.includes(normalizedColumn) && (text.includes("does not exist") || text.includes("schema cache"));
    }

    function loadCounselorOptions() {
        try {
            const raw = localStorage.getItem(COUNSELOR_OPTIONS_STORAGE_KEY);
            if (!raw) {
                return DEFAULT_COUNSELOR_OPTIONS.slice();
            }

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return DEFAULT_COUNSELOR_OPTIONS.slice();
            }

            return uniqueTags(parsed).slice(0, 20);
        } catch (error) {
            return DEFAULT_COUNSELOR_OPTIONS.slice();
        }
    }

    function loadConfiguredInterviewVenue() {
        try {
            return (localStorage.getItem(INTERVIEW_VENUE_STORAGE_KEY) || "").trim();
        } catch (error) {
            return "";
        }
    }

    function loadConfiguredInterviewSchedule() {
        try {
            return (localStorage.getItem(INTERVIEW_SCHEDULE_STORAGE_KEY) || "").trim();
        } catch (error) {
            return "";
        }
    }

    function parseRemarksWithSectorMeta(value) {
        const source = (value || "").toString();
        if (!source) {
            return { plainRemarks: "", sectorTags: [], counselorEndorsement: "" };
        }

        let working = source;
        let tags = [];
        let counselorEndorsement = "";
        const counselorPattern = /\[\[LDSS_COUNSELOR\]\]([\s\S]*?)\[\[\/LDSS_COUNSELOR\]\]/i;
        const counselorMatch = working.match(counselorPattern);
        if (counselorMatch && counselorMatch[1]) {
            counselorEndorsement = normalizeTag(counselorMatch[1]);
            working = working.replace(counselorMatch[0], "");
        }
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
            sectorTags: tags,
            counselorEndorsement: counselorEndorsement
        };
    }

    function composeRemarksWithSectorMeta(plainRemarks, tags, counselorEndorsement) {
        const cleanRemarks = (plainRemarks || "").toString().trim();
        const cleanTags = uniqueTags(tags);
        const cleanCounselor = normalizeTag(counselorEndorsement);
        const metaBlocks = [];
        if (cleanCounselor) {
            metaBlocks.push(REMARKS_COUNSELOR_META_START + cleanCounselor + REMARKS_COUNSELOR_META_END);
        }
        if (cleanTags.length > 0) {
            metaBlocks.push(REMARKS_SECTOR_META_START + cleanTags.join("|") + REMARKS_SECTOR_META_END);
        }
        if (metaBlocks.length === 0) {
            return cleanRemarks;
        }
        const metaBlock = metaBlocks.join("\n");
        return cleanRemarks ? (cleanRemarks + "\n\n" + metaBlock) : metaBlock;
    }

    function renderCounselorOptions() {
        const select = byId("verificationCounselorEndorsement");
        if (!select) {
            return;
        }

        const options = uniqueTags((counselorOptions || []).concat(selectedCounselor ? [selectedCounselor] : []));
        if (options.length === 0) {
            select.innerHTML = '<option value="">No counselors configured</option>';
            select.value = "";
            select.disabled = true;
            return;
        }

        select.disabled = false;
        select.innerHTML = ['<option value="">Not Yet Endorsed</option>'].concat(options.map(function (name) {
            return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + "</option>";
        })).join("");
        select.value = options.some(function (name) {
            return name.toLowerCase() === selectedCounselor.toLowerCase();
        }) ? selectedCounselor : "";
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

    async function saveApplicantPhotoPathForCurrentApplicant(storagePath) {
        if (!storagePath || !currentApplication || !currentApplication.applicant_id) {
            return;
        }

        let result = await authContext.client
            .from("profiles")
            .update({ applicant_photo_path: storagePath })
            .eq("id", currentApplication.applicant_id)
            .select(profileSelectFields())
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(result.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            result = await authContext.client
                .from("profiles")
                .update({ applicant_photo_path: storagePath })
                .eq("id", currentApplication.applicant_id)
                .select(profileSelectFields())
                .maybeSingle();
        }

        if (result.error) {
            throw new Error("Applicant photo uploaded, but profile sync failed: " + result.error.message);
        }

        currentProfile = result.data || currentProfile;
    }

    async function upsertApplicantPhotoDocument(storagePath, file) {
        const existing = await authContext.client
            .from("application_documents")
            .select("id, storage_path, created_at")
            .eq("application_id", currentApplication.id)
            .eq("document_type", "applicant_photo")
            .order("created_at", { ascending: false })
            .limit(1);

        if (existing.error) {
            throw new Error("Applicant photo uploaded, but document sync failed: " + existing.error.message);
        }

        const payload = {
            application_id: currentApplication.id,
            document_type: "applicant_photo",
            storage_path: storagePath,
            original_filename: file.name,
            mime_type: file.type || "application/octet-stream",
            file_size_bytes: file.size,
            verification_status: "verified",
            verification_notes: null,
            uploaded_by: authContext.user.id,
            verified_by: authContext.user.id
        };

        if (existing.data && existing.data.length > 0) {
            const existingRow = existing.data[0];
            const updateResult = await authContext.client
                .from("application_documents")
                .update(payload)
                .eq("id", existingRow.id)
                .select("id, application_id, document_type, storage_path, original_filename, mime_type, file_size_bytes, verification_status, verification_notes, created_at")
                .maybeSingle();

            if (updateResult.error) {
                throw new Error("Applicant photo uploaded, but document update failed: " + updateResult.error.message);
            }

            latestDocumentByType.applicant_photo = updateResult.data || Object.assign({}, existingRow, payload);

            const previousPath = (existingRow.storage_path || "").toString().trim();
            if (
                previousPath &&
                previousPath !== storagePath &&
                window.ldssUploads &&
                typeof window.ldssUploads.deleteFiles === "function"
            ) {
                try {
                    await window.ldssUploads.deleteFiles(authContext, [previousPath]);
                } catch (_cleanupError) {
                    // Best-effort cleanup only.
                }
            }
            return;
        }

        const insertResult = await authContext.client
            .from("application_documents")
            .insert(payload)
            .select("id, application_id, document_type, storage_path, original_filename, mime_type, file_size_bytes, verification_status, verification_notes, created_at")
            .maybeSingle();

        if (insertResult.error) {
            throw new Error("Applicant photo uploaded, but document insert failed: " + insertResult.error.message);
        }

        latestDocumentByType.applicant_photo = insertResult.data || Object.assign({}, payload);
    }

    async function maybeUploadDraftApplicantPhoto() {
        if (!isDraftCompletionMode()) {
            return currentApplicantPhotoPath();
        }

        const fileInput = byId("verificationDraftApplicantPhotoFile");
        const file = selectedDraftApplicantPhotoFile();
        const existingPath = currentApplicantPhotoPath();
        if (!file) {
            if (isApplicantPhotoRequiredOnSubmit() && !existingPath) {
                throw new Error("Applicant 1x1 photo is required before finishing this draft. Upload the photo here or temporarily turn off the photo requirement in Scholarship Settings.");
            }
            return existingPath;
        }

        const mime = (file.type || "").toLowerCase();
        if (!mime.startsWith("image/")) {
            throw new Error("Applicant 1x1 photo must be a JPG or PNG image.");
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            throw new Error("Applicant 1x1 photo exceeds the 10MB limit.");
        }
        if (!window.ldssUploads || typeof window.ldssUploads.uploadFile !== "function") {
            throw new Error("Applicant photo upload client is not available.");
        }

        const uploadResult = await window.ldssUploads.uploadFile(authContext, file, {
            applicationId: currentApplication.id,
            documentType: "applicant_photo"
        });
        const storagePath = uploadResult && uploadResult.path ? uploadResult.path : "";
        if (!storagePath) {
            throw new Error("Applicant photo upload failed: upload server did not return a file path.");
        }

        await upsertApplicantPhotoDocument(storagePath, file);
        await saveApplicantPhotoPathForCurrentApplicant(storagePath);

        if (fileInput) {
            fileInput.value = "";
        }

        clearDraftApplicantPhotoPreviewObjectUrl();
        const previewUrl = await createSignedUrl(storagePath);
        setPhotoArea(
            "verificationApplicantPhotoPreview",
            "verificationApplicantPhotoPlaceholder",
            "verificationApplicantPhotoLink",
            previewUrl || "",
            "No Photo"
        );
        syncDraftApplicantPhotoUploadState();
        return storagePath;
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
        const selectFields = "id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at, secretary_remarks, is_locked";

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

        let fallbackQuery = authContext.client
            .from("applications")
            .select(selectFields)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (!isSecretaryDraftCompletionEnabled()) {
            fallbackQuery = fallbackQuery.neq("status", "draft");
        }

        const fallbackResult = await fallbackQuery;

        if (fallbackResult.error || !fallbackResult.data || fallbackResult.data.length === 0) {
            return null;
        }

        return fallbackResult.data[0];
    }

    async function fetchLatestCorrectionNotice(applicationId) {
        if (!applicationId) {
            return null;
        }

        const result = await authContext.client
            .from("notifications")
            .select("notification_type, title, message, created_at")
            .eq("related_application_id", applicationId)
            .in("notification_type", ["application", "reminder"])
            .order("created_at", { ascending: false })
            .limit(25);

        if (result.error) {
            return null;
        }

        const notices = result.data || [];
        for (let index = 0; index < notices.length; index += 1) {
            if (isCorrectionNotification(notices[index])) {
                return notices[index];
            }
        }

        return null;
    }

    async function fetchProfile(userId) {
        let result = await authContext.client
            .from("profiles")
            .select(profileSelectFields())
            .eq("id", userId)
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(result.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            result = await authContext.client
                .from("profiles")
                .select(profileSelectFields())
                .eq("id", userId)
                .maybeSingle();
        }

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

    function resetVerificationPhotoAreas() {
        setPhotoArea(
            "verificationApplicantPhotoPreview",
            "verificationApplicantPhotoPlaceholder",
            "verificationApplicantPhotoLink",
            "",
            "Loading applicant photo..."
        );
        setPhotoArea(
            "verificationVerifiedPhotoPreview",
            "verificationVerifiedPhotoPlaceholder",
            "verificationVerifiedPhotoLink",
            "",
            "Loading verified photo..."
        );
    }

    async function hydrateVerificationPhotoAreas(loadToken, applicantPhotoPath, verifiedPhotoPath) {
        const photoUrls = await Promise.all([
            applicantPhotoPath ? createSignedUrl(applicantPhotoPath) : Promise.resolve(""),
            verifiedPhotoPath ? createSignedUrl(verifiedPhotoPath) : Promise.resolve("")
        ]);

        if (!isActivePageLoad(loadToken)) {
            return;
        }

        clearLocalPreviewObjectUrl();

        setPhotoArea(
            "verificationApplicantPhotoPreview",
            "verificationApplicantPhotoPlaceholder",
            "verificationApplicantPhotoLink",
            photoUrls[0],
            "No Photo"
        );

        setPhotoArea(
            "verificationVerifiedPhotoPreview",
            "verificationVerifiedPhotoPlaceholder",
            "verificationVerifiedPhotoLink",
            photoUrls[1],
            "No verified interview photo uploaded."
        );
    }

    function renderHeaderAndSummary() {
        const appNo = currentApplication ? currentApplication.application_no : "-";
        const applicantName = buildApplicantName(currentProfile);
        const meta = byId("secretaryVerificationHeaderMeta");
        const isDraft = isDraftApplication(currentApplication);
        const draftLabel = isDraftReadOnlyMode()
            ? (isDraftViewOnlyRequest() ? "Draft View" : "Draft Preview")
            : (isDraftCompletionMode() ? "Draft Completion" : "Draft");

        if (meta) {
            meta.textContent = "Application ID: " + appNo + " | Applicant: " + applicantName + (isDraft ? " | " + draftLabel : "");
        }

        renderApplicantDetailSheet();
        syncVerificationActionLabels();
    }

    function refreshVerificationView() {
        renderHeaderAndSummary();
        renderCorrectionHistoryNotice();
        renderInterviewForm();
        syncApplicantEditAccess();
        syncDraftReadOnlyState();
        markCurrentFormSnapshot();
        updateVerificationNavigationButtons();
    }

    function renderApplicantDetailSheet() {
        const application = currentApplication || null;
        const profile = currentProfile || null;
        const aux = currentAuxMeta || {};
        const currentStatus = statusMeta(application ? application.status : "");
        const fatherName = buildPersonName([
            aux.fatherFirstName,
            aux.fatherMiddleName,
            aux.fatherLastName
        ], profile ? profile.guardian_name : "");
        const motherName = buildPersonName([
            aux.motherFirstName,
            aux.motherMiddleName,
            aux.motherMaidenName
        ], "");

        setText("verificationSheetApplicationNo", application ? application.application_no : "-");
        setText("verificationSheetDateFiled", application ? formatDate(application.submitted_at || application.created_at) : "-");
        setText("verificationSheetScholarshipType", application ? application.scholarship_type : "-");
        setText("verificationSheetSchoolYear", application ? application.school_year : "-");
        setText("verificationSheetApplicationType", application ? applicationTypeLabel(application.application_type) : "-");
        setText("verificationSheetCurrentStatus", currentStatus.label);

        setText("verificationSheetFullName", profile ? buildApplicantName(profile) : "-");
        setText("verificationSheetDateOfBirth", profile ? formatDate(profile.date_of_birth) : "-");
        setText("verificationSheetGender", profile ? profile.sex : "-");
        setText("verificationSheetCivilStatus", profile ? profile.civil_status : "-");
        setText("verificationSheetPlaceOfBirth", (profile && profile.place_of_birth) || aux.placeOfBirth || "");
        setText("verificationSheetReligion", aux.religion || "");
        setText("verificationSheetSectorClassification", (application && application.sector_classification) || "");
        setText("verificationSheetAddress", profile ? buildAddress(profile) : "-");
        setText("verificationSheetContact", profile ? profile.mobile_number : "-");
        setText("verificationSheetEmail", profile ? profile.email : "-");

        setText("verificationSheetSchoolName", profile ? profile.school_name : "-");
        setText("verificationSheetYearLevel", profile ? profile.year_level : "-");
        setText("verificationSheetCourse", profile ? profile.course_or_strand : "-");

        setText("verificationSheetFatherName", fatherName);
        setText("verificationSheetFatherStatus", normalizedParentStatus(aux.fatherStatus));
        setText("verificationSheetFatherOccupation", aux.fatherOccupation || (profile ? profile.guardian_occupation : ""));
        setText("verificationSheetFatherAddress", aux.fatherAddress || "");

        setText("verificationSheetMotherName", motherName);
        setText("verificationSheetMotherStatus", normalizedParentStatus(aux.motherStatus));
        setText("verificationSheetMotherOccupation", aux.motherOccupation || "");
        setText("verificationSheetMotherAddress", aux.motherAddress || "");

        setText(
            "verificationSheetGrossIncome",
            aux.totalParentsGrossIncome
                ? formatMoney(aux.totalParentsGrossIncome)
                : (profile ? formatMoney(profile.monthly_income) : "-")
        );
        setText("verificationSheetChildrenInFamily", aux.childrenInFamily || "");
        setText("verificationSheetBrotherCount", aux.brotherCount || "");
        setText("verificationSheetSisterCount", aux.sisterCount || "");

        setText("verificationSheetSpouseName", aux.spouseName || "");
        setText("verificationSheetSpouseChildrenCount", aux.spouseChildrenCount || "");
        setText("verificationSheetSpouseOccupation", aux.spouseOccupation || "");
    }

    function syncApplicantEditAccess() {
        const editBtn = byId("verificationEditApplicantBtn");
        const meta = byId("verificationEditApplicantMeta");
        const draftReadOnly = isDraftReadOnlyMode();
        const draftCompletionMode = isDraftCompletionMode();
        const enabled = draftCompletionMode || (workflowControls.allow_secretary_applicant_edits === true && !draftReadOnly && !isDraftApplication(currentApplication));

        if (editBtn) {
            editBtn.classList.toggle("d-none", !enabled);
            editBtn.disabled = !enabled;
        }
        if (meta) {
            meta.classList.toggle("d-none", !enabled && !draftReadOnly);
            meta.textContent = draftReadOnly
                ? (isDraftViewOnlyRequest()
                    ? "Draft view is read-only. Use Finish Draft from the application queue to edit and complete this record."
                    : "Draft preview is read-only. Applicant detail editing is unavailable until the applicant submits the form.")
                : draftCompletionMode
                    ? "Draft completion mode is enabled by System Administrator."
                : enabled
                    ? "Applicant detail editing is enabled by System Administrator."
                    : "Applicant detail editing is off in System Administrator settings.";
        }
    }

    function populateApplicantEditForm() {
        const profile = currentProfile || {};
        const application = currentApplication || {};
        const aux = currentAuxMeta || {};
        const addressParts = parsePermanentAddress(profile.address || "", profile.barangay || "");

        populateApplicantEditBarangays();
        setApplicantEditStatus("");
        setControlValue("verificationEditLastName", profile.last_name || "");
        setControlValue("verificationEditFirstName", profile.first_name || "");
        setControlValue("verificationEditMiddleName", profile.middle_name || "");
        setSelectValue("verificationEditGender", profile.sex || "");
        setSelectValue("verificationEditCivilStatus", profile.civil_status || "");
        setControlValue("verificationEditDateOfBirth", profile.date_of_birth || "");
        setControlValue("verificationEditPlaceOfBirth", profile.place_of_birth || "");
        setSelectValue("verificationEditSectorClassification", application.sector_classification || "");
        setSelectValue("verificationEditBarangay", profile.barangay || addressParts.barangay || "");
        setControlValue("verificationEditAddressLine", addressParts.line || "");
        setControlValue("verificationEditContact", profile.mobile_number || "");
        setControlValue("verificationEditEmail", profile.email || "");
        setControlValue("verificationEditSchoolName", profile.school_name || "");
        setControlValue("verificationEditCourse", profile.course_or_strand || "");
        setSelectValue("verificationEditYearLevel", profile.year_level || "");
        setControlValue("verificationEditStudentNumber", profile.student_number || "");
        setSelectValue("verificationEditReligion", aux.religion || "");
        setSelectValue("verificationEditHighestEducationAttainment", aux.highestEducationAttainment || "");
        setSelectValue("verificationEditSchoolType", aux.schoolType || "");
        setSelectValue("verificationEditGrantAppliedFor", aux.grantAppliedFor || "Degree Course");
        setControlValue("verificationEditGwa", aux.gwa || "");
        setControlValue("verificationEditAwards", awardsToTextarea(aux.awards));
        setSelectValue("verificationEditFatherStatus", aux.fatherStatus || "");
        setSelectValue("verificationEditMotherStatus", aux.motherStatus || "");
        setControlValue("verificationEditFatherFirstName", aux.fatherFirstName || "");
        setControlValue("verificationEditFatherMiddleName", aux.fatherMiddleName || "");
        setControlValue("verificationEditFatherLastName", aux.fatherLastName || "");
        setControlValue("verificationEditMotherFirstName", aux.motherFirstName || "");
        setControlValue("verificationEditMotherMiddleName", aux.motherMiddleName || "");
        setControlValue("verificationEditMotherMaidenName", aux.motherMaidenName || "");
        setControlValue("verificationEditFatherAddress", aux.fatherAddress || "");
        setControlValue("verificationEditMotherAddress", aux.motherAddress || "");
        setControlValue("verificationEditFatherOccupation", aux.fatherOccupation || "");
        setControlValue("verificationEditMotherOccupation", aux.motherOccupation || "");
        setControlValue("verificationEditFatherEducationAttainment", aux.fatherEducationAttainment || "");
        setControlValue("verificationEditMotherEducationAttainment", aux.motherEducationAttainment || "");
        setControlValue("verificationEditChildrenInFamily", aux.childrenInFamily || "");
        setControlValue("verificationEditBrotherCount", aux.brotherCount || "");
        setControlValue("verificationEditSisterCount", aux.sisterCount || "");
        setControlValue("verificationEditTotalParentsGrossIncome", aux.totalParentsGrossIncome || "");
        setControlValue("verificationEditSpouseName", aux.spouseName || "");
        setControlValue("verificationEditSpouseChildrenCount", aux.spouseChildrenCount || "");
        setControlValue("verificationEditSpouseOccupation", aux.spouseOccupation || "");
    }

    function collectApplicantEditPayload() {
        const middleNameValue = normalizeMiddleNameValue(byId("verificationEditMiddleName") ? byId("verificationEditMiddleName").value : "");
        const courseValue = upperTextOrNull(byId("verificationEditCourse") ? byId("verificationEditCourse").value : "");
        const profilePatch = {
            first_name: upperTextOrNull(byId("verificationEditFirstName") ? byId("verificationEditFirstName").value : ""),
            middle_name: middleNameValue,
            last_name: upperTextOrNull(byId("verificationEditLastName") ? byId("verificationEditLastName").value : ""),
            sex: nullIfBlank(byId("verificationEditGender") ? byId("verificationEditGender").value : ""),
            civil_status: nullIfBlank(byId("verificationEditCivilStatus") ? byId("verificationEditCivilStatus").value : ""),
            date_of_birth: nullIfBlank(byId("verificationEditDateOfBirth") ? byId("verificationEditDateOfBirth").value : ""),
            place_of_birth: upperTextOrNull(byId("verificationEditPlaceOfBirth") ? byId("verificationEditPlaceOfBirth").value : ""),
            barangay: nullIfBlank(byId("verificationEditBarangay") ? byId("verificationEditBarangay").value : ""),
            address: composePermanentAddress(
                byId("verificationEditAddressLine") ? byId("verificationEditAddressLine").value : "",
                byId("verificationEditBarangay") ? byId("verificationEditBarangay").value : ""
            ),
            mobile_number: normalizeMobileForStorage(byId("verificationEditContact") ? byId("verificationEditContact").value : ""),
            email: nullIfBlank(byId("verificationEditEmail") ? byId("verificationEditEmail").value.toLowerCase() : ""),
            school_name: upperTextOrNull(byId("verificationEditSchoolName") ? byId("verificationEditSchoolName").value : ""),
            course_or_strand: courseValue,
            year_level: nullIfBlank(byId("verificationEditYearLevel") ? byId("verificationEditYearLevel").value : ""),
            student_number: upperTextOrNull(byId("verificationEditStudentNumber") ? byId("verificationEditStudentNumber").value : "")
        };

        if (!profilesSupportsPlaceOfBirth) {
            delete profilePatch.place_of_birth;
        }

        const applicationPatch = {
            sector_classification: nullIfBlank(byId("verificationEditSectorClassification") ? byId("verificationEditSectorClassification").value : ""),
            scholarship_type: courseValue || currentApplication.scholarship_type
        };

        const auxPatch = {
            religion: nullIfBlank(byId("verificationEditReligion") ? byId("verificationEditReligion").value : ""),
            placeOfBirth: upperTextOrNull(byId("verificationEditPlaceOfBirth") ? byId("verificationEditPlaceOfBirth").value : ""),
            additionalData: nullIfBlank(byId("verificationEditSectorClassification") ? byId("verificationEditSectorClassification").value : ""),
            highestEducationAttainment: nullIfBlank(byId("verificationEditHighestEducationAttainment") ? byId("verificationEditHighestEducationAttainment").value : ""),
            highestGradeYearLevel: nullIfBlank(byId("verificationEditYearLevel") ? byId("verificationEditYearLevel").value : ""),
            schoolType: nullIfBlank(byId("verificationEditSchoolType") ? byId("verificationEditSchoolType").value : ""),
            grantAppliedFor: nullIfBlank(byId("verificationEditGrantAppliedFor") ? byId("verificationEditGrantAppliedFor").value : ""),
            awards: awardsFromTextarea(byId("verificationEditAwards") ? byId("verificationEditAwards").value : ""),
            fatherStatus: nullIfBlank(byId("verificationEditFatherStatus") ? byId("verificationEditFatherStatus").value : ""),
            fatherFirstName: upperTextOrNull(byId("verificationEditFatherFirstName") ? byId("verificationEditFatherFirstName").value : ""),
            fatherMiddleName: upperTextOrNull(byId("verificationEditFatherMiddleName") ? byId("verificationEditFatherMiddleName").value : ""),
            fatherLastName: upperTextOrNull(byId("verificationEditFatherLastName") ? byId("verificationEditFatherLastName").value : ""),
            motherStatus: nullIfBlank(byId("verificationEditMotherStatus") ? byId("verificationEditMotherStatus").value : ""),
            motherFirstName: upperTextOrNull(byId("verificationEditMotherFirstName") ? byId("verificationEditMotherFirstName").value : ""),
            motherMiddleName: upperTextOrNull(byId("verificationEditMotherMiddleName") ? byId("verificationEditMotherMiddleName").value : ""),
            motherMaidenName: upperTextOrNull(byId("verificationEditMotherMaidenName") ? byId("verificationEditMotherMaidenName").value : ""),
            fatherAddress: upperTextOrNull(byId("verificationEditFatherAddress") ? byId("verificationEditFatherAddress").value : ""),
            motherAddress: upperTextOrNull(byId("verificationEditMotherAddress") ? byId("verificationEditMotherAddress").value : ""),
            fatherOccupation: upperTextOrNull(byId("verificationEditFatherOccupation") ? byId("verificationEditFatherOccupation").value : ""),
            fatherEducationAttainment: nullIfBlank(byId("verificationEditFatherEducationAttainment") ? byId("verificationEditFatherEducationAttainment").value : ""),
            gwa: nullIfBlank(byId("verificationEditGwa") ? byId("verificationEditGwa").value : ""),
            motherOccupation: upperTextOrNull(byId("verificationEditMotherOccupation") ? byId("verificationEditMotherOccupation").value : ""),
            motherEducationAttainment: nullIfBlank(byId("verificationEditMotherEducationAttainment") ? byId("verificationEditMotherEducationAttainment").value : ""),
            totalParentsGrossIncome: nullIfBlank(byId("verificationEditTotalParentsGrossIncome") ? byId("verificationEditTotalParentsGrossIncome").value : ""),
            childrenInFamily: nullIfBlank(byId("verificationEditChildrenInFamily") ? byId("verificationEditChildrenInFamily").value : ""),
            brotherCount: nullIfBlank(byId("verificationEditBrotherCount") ? byId("verificationEditBrotherCount").value : ""),
            sisterCount: nullIfBlank(byId("verificationEditSisterCount") ? byId("verificationEditSisterCount").value : ""),
            spouseName: upperTextOrNull(byId("verificationEditSpouseName") ? byId("verificationEditSpouseName").value : ""),
            spouseChildrenCount: nullIfBlank(byId("verificationEditSpouseChildrenCount") ? byId("verificationEditSpouseChildrenCount").value : ""),
            spouseOccupation: upperTextOrNull(byId("verificationEditSpouseOccupation") ? byId("verificationEditSpouseOccupation").value : ""),
            degreeProgramCourse: courseValue
        };
        auxPatch.isMarriedApplicant = Boolean(auxPatch.spouseName || auxPatch.spouseChildrenCount || auxPatch.spouseOccupation);

        return {
            profilePatch: profilePatch,
            applicationPatch: applicationPatch,
            auxPatch: auxPatch
        };
    }

    async function saveApplicantCorrections() {
        if (!currentApplication || !currentApplication.id || !currentApplication.applicant_id) {
            throw new Error("No application is loaded for correction.");
        }
        if (!isDraftCompletionMode() && workflowControls.allow_secretary_applicant_edits !== true) {
            throw new Error("Applicant detail editing is currently disabled in System Administrator settings.");
        }

        const payloads = collectApplicantEditPayload();
        const emailValue = payloads.profilePatch.email || "";
        if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
            throw new Error("Enter a valid email address before saving corrections.");
        }

        let profileResult = await authContext.client
            .from("profiles")
            .update(payloads.profilePatch)
            .eq("id", currentApplication.applicant_id)
            .select(profileSelectFields())
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(profileResult.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            delete payloads.profilePatch.place_of_birth;
            profileResult = await authContext.client
                .from("profiles")
                .update(payloads.profilePatch)
                .eq("id", currentApplication.applicant_id)
                .select(profileSelectFields())
                .maybeSingle();
        }

        if (profileResult.error) {
            throw new Error("Failed to save applicant profile corrections: " + profileResult.error.message);
        }

        const applicationResult = await authContext.client
            .from("applications")
            .update(payloads.applicationPatch)
            .eq("id", currentApplication.id)
            .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at, secretary_remarks, is_locked")
            .maybeSingle();

        if (applicationResult.error) {
            throw new Error("Profile corrections were saved, but application detail update failed: " + applicationResult.error.message);
        }

        currentProfile = profileResult.data || currentProfile;
        currentApplication = applicationResult.data || currentApplication;
        currentAuxMeta = Object.assign({}, currentAuxMeta || {}, payloads.auxPatch);
        writeAuxMeta(currentApplication.applicant_id, currentApplication.id, currentAuxMeta);
        await persistSharedAuxMeta(currentApplication.id, currentApplication.applicant_id, currentAuxMeta);
    }

    function renderInterviewForm() {
        const interview = currentInterview || {};
        const remarksSource = interview.remarks || (currentApplication && currentApplication.secretary_remarks) || "";
        const remarksParsed = parseRemarksWithSectorMeta(remarksSource);
        const configuredSchedule = loadConfiguredInterviewSchedule();
        const configuredVenue = loadConfiguredInterviewVenue();

        const dateTime = byId("verificationInterviewDateTime");
        const venue = byId("verificationInterviewVenue");
        const remarks = byId("verificationRemarks");
        selectedCounselor = remarksParsed.counselorEndorsement || "";

        if (dateTime) {
            dateTime.value = configuredSchedule || toDatetimeLocalValue(interview.scheduled_at || "");
        }
        if (venue) {
            venue.value = configuredVenue || interview.venue || "";
        }
        if (remarks) {
            remarks.value = remarksParsed.plainRemarks;
        }

        renderCounselorOptions();

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
        const configuredSchedule = loadConfiguredInterviewSchedule();
        const interviewDateTimeRaw = configuredSchedule || "";
        const remarksValue = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        const cleanCounselorEndorsement = normalizeTag(selectedCounselor);
        const configuredVenue = loadConfiguredInterviewVenue();
        const preservedInterviewStatus = currentInterview && currentInterview.status
            ? currentInterview.status
            : (interviewDateTimeRaw ? "scheduled" : "not_scheduled");
        const preservedInterviewResult = currentInterview && currentInterview.result
            ? currentInterview.result
            : "pending";

        return {
            interviewDateTimeIso: toIsoFromDatetimeLocal(interviewDateTimeRaw),
            interviewVenue: configuredVenue || (currentInterview && currentInterview.venue ? currentInterview.venue : ""),
            interviewStatus: preservedInterviewStatus,
            interviewResult: preservedInterviewResult,
            examScore: currentInterview && typeof currentInterview.exam_score !== "undefined"
                ? currentInterview.exam_score
                : null,
            counselorEndorsement: cleanCounselorEndorsement,
            queuePriority: "medium",
            recommendationDecision: byId("verificationRecommendationDecision") ? byId("verificationRecommendationDecision").value : "approved",
            remarks: remarksValue,
            sectorTags: [],
            remarksWithSectorMeta: composeRemarksWithSectorMeta(remarksValue, [], cleanCounselorEndorsement)
        };
    }

    function buildFormSnapshot() {
        const formValues = readFormValues();
        return JSON.stringify({
            counselorEndorsement: formValues.counselorEndorsement || "",
            interviewDateTimeIso: formValues.interviewDateTimeIso || "",
            interviewVenue: formValues.interviewVenue || "",
            recommendationDecision: formValues.recommendationDecision || "",
            remarks: formValues.remarks || ""
        });
    }

    function markCurrentFormSnapshot() {
        currentFormSnapshot = buildFormSnapshot();
    }

    function hasUnsavedVerificationChanges() {
        if (!currentApplication) {
            return false;
        }
        if (isDraftReadOnlyMode()) {
            return false;
        }
        return currentFormSnapshot !== buildFormSnapshot();
    }

    function actionButtonState(isLoading, activeButtonId, loadingText) {
        const saveBtn = byId("verificationSaveBtn");
        const complianceBtn = byId("verificationComplianceBtn");
        const returnBtn = byId("verificationReturnBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const forExamBtn = byId("verificationForExamBtn");
        const notQualifiedBtn = byId("verificationNotQualifiedBtn");
        const photoActionBtn = byId("verificationPhotoActionBtn");
        const approvePhotoBtn = byId("verificationApprovePhotoBtn");
        const photoChangeBtn = byId("verificationRequestPhotoChangeBtn");

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

        setState(saveBtn, saveActionLabel());
        setState(complianceBtn, "Send Compliance Notice");
        setState(returnBtn, "Return for Correction");
        setState(returnConfirmBtn, "Return and Redirect");
        setState(forExamBtn, "Set for Examination");
        setState(notQualifiedBtn, "Not Qualified");
        if (photoActionBtn) {
            photoActionBtn.disabled = isLoading;
            if (!isLoading) {
                photoActionBtn.textContent = "Photo Action";
            } else if (activeButtonId === "verificationApprovePhotoBtn") {
                photoActionBtn.textContent = "Approving...";
            } else if (activeButtonId === "verificationRequestPhotoChangeBtn") {
                photoActionBtn.textContent = "Sending...";
            }
        }
        if (approvePhotoBtn) {
            approvePhotoBtn.disabled = isLoading || isDraftReadOnlyMode();
        }
        setState(photoChangeBtn, "Change Photo");
        syncDraftReadOnlyState();
        updateVerificationNavigationButtons();
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
            hard_copy_verified_at: hardCopyVerified
                ? ((currentInterview && currentInterview.hard_copy_verified_at) || new Date().toISOString())
                : null
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

        if (isDraftApplication(currentApplication) && targetStatus !== "draft" && !currentApplication.submitted_at) {
            payload.submitted_at = new Date().toISOString();
        }

        if (typeof lockState === "boolean") {
            payload.is_locked = lockState;
        }

        const result = await authContext.client
            .from("applications")
            .update(payload)
            .eq("id", currentApplication.id)
            .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at, secretary_remarks, is_locked")
            .maybeSingle();

        if (result.error) {
            throw new Error("Failed to update application status: " + result.error.message);
        }

        currentApplication = result.data || currentApplication;
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

    function buildApplicantFormUrl() {
        if (!currentApplication || !currentApplication.id) {
            return "applicant-notifications.html";
        }
        return "applicant-application-form.html?application_id=" + encodeURIComponent(currentApplication.id);
    }

    function buildApplicantCorrectionUrl(targetKey, remarks, correctionType, targetKeys) {
        if (!currentApplication || !currentApplication.id) {
            return "applicant-notifications.html";
        }

        const effectiveTargets = parseCorrectionTargetKeys(targetKeys);
        const primaryTarget = normalizeCorrectionTargetKey(targetKey) || effectiveTargets[0] || "full_application";
        const params = new URLSearchParams();
        params.set("application_id", currentApplication.id);
        params.set("correction", primaryTarget);
        if (effectiveTargets.length) {
            params.set("correction_targets", effectiveTargets.join(","));
        }
        if (correctionType) {
            params.set("correction_type", correctionType);
        }
        if (remarks) {
            params.set("correction_note", remarks.slice(0, 500));
        }
        return "applicant-application-form.html?" + params.toString();
    }

    async function notifyApplicant(type, title, message, relatedUrl) {
        const payload = {
            recipient_user_id: currentApplication.applicant_id,
            sender_user_id: authContext.user.id,
            notification_type: type,
            title: title,
            message: message,
            related_application_id: currentApplication.id,
            related_url: relatedUrl || ("application-detail.html?id=" + encodeURIComponent(currentApplication.id))
        };

        const result = await authContext.client
            .from("notifications")
            .insert(payload);

        if (result.error) {
            throw new Error("Action saved but notification failed: " + result.error.message);
        }
    }

    async function sendComplianceEmail(remarks, correctionTarget, correctionTargets) {
        return requestJson(COMPLIANCE_EMAIL_API_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                applicationId: currentApplication ? currentApplication.id : "",
                remarks: remarks || "",
                correctionTarget: correctionTarget || "full_application",
                correctionTargets: Array.isArray(correctionTargets) ? correctionTargets : []
            })
        });
    }

    function allRequiredDocsVerified(docStates) {
        if (!Array.isArray(docStates) || docStates.length === 0) {
            return true;
        }
        return docStates.every(function (row) {
            return row.exists && row.status === "verified";
        });
    }

    function deriveSaveStatus(formValues, docStates) {
        const currentStatus = normalizedApplicationStatus();
        const lockedStatuses = [
            "for_approval",
            "approved",
            "waitlisted",
            "rejected",
            "for_release",
            "released"
        ];

        if (lockedStatuses.includes(currentStatus)) {
            return currentStatus;
        }

        if (currentStatus === "draft") {
            return isDraftCompletionMode() ? "submitted" : "draft";
        }

        if (currentStatus === "returned_for_correction") {
            return hasApplicantUpdatedReturnedApplication(currentApplication, latestCorrectionNotice)
                ? "submitted"
                : "returned_for_correction";
        }

        if (isSecretaryCheckingStage(currentStatus)) {
            return currentStatus || "submitted";
        }

        return currentStatus || "submitted";
    }

    async function persistVerification(targetStatus, lockState, includeQueue) {
        const formValues = readFormValues();
        if (formValues.error) {
            throw new Error(formValues.error);
        }

        const docStates = documentVerificationState();
        const uploadedApplicantPhotoPath = await maybeUploadDraftApplicantPhoto();
        const uploadedPhotoPath = await maybeUploadVerifiedPhoto();
        const hardCopyVerified = Boolean(currentInterview && currentInterview.hard_copy_verified);

        await persistDocumentUpdates(docStates);
        currentInterview = await upsertInterview(formValues, uploadedPhotoPath, hardCopyVerified);
        await updateApplication(targetStatus, formValues.remarks, lockState);

        if (includeQueue) {
            await upsertApprovalQueue(formValues);
        }

        return {
            formValues: formValues,
            docStates: docStates,
            uploadedApplicantPhotoPath: uploadedApplicantPhotoPath,
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

        const currentApplicationId = currentApplication && currentApplication.id ? currentApplication.id : "";
        if (currentApplicationId) {
            const latestApplication = await fetchApplication(currentApplicationId);
            if (latestApplication) {
                currentApplication = latestApplication;
            }
            latestCorrectionNotice = await fetchLatestCorrectionNotice(currentApplicationId) || null;
            renderCorrectionHistoryNotice();
            updateVerificationNavigationButtons();
        }

        const previousStatus = normalizedApplicationStatus();
        const docStates = documentVerificationState();
        const targetStatus = deriveSaveStatus(formValues, docStates);
        const result = await persistVerification(targetStatus, null, false);

        if (targetStatus === "pending_exam" && previousStatus !== "pending_exam") {
            await notifyApplicant(
                "application",
                "Application Ready for Examination",
                "Your application passed secretary checking and is now waiting for examination scheduling."
            );
        } else if (previousStatus === "returned_for_correction" && targetStatus === "submitted") {
            await notifyApplicant(
                "application",
                "Corrected Application Received",
                "The scholarship office reviewed your updated application and returned it to the submitted verification queue."
            );
        } else if (previousStatus === "draft" && targetStatus === "submitted") {
            await notifyApplicant(
                "application",
                "Application Submitted by Scholarship Office",
                "Your draft application was completed by the scholarship office and moved into the submitted queue for secretary checking."
            );
        } else {
            await notifyApplicant(
                "application",
                "Secretary Checking Updated",
                "The scholarship office updated your application checking details."
            );
        }

        refreshVerificationView();
        return targetStatus === "pending_exam"
            ? "Secretary checking saved. Application moved to Pending Exam."
            : (previousStatus === "returned_for_correction" && targetStatus === "submitted")
                ? "Corrected application moved back to Submitted."
            : (previousStatus === "draft" && targetStatus === "submitted")
                ? "Draft finished and moved to Submitted."
            : "Secretary checking details saved successfully.";
    }

    async function handleSetForExamination() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        const previousStatus = normalizedApplicationStatus();
        if (previousStatus === "draft") {
            showStatus("Finish this draft first before setting it for examination.", "alert-warning");
            return;
        }
        if (!isSecretaryCheckingStage(previousStatus) && previousStatus !== "pending_exam") {
            showStatus("This application is no longer in secretary checking stage.", "alert-warning");
            return;
        }

        await persistVerification("pending_exam", false, false);

        if (previousStatus !== "pending_exam") {
            await notifyApplicant(
                "application",
                "Application Ready for Examination",
                "Your application passed secretary checking and is now waiting for examination scheduling."
            );
            refreshVerificationView();
            return "Application moved to Pending Exam.";
        }

        await notifyApplicant(
            "application",
            "Pending Exam Details Updated",
            "The scholarship office updated your examination preparation details."
        );
        refreshVerificationView();
        return "Pending Exam details updated successfully.";
    }

    async function handleMarkNotQualified() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        const previousStatus = normalizedApplicationStatus();
        if (previousStatus === "draft") {
            showStatus("Finish this draft first before marking it as not qualified.", "alert-warning");
            return;
        }
        if (!isSecretaryCheckingStage(previousStatus)) {
            showStatus("This application is no longer in secretary checking stage.", "alert-warning");
            return;
        }

        const confirmed = window.confirm("Mark this application as Not Qualified and stop it from proceeding to examination?");
        if (!confirmed) {
            return;
        }

        const remarks = (formValues.remarks || "").trim();
        const applicantMessage = remarks
            ? "After secretary checking, your application was marked as not qualified and will not proceed to examination. Remarks: " + remarks
            : "After secretary checking, your application was marked as not qualified and will not proceed to examination.";

        await persistVerification("rejected", false, false);
        await notifyApplicant(
            "application",
            "Application Not Qualified",
            applicantMessage
        );

        refreshVerificationView();
        return "Application marked as Not Qualified and moved to Rejected.";
    }

    async function handleReturnForCorrection() {
        const remarks = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        const correctionTargets = selectedCorrectionTargets();
        const correctionTarget = selectedCorrectionTarget();
        const targetSummary = correctionTargetsLabelText(correctionTargets);
        const applicantMessage = "Your application was returned for correction. Please update: " +
            targetSummary +
            (remarks ? ". Remarks: " + remarks : ".");

        await persistVerification("returned_for_correction", false, false);
        await notifyApplicant(
            "application",
            "Application Returned for Correction",
            applicantMessage,
            buildApplicantCorrectionUrl(correctionTarget, remarks, "return", correctionTargets)
        );
        const modal = getReturnCorrectionModal();
        if (modal) {
            modal.hide();
        }

        refreshVerificationView();
        return "Application returned for correction. Applicant will open " + correctionTargetLabel(correctionTarget) + " first and review " + targetSummary + ".";
    }

    async function handleSendComplianceNotice() {
        const remarksEl = byId("verificationRemarks");
        const remarks = dedupeFixedRemark(remarksEl ? remarksEl.value.trim() : "", PHOTO_CHANGE_REMARK);
        const correctionTargets = selectedCorrectionTargets();
        const correctionTarget = selectedCorrectionTarget();
        const targetSummary = correctionTargetsLabelText(correctionTargets);
        if (!remarks || remarks.length < 10) {
            showStatus("Please provide clear compliance remarks (at least 10 characters) before sending a notice.", "alert-warning");
            return;
        }
        if (remarksEl) {
            remarksEl.value = remarks;
        }

        if (!currentApplication) {
            showStatus("No application is loaded yet.", "alert-warning");
            return;
        }

        if (currentApplication.is_locked === true) {
            showStatus("This application is locked. Unlock it first before asking the applicant to comply with updates.", "alert-warning");
            return;
        }

        const currentStatus = normalizedApplicationStatus() || "submitted";
        await persistVerification(currentStatus, null, false);
        await notifyApplicant(
            "reminder",
            COMPLIANCE_NOTICE_TITLE,
            "Your application remains submitted, but you need to comply with the following requirement(s): " +
                remarks +
                " Please open your application and update: " +
                targetSummary +
                ".",
            buildApplicantCorrectionUrl(correctionTarget, remarks, "compliance", correctionTargets)
        );

        try {
            await sendComplianceEmail(remarks, correctionTarget, correctionTargets);
            return "Compliance notice sent. The application status stayed as " + statusMeta(currentStatus).label + ".";
        } catch (emailError) {
            return {
                message: "Compliance notice was saved and shown to the applicant, but email failed: " +
                    (emailError && emailError.message ? emailError.message : "Unknown email error."),
                type: "alert-warning"
            };
        }
    }

    async function handleRequestPhotoChange() {
        const remarksEl = byId("verificationRemarks");
        const existingRemarks = remarksEl ? remarksEl.value.trim() : "";
        const combinedRemarks = appendFixedRemarkOnce(existingRemarks, PHOTO_CHANGE_REMARK);

        if (remarksEl) {
            remarksEl.value = combinedRemarks;
        }

        await persistVerification("returned_for_correction", false, false);
        await notifyApplicant(
            "application",
            "Applicant Photo Needs Change",
            "Please replace your applicant 1x1 photo with a clear picture on a white background while wearing formal attire or your school uniform, then update your application. Remarks: " + combinedRemarks,
            buildApplicantCorrectionUrl("applicant_photo", combinedRemarks, "return")
        );

        return "Photo change request sent to the applicant.";
    }

    async function handleApprovePhoto() {
        const hasApplicantPhoto = Boolean(
            (currentProfile && currentProfile.applicant_photo_path) ||
            (latestDocumentByType.applicant_photo && latestDocumentByType.applicant_photo.storage_path)
        );

        if (!hasApplicantPhoto) {
            showStatus("No applicant photo is loaded for this record.", "alert-warning");
            return;
        }

        await persistVerification(normalizedApplicationStatus() || "submitted", null, false);
        await notifyApplicant(
            "application",
            "Applicant Photo Approved",
            "Your applicant 1x1 photo has been reviewed and approved by the scholarship office."
        );

        return "Photo approval notice sent to the applicant.";
    }

    async function runAction(buttonId, loadingText, action) {
        if (isProcessing || !authContext || !currentApplication) {
            return;
        }

        isProcessing = true;
        actionButtonState(true, buttonId, loadingText);
        showStatus("");

        try {
            const actionResult = await action();
            if (!actionResult) {
                return;
            }
            await loadPageData(currentApplication.id);
            if (typeof actionResult === "string") {
                showStatus(actionResult, "alert-success");
            } else {
                showStatus(actionResult.message || "Action completed.", actionResult.type || "alert-success");
            }
        } catch (error) {
            showStatus(error && error.message ? error.message : "Action failed. Please try again.", "alert-danger");
        } finally {
            isProcessing = false;
            actionButtonState(false);
        }
    }

    async function loadApplicationNavigationQueue(currentApplicationId, loadToken) {
        if (!authContext || !authContext.client) {
            if (!isActivePageLoad(loadToken)) {
                return;
            }
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
            updateVerificationNavigationButtons();
            return;
        }

        if (currentApplicationId && isDraftReadOnlyMode()) {
            if (!isActivePageLoad(loadToken)) {
                return;
            }
            applicationNavigationIds = [currentApplicationId];
            currentNavigationIndex = 0;
            updateVerificationNavigationButtons();
            return;
        }

        const storedIds = readStoredVerificationQueue();
        if (currentApplicationId && storedIds.length && storedIds.indexOf(currentApplicationId) !== -1) {
            if (!isActivePageLoad(loadToken)) {
                return;
            }
            applicationNavigationIds = storedIds.slice();
            currentNavigationIndex = applicationNavigationIds.indexOf(currentApplicationId);
            updateVerificationNavigationButtons();
            return;
        }

        let navigationQuery = authContext.client
            .from("applications")
            .select("id")
            .order("updated_at", { ascending: false });

        if (!isSecretaryDraftCompletionEnabled()) {
            navigationQuery = navigationQuery.neq("status", "draft");
        }

        const result = await navigationQuery;

        if (!isActivePageLoad(loadToken)) {
            return;
        }

        if (result.error) {
            applicationNavigationIds = currentApplicationId ? [currentApplicationId] : [];
        } else {
            applicationNavigationIds = (result.data || []).map(function (row) {
                return row.id;
            }).filter(Boolean);
            if (currentApplicationId && applicationNavigationIds.indexOf(currentApplicationId) === -1) {
                applicationNavigationIds.unshift(currentApplicationId);
            }
        }

        currentNavigationIndex = currentApplicationId
            ? applicationNavigationIds.indexOf(currentApplicationId)
            : -1;
        updateVerificationNavigationButtons();
    }

    function navigateToRelativeApplication(step) {
        if (!currentApplication || !applicationNavigationIds.length || currentNavigationIndex < 0) {
            return;
        }

        const targetIndex = currentNavigationIndex + step;
        if (targetIndex < 0 || targetIndex >= applicationNavigationIds.length) {
            return;
        }

        if (hasUnsavedVerificationChanges()) {
            const confirmed = window.confirm("Unsaved secretary checking changes will be lost. Continue?");
            if (!confirmed) {
                return;
            }
        }

        window.location.href = buildVerificationUrl(applicationNavigationIds[targetIndex]);
    }

    function bindActions() {
        const printBtn = byId("verificationPrintBtn");
        const saveBtn = byId("verificationSaveBtn");
        const complianceBtn = byId("verificationComplianceBtn");
        const returnBtn = byId("verificationReturnBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const correctionTargetInputs = document.querySelectorAll("input[name='verificationCorrectionTargets']");
        const forExamBtn = byId("verificationForExamBtn");
        const notQualifiedBtn = byId("verificationNotQualifiedBtn");
        const prevBtn = byId("verificationPrevBtn");
        const nextBtn = byId("verificationNextBtn");
        const approvePhotoBtn = byId("verificationApprovePhotoBtn");
        const photoChangeBtn = byId("verificationRequestPhotoChangeBtn");
        const editApplicantBtn = byId("verificationEditApplicantBtn");
        const editApplicantSaveBtn = byId("verificationApplicantEditSaveBtn");
        const counselorSelect = byId("verificationCounselorEndorsement");
        const cameraStartBtn = byId("verificationStartCameraBtn");
        const cameraCaptureBtn = byId("verificationCapturePhotoBtn");
        const cameraStopBtn = byId("verificationStopCameraBtn");
        const draftApplicantPhotoInput = byId("verificationDraftApplicantPhotoFile");

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

        if (complianceBtn) {
            complianceBtn.addEventListener("click", function () {
                runAction("verificationComplianceBtn", "Sending...", handleSendComplianceNotice);
            });
        }

        if (forExamBtn) {
            forExamBtn.addEventListener("click", function () {
                runAction("verificationForExamBtn", "Sending...", handleSetForExamination);
            });
        }

        if (notQualifiedBtn) {
            notQualifiedBtn.addEventListener("click", function () {
                runAction("verificationNotQualifiedBtn", "Saving...", handleMarkNotQualified);
            });
        }

        if (returnBtn) {
            returnBtn.addEventListener("click", function () {
                openReturnCorrectionModal();
            });
        }

        if (returnConfirmBtn) {
            returnConfirmBtn.addEventListener("click", function () {
                runAction("verificationReturnConfirmBtn", "Returning...", handleReturnForCorrection);
            });
        }

        correctionTargetInputs.forEach(function (input) {
            input.addEventListener("change", handleCorrectionTargetCheckboxChange);
        });
        setCorrectionTargetCheckboxState(selectedCorrectionTargets());

        if (prevBtn) {
            prevBtn.addEventListener("click", function () {
                navigateToRelativeApplication(-1);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener("click", function () {
                navigateToRelativeApplication(1);
            });
        }

        if (approvePhotoBtn) {
            approvePhotoBtn.addEventListener("click", function () {
                runAction("verificationApprovePhotoBtn", "Approving...", handleApprovePhoto);
            });
        }

        if (photoChangeBtn) {
            photoChangeBtn.addEventListener("click", function () {
                runAction("verificationRequestPhotoChangeBtn", "Sending...", handleRequestPhotoChange);
            });
        }

        if (editApplicantBtn) {
            editApplicantBtn.addEventListener("click", function () {
                if (!currentApplication) {
                    showStatus("Applicant details are not loaded yet.", "alert-warning");
                    return;
                }
                if (!isDraftCompletionMode() && workflowControls.allow_secretary_applicant_edits !== true) {
                    showStatus("Applicant detail editing is currently disabled in System Administrator settings.", "alert-warning");
                    return;
                }
                populateApplicantEditForm();
                const modal = getApplicantEditModal();
                if (modal) {
                    modal.show();
                }
            });
        }

        if (editApplicantSaveBtn) {
            editApplicantSaveBtn.addEventListener("click", async function () {
                if (isProcessing) {
                    return;
                }
                editApplicantSaveBtn.disabled = true;
                editApplicantSaveBtn.textContent = "Saving...";
                setApplicantEditStatus("");
                try {
                    await saveApplicantCorrections();
                    await loadPageData(currentApplication.id);
                    const modal = getApplicantEditModal();
                    if (modal) {
                        modal.hide();
                    }
                    showStatus("Applicant details updated successfully.", "alert-success");
                } catch (error) {
                    setApplicantEditStatus(error && error.message ? error.message : "Failed to save applicant corrections.", "alert-danger");
                } finally {
                    editApplicantSaveBtn.disabled = false;
                    editApplicantSaveBtn.textContent = "Save Corrections";
                }
            });
        }

        if (counselorSelect) {
            counselorSelect.addEventListener("change", function () {
                selectedCounselor = normalizeTag(counselorSelect.value);
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

        if (draftApplicantPhotoInput) {
            draftApplicantPhotoInput.addEventListener("change", function () {
                const file = draftApplicantPhotoInput.files && draftApplicantPhotoInput.files[0] ? draftApplicantPhotoInput.files[0] : null;
                if (!file) {
                    clearDraftApplicantPhotoPreviewObjectUrl();
                    if (currentApplicantPhotoPath()) {
                        createSignedUrl(currentApplicantPhotoPath()).then(function (url) {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                url || "",
                                "No Photo"
                            );
                        }).catch(function () {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                "",
                                "Photo preview unavailable."
                            );
                        });
                    } else {
                        setPhotoArea(
                            "verificationApplicantPhotoPreview",
                            "verificationApplicantPhotoPlaceholder",
                            "verificationApplicantPhotoLink",
                            "",
                            "No Photo"
                        );
                    }
                    return;
                }

                const mime = (file.type || "").toLowerCase();
                if (!mime.startsWith("image/")) {
                    draftApplicantPhotoInput.value = "";
                    clearDraftApplicantPhotoPreviewObjectUrl();
                    if (currentApplicantPhotoPath()) {
                        createSignedUrl(currentApplicantPhotoPath()).then(function (url) {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                url || "",
                                "No Photo"
                            );
                        }).catch(function () {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                "",
                                "Photo preview unavailable."
                            );
                        });
                    } else {
                        setPhotoArea(
                            "verificationApplicantPhotoPreview",
                            "verificationApplicantPhotoPlaceholder",
                            "verificationApplicantPhotoLink",
                            "",
                            "No Photo"
                        );
                    }
                    showStatus("Applicant 1x1 photo must be a JPG or PNG image.", "alert-warning");
                    return;
                }
                if (file.size > MAX_IMAGE_SIZE_BYTES) {
                    draftApplicantPhotoInput.value = "";
                    clearDraftApplicantPhotoPreviewObjectUrl();
                    if (currentApplicantPhotoPath()) {
                        createSignedUrl(currentApplicantPhotoPath()).then(function (url) {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                url || "",
                                "No Photo"
                            );
                        }).catch(function () {
                            setPhotoArea(
                                "verificationApplicantPhotoPreview",
                                "verificationApplicantPhotoPlaceholder",
                                "verificationApplicantPhotoLink",
                                "",
                                "Photo preview unavailable."
                            );
                        });
                    } else {
                        setPhotoArea(
                            "verificationApplicantPhotoPreview",
                            "verificationApplicantPhotoPlaceholder",
                            "verificationApplicantPhotoLink",
                            "",
                            "No Photo"
                        );
                    }
                    showStatus("Applicant 1x1 photo exceeds the 10MB limit.", "alert-warning");
                    return;
                }

                clearDraftApplicantPhotoPreviewObjectUrl();
                draftApplicantPhotoPreviewObjectUrl = URL.createObjectURL(file);
                setPhotoArea(
                    "verificationApplicantPhotoPreview",
                    "verificationApplicantPhotoPlaceholder",
                    "verificationApplicantPhotoLink",
                    draftApplicantPhotoPreviewObjectUrl,
                    "No Photo"
                );
                showStatus("Applicant photo ready. Click Finish Draft to upload and submit this draft.", "alert-info");
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
            clearDraftApplicantPhotoPreviewObjectUrl();
        });

        const editModalEl = byId("verificationApplicantEditModal");
        if (editModalEl) {
            editModalEl.addEventListener("hidden.bs.modal", function () {
                setApplicantEditStatus("");
            });
        }
    }

    async function loadPageData(targetApplicationId) {
        const loadToken = pageLoadToken + 1;
        pageLoadToken = loadToken;
        showStatus("");
        stopCameraStream();
        counselorOptions = loadCounselorOptions();
        currentAuxMeta = {};
        currentFormSnapshot = "";
        latestCorrectionNotice = null;
        currentProfile = null;
        currentInterview = null;
        latestDocumentByType = {};
        signedDocumentUrlByType = {};
        documentNotesById = {};
        applicationNavigationIds = [];
        currentNavigationIndex = -1;
        clearLocalPreviewObjectUrl();
        clearDraftApplicantPhotoPreviewObjectUrl();
        if (byId("verificationDraftApplicantPhotoFile")) {
            byId("verificationDraftApplicantPhotoFile").value = "";
        }
        resetVerificationPhotoAreas();
        updateVerificationNavigationButtons();

        currentApplication = await fetchApplication(targetApplicationId || queryApplicationId());
        if (!isActivePageLoad(loadToken)) {
            return;
        }
        if (!currentApplication) {
            showStatus("No application records are currently available for secretary verification.", "alert-warning");
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
            renderCorrectionHistoryNotice();
            updateVerificationNavigationButtons();
            return;
        }

        currentAuxMeta = readAuxMeta(currentApplication.applicant_id, currentApplication.id);
        writeAuxMeta(currentApplication.applicant_id, currentApplication.id, currentAuxMeta);

        const sharedAuxMetaPromise = fetchSharedAuxMeta(currentApplication.id);
        const navigationQueuePromise = loadApplicationNavigationQueue(currentApplication.id, loadToken);
        const dataResults = await Promise.all([
            sharedAuxMetaPromise,
            fetchProfile(currentApplication.applicant_id),
            fetchInterview(currentApplication.id),
            fetchDocuments(currentApplication.id),
            fetchLatestCorrectionNotice(currentApplication.id)
        ]);
        if (!isActivePageLoad(loadToken)) {
            return;
        }

        currentAuxMeta = dataResults[0]
            || currentAuxMeta
            || {};
        writeAuxMeta(currentApplication.applicant_id, currentApplication.id, currentAuxMeta);
        currentProfile = dataResults[1];
        currentInterview = dataResults[2];
        latestDocumentByType = latestDocumentsByType(dataResults[3]);
        latestCorrectionNotice = dataResults[4] || null;

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

        renderHeaderAndSummary();
        renderCorrectionHistoryNotice();
        renderInterviewForm();
        syncApplicantEditAccess();
        syncDraftReadOnlyState();
        markCurrentFormSnapshot();
        updateVerificationNavigationButtons();

        hydrateVerificationPhotoAreas(loadToken, applicantPhotoPath, verifiedPhotoPath)
            .catch(function () {
                if (!isActivePageLoad(loadToken)) {
                    return;
                }
                setPhotoArea(
                    "verificationApplicantPhotoPreview",
                    "verificationApplicantPhotoPlaceholder",
                    "verificationApplicantPhotoLink",
                    "",
                    "Photo preview unavailable."
                );
                setPhotoArea(
                    "verificationVerifiedPhotoPreview",
                    "verificationVerifiedPhotoPlaceholder",
                    "verificationVerifiedPhotoLink",
                    "",
                    "Verified photo preview unavailable."
                );
            });

        navigationQueuePromise.catch(function () {
            if (!isActivePageLoad(loadToken)) {
                return;
            }
            applicationNavigationIds = currentApplication && currentApplication.id ? [currentApplication.id] : [];
            currentNavigationIndex = applicationNavigationIds.length ? 0 : -1;
            updateVerificationNavigationButtons();
        });
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindActions();
        const targetApplicationId = queryApplicationId();
        const workflowPromise = loadWorkflowControls()
            .catch(function (error) {
                showStatus(error && error.message ? error.message : "Failed to load workflow controls.", "alert-warning");
                return workflowControls;
            })
            .then(function () {
                renderHeaderAndSummary();
                syncApplicantEditAccess();
                syncDraftReadOnlyState();
                updateVerificationNavigationButtons();
            });

        if (targetApplicationId) {
            await loadPageData(targetApplicationId);
            await workflowPromise;
            return;
        }

        await workflowPromise;
        await loadPageData("");
    }

    window.addEventListener("DOMContentLoaded", init);
})();
