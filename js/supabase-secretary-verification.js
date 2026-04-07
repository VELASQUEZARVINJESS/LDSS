
(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
    const APPLICANT_PHOTO_MAX_DIMENSION = 640;
    const APPLICANT_PHOTO_JPEG_QUALITY = 0.82;
    const SETTINGS_STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const APPLICATION_STAFF_FLAGS_TABLE = "application_staff_flags";
    const LEGACY_RESERVED_SLOT_TAG = "reserved_slot_exception";
    const SPECIAL_TAG_DELIMITER = "::";
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
        allow_secretary_special_consideration: false,
        show_secretary_special_consideration_control: false,
        special_consideration_options: []
    };
    const SPECIAL_CONSIDERATION_LEVEL_META = {
        internal_review: { label: "Priority Review", chipClass: "ldss-chip-special-priority" },
        for_approval: { label: "For Approval", chipClass: "ldss-chip-special-approval" }
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

    const DEFAULT_VERIFICATION_DOCUMENT_TYPES = ["applicant_photo"];
    const DOCUMENT_LABELS = {
        applicant_photo: "Applicant 1x1 Photo",
        income_certificate: "Income Certificate"
    };

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
    const APPLICANT_LOGIN_EMAIL_API_BASE = "/api/secretary/applicants";
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
    let loginEmailModalInstance = null;
    let notesModalInstance = null;
    let applicantEditModalInstance = null;
    let forExamConfirmModalInstance = null;
    let returnCorrectionModalInstance = null;
    let forExamConfirmResolver = null;
    let activeNotesDocId = "";
    let counselorOptions = DEFAULT_COUNSELOR_OPTIONS.slice();
    let selectedCounselor = "";
    let cameraStream = null;
    let localPreviewObjectUrl = "";
    let isProcessing = false;
    let profilesSupportsPlaceOfBirth = true;
    let applicationAuxDataAvailable = true;
    let workflowControls = Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);
    let latestCorrectionNotice = null;
    let applicationStaffFlagsAvailable = true;
    let currentStaffFlags = null;
    let selectedSpecialConsiderationTag = "";
    let specialConsiderationToastInstance = null;
    let shownSpecialConsiderationToastKeys = {};
    let isSavingSpecialConsideration = false;
    let isLoginEmailSubmitting = false;

    function byId(id) {
        return document.getElementById(id);
    }

    function replaceFileExtension(name, extension) {
        const baseName = (name || "applicant-photo")
            .toString()
            .replace(/\.[^./\\]+$/, "")
            .trim() || "applicant-photo";
        return baseName + extension;
    }

    function loadImageFromObjectUrl(objectUrl) {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = function () {
                reject(new Error("Failed to load selected image."));
            };
            image.src = objectUrl;
        });
    }

    async function optimizeApplicantPhotoForUpload(file) {
        if (!file || !/^image\//i.test((file.type || "").toString())) {
            return file;
        }

        let objectUrl = "";
        try {
            objectUrl = URL.createObjectURL(file);
            const image = await loadImageFromObjectUrl(objectUrl);
            const naturalWidth = image.naturalWidth || image.width || 0;
            const naturalHeight = image.naturalHeight || image.height || 0;

            if (!naturalWidth || !naturalHeight) {
                return file;
            }

            const scale = Math.min(1, APPLICANT_PHOTO_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
            const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
            const targetHeight = Math.max(1, Math.round(naturalHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const context2d = canvas.getContext("2d", { alpha: false });
            if (!context2d) {
                return file;
            }

            context2d.fillStyle = "#ffffff";
            context2d.fillRect(0, 0, targetWidth, targetHeight);
            context2d.drawImage(image, 0, 0, targetWidth, targetHeight);

            const jpegBlob = await new Promise(function (resolve) {
                canvas.toBlob(resolve, "image/jpeg", APPLICANT_PHOTO_JPEG_QUALITY);
            });

            if (!jpegBlob) {
                return file;
            }

            return new File(
                [jpegBlob],
                replaceFileExtension(file.name, ".jpg"),
                {
                    type: "image/jpeg",
                    lastModified: Date.now()
                }
            );
        } catch (_error) {
            return file;
        } finally {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
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
        const requestOptions = Object.assign({}, options || {});
        const notFoundMessage = requestOptions.notFoundMessage || "";
        delete requestOptions.notFoundMessage;
        const token = await getAccessToken();
        const fetchOptions = Object.assign({ method: "GET" }, requestOptions);
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
                ? (notFoundMessage || "Compliance email API route was not found. Open the site through the Node server.")
                : "Request failed.";
            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
    }

    function getLoginEmailModal() {
        if (!loginEmailModalInstance) {
            const modalEl = byId("verificationLoginEmailModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                loginEmailModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return loginEmailModalInstance;
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

    function getForExamConfirmModal() {
        if (!forExamConfirmModalInstance) {
            const modalEl = byId("verificationForExamConfirmModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                forExamConfirmModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return forExamConfirmModalInstance;
    }

    function getNotesModal() {
        if (!notesModalInstance) {
            const modalEl = byId("verificationDocNotesModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                notesModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return notesModalInstance;
    }

    function setLoginEmailStatus(message, type) {
        const box = byId("verificationLoginEmailStatus");
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

    function setLoginEmailLoading(isLoading, busyLabel) {
        const nextBusy = Boolean(isLoading);
        const submitBtn = byId("verificationLoginEmailSubmitBtn");
        const input = byId("verificationLoginEmailNew");
        const checkbox = byId("verificationLoginEmailSendReset");
        isLoginEmailSubmitting = nextBusy;

        if (submitBtn) {
            submitBtn.disabled = nextBusy;
            submitBtn.textContent = nextBusy ? (busyLabel || "Saving...") : "Save Email Change";
        }
        if (input) {
            input.disabled = nextBusy;
        }
        if (checkbox) {
            checkbox.disabled = nextBusy;
        }
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

    function isDraftReadOnlyMode() {
        return isDraftApplication(currentApplication);
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

    function resolveForExamConfirmation(confirmed) {
        if (!forExamConfirmResolver) {
            return;
        }
        const resolve = forExamConfirmResolver;
        forExamConfirmResolver = null;
        resolve(Boolean(confirmed));
    }

    function forExamConfirmationDetails() {
        const currentStatus = normalizedApplicationStatus();
        const alreadyPendingExam = currentStatus === "pending_exam";

        if (alreadyPendingExam) {
            return {
                kicker: "Pending Exam",
                title: "Save updates for this Pending Exam record?",
                copy: "This will save the latest secretary checking details while keeping the application in Pending Exam.",
                currentStatusLabel: "Pending Exam",
                targetStatusLabel: "Pending Exam",
                note: "Use this when the office updated remarks, interview details, or document checking while the applicant is already waiting for exam scheduling.",
                confirmLabel: "Agree and Save",
                fallbackConfirm: "This will save the latest secretary checking details and keep the application in Pending Exam. Continue?"
            };
        }

        return {
            kicker: "Set for Examination",
            title: "Move this application to Pending Exam?",
            copy: "This will save the current secretary checking details, move the application to Pending Exam, and notify the applicant that examination scheduling will follow.",
            currentStatusLabel: statusMeta(currentStatus).label,
            targetStatusLabel: "Pending Exam",
            note: "Once you agree, this record will leave the secretary checking queue and appear in Exam Management.",
            confirmLabel: "Agree and Continue",
            fallbackConfirm: "This will move the application to Pending Exam and notify the applicant. Continue?"
        };
    }

    function populateForExamConfirmModal() {
        const details = forExamConfirmationDetails();
        const kicker = byId("verificationForExamConfirmKicker");
        const title = byId("verificationForExamConfirmModalLabel");
        const copy = byId("verificationForExamConfirmCopy");
        const applicant = byId("verificationForExamConfirmApplicant");
        const applicationNo = byId("verificationForExamConfirmApplicationNo");
        const currentStatus = byId("verificationForExamConfirmCurrentStatus");
        const targetStatus = byId("verificationForExamConfirmTargetStatus");
        const note = byId("verificationForExamConfirmNote");
        const proceedBtn = byId("verificationForExamConfirmProceedBtn");

        if (kicker) {
            kicker.textContent = details.kicker;
        }
        if (title) {
            title.textContent = details.title;
        }
        if (copy) {
            copy.textContent = details.copy;
        }
        if (applicant) {
            applicant.textContent = buildApplicantName(currentProfile);
        }
        if (applicationNo) {
            applicationNo.textContent = valueOrDash(currentApplication ? currentApplication.application_no : "");
        }
        if (currentStatus) {
            currentStatus.textContent = valueOrDash(details.currentStatusLabel);
        }
        if (targetStatus) {
            targetStatus.textContent = details.targetStatusLabel;
        }
        if (note) {
            note.textContent = details.note;
        }
        if (proceedBtn) {
            proceedBtn.textContent = details.confirmLabel;
        }
    }

    function requestForExamConfirmation() {
        const details = forExamConfirmationDetails();
        const modal = getForExamConfirmModal();
        if (!modal) {
            return Promise.resolve(window.confirm(details.fallbackConfirm));
        }

        populateForExamConfirmModal();
        return new Promise(function (resolve) {
            forExamConfirmResolver = resolve;
            modal.show();
        });
    }

    function isSecretaryCheckingStage(status) {
        return ["submitted", "pending_exam", "returned_for_correction"].includes((status || "").toString().toLowerCase());
    }

    function startCaseLabel(value) {
        return (value || "")
            .toString()
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, function (character) {
                return character.toUpperCase();
            });
    }

    function documentLabel(type) {
        const normalizedType = (type || "").toString().trim().toLowerCase();
        if (!normalizedType) {
            return "Requirement";
        }
        return DOCUMENT_LABELS[normalizedType] || startCaseLabel(normalizedType);
    }

    function verificationDocumentDefinitions() {
        const seen = new Set();
        const definitions = [];

        DEFAULT_VERIFICATION_DOCUMENT_TYPES.forEach(function (type) {
            const normalizedType = (type || "").toString().trim().toLowerCase();
            if (!normalizedType || seen.has(normalizedType)) {
                return;
            }
            seen.add(normalizedType);
            definitions.push({
                type: normalizedType,
                label: documentLabel(normalizedType)
            });
        });

        Object.keys(latestDocumentByType || {}).sort().forEach(function (type) {
            const normalizedType = (type || "").toString().trim().toLowerCase();
            if (!normalizedType || seen.has(normalizedType)) {
                return;
            }
            seen.add(normalizedType);
            definitions.push({
                type: normalizedType,
                label: documentLabel(normalizedType)
            });
        });

        return definitions;
    }

    function documentMeta(status) {
        return DOCUMENT_STATUS_META[status] || DOCUMENT_STATUS_META.pending;
    }

    function missingDocumentHelpText(definition) {
        if ((definition && definition.type) === "applicant_photo") {
            return "Use Photo Action > Upload / Replace Photo if the office already has the applicant's 1x1 photo.";
        }
        return "Applicant must upload this requirement.";
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
        const hasUpdated = hasApplicationUpdatedSinceNotice(currentApplication, latestCorrectionNotice);

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
        const backToCheckingBtn = byId("verificationBackToCheckingBtn");
        const hasPrevious = currentNavigationIndex > 0;
        const hasNext = currentNavigationIndex > -1 && currentNavigationIndex < applicationNavigationIds.length - 1;
        const canMoveBackToChecking = normalizeStatus(currentApplication && currentApplication.status) === "returned_for_correction";

        if (prevBtn) {
            prevBtn.disabled = isProcessing || !hasPrevious;
        }
        if (nextBtn) {
            nextBtn.disabled = isProcessing || !hasNext;
        }
        if (forExamBtn) {
            forExamBtn.disabled = isProcessing || !currentApplication || isDraftReadOnlyMode();
        }
        if (backToCheckingBtn) {
            backToCheckingBtn.disabled = isProcessing || !currentApplication || isDraftReadOnlyMode() || !canMoveBackToChecking;
            if (!currentApplication) {
                backToCheckingBtn.title = "Load an application first.";
            } else if (isDraftReadOnlyMode()) {
                backToCheckingBtn.title = "Back to Checking is not available while previewing a draft.";
            } else if (!canMoveBackToChecking) {
                backToCheckingBtn.title = "Available only for applications currently marked Returned for Correction.";
            } else {
                backToCheckingBtn.removeAttribute("title");
            }
        }
        syncDraftReadOnlyState();
    }

    function syncDraftReadOnlyState() {
        const draftMode = isDraftReadOnlyMode();
        const notice = byId("verificationDraftReadOnlyNotice");
        const remarks = byId("verificationRemarks");
        const interviewDateTime = byId("verificationInterviewDateTime");
        const interviewVenue = byId("verificationInterviewVenue");
        const counselorSelect = byId("verificationCounselorEndorsement");
        const recommendationSelect = byId("verificationRecommendationDecision");
        const specialConsiderationSelect = byId("verificationSpecialConsiderationTag");
        const hardCopyToggle = byId("verificationHardCopyVerified");
        const applicantPhotoInput = byId("verificationApplicantPhotoFile");
        const verifiedPhotoInput = byId("verificationVerifiedPhotoFile");
        const cameraStartBtn = byId("verificationStartCameraBtn");
        const cameraCaptureBtn = byId("verificationCapturePhotoBtn");
        const cameraStopBtn = byId("verificationStopCameraBtn");
        const notesText = byId("verificationDocNotesText");
        const notesSaveBtn = byId("verificationDocNotesSaveBtn");
        const saveBtn = byId("verificationSaveBtn");
        const complianceBtn = byId("verificationComplianceBtn");
        const backToCheckingBtn = byId("verificationBackToCheckingBtn");
        const returnBtn = byId("verificationReturnBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const photoActionBtn = byId("verificationPhotoActionBtn");
        const uploadApplicantPhotoBtn = byId("verificationUploadApplicantPhotoBtn");
        const approvePhotoBtn = byId("verificationApprovePhotoBtn");
        const photoChangeBtn = byId("verificationRequestPhotoChangeBtn");
        const editApplicantSaveBtn = byId("verificationApplicantEditSaveBtn");

        if (notice) {
            if (draftMode) {
                notice.className = "alert alert-info";
                notice.textContent = "Draft preview only. Secretary checking, correction routing, photo actions, and workflow updates stay disabled until the applicant submits the application.";
            } else {
                notice.className = "alert alert-info d-none";
                notice.textContent = "";
            }
        }

        if (remarks) {
            remarks.readOnly = draftMode;
        }
        if (interviewDateTime) {
            interviewDateTime.disabled = draftMode;
        }
        if (interviewVenue) {
            interviewVenue.disabled = draftMode;
        }
        if (counselorSelect) {
            counselorSelect.disabled = draftMode;
        }
        if (recommendationSelect) {
            recommendationSelect.disabled = draftMode;
        }
        if (specialConsiderationSelect) {
            specialConsiderationSelect.disabled = draftMode || isProcessing || isSavingSpecialConsideration || !currentApplication || !specialConsiderationInputEnabled();
        }
        if (hardCopyToggle) {
            hardCopyToggle.disabled = draftMode;
        }
        if (applicantPhotoInput) {
            applicantPhotoInput.disabled = draftMode;
        }
        if (verifiedPhotoInput) {
            verifiedPhotoInput.disabled = draftMode;
        }
        if (cameraStartBtn) {
            cameraStartBtn.disabled = draftMode;
        }
        if (cameraCaptureBtn) {
            cameraCaptureBtn.disabled = draftMode;
        }
        if (cameraStopBtn) {
            cameraStopBtn.disabled = draftMode;
        }
        if (notesText) {
            notesText.disabled = draftMode || isProcessing;
        }
        if (notesSaveBtn) {
            notesSaveBtn.disabled = draftMode || isProcessing;
        }
        if (saveBtn) {
            saveBtn.disabled = draftMode || isProcessing || !currentApplication;
        }
        if (complianceBtn) {
            complianceBtn.disabled = draftMode || isProcessing || !currentApplication;
        }
        if (backToCheckingBtn) {
            backToCheckingBtn.disabled = draftMode || isProcessing || !currentApplication || normalizeStatus(currentApplication && currentApplication.status) !== "returned_for_correction";
        }
        if (returnBtn) {
            returnBtn.disabled = draftMode || isProcessing || !currentApplication;
        }
        if (returnConfirmBtn) {
            returnConfirmBtn.disabled = draftMode || isProcessing;
        }
        if (photoActionBtn) {
            photoActionBtn.disabled = draftMode || isProcessing;
        }
        if (uploadApplicantPhotoBtn) {
            uploadApplicantPhotoBtn.disabled = draftMode || isProcessing;
        }
        if (approvePhotoBtn) {
            approvePhotoBtn.disabled = draftMode || isProcessing;
        }
        if (photoChangeBtn) {
            photoChangeBtn.disabled = draftMode || isProcessing;
        }
        if (editApplicantSaveBtn) {
            editApplicantSaveBtn.disabled = draftMode || isProcessing;
        }

        document.querySelectorAll(".ldss-verification-status-select, [data-doc-note-open='1']").forEach(function (element) {
            element.disabled = draftMode;
        });

        renderSpecialConsiderationControl();
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
        const first = upperTextOrNull(profile && profile.first_name ? profile.first_name : "") || "";
        const middle = upperTextOrNull(profile && profile.middle_name ? profile.middle_name : "") || "";
        const last = upperTextOrNull(profile && profile.last_name ? profile.last_name : "") || "";
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
                if (!key || seen.has(key)) {
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
        const barangayKey = normalizeAddressSegment(barangay);
        if (barangayKey && addressSegments.includes(barangayKey)) {
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

    function isMissingTableError(error, tableName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedTable = (tableName || "").toString().trim().toLowerCase();
        return Boolean(normalizedTable) && text.includes(normalizedTable) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
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

    function normalizeSpecialConsiderationLevel(value) {
        const normalized = normalizeTag(value).toLowerCase();
        if (!normalized) {
            return "";
        }
        if (normalized === LEGACY_RESERVED_SLOT_TAG) {
            return "internal_review";
        }
        if (normalized === "internal review" || normalized === "priority review") {
            return "internal_review";
        }
        if (normalized === "endorse" || normalized === "indorse" || normalized === "endorsed") {
            return "internal_review";
        }
        if (normalized === "for approval") {
            return "for_approval";
        }
        return Object.prototype.hasOwnProperty.call(SPECIAL_CONSIDERATION_LEVEL_META, normalized)
            ? normalized
            : "";
    }

    function decodeSpecialConsiderationTag(value) {
        const raw = normalizeTag(value);
        if (!raw) {
            return { level: "", label: "" };
        }
        if (raw.toLowerCase() === LEGACY_RESERVED_SLOT_TAG) {
            return { level: "internal_review", label: "" };
        }

        const delimiterIndex = raw.indexOf(SPECIAL_TAG_DELIMITER);
        if (delimiterIndex >= 0) {
            const level = normalizeSpecialConsiderationLevel(raw.slice(0, delimiterIndex));
            const label = normalizeTag(raw.slice(delimiterIndex + SPECIAL_TAG_DELIMITER.length));
            if (level) {
                return { level: level, label: label };
            }
        }

        return {
            level: normalizeSpecialConsiderationLevel(raw),
            label: ""
        };
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

    function specialConsiderationOptionsFromControls(controls) {
        const source = controls && controls.special_consideration_options;
        if (Array.isArray(source)) {
            return uniqueTags(source).slice(0, 25);
        }
        if (typeof source === "string") {
            return uniqueTags(source.split(/\r?\n|\|/)).slice(0, 25);
        }
        return [];
    }

    function encodeSpecialConsiderationTag(level, label) {
        const normalizedLevel = normalizeSpecialConsiderationLevel(level);
        const normalizedLabel = normalizeTag(label);
        if (!normalizedLevel) {
            return "";
        }
        return normalizedLabel
            ? (normalizedLevel + SPECIAL_TAG_DELIMITER + normalizedLabel)
            : normalizedLevel;
    }

    function specialConsiderationOptionLabel(level, label, includeCurrentSuffix) {
        const normalizedLevel = normalizeSpecialConsiderationLevel(level) || "internal_review";
        const levelMeta = SPECIAL_CONSIDERATION_LEVEL_META[normalizedLevel] || SPECIAL_CONSIDERATION_LEVEL_META.internal_review;
        const base = normalizeTag(label)
            ? (normalizeTag(label) + " - " + (levelMeta.label || "Special Consideration"))
            : (levelMeta.label || "Special Consideration");
        return includeCurrentSuffix ? (base + " (Current)") : base;
    }

    function secretarySpecialConsiderationEntries() {
        const currentTag = currentSpecialConsiderationTag();
        const entries = [];
        const seen = new Set();

        specialConsiderationOptionsFromControls(workflowControls).forEach(function (value) {
            const decoded = decodeSpecialConsiderationTag(value);
            const encoded = encodeSpecialConsiderationTag(decoded.level, decoded.label);
            if (!encoded || !decoded.label) {
                return;
            }
            const key = encoded.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            entries.push({
                value: encoded,
                level: decoded.level,
                label: decoded.label,
                optionLabel: specialConsiderationOptionLabel(decoded.level, decoded.label, false)
            });
        });

        if (currentTag) {
            const currentKey = currentTag.toLowerCase();
            const currentDecoded = decodeSpecialConsiderationTag(currentTag);
            if (!seen.has(currentKey) && currentDecoded.level) {
                entries.unshift({
                    value: currentTag,
                    level: currentDecoded.level,
                    label: currentDecoded.label || "",
                    optionLabel: specialConsiderationOptionLabel(currentDecoded.level, currentDecoded.label, true)
                });
            }
        }

        return entries;
    }

    function currentSpecialConsiderationTag() {
        return normalizeTag(selectedSpecialConsiderationTag || (currentStaffFlags && currentStaffFlags.special_consideration_tag) || "");
    }

    function specialConsiderationInputEnabled() {
        return workflowControls.show_secretary_special_consideration_control === true
            && applicationStaffFlagsAvailable;
    }

    function secretaryStatusSummary() {
        const normalizedStatus = normalizedApplicationStatus();
        const meta = statusMeta(normalizedStatus);
        return {
            label: meta && meta.label ? meta.label : "-",
            chipClass: meta && meta.chipClass ? meta.chipClass : "ldss-chip-neutral"
        };
    }

    function getSpecialConsiderationToast() {
        if (!specialConsiderationToastInstance) {
            const toastEl = byId("verificationSpecialConsiderationToast");
            if (toastEl && window.bootstrap && typeof window.bootstrap.Toast === "function") {
                specialConsiderationToastInstance = new window.bootstrap.Toast(toastEl, {
                    autohide: true,
                    delay: 3400
                });
            }
        }
        return specialConsiderationToastInstance;
    }

    function showSpecialConsiderationToast(message, variant, dedupeKey) {
        const toastEl = byId("verificationSpecialConsiderationToast");
        const toastHeader = byId("verificationSpecialConsiderationToastHeader");
        const toastTitle = byId("verificationSpecialConsiderationToastTitle");
        const toastBody = byId("verificationSpecialConsiderationToastBody");
        const key = (dedupeKey || message || "").toString();
        const tone = (variant || "info").toString().trim().toLowerCase();

        if (!toastEl || !toastHeader || !toastTitle || !toastBody || !message) {
            return;
        }
        if (key && shownSpecialConsiderationToastKeys[key]) {
            return;
        }
        if (key) {
            shownSpecialConsiderationToastKeys[key] = true;
        }

        toastHeader.classList.remove("text-warning", "text-danger", "text-success", "text-info");
        if (tone === "warning") {
            toastTitle.textContent = "Special Consideration Unavailable";
            toastHeader.classList.add("text-warning");
        } else if (tone === "danger") {
            toastTitle.textContent = "Special Consideration Error";
            toastHeader.classList.add("text-danger");
        } else if (tone === "success") {
            toastTitle.textContent = "Special Consideration Updated";
            toastHeader.classList.add("text-success");
        } else {
            toastTitle.textContent = "Special Consideration";
            toastHeader.classList.add("text-info");
        }

        toastBody.textContent = message;

        const toast = getSpecialConsiderationToast();
        if (toast) {
            toast.show();
        }
    }

    function renderSpecialConsiderationControl() {
        const section = byId("verificationSpecialConsiderationSection");
        const select = byId("verificationSpecialConsiderationTag");
        const specialWrap = byId("verificationSpecialConsiderationWrap");
        const specialBadge = byId("verificationSpecialConsiderationBadge");
        const selectedTag = currentSpecialConsiderationTag();
        const selectedMeta = decodeSpecialConsiderationTag(selectedTag);
        const entries = secretarySpecialConsiderationEntries();
        const draftMode = isDraftReadOnlyMode();
        const sectionVisible = workflowControls.show_secretary_special_consideration_control === true
            && applicationStaffFlagsAvailable
            && Boolean(currentApplication);

        if (select) {
            const optionMarkup = ['<option value="">Regular Review</option>'].concat(entries.map(function (entry) {
                const selected = entry.value.toLowerCase() === selectedTag.toLowerCase() ? ' selected' : '';
                return '<option value="' + escapeHtml(entry.value) + '"' + selected + '>' + escapeHtml(entry.optionLabel) + '</option>';
            }));
            select.innerHTML = optionMarkup.join("");
            select.value = selectedTag || "";
            select.disabled = draftMode || isProcessing || isSavingSpecialConsideration || !currentApplication || !specialConsiderationInputEnabled() || (!entries.length && !selectedTag);
        }

        if (section) {
            section.classList.toggle("d-none", !sectionVisible);
        }

        if (specialWrap && specialBadge) {
            specialWrap.classList.remove("d-none");
            if (selectedMeta.level || selectedMeta.label) {
                const levelMeta = SPECIAL_CONSIDERATION_LEVEL_META[selectedMeta.level] || SPECIAL_CONSIDERATION_LEVEL_META.internal_review;
                specialBadge.className = "ldss-chip " + (levelMeta.chipClass || "ldss-chip-accent");
                specialBadge.textContent = levelMeta.label || "Special Consideration";
            } else {
                specialBadge.className = "ldss-chip ldss-chip-neutral";
                specialBadge.textContent = "Regular";
            }
        }
    }

    async function fetchApplicationStaffFlags(applicationId) {
        if (!authContext || !authContext.client || !applicationId || !applicationStaffFlagsAvailable) {
            return null;
        }

        const result = await authContext.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .select("application_id, special_consideration_tag, special_consideration_marked_by, created_at, updated_at")
            .eq("application_id", applicationId)
            .maybeSingle();

        if (result.error) {
            if (isMissingTableError(result.error, APPLICATION_STAFF_FLAGS_TABLE)) {
                applicationStaffFlagsAvailable = false;
                return null;
            }
            throw new Error("Failed to load Special Consideration tag: " + result.error.message);
        }

        const row = result.data || null;
        const normalizedTag = normalizeTag(row && row.special_consideration_tag);
        if (!row || !normalizedTag) {
            return null;
        }

        return {
            application_id: row.application_id,
            special_consideration_tag: normalizedTag,
            special_consideration_marked_by: row.special_consideration_marked_by || null,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null
        };
    }

    function ensureSpecialConsiderationReady(tag) {
        const normalizedTag = normalizeTag(tag);
        if (normalizedTag && !applicationStaffFlagsAvailable) {
            throw new Error("Special Consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.");
        }
    }

    async function persistApplicationStaffFlags(tag) {
        const normalizedTag = normalizeTag(tag);
        selectedSpecialConsiderationTag = normalizedTag;

        if (!currentApplication || !currentApplication.id) {
            return;
        }

        ensureSpecialConsiderationReady(normalizedTag);
        if (!applicationStaffFlagsAvailable) {
            currentStaffFlags = normalizedTag
                ? {
                    application_id: currentApplication.id,
                    special_consideration_tag: normalizedTag,
                    special_consideration_marked_by: authContext && authContext.user ? authContext.user.id : null
                }
                : null;
            renderSpecialConsiderationControl();
            return;
        }

        const payload = {
            application_id: currentApplication.id,
            special_consideration_tag: normalizedTag || null,
            special_consideration_marked_by: normalizedTag && authContext && authContext.user ? authContext.user.id : null
        };

        const result = await authContext.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .upsert(payload, { onConflict: "application_id" });

        if (result.error) {
            if (isMissingTableError(result.error, APPLICATION_STAFF_FLAGS_TABLE)) {
                applicationStaffFlagsAvailable = false;
                renderSpecialConsiderationControl();
                throw new Error("Special Consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.");
            }
            throw new Error("Failed to save Special Consideration tag: " + result.error.message);
        }

        currentStaffFlags = normalizedTag
            ? {
                application_id: currentApplication.id,
                special_consideration_tag: normalizedTag,
                special_consideration_marked_by: authContext && authContext.user ? authContext.user.id : null
            }
            : null;
        renderSpecialConsiderationControl();
    }

    function syncSavedSpecialConsiderationInSnapshot(tag) {
        if (!currentFormSnapshot) {
            currentFormSnapshot = buildFormSnapshot();
            return;
        }

        try {
            const snapshot = JSON.parse(currentFormSnapshot);
            snapshot.specialConsiderationTag = normalizeTag(tag);
            currentFormSnapshot = JSON.stringify(snapshot);
        } catch (_error) {
            currentFormSnapshot = buildFormSnapshot();
        }
    }

    async function handleSpecialConsiderationSelectionChange() {
        const select = byId("verificationSpecialConsiderationTag");
        const previousTag = currentSpecialConsiderationTag();
        const nextTag = normalizeTag(select && select.value ? select.value : "");

        if (!currentApplication || isDraftReadOnlyMode() || isProcessing || isSavingSpecialConsideration) {
            renderSpecialConsiderationControl();
            return;
        }
        if (nextTag === previousTag) {
            renderSpecialConsiderationControl();
            return;
        }

        selectedSpecialConsiderationTag = nextTag;
        isSavingSpecialConsideration = true;
        renderSpecialConsiderationControl();

        try {
            await persistApplicationStaffFlags(nextTag);
            syncSavedSpecialConsiderationInSnapshot(nextTag);
            if (nextTag) {
                const decoded = decodeSpecialConsiderationTag(nextTag);
                showStatus("Special Consideration set to " + specialConsiderationOptionLabel(decoded.level, decoded.label, false) + ".", "alert-success");
            } else {
                showStatus("Special Consideration cleared. This applicant is back to regular review.", "alert-success");
            }
        } catch (error) {
            selectedSpecialConsiderationTag = previousTag;
            if (currentStaffFlags) {
                currentStaffFlags.special_consideration_tag = previousTag || null;
            }
            renderSpecialConsiderationControl();
            showStatus(error && error.message ? error.message : "Failed to save Special Consideration.", "alert-danger");
        } finally {
            isSavingSpecialConsideration = false;
            renderSpecialConsiderationControl();
        }
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

    function isMissingRpcFunctionError(error, functionName) {
        const text = [
            error && error.message ? error.message : "",
            error && error.details ? error.details : "",
            error && error.hint ? error.hint : ""
        ].join(" ").toLowerCase();
        const normalizedName = (functionName || "").toString().toLowerCase();
        if (!text || !normalizedName) {
            return false;
        }
        return text.includes(normalizedName) && /does not exist|function|schema cache|could not find/i.test(text);
    }

    function hotfixSaveErrorMessage() {
        return "Secretary applicant profile saving needs the Supabase hotfix `supabase/secretary_applicant_profile_edit_hotfix_2026_04_07.sql`. Apply it in Supabase SQL Editor, then refresh this page and try again.";
    }

    async function saveApplicantProfilePatch(profilePatch) {
        const payload = Object.assign({}, profilePatch || {});

        if (!profilesSupportsPlaceOfBirth) {
            delete payload.place_of_birth;
        }

        const rpcResult = await authContext.client.rpc("secretary_update_applicant_profile", {
            p_application_id: currentApplication.id,
            p_profile_patch: payload
        });

        if (!rpcResult.error) {
            if (!rpcResult.data || typeof rpcResult.data !== "object") {
                throw new Error("Applicant profile update did not return the saved profile record.");
            }
            if (profilesSupportsPlaceOfBirth && typeof rpcResult.data.place_of_birth === "undefined") {
                profilesSupportsPlaceOfBirth = false;
            }
            return rpcResult.data;
        }

        if (!isMissingRpcFunctionError(rpcResult.error, "secretary_update_applicant_profile")) {
            throw new Error("Failed to save applicant profile corrections: " + rpcResult.error.message);
        }

        let profileResult = await authContext.client
            .from("profiles")
            .update(payload)
            .eq("id", currentApplication.applicant_id)
            .select(profileSelectFields())
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(profileResult.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            delete payload.place_of_birth;
            profileResult = await authContext.client
                .from("profiles")
                .update(payload)
                .eq("id", currentApplication.applicant_id)
                .select(profileSelectFields())
                .maybeSingle();
        }

        if (profileResult.error) {
            throw new Error("Failed to save applicant profile corrections: " + profileResult.error.message);
        }
        if (!profileResult.data) {
            throw new Error(hotfixSaveErrorMessage());
        }
        return profileResult.data;
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

    function renderHardCopyVerificationState() {
        const checkbox = byId("verificationHardCopyVerified");
        const meta = byId("verificationHardCopyMeta");
        if (!checkbox || !meta) {
            return;
        }

        if (checkbox.checked) {
            if (currentInterview && currentInterview.hard_copy_verified_at) {
                meta.textContent = "Hard copies verified on " + formatDateTime(currentInterview.hard_copy_verified_at) + ".";
                return;
            }
            meta.textContent = "This will be saved as verified when you save secretary checking.";
            return;
        }

        meta.textContent = "Use this after the office matches the online record with the applicant's printed requirements.";
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

        const modal = getNotesModal();
        if (modal) {
            modal.show();
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
        try {
            return await window.ldssUploads.createObjectUrl(authContext, path);
        } catch (error) {
            const message = error && error.message ? error.message : "";
            const isHostedPreviewRouteIssue =
                message.includes("Upload API route was not found")
                || message.includes("Upload API returned an HTML page")
                || message.includes("Upload server is not available right now")
                || message.includes("Failed to fetch");

            // Do not block secretary verification or applicant-detail edits just
            // because an older hosted file preview cannot be opened right now.
            if (isHostedPreviewRouteIssue) {
                return "";
            }
            throw error;
        }
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

    function renderHeaderAndSummary() {
        const appNo = currentApplication ? currentApplication.application_no : "-";
        const applicantName = buildApplicantName(currentProfile);
        const meta = byId("secretaryVerificationHeaderMeta");
        const isDraft = isDraftReadOnlyMode();

        if (meta) {
            meta.textContent = "Application ID: " + appNo + " | Applicant: " + applicantName + (isDraft ? " | Draft Preview" : "");
        }

        renderApplicantDetailSheet();
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

    function applicantLoginEmailApiUrl(userId) {
        return APPLICANT_LOGIN_EMAIL_API_BASE + "/" + encodeURIComponent(userId || "") + "/replace-login-email";
    }

    function populateLoginEmailForm() {
        const profile = currentProfile || {};
        const target = byId("verificationLoginEmailTarget");
        const currentInput = byId("verificationLoginEmailCurrent");
        const newInput = byId("verificationLoginEmailNew");
        const sendResetToggle = byId("verificationLoginEmailSendReset");

        if (target) {
            target.textContent = buildApplicantName(profile);
        }
        if (currentInput) {
            currentInput.value = profile.email || "";
        }
        if (newInput) {
            newInput.value = profile.email || "";
        }
        if (sendResetToggle) {
            sendResetToggle.checked = true;
        }

        setLoginEmailStatus("");
        setLoginEmailLoading(false);
    }

    async function submitLoginEmailChange() {
        if (!currentApplication || !currentApplication.applicant_id) {
            setLoginEmailStatus("Applicant account is not loaded yet.", "alert-warning");
            return;
        }
        if (isLoginEmailSubmitting) {
            return;
        }

        const newEmail = ((byId("verificationLoginEmailNew") ? byId("verificationLoginEmailNew").value : "") || "").trim().toLowerCase();
        const sendAccessEmail = Boolean(byId("verificationLoginEmailSendReset") && byId("verificationLoginEmailSendReset").checked);

        if (!newEmail) {
            setLoginEmailStatus("Corrected login email is required.", "alert-warning");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            setLoginEmailStatus("Enter a valid corrected login email address.", "alert-warning");
            return;
        }

        setLoginEmailLoading(true, sendAccessEmail ? "Saving and Sending..." : "Saving...");
        setLoginEmailStatus("");

        try {
            const payload = await requestJson(applicantLoginEmailApiUrl(currentApplication.applicant_id), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    newEmail: newEmail,
                    sendAccessEmail: sendAccessEmail
                }),
                notFoundMessage: "Login email replacement API route was not found. Open the site through the Node server."
            });

            const updatedEmail = payload && payload.user && payload.user.email
                ? payload.user.email
                : newEmail;
            const accessEmail = payload && payload.access_email ? payload.access_email : null;
            const currentInput = byId("verificationLoginEmailCurrent");
            const newInput = byId("verificationLoginEmailNew");
            let statusMessage = "Applicant login email updated successfully to " + updatedEmail + ".";
            let statusType = "alert-success";

            if (accessEmail && accessEmail.requested && accessEmail.sent) {
                statusMessage += " Password reset email sent to " + updatedEmail + " successfully.";
            } else if (accessEmail && accessEmail.requested && accessEmail.warning) {
                statusMessage += " " + accessEmail.warning;
                statusType = "alert-warning";
            }

            await loadPageData(currentApplication.id);
            if (currentInput) {
                currentInput.value = updatedEmail;
            }
            if (newInput) {
                newInput.value = updatedEmail;
            }
            setLoginEmailStatus(statusMessage, statusType);
            showStatus(statusMessage, statusType);
        } catch (error) {
            setLoginEmailStatus(error && error.message ? error.message : "Failed to replace applicant login email.", "alert-danger");
        } finally {
            setLoginEmailLoading(false);
        }
    }

    function syncApplicantEditAccess() {
        const editBtn = byId("verificationEditApplicantBtn");
        const draftMode = isDraftReadOnlyMode();
        const enabled = workflowControls.allow_secretary_applicant_edits === true && !draftMode;

        if (editBtn) {
            editBtn.classList.toggle("d-none", !enabled);
            editBtn.disabled = !enabled;
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
        setControlValue("verificationEditPlaceOfBirth", profile.place_of_birth || aux.placeOfBirth || "");
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
        if (workflowControls.allow_secretary_applicant_edits !== true) {
            throw new Error("Applicant detail editing is currently disabled in System Administrator settings.");
        }

        const payloads = collectApplicantEditPayload();
        const savedProfile = await saveApplicantProfilePatch(payloads.profilePatch);

        const applicationResult = await authContext.client
            .from("applications")
            .update(payloads.applicationPatch)
            .eq("id", currentApplication.id)
            .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at, secretary_remarks, is_locked")
            .maybeSingle();

        if (applicationResult.error) {
            throw new Error("Profile corrections were saved, but application detail update failed: " + applicationResult.error.message);
        }
        if (!applicationResult.data) {
            throw new Error("Profile corrections were saved, but the application detail update did not return the saved record.");
        }

        currentProfile = savedProfile || currentProfile;
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
        const hardCopyToggle = byId("verificationHardCopyVerified");
        selectedCounselor = remarksParsed.counselorEndorsement || "";

        if (dateTime) {
            dateTime.value = toDatetimeLocalValue(interview.scheduled_at || "") || configuredSchedule || "";
        }
        if (venue) {
            venue.value = interview.venue || configuredVenue || "";
        }
        if (remarks) {
            remarks.value = remarksParsed.plainRemarks;
        }
        if (hardCopyToggle) {
            hardCopyToggle.checked = Boolean(interview.hard_copy_verified);
        }

        renderCounselorOptions();
        renderHardCopyVerificationState();
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
                '<td><span class="small text-muted">' + escapeHtml(missingDocumentHelpText(definition)) + "</span></td>" +
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
            '<button class="btn btn-outline-dark btn-sm ldss-doc-note-btn" type="button" data-doc-note-open="1" data-doc-id="' + escapeHtml(documentRow.id) + '" data-doc-label="' + escapeHtml(definition.label) + '" data-doc-has-file="1">' +
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

        tbody.innerHTML = verificationDocumentDefinitions().map(documentRowMarkup).join("");
        Object.keys(documentNotesById).forEach(function (docId) {
            updateDocNotePreview(docId);
        });
    }

    function restoreDocumentTableState(savedDocStateRows, excludedType) {
        (savedDocStateRows || []).forEach(function (row) {
            if (!row || !row.exists || row.type === excludedType) {
                return;
            }

            const latestRow = latestDocumentByType[row.type] || null;
            if (!latestRow || !latestRow.id) {
                return;
            }

            const statusEl = byId("verificationDocStatus-" + latestRow.id);
            if (statusEl) {
                statusEl.value = row.status || "pending";
            }

            documentNotesById[latestRow.id] = row.notes || "";
            updateDocNotePreview(latestRow.id);
        });
    }

    function documentVerificationState() {
        return verificationDocumentDefinitions().map(function (definition) {
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
        const interviewDateTimeRaw = byId("verificationInterviewDateTime")
            ? byId("verificationInterviewDateTime").value.trim()
            : "";
        const remarksValue = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        const cleanCounselorEndorsement = normalizeTag(selectedCounselor);
        const interviewVenueValue = byId("verificationInterviewVenue")
            ? byId("verificationInterviewVenue").value.trim()
            : "";
        const hardCopyVerified = Boolean(byId("verificationHardCopyVerified") && byId("verificationHardCopyVerified").checked);
        const currentInterviewStatus = currentInterview && currentInterview.status
            ? currentInterview.status
            : "";
        let preservedInterviewStatus = currentInterviewStatus || (interviewDateTimeRaw ? "scheduled" : "not_scheduled");
        const preservedInterviewResult = currentInterview && currentInterview.result
            ? currentInterview.result
            : "pending";

        if (!interviewDateTimeRaw && (!currentInterviewStatus || currentInterviewStatus === "scheduled" || currentInterviewStatus === "not_scheduled")) {
            preservedInterviewStatus = "not_scheduled";
        }
        if (interviewDateTimeRaw && (!currentInterviewStatus || currentInterviewStatus === "not_scheduled")) {
            preservedInterviewStatus = "scheduled";
        }

        return {
            interviewDateTimeIso: toIsoFromDatetimeLocal(interviewDateTimeRaw),
            interviewVenue: interviewVenueValue,
            interviewStatus: preservedInterviewStatus,
            interviewResult: preservedInterviewResult,
            examScore: currentInterview && typeof currentInterview.exam_score !== "undefined"
                ? currentInterview.exam_score
                : null,
            hardCopyVerified: hardCopyVerified,
            counselorEndorsement: cleanCounselorEndorsement,
            queuePriority: "medium",
            recommendationDecision: byId("verificationRecommendationDecision") ? byId("verificationRecommendationDecision").value : "approved",
            remarks: remarksValue,
            specialConsiderationTag: currentSpecialConsiderationTag(),
            sectorTags: [],
            remarksWithSectorMeta: composeRemarksWithSectorMeta(remarksValue, [], cleanCounselorEndorsement)
        };
    }

    function buildFormSnapshot() {
        const formValues = readFormValues();
        const photoInput = byId("verificationVerifiedPhotoFile");
        return JSON.stringify({
            counselorEndorsement: formValues.counselorEndorsement || "",
            interviewDateTimeIso: formValues.interviewDateTimeIso || "",
            interviewVenue: formValues.interviewVenue || "",
            hardCopyVerified: Boolean(formValues.hardCopyVerified),
            recommendationDecision: formValues.recommendationDecision || "",
            specialConsiderationTag: formValues.specialConsiderationTag || "",
            remarks: formValues.remarks || "",
            docStates: documentVerificationState().map(function (row) {
                return {
                    type: row.type,
                    exists: row.exists,
                    status: row.status,
                    notes: row.notes || ""
                };
            }),
            hasVerifiedPhotoUpload: Boolean(photoInput && photoInput.files && photoInput.files.length)
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
        const backToCheckingBtn = byId("verificationBackToCheckingBtn");
        const returnBtn = byId("verificationReturnBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const forExamBtn = byId("verificationForExamBtn");
        const photoActionBtn = byId("verificationPhotoActionBtn");
        const uploadApplicantPhotoBtn = byId("verificationUploadApplicantPhotoBtn");
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

        setState(saveBtn, "Save Checking");
        setState(complianceBtn, "Send Compliance Notice");
        setState(backToCheckingBtn, "Back to Checking");
        setState(returnBtn, "Return for Correction");
        setState(returnConfirmBtn, "Return and Redirect");
        setState(forExamBtn, "Set for Examination");
        setState(uploadApplicantPhotoBtn, "Upload / Replace Photo");
        if (photoActionBtn) {
            photoActionBtn.disabled = isLoading;
            if (!isLoading) {
                photoActionBtn.textContent = "Photo Action";
            } else if (activeButtonId === "verificationUploadApplicantPhotoBtn") {
                photoActionBtn.textContent = "Uploading...";
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

    async function saveApplicantPhotoPath(storagePath) {
        if (!storagePath || !currentApplication || !currentApplication.applicant_id) {
            return currentProfile;
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
            throw new Error("Applicant photo uploaded but profile photo sync failed: " + result.error.message);
        }

        if (result.data) {
            currentProfile = result.data;
            return result.data;
        }

        currentProfile = Object.assign({}, currentProfile || {}, {
            applicant_photo_path: storagePath
        });
        return currentProfile;
    }

    async function upsertApplicantPhotoDocument(storagePath, file) {
        const selectFields = "id, application_id, document_type, storage_path, original_filename, mime_type, file_size_bytes, verification_status, verification_notes, created_at";
        const existingRow = latestDocumentByType.applicant_photo || null;
        const payload = {
            application_id: currentApplication.id,
            document_type: "applicant_photo",
            storage_path: storagePath,
            original_filename: file.name || "applicant-photo",
            mime_type: file.type || "application/octet-stream",
            file_size_bytes: file.size,
            verification_status: "pending",
            verification_notes: null,
            uploaded_by: authContext.user.id,
            verified_by: null
        };

        let result = null;
        if (existingRow && existingRow.id) {
            result = await authContext.client
                .from("application_documents")
                .update(payload)
                .eq("id", existingRow.id)
                .eq("application_id", currentApplication.id)
                .select(selectFields)
                .maybeSingle();
        } else {
            result = await authContext.client
                .from("application_documents")
                .insert(payload)
                .select(selectFields)
                .maybeSingle();
        }

        if (result.error) {
            throw new Error("Applicant photo uploaded but document record update failed: " + result.error.message);
        }

        return {
            row: result.data || Object.assign({}, existingRow || {}, payload),
            previousDocumentPath: existingRow && existingRow.storage_path ? existingRow.storage_path : ""
        };
    }

    async function handleApplicantPhotoUpload() {
        const fileInput = byId("verificationApplicantPhotoFile");
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            return "";
        }
        if (!currentApplication || !currentApplication.id || !currentApplication.applicant_id) {
            throw new Error("No application is loaded for applicant photo upload.");
        }
        if (!authContext || !authContext.user) {
            throw new Error("Please sign in again before uploading the applicant photo.");
        }
        if (!window.ldssUploads || typeof window.ldssUploads.uploadFile !== "function") {
            throw new Error("Applicant photo upload client is not available.");
        }

        const priorDocStateRows = documentVerificationState();
        const hadUnsavedChangesBefore = hasUnsavedVerificationChanges();
        const selectedFile = fileInput.files[0];
        const mime = (selectedFile.type || "").toLowerCase();
        if (!mime.startsWith("image/")) {
            throw new Error("Applicant photo must be an image file.");
        }

        const uploadFile = await optimizeApplicantPhotoForUpload(selectedFile);
        if (uploadFile.size > MAX_IMAGE_SIZE_BYTES) {
            throw new Error("Applicant photo exceeds 10MB limit.");
        }

        const previousProfilePath = (currentProfile && currentProfile.applicant_photo_path) || "";
        const uploadResult = await window.ldssUploads.uploadFile(authContext, uploadFile, {
            applicationId: currentApplication.id,
            documentType: "applicant_photo"
        });
        const storagePath = uploadResult && uploadResult.path ? uploadResult.path : "";
        if (!storagePath) {
            throw new Error("Applicant photo upload failed: upload server did not return a file path.");
        }

        const documentResult = await upsertApplicantPhotoDocument(storagePath, uploadFile);
        await saveApplicantPhotoPath(storagePath);

        latestDocumentByType.applicant_photo = documentResult.row;
        signedDocumentUrlByType.applicant_photo = await createSignedUrl(storagePath);

        renderDocumentTable();
        restoreDocumentTableState(priorDocStateRows, "applicant_photo");
        setPhotoArea(
            "verificationApplicantPhotoPreview",
            "verificationApplicantPhotoPlaceholder",
            "verificationApplicantPhotoLink",
            signedDocumentUrlByType.applicant_photo || "",
            "No Photo"
        );

        if (!hadUnsavedChangesBefore) {
            markCurrentFormSnapshot();
        }

        const cleanupPaths = Array.from(new Set([
            documentResult.previousDocumentPath,
            previousProfilePath
        ].filter(function (pathValue) {
            return pathValue && pathValue !== storagePath;
        })));

        if (cleanupPaths.length && window.ldssUploads && typeof window.ldssUploads.deleteFiles === "function") {
            try {
                await window.ldssUploads.deleteFiles(authContext, cleanupPaths);
            } catch (_cleanupError) {
                // Best-effort cleanup only. The newly saved photo remains valid.
            }
        }

        return previousProfilePath || documentResult.previousDocumentPath
            ? "Applicant photo replaced successfully."
            : "Applicant photo uploaded successfully.";
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

        if (currentStatus === "returned_for_correction") {
            return hasApplicationUpdatedSinceNotice(currentApplication, latestCorrectionNotice)
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
        ensureSpecialConsiderationReady(formValues.specialConsiderationTag);

        const docStates = documentVerificationState();
        const uploadedPhotoPath = await maybeUploadVerifiedPhoto();
        const hardCopyVerified = Boolean(formValues.hardCopyVerified);

        await persistDocumentUpdates(docStates);
        currentInterview = await upsertInterview(formValues, uploadedPhotoPath, hardCopyVerified);
        await updateApplication(targetStatus, formValues.remarks, lockState);
        await persistApplicationStaffFlags(formValues.specialConsiderationTag);

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

        const previousStatus = normalizedApplicationStatus();
        const docStates = documentVerificationState();
        const targetStatus = deriveSaveStatus(formValues, docStates);
        await persistVerification(targetStatus, null, false);

        if (previousStatus === "returned_for_correction" && targetStatus === "submitted") {
            await notifyApplicant(
                "application",
                "Application Back in Secretary Checking",
                "The scholarship office received your corrected application and moved it back to secretary checking for review."
            );
            return "Secretary checking saved. Application moved back to For Checking.";
        }

        if (targetStatus === "pending_exam" && previousStatus !== "pending_exam") {
            await notifyApplicant(
                "application",
                "Application Ready for Examination",
                "Your application passed secretary checking and is now waiting for examination scheduling."
            );
        } else {
            await notifyApplicant(
                "application",
                "Secretary Checking Updated",
                "The scholarship office updated your application checking details."
            );
        }

        return targetStatus === "pending_exam"
            ? "Secretary checking saved. Application moved to Pending Exam."
            : "Secretary checking details saved successfully.";
    }

    async function handleBackToChecking() {
        const currentStatus = normalizedApplicationStatus();
        if (currentStatus !== "returned_for_correction") {
            showStatus("This application is not currently marked Returned for Correction.", "alert-warning");
            return;
        }

        await persistVerification("submitted", null, false);
        await notifyApplicant(
            "application",
            "Application Back in Secretary Checking",
            "The scholarship office moved your application back to secretary checking for review."
        );

        return "Application moved back to For Checking.";
    }

    async function handleSetForExamination() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        const previousStatus = normalizedApplicationStatus();
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
            return "Application moved to Pending Exam.";
        }

        await notifyApplicant(
            "application",
            "Pending Exam Details Updated",
            "The scholarship office updated your examination preparation details."
        );
        return "Pending Exam details updated successfully.";
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

    async function loadApplicationNavigationQueue(currentApplicationId) {
        if (!authContext || !authContext.client) {
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
            updateVerificationNavigationButtons();
            return;
        }

        if (currentApplicationId && isDraftReadOnlyMode()) {
            applicationNavigationIds = [currentApplicationId];
            currentNavigationIndex = 0;
            updateVerificationNavigationButtons();
            return;
        }

        const storedIds = readStoredVerificationQueue();
        if (currentApplicationId && storedIds.length && storedIds.indexOf(currentApplicationId) !== -1) {
            applicationNavigationIds = storedIds.slice();
            currentNavigationIndex = applicationNavigationIds.indexOf(currentApplicationId);
            updateVerificationNavigationButtons();
            return;
        }

        const result = await authContext.client
            .from("applications")
            .select("id")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

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
        const backToCheckingBtn = byId("verificationBackToCheckingBtn");
        const returnBtn = byId("verificationReturnBtn");
        const forExamConfirmModalEl = byId("verificationForExamConfirmModal");
        const forExamConfirmCancelBtn = byId("verificationForExamConfirmCancelBtn");
        const forExamConfirmProceedBtn = byId("verificationForExamConfirmProceedBtn");
        const returnConfirmBtn = byId("verificationReturnConfirmBtn");
        const correctionTargetInputs = document.querySelectorAll("input[name='verificationCorrectionTargets']");
        const forExamBtn = byId("verificationForExamBtn");
        const prevBtn = byId("verificationPrevBtn");
        const nextBtn = byId("verificationNextBtn");
        const uploadApplicantPhotoBtn = byId("verificationUploadApplicantPhotoBtn");
        const applicantPhotoInput = byId("verificationApplicantPhotoFile");
        const approvePhotoBtn = byId("verificationApprovePhotoBtn");
        const photoChangeBtn = byId("verificationRequestPhotoChangeBtn");
        const fixLoginEmailBtn = byId("verificationFixLoginEmailBtn");
        const loginEmailSubmitBtn = byId("verificationLoginEmailSubmitBtn");
        const loginEmailModalEl = byId("verificationLoginEmailModal");
        const editApplicantBtn = byId("verificationEditApplicantBtn");
        const editApplicantSaveBtn = byId("verificationApplicantEditSaveBtn");
        const counselorSelect = byId("verificationCounselorEndorsement");
        const specialConsiderationSelect = byId("verificationSpecialConsiderationTag");
        const hardCopyToggle = byId("verificationHardCopyVerified");
        const cameraStartBtn = byId("verificationStartCameraBtn");
        const cameraCaptureBtn = byId("verificationCapturePhotoBtn");
        const cameraStopBtn = byId("verificationStopCameraBtn");
        const docNotesSaveBtn = byId("verificationDocNotesSaveBtn");
        const docNotesModalEl = byId("verificationDocNotesModal");
        const docTableBody = byId("verificationDocumentsTableBody");

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

        if (backToCheckingBtn) {
            backToCheckingBtn.addEventListener("click", function () {
                runAction("verificationBackToCheckingBtn", "Moving...", handleBackToChecking);
            });
        }

        if (forExamConfirmCancelBtn) {
            forExamConfirmCancelBtn.addEventListener("click", function () {
                resolveForExamConfirmation(false);
            });
        }

        if (forExamConfirmProceedBtn) {
            forExamConfirmProceedBtn.addEventListener("click", function () {
                resolveForExamConfirmation(true);
                const modal = getForExamConfirmModal();
                if (modal) {
                    modal.hide();
                }
            });
        }

        if (forExamConfirmModalEl) {
            forExamConfirmModalEl.addEventListener("hidden.bs.modal", function () {
                resolveForExamConfirmation(false);
            });
        }

        if (forExamBtn) {
            forExamBtn.addEventListener("click", async function () {
                const previousStatus = normalizedApplicationStatus();

                if (isProcessing) {
                    return;
                }
                if (!currentApplication || !currentApplication.id) {
                    showStatus("No application is loaded yet.", "alert-warning");
                    return;
                }
                if (isDraftReadOnlyMode()) {
                    showStatus("Draft preview only. Submit the application first before setting it for examination.", "alert-warning");
                    return;
                }
                if (!isSecretaryCheckingStage(previousStatus) && previousStatus !== "pending_exam") {
                    showStatus("This application is no longer in secretary checking stage.", "alert-warning");
                    return;
                }

                const confirmed = await requestForExamConfirmation();
                if (!confirmed) {
                    return;
                }
                runAction("verificationForExamBtn", "Sending...", handleSetForExamination);
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

        if (uploadApplicantPhotoBtn && applicantPhotoInput) {
            uploadApplicantPhotoBtn.addEventListener("click", function () {
                if (!currentApplication) {
                    showStatus("No application is loaded yet.", "alert-warning");
                    return;
                }
                if (isDraftReadOnlyMode()) {
                    showStatus("Draft preview only. Submit the application first before uploading the applicant photo here.", "alert-warning");
                    return;
                }
                applicantPhotoInput.value = "";
                applicantPhotoInput.click();
            });

            applicantPhotoInput.addEventListener("change", async function () {
                const hasFile = applicantPhotoInput.files && applicantPhotoInput.files[0];
                if (!hasFile || isProcessing) {
                    return;
                }

                isProcessing = true;
                actionButtonState(true, "verificationUploadApplicantPhotoBtn", "Uploading...");
                showStatus("");

                try {
                    const resultMessage = await handleApplicantPhotoUpload();
                    if (resultMessage) {
                        showStatus(resultMessage, "alert-success");
                    }
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Applicant photo upload failed. Please try again.", "alert-danger");
                } finally {
                    applicantPhotoInput.value = "";
                    isProcessing = false;
                    actionButtonState(false);
                }
            });
        }

        if (photoChangeBtn) {
            photoChangeBtn.addEventListener("click", function () {
                runAction("verificationRequestPhotoChangeBtn", "Sending...", handleRequestPhotoChange);
            });
        }

        if (fixLoginEmailBtn) {
            fixLoginEmailBtn.addEventListener("click", function () {
                if (!currentApplication || !currentApplication.applicant_id || !currentProfile) {
                    showStatus("Applicant account details are not loaded yet.", "alert-warning");
                    return;
                }
                populateLoginEmailForm();
                const modal = getLoginEmailModal();
                if (modal) {
                    modal.show();
                }
            });
        }

        if (loginEmailSubmitBtn) {
            loginEmailSubmitBtn.addEventListener("click", function () {
                submitLoginEmailChange();
            });
        }

        if (loginEmailModalEl) {
            loginEmailModalEl.addEventListener("hidden.bs.modal", function () {
                setLoginEmailStatus("");
            });
        }

        if (editApplicantBtn) {
            editApplicantBtn.addEventListener("click", function () {
                if (!currentApplication) {
                    showStatus("Applicant details are not loaded yet.", "alert-warning");
                    return;
                }
                if (workflowControls.allow_secretary_applicant_edits !== true) {
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

        if (specialConsiderationSelect) {
            specialConsiderationSelect.addEventListener("change", function () {
                handleSpecialConsiderationSelectionChange().catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to save Special Consideration.", "alert-danger");
                });
            });
        }
        if (hardCopyToggle) {
            hardCopyToggle.addEventListener("change", function () {
                renderHardCopyVerificationState();
            });
        }
        if (docTableBody) {
            docTableBody.addEventListener("click", function (event) {
                const button = event.target && event.target.closest
                    ? event.target.closest("[data-doc-note-open='1']")
                    : null;
                if (!button) {
                    return;
                }
                openNotesModal(
                    button.getAttribute("data-doc-id"),
                    button.getAttribute("data-doc-label"),
                    button.getAttribute("data-doc-has-file") === "1"
                );
            });
        }
        if (docNotesSaveBtn) {
            docNotesSaveBtn.addEventListener("click", function () {
                saveNotesFromModal();
            });
        }
        if (docNotesModalEl) {
            docNotesModalEl.addEventListener("hidden.bs.modal", function () {
                activeNotesDocId = "";
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

        const editModalEl = byId("verificationApplicantEditModal");
        if (editModalEl) {
            editModalEl.addEventListener("hidden.bs.modal", function () {
                setApplicantEditStatus("");
            });
        }
    }

    async function loadPageData(targetApplicationId) {
        showStatus("");
        stopCameraStream();
        counselorOptions = loadCounselorOptions();
        currentAuxMeta = {};
        currentFormSnapshot = "";
        latestCorrectionNotice = null;

        currentApplication = await fetchApplication(targetApplicationId || queryApplicationId());
        if (!currentApplication) {
            currentStaffFlags = null;
            selectedSpecialConsiderationTag = "";
            renderSpecialConsiderationControl();
            showStatus("No application records are currently available for secretary verification.", "alert-warning");
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
            renderCorrectionHistoryNotice();
            updateVerificationNavigationButtons();
            return;
        }

        currentAuxMeta = (await fetchSharedAuxMeta(currentApplication.id))
            || readAuxMeta(currentApplication.applicant_id, currentApplication.id);
        writeAuxMeta(currentApplication.applicant_id, currentApplication.id, currentAuxMeta);

        const dataResults = await Promise.all([
            fetchProfile(currentApplication.applicant_id),
            fetchInterview(currentApplication.id),
            fetchDocuments(currentApplication.id),
            fetchLatestCorrectionNotice(currentApplication.id),
            fetchApplicationStaffFlags(currentApplication.id)
        ]);

        currentProfile = dataResults[0];
        currentInterview = dataResults[1];
        latestDocumentByType = latestDocumentsByType(dataResults[2]);
        latestCorrectionNotice = dataResults[3] || null;
        currentStaffFlags = dataResults[4] || null;
        selectedSpecialConsiderationTag = normalizeTag(currentStaffFlags && currentStaffFlags.special_consideration_tag);

        signedDocumentUrlByType = {};
        for (const type of Object.keys(latestDocumentByType)) {
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
        renderCorrectionHistoryNotice();
        renderInterviewForm();
        renderDocumentTable();
        renderSpecialConsiderationControl();
        syncApplicantEditAccess();
        await loadApplicationNavigationQueue(currentApplication.id);
        syncDraftReadOnlyState();

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

        markCurrentFormSnapshot();
        updateVerificationNavigationButtons();
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindActions();
        try {
            await loadWorkflowControls();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load workflow controls.", "alert-warning");
        }
        syncApplicantEditAccess();
        await loadPageData(queryApplicationId());
    }

    window.addEventListener("DOMContentLoaded", init);
})();
