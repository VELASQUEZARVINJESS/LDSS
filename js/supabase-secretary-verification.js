
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
        allow_secretary_applicant_edits: false
    };

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

    const COUNSELOR_OPTIONS_STORAGE_KEY = "ldss:counselor-options:v1";
    const INTERVIEW_SCHEDULE_STORAGE_KEY = "ldss:default-interview-schedule:v1";
    const INTERVIEW_VENUE_STORAGE_KEY = "ldss:default-interview-venue:v1";
    const VERIFICATION_QUEUE_STORAGE_KEY = "ldss:secretary-verification-queue:v1";
    const DEFAULT_COUNSELOR_OPTIONS = [];
    const PHOTO_CHANGE_REMARK = "Please replace your applicant 1x1 photo with a clear and appropriate picture.";
    const REMARKS_COUNSELOR_META_START = "[[LDSS_COUNSELOR]]";
    const REMARKS_COUNSELOR_META_END = "[[/LDSS_COUNSELOR]]";
    const REMARKS_SECTOR_META_START = "[[LDSS_SECTOR_TAGS]]";
    const REMARKS_SECTOR_META_END = "[[/LDSS_SECTOR_TAGS]]";

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
    let activeNotesDocId = "";
    let counselorOptions = DEFAULT_COUNSELOR_OPTIONS.slice();
    let selectedCounselor = "";
    let cameraStream = null;
    let localPreviewObjectUrl = "";
    let isProcessing = false;
    let profilesSupportsPlaceOfBirth = true;
    let applicationAuxDataAvailable = true;
    let workflowControls = Object.assign({}, DEFAULT_WORKFLOW_CONTROLS);

    function byId(id) {
        return document.getElementById(id);
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

    function normalizedApplicationStatus() {
        return ((currentApplication && currentApplication.status) || "")
            .toString()
            .trim()
            .toLowerCase();
    }

    function buildVerificationUrl(applicationId) {
        return "secretary-interview-verification.html?id=" + encodeURIComponent(applicationId || "");
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

    function updateVerificationNavigationButtons() {
        const prevBtn = byId("verificationPrevBtn");
        const nextBtn = byId("verificationNextBtn");
        const forExamBtn = byId("verificationForExamBtn");
        const hasPrevious = currentNavigationIndex > 0;
        const hasNext = currentNavigationIndex > -1 && currentNavigationIndex < applicationNavigationIds.length - 1;

        if (prevBtn) {
            prevBtn.disabled = isProcessing || !hasPrevious;
        }
        if (nextBtn) {
            nextBtn.disabled = isProcessing || !hasNext;
        }
        if (forExamBtn) {
            forExamBtn.disabled = isProcessing || !currentApplication;
        }
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

        if (meta) {
            meta.textContent = "Application ID: " + appNo + " | Applicant: " + applicantName;
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

    function syncApplicantEditAccess() {
        const editBtn = byId("verificationEditApplicantBtn");
        const meta = byId("verificationEditApplicantMeta");
        const enabled = workflowControls.allow_secretary_applicant_edits === true;

        if (editBtn) {
            editBtn.classList.toggle("d-none", !enabled);
            editBtn.disabled = !enabled;
        }
        if (meta) {
            meta.classList.toggle("d-none", !enabled);
            meta.textContent = enabled
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

        const recommendation = byId("verificationRecommendationDecision");
        if (recommendation && !recommendation.value) {
            recommendation.value = "approved";
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
        const configuredSchedule = loadConfiguredInterviewSchedule();
        const interviewDateTimeRaw = configuredSchedule || (byId("verificationInterviewDateTime") ? byId("verificationInterviewDateTime").value : "");
        const remarksValue = byId("verificationRemarks") ? byId("verificationRemarks").value.trim() : "";
        const cleanCounselorEndorsement = byId("verificationCounselorEndorsement")
            ? normalizeTag(byId("verificationCounselorEndorsement").value)
            : normalizeTag(selectedCounselor);
        const configuredVenue = loadConfiguredInterviewVenue();
        const preservedInterviewStatus = currentInterview && currentInterview.status
            ? currentInterview.status
            : (interviewDateTimeRaw ? "scheduled" : "not_scheduled");
        const preservedInterviewResult = currentInterview && currentInterview.result
            ? currentInterview.result
            : "pending";

        return {
            interviewDateTimeIso: toIsoFromDatetimeLocal(interviewDateTimeRaw),
            interviewVenue: configuredVenue || (byId("verificationInterviewVenue") ? byId("verificationInterviewVenue").value.trim() : ""),
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
        return currentFormSnapshot !== buildFormSnapshot();
    }

    function actionButtonState(isLoading, activeButtonId, loadingText) {
        const saveBtn = byId("verificationSaveBtn");
        const returnBtn = byId("verificationReturnBtn");
        const recommendBtn = byId("verificationRecommendBtn");
        const forExamBtn = byId("verificationForExamBtn");
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

        setState(saveBtn, "Save Checking");
        setState(returnBtn, "Return for Correction");
        setState(recommendBtn, "Recommend to Admin");
        setState(forExamBtn, "Set for Examination");
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
            approvePhotoBtn.disabled = isLoading;
        }
        setState(photoChangeBtn, "Change Photo");
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

        if (isSecretaryCheckingStage(currentStatus)) {
            return formValues.counselorEndorsement
                ? "pending_exam"
                : (currentStatus || "submitted");
        }

        return currentStatus || "submitted";
    }

    async function persistVerification(targetStatus, lockState, includeQueue) {
        const formValues = readFormValues();
        if (formValues.error) {
            throw new Error(formValues.error);
        }

        const docStates = documentVerificationState();
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
        const result = await persistVerification(targetStatus, null, false);

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

    async function handleSetForExamination() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
            return;
        }

        if (!formValues.counselorEndorsement) {
            showStatus("Select a counselor endorsement before moving this application to Pending Exam.", "alert-warning");
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
        if (!remarks || remarks.length < 10) {
            showStatus("Please provide clear remarks (at least 10 characters) before returning for correction.", "alert-warning");
            return;
        }

        await persistVerification("returned_for_correction", false, false);
        await notifyApplicant(
            "application",
            "Application Returned for Correction",
            "Your application was returned for correction. Remarks: " + remarks
        );

        return "Application returned for correction.";
    }

    async function handleRequestPhotoChange() {
        const remarksEl = byId("verificationRemarks");
        const existingRemarks = remarksEl ? remarksEl.value.trim() : "";
        const combinedRemarks = existingRemarks
            ? (existingRemarks + (existingRemarks.endsWith(".") ? "" : ".") + " " + PHOTO_CHANGE_REMARK)
            : PHOTO_CHANGE_REMARK;

        if (remarksEl) {
            remarksEl.value = combinedRemarks;
        }

        await persistVerification("returned_for_correction", false, false);
        await notifyApplicant(
            "application",
            "Applicant Photo Needs Change",
            "Please replace your applicant 1x1 photo with a clear and appropriate picture, then update your application. Remarks: " + combinedRemarks
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

    async function handleRecommendToAdmin() {
        const formValues = readFormValues();
        if (formValues.error) {
            showStatus(formValues.error, "alert-danger");
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

    async function loadApplicationNavigationQueue(currentApplicationId) {
        if (!authContext || !authContext.client) {
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
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
        const returnBtn = byId("verificationReturnBtn");
        const recommendBtn = byId("verificationRecommendBtn");
        const forExamBtn = byId("verificationForExamBtn");
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

        if (forExamBtn) {
            forExamBtn.addEventListener("click", function () {
                runAction("verificationForExamBtn", "Sending...", handleSetForExamination);
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

        currentApplication = await fetchApplication(targetApplicationId || queryApplicationId());
        if (!currentApplication) {
            showStatus("No application records are currently available for secretary verification.", "alert-warning");
            applicationNavigationIds = [];
            currentNavigationIndex = -1;
            updateVerificationNavigationButtons();
            return;
        }

        currentAuxMeta = (await fetchSharedAuxMeta(currentApplication.id))
            || readAuxMeta(currentApplication.applicant_id, currentApplication.id);
        writeAuxMeta(currentApplication.applicant_id, currentApplication.id, currentAuxMeta);

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
        syncApplicantEditAccess();
        await loadApplicationNavigationQueue(currentApplication.id);

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
