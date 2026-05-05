(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const APPLICATION_STAFF_FLAGS_TABLE = "application_staff_flags";
    const LEGACY_RESERVED_SLOT_TAG = "reserved_slot_exception";
    const SPECIAL_TAG_DELIMITER = "::";
    const SPECIAL_APPLICATION_BATCH_SIZE = 500;
    const SPECIAL_FLAG_BATCH_SIZE = 150;
    const SPECIAL_EXAM_LOOKUP_BATCH_SIZE = 150;
    const PROFILE_BATCH_SIZE = 120;
    const SPECIAL_RESULT_LIMIT = 5;
    const DEFAULT_SPECIAL_TAG = "internal_review";
    const SPECIAL_TAG_OPTIONS = Object.freeze([
        { value: "internal_review", label: "Priority Review" },
        { value: "for_approval", label: "For Approval" }
    ]);

    let activeSettingsRecord = null;
    let specialCandidates = [];
    let specialApplicationsById = {};
    let specialFlagsAvailable = true;
    let specialLoadToken = 0;
    let specialFlowModalTimer = 0;
    let specialStatusToastInstance = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function auditHelper() {
        return window.LDSSSuperAdminAudit || null;
    }

    function cloneSettings(settings) {
        if (!settings || typeof settings !== "object") {
            return null;
        }
        return JSON.parse(JSON.stringify(settings));
    }

    function readFallbackStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function writeFallbackStorage(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (_error) {
            return;
        }
    }

    function currentControls() {
        return activeSettingsRecord && activeSettingsRecord.ranking_basis && activeSettingsRecord.ranking_basis.controls
            ? activeSettingsRecord.ranking_basis.controls
            : {};
    }

    function currentSchoolYear() {
        return (activeSettingsRecord && activeSettingsRecord.school_year ? activeSettingsRecord.school_year : "").toString().trim();
    }

    function flowEnabled() {
        const toggle = byId("specialConsiderationFlowToggle");
        if (toggle) {
            return Boolean(toggle.checked);
        }
        return Boolean(currentControls().allow_secretary_special_consideration);
    }

    function flowModalInstance(id) {
        const modalEl = byId(id);
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        return window.bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    function showFlowModal(id) {
        const modalEl = byId(id);
        const instance = flowModalInstance(id);

        if (!modalEl || !instance) {
            return;
        }

        ["specialConsiderationEnabledModal", "specialConsiderationDisabledModal"].forEach(function (modalId) {
            if (modalId === id) {
                return;
            }
            const otherEl = byId(modalId);
            const otherInstance = otherEl && window.bootstrap && window.bootstrap.Modal
                ? window.bootstrap.Modal.getInstance(otherEl)
                : null;
            if (otherInstance) {
                otherInstance.hide();
            }
        });

        if (specialFlowModalTimer) {
            clearTimeout(specialFlowModalTimer);
            specialFlowModalTimer = 0;
        }

        instance.show();
        specialFlowModalTimer = window.setTimeout(function () {
            const liveInstance = window.bootstrap && window.bootstrap.Modal
                ? window.bootstrap.Modal.getInstance(modalEl)
                : null;
            if (liveInstance) {
                liveInstance.hide();
            }
            specialFlowModalTimer = 0;
        }, 1600);
    }

    function showPageStatus(message, type) {
        const box = byId("specialConsiderationStatus");
        const tone = normalizeStatus((type || "alert-info").toString().replace(/^alert-/, "")) || "info";

        if (box) {
            box.className = "alert d-none";
            box.textContent = "";
        }
        if (!message) {
            return;
        }
        if (typeof window.ldssShowToast === "function") {
            window.ldssShowToast({
                title: tone === "danger" ? "Special Consideration Error" : "Special Consideration",
                message: message,
                variant: tone,
                delay: tone === "danger" ? 4200 : 3200
            });
            return;
        }
        showLocalStatusToast(message, tone);
    }

    function showManagerStatus(message, type) {
        const box = byId("specialConsiderationManagerStatus");
        const tone = normalizeStatus((type || "alert-info").toString().replace(/^alert-/, "")) || "info";

        if (box) {
            box.className = "alert d-none";
            box.textContent = "";
        }
        if (!message) {
            return;
        }
        if (typeof window.ldssShowToast === "function") {
            window.ldssShowToast({
                title: tone === "danger" ? "Special Consideration Error" : "Special Consideration",
                message: message,
                variant: tone,
                delay: tone === "danger" ? 4200 : 3200
            });
            return;
        }
        showLocalStatusToast(message, tone);
    }

    function specialStatusToastMeta(tone) {
        if (tone === "success") {
            return { title: "Special Consideration Saved", badgeClass: "bg-success", badgeText: "Saved" };
        }
        if (tone === "warning") {
            return { title: "Special Consideration Notice", badgeClass: "bg-warning text-dark", badgeText: "Notice" };
        }
        if (tone === "danger") {
            return { title: "Special Consideration Error", badgeClass: "bg-danger", badgeText: "Error" };
        }
        return { title: "Special Consideration", badgeClass: "bg-primary", badgeText: "Info" };
    }

    function ensureLocalStatusToast() {
        let viewport = byId("specialConsiderationToastViewport");
        let toastEl = byId("specialConsiderationToast");

        if (!viewport) {
            viewport = document.createElement("div");
            viewport.id = "specialConsiderationToastViewport";
            viewport.className = "toast-container position-fixed top-0 end-0 p-3";
            viewport.style.zIndex = "1085";
            document.body.appendChild(viewport);
        }

        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.id = "specialConsiderationToast";
            toastEl.className = "toast border-0 shadow-sm bg-white";
            toastEl.setAttribute("role", "status");
            toastEl.setAttribute("aria-live", "polite");
            toastEl.setAttribute("aria-atomic", "true");
            toastEl.innerHTML = [
                '<div class="toast-header bg-white">',
                '<span class="badge rounded-pill bg-primary me-2" id="specialConsiderationToastBadge">Info</span>',
                '<strong class="me-auto" id="specialConsiderationToastTitle">Special Consideration</strong>',
                '<button class="btn-close ms-2 mb-1" type="button" data-bs-dismiss="toast" aria-label="Close"></button>',
                "</div>",
                '<div class="toast-body" id="specialConsiderationToastBody"></div>'
            ].join("");
            viewport.appendChild(toastEl);
        }

        if (!specialStatusToastInstance && window.bootstrap && typeof window.bootstrap.Toast === "function") {
            specialStatusToastInstance = new window.bootstrap.Toast(toastEl, {
                autohide: true,
                delay: 3200
            });
        }

        return {
            toastEl: toastEl,
            badge: byId("specialConsiderationToastBadge"),
            title: byId("specialConsiderationToastTitle"),
            body: byId("specialConsiderationToastBody")
        };
    }

    function showLocalStatusToast(message, tone) {
        const refs = ensureLocalStatusToast();
        const meta = specialStatusToastMeta(tone);

        if (!refs || !refs.toastEl || !refs.badge || !refs.title || !refs.body || !message) {
            return;
        }

        refs.badge.className = "badge rounded-pill me-2 " + meta.badgeClass;
        refs.badge.textContent = meta.badgeText;
        refs.title.textContent = meta.title;
        refs.body.textContent = message;

        if (specialStatusToastInstance) {
            specialStatusToastInstance.show();
            return;
        }

        refs.toastEl.classList.add("show");
        window.setTimeout(function () {
            refs.toastEl.classList.remove("show");
        }, 3200);
    }

    function setText(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
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

    function upperText(value) {
        return (value || "").toString().trim().toUpperCase();
    }

    function normalizeStatus(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    function formatStatusLabel(value) {
        const normalized = normalizeStatus(value);
        if (!normalized) {
            return "-";
        }
        return normalized.replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); });
    }

    function knownSpecialTag(value) {
        const normalized = normalizeStatus(value);
        return SPECIAL_TAG_OPTIONS.some(function (option) {
            return option.value === normalized;
        });
    }

    function normalizeSpecialTag(value) {
        const raw = normalizeStatus(value);
        if (!raw) {
            return "";
        }
        if (raw === LEGACY_RESERVED_SLOT_TAG) {
            return DEFAULT_SPECIAL_TAG;
        }
        if (raw === "internal review" || raw === "priority review") {
            return "internal_review";
        }
        if (raw === "endorse" || raw === "indorse" || raw === "endorsed") {
            return "internal_review";
        }
        if (raw === "for approval") {
            return "for_approval";
        }
        return knownSpecialTag(raw) ? raw : "";
    }

    function specialTagLabel(value) {
        const normalized = normalizeSpecialTag(value);
        const match = SPECIAL_TAG_OPTIONS.find(function (option) {
            return option.value === normalized;
        });
        return match ? match.label : "Priority Review";
    }

    function specialTagOptionsMarkup(selectedValue) {
        const normalized = normalizeSpecialTag(selectedValue) || DEFAULT_SPECIAL_TAG;
        return SPECIAL_TAG_OPTIONS.map(function (option) {
            const selected = option.value === normalized ? ' selected' : '';
            return '<option value="' + escapeHtml(option.value) + '"' + selected + '>' + escapeHtml(option.label) + '</option>';
        }).join("");
    }

    function normalizeSpecialLabel(value) {
        return (value || "").toString().trim().replace(/\s+/g, " ").slice(0, 120);
    }

    function decodeSpecialTag(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return { level: "", label: "" };
        }
        if (raw === LEGACY_RESERVED_SLOT_TAG) {
            return { level: DEFAULT_SPECIAL_TAG, label: "" };
        }

        const delimiterIndex = raw.indexOf(SPECIAL_TAG_DELIMITER);
        if (delimiterIndex >= 0) {
            const level = normalizeSpecialTag(raw.slice(0, delimiterIndex));
            const label = normalizeSpecialLabel(raw.slice(delimiterIndex + SPECIAL_TAG_DELIMITER.length));
            if (level) {
                return { level: level, label: label };
            }
        }

        return {
            level: normalizeSpecialTag(raw),
            label: ""
        };
    }

    function encodeSpecialTag(level, label) {
        const normalizedLevel = normalizeSpecialTag(level) || DEFAULT_SPECIAL_TAG;
        const normalizedLabel = normalizeSpecialLabel(label);
        return normalizedLabel
            ? (normalizedLevel + SPECIAL_TAG_DELIMITER + normalizedLabel)
            : normalizedLevel;
    }

    function buildApplicantName(profile) {
        if (!profile || typeof profile !== "object") {
            return "";
        }
        return [
            upperText(profile.first_name || ""),
            upperText(profile.middle_name || ""),
            upperText(profile.last_name || "")
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    function formatBarangayPrintValue(value) {
        const raw = (value || "").toString().trim().replace(/\s+/g, " ");
        if (!raw) {
            return "-";
        }
        if (/^barangay\s+/i.test(raw)) {
            return raw;
        }
        if (/^brgy\.?\s+/i.test(raw)) {
            return raw.replace(/^brgy\.?\s+/i, "Barangay ");
        }
        return "Barangay " + raw;
    }

    function formatSectorPrintValue(value) {
        const raw = (value || "").toString().trim().replace(/\s+/g, " ");
        if (!raw || /^(none of the above|none|n\/a|na|unspecified)$/i.test(raw)) {
            return "";
        }
        return raw;
    }

    function barangaySectorPrintParts(row) {
        return {
            barangay: formatBarangayPrintValue(row && row.applicant_barangay ? row.applicant_barangay : ""),
            sector: formatSectorPrintValue(row && row.sector_classification ? row.sector_classification : "")
        };
    }

    function formatApplicationPrintValue(row) {
        const applicationNo = row && row.application_no ? row.application_no : "-";
        return "Application " + applicationNo;
    }

    function toPrintTitleCase(value) {
        return (value || "").toString().trim().replace(/\s+/g, " ").toLowerCase().replace(/\b[a-z]/g, function (char) {
            return char.toUpperCase();
        }).replace(/\bPwd\b/g, "PWD");
    }

    function formatCareOfPrintValue(value) {
        const raw = (value || "").toString().trim().replace(/\s+/g, " ");
        if (!raw) {
            return "-";
        }
        if (/^m\.?\s*o\.?$/i.test(raw) || /^mayors?\s+office$/i.test(raw)) {
            return "Mayor Office";
        }
        return toPrintTitleCase(raw);
    }

    function specialCarePrintParts(row) {
        return {
            careOf: formatCareOfPrintValue(row && row.special_label ? row.special_label : ""),
            status: toPrintTitleCase(specialTagLabel(row && row.special_level ? row.special_level : ""))
        };
    }

    function formatSpecialCarePrintValue(row) {
        const parts = specialCarePrintParts(row);
        return [parts.careOf, parts.status].filter(Boolean).join("\n") || "-";
    }

    function formatDateDisplay(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value + "T12:00:00");
        if (Number.isNaN(parsed.getTime())) {
            return value;
        }
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    function formatRawScoreValue(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "-";
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return String(value);
        }
        return Number.isInteger(numeric) ? String(numeric) : String(numeric);
    }

    function formatRankValue(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return "-";
        }
        return String(Math.max(0, Math.trunc(numeric)));
    }

    function compareRoomLabels(left, right) {
        return (left || "").toString().localeCompare((right || "").toString(), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function hasSavedRawScore(value) {
        return value !== null && typeof value !== "undefined" && value !== "" && Number.isFinite(Number(value));
    }

    function choosePreferredExamRecord(currentRecord, nextRecord) {
        if (!currentRecord) {
            return nextRecord;
        }
        if (!nextRecord) {
            return currentRecord;
        }

        const currentHasScore = hasSavedRawScore(currentRecord.raw_score);
        const nextHasScore = hasSavedRawScore(nextRecord.raw_score);
        if (nextHasScore !== currentHasScore) {
            return nextHasScore ? nextRecord : currentRecord;
        }

        const currentStamp = new Date(currentRecord.updated_at || 0).getTime();
        const nextStamp = new Date(nextRecord.updated_at || 0).getTime();
        return nextStamp > currentStamp ? nextRecord : currentRecord;
    }

    function assignDisplayRanks(sourceRows) {
        let lastScore = null;
        let lastRank = 0;

        return (sourceRows || []).map(function (row, index) {
            const score = row.raw_score_value;
            const displayRank = index > 0 && score === lastScore ? lastRank : (index + 1);
            lastScore = score;
            lastRank = displayRank;
            return Object.assign({}, row, {
                display_rank: displayRank
            });
        });
    }

    function sortCandidatesForRanking(sourceRows) {
        return (sourceRows || []).slice().sort(function (left, right) {
            if (right.raw_score_value !== left.raw_score_value) {
                return right.raw_score_value - left.raw_score_value;
            }

            const roomCompare = compareRoomLabels(left.room_label || "", right.room_label || "");
            if (roomCompare !== 0) {
                return roomCompare;
            }

            const leftSeat = Number(left.room_seat_no || 0);
            const rightSeat = Number(right.room_seat_no || 0);
            if (leftSeat !== rightSeat) {
                return leftSeat - rightSeat;
            }

            return String(left.application_no || "").localeCompare(String(right.application_no || ""), undefined, {
                numeric: true,
                sensitivity: "base"
            });
        });
    }

    function rankMapForSpecialCandidates(sourceRows, schoolYear) {
        const rankedRows = assignDisplayRanks(sortCandidatesForRanking((sourceRows || []).filter(function (row) {
            return row && row.school_year === schoolYear && hasSavedRawScore(row.raw_score_value);
        }).map(function (row) {
            return Object.assign({}, row, {
                raw_score_value: Number(row.raw_score_value)
            });
        })));
        const rankMap = {};

        rankedRows.forEach(function (row) {
            rankMap[row.id] = row.display_rank;
        });

        return rankMap;
    }

    function specialPrintLogoUrl() {
        return new URL("../img/daet-lgu.png", window.location.href).href;
    }

    let specialPrintLogoDataUrlPromise = null;

    function loadSpecialPrintLogoDataUrl() {
        if (specialPrintLogoDataUrlPromise) {
            return specialPrintLogoDataUrlPromise;
        }

        specialPrintLogoDataUrlPromise = new Promise(function (resolve) {
            const image = new Image();
            image.onload = function () {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = image.naturalWidth || image.width || 1;
                    canvas.height = image.naturalHeight || image.height || 1;
                    const context2d = canvas.getContext("2d");
                    if (!context2d) {
                        resolve("");
                        return;
                    }
                    context2d.drawImage(image, 0, 0);
                    resolve(canvas.toDataURL("image/png"));
                } catch (_error) {
                    resolve("");
                }
            };
            image.onerror = function () {
                resolve("");
            };
            image.src = specialPrintLogoUrl();
        });

        return specialPrintLogoDataUrlPromise;
    }

    function specialTagTone(value) {
        const normalized = normalizeSpecialTag(value) || DEFAULT_SPECIAL_TAG;
        if (normalized === "for_approval") {
            return "for_approval";
        }
        return "internal_review";
    }

    function renderFlowChip() {
        const chip = byId("specialConsiderationFlowChip");
        if (!chip) {
            return;
        }
        const enabled = flowEnabled();
        chip.className = "ldss-chip " + (enabled ? "ldss-chip-accent" : "ldss-chip-neutral");
        chip.textContent = enabled ? "Flow Enabled" : "Flow Disabled";
    }

    function specialTagBadgeMarkup(level) {
        const normalizedLevel = normalizeSpecialTag(level) || DEFAULT_SPECIAL_TAG;
        return '<span class="ldss-special-category-badge ldss-special-category-badge-' + escapeHtml(specialTagTone(normalizedLevel)) + '">' + escapeHtml(specialTagLabel(normalizedLevel)) + "</span>";
    }

    function rowSpecialValue(row) {
        return encodeSpecialTag(row && row.special_level ? row.special_level : "", row && row.special_label ? row.special_label : "");
    }

    function specialOptionEntries() {
        const source = currentControls().special_consideration_options;
        const rawEntries = Array.isArray(source)
            ? source
            : (typeof source === "string" ? source.split(/\r?\n|\|/) : []);
        const seen = new Set();

        return rawEntries.map(function (entry) {
            const decoded = decodeSpecialTag(entry);
            if (!decoded.level || !decoded.label) {
                return null;
            }
            const value = encodeSpecialTag(decoded.level, decoded.label);
            const key = value.toLowerCase();
            if (seen.has(key)) {
                return null;
            }
            seen.add(key);
            return {
                value: value,
                level: decoded.level,
                label: decoded.label
            };
        }).filter(Boolean);
    }

    function normalizeSpecialOptionValues(values) {
        const seen = new Set();
        const output = [];

        (Array.isArray(values) ? values : []).forEach(function (value) {
            const decoded = decodeSpecialTag(value);
            if (!decoded.level || !decoded.label) {
                return;
            }
            const encoded = encodeSpecialTag(decoded.level, decoded.label);
            const key = encoded.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            output.push(encoded);
        });

        return output;
    }

    function specialOptionLabel(entry) {
        if (!entry) {
            return "";
        }
        return entry.label + " - " + specialTagLabel(entry.level);
    }

    function specialOptionSelectMarkup(selectedValue) {
        const options = specialOptionEntries();
        const selectedKey = (selectedValue || "").toString().trim().toLowerCase();
        const selectedExists = options.some(function (entry) {
            return entry.value.toLowerCase() === selectedKey;
        });
        const fallbackOption = !selectedExists ? decodeSpecialTag(selectedValue) : null;
        const output = [];

        if (fallbackOption && fallbackOption.level && fallbackOption.label) {
            output.push(
                '<option value="' + escapeHtml(encodeSpecialTag(fallbackOption.level, fallbackOption.label)) + '" selected>'
                + escapeHtml(fallbackOption.label + " - " + specialTagLabel(fallbackOption.level) + " (Current)")
                + "</option>"
            );
        }

        options.forEach(function (entry) {
            const selected = entry.value.toLowerCase() === selectedKey ? ' selected' : '';
            output.push(
                '<option value="' + escapeHtml(entry.value) + '"' + selected + '>'
                + escapeHtml(specialOptionLabel(entry))
                + "</option>"
            );
        });

        return output.join("");
    }

    function renderOptionCatalog() {
        const target = byId("specialConsiderationCatalogList");
        const schoolYear = currentSchoolYear();
        const options = specialOptionEntries();

        if (!target) {
            return;
        }
        if (!schoolYear) {
            target.innerHTML = '<div class="px-3 pb-3 pt-3 small text-muted">Save Scholarship Settings first to set the active school year.</div>';
            return;
        }
        if (!options.length) {
            target.innerHTML = '<div class="px-3 pb-3 pt-3 small text-muted">No saved Special Consideration entries yet. Click Add Special Consideration first.</div>';
            return;
        }

        target.innerHTML = options.map(function (entry) {
            return [
                '<div class="ldss-special-option-row">',
                '<div>',
                '<div class="ldss-special-option-name">' + escapeHtml(entry.label) + "</div>",
                "</div>",
                '<div class="ldss-special-option-actions">',
                specialTagBadgeMarkup(entry.level),
                '<button class="btn btn-outline-dark btn-sm" type="button" data-special-option-delete="' + escapeHtml(entry.value) + '">Delete</button>',
                "</div>",
                "</div>"
            ].join("");
        }).join("");
    }

    function editModalInstance() {
        const modalEl = byId("specialConsiderationEditModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        return window.bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    function catalogModalInstance() {
        const modalEl = byId("specialConsiderationCatalogModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        return window.bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    function openCatalogModal() {
        const modal = catalogModalInstance();
        const labelInput = byId("specialConsiderationOptionLabel");
        const levelSelect = byId("specialConsiderationOptionLevel");

        if (!modal) {
            return;
        }
        if (labelInput) {
            labelInput.value = "";
        }
        if (levelSelect) {
            levelSelect.value = DEFAULT_SPECIAL_TAG;
        }
        modal.show();
    }

    function openEditModal(applicationId) {
        const row = specialApplicationsById[applicationId];
        const modal = editModalInstance();
        const applicationInput = byId("specialConsiderationEditApplicationId");
        const applicantName = byId("specialConsiderationEditApplicantName");
        const applicationMeta = byId("specialConsiderationEditApplicationMeta");
        const optionSelect = byId("specialConsiderationEditOption");

        if (!row || !modal || !applicationInput || !applicantName || !applicationMeta || !optionSelect) {
            return;
        }
        if (!specialOptionEntries().length) {
            showManagerStatus("Add Special Consideration first before assigning a student.", "alert-warning");
            return;
        }

        applicationInput.value = applicationId;
        applicantName.textContent = row.applicant_name || "Unknown Applicant";
        applicationMeta.textContent = (row.application_no || "-") + " | " + formatStatusLabel(row.status);
        optionSelect.innerHTML = specialOptionSelectMarkup(rowSpecialValue(row));
        modal.show();
    }

    function syncManagerState() {
        const searchInput = byId("specialConsiderationSearchInput");
        const meta = byId("specialConsiderationMeta");
        const schoolYear = currentSchoolYear();
        const addOptionButton = byId("specialConsiderationAddOption");
        const controlsDisabled = !specialFlagsAvailable || !schoolYear;

        if (searchInput) {
            searchInput.disabled = !specialFlagsAvailable || !schoolYear;
        }
        if (addOptionButton) {
            addOptionButton.disabled = controlsDisabled;
        }

        if (meta) {
            meta.classList.remove("d-none");
            if (!schoolYear) {
                meta.textContent = "Save Scholarship Settings first to set the active school year.";
            } else if (!specialFlagsAvailable) {
                meta.textContent = "Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.";
            } else if (!specialOptionEntries().length) {
                meta.textContent = "Click Add Special Consideration first, then search a student to assign one of those saved entries.";
            } else if (!flowEnabled()) {
                meta.textContent = "Special consideration flow is currently off. You can still prepare the list below, then enable the switch when the office is ready.";
            } else {
                meta.textContent = "";
                meta.classList.add("d-none");
            }
        }

        renderFlowChip();
        renderOptionCatalog();
        renderSpecialCounters();
    }

    function applySettingsRecord(record) {
        const safeRecord = record || {
            school_year: "",
            ranking_basis: {
                controls: {
                    allow_secretary_special_consideration: false
                }
            }
        };
        const controls = safeRecord.ranking_basis && safeRecord.ranking_basis.controls
            ? safeRecord.ranking_basis.controls
            : {};
        const toggle = byId("specialConsiderationFlowToggle");

        activeSettingsRecord = cloneSettings(safeRecord);
        if (toggle) {
            toggle.checked = Boolean(controls.allow_secretary_special_consideration);
            toggle.dataset.savedValue = toggle.checked ? "1" : "0";
        }

        syncManagerState();
    }

    function specialRows() {
        return specialCandidates
            .filter(function (row) { return row.is_reserved_slot; })
            .sort(function (left, right) {
                const leftStamp = new Date(left.flag_updated_at || left.updated_at || left.created_at || 0).getTime();
                const rightStamp = new Date(right.flag_updated_at || right.updated_at || right.created_at || 0).getTime();
                return rightStamp - leftStamp;
            });
    }

    function specialCounterSnapshot(sourceRows) {
        const rows = Array.isArray(sourceRows) ? sourceRows : specialRows();
        const snapshot = {
            tagged: rows.length,
            priority: 0,
            approval: 0,
            available: specialCandidates.filter(function (row) {
                return !row.is_reserved_slot;
            }).length
        };

        rows.forEach(function (row) {
            const level = normalizeSpecialTag(row && row.special_level ? row.special_level : "");
            if (level === "for_approval") {
                snapshot.approval += 1;
            } else {
                snapshot.priority += 1;
            }
        });

        return snapshot;
    }

    function specialPrintTagEntries() {
        const seen = new Map();

        specialRows().forEach(function (row) {
            const label = normalizeSpecialLabel(row && row.special_label ? row.special_label : "");
            if (!label) {
                return;
            }

            const key = label.toLowerCase();
            const existing = seen.get(key) || {
                key: key,
                label: formatCareOfPrintValue(label),
                count: 0
            };

            existing.count += 1;
            seen.set(key, existing);
        });

        return Array.from(seen.values()).sort(function (left, right) {
            return left.label.localeCompare(right.label);
        });
    }

    function specialPrintTagSelect() {
        return byId("specialConsiderationPrintTag");
    }

    function specialPrintSelectedKey() {
        const select = specialPrintTagSelect();
        return normalizeSpecialLabel(select ? select.value : "").toLowerCase();
    }

    function specialPrintSelectedEntry() {
        const key = specialPrintSelectedKey();
        if (!key) {
            return null;
        }
        return specialPrintTagEntries().find(function (entry) {
            return entry.key === key;
        }) || null;
    }

    function specialPassingScoreValue() {
        const value = Number(currentControls().passing_score);
        return Number.isFinite(value) ? value : null;
    }

    function specialRowPassedScore(row) {
        const passingScore = specialPassingScoreValue();
        const rawScore = row && hasSavedRawScore(row.raw_score_value) ? Number(row.raw_score_value) : null;

        return passingScore !== null && rawScore !== null && rawScore >= passingScore;
    }

    function specialPrintRows() {
        const key = specialPrintSelectedKey();
        const rows = specialRows();

        if (!key) {
            return rows;
        }

        return rows.filter(function (row) {
            return normalizeSpecialLabel(row && row.special_label ? row.special_label : "").toLowerCase() === key;
        });
    }

    function renderSpecialPrintTagSelect() {
        const select = specialPrintTagSelect();
        if (!select) {
            return;
        }

        const rows = specialRows();
        const entries = specialPrintTagEntries();
        const currentKey = normalizeSpecialLabel(select.value).toLowerCase();
        const hasCurrent = currentKey && entries.some(function (entry) {
            return entry.key === currentKey;
        });

        select.innerHTML = [
            '<option value="">All Tagged (' + escapeHtml(String(rows.length)) + ')</option>'
        ].concat(entries.map(function (entry) {
            return '<option value="' + escapeHtml(entry.key) + '">' + escapeHtml(entry.label + " (" + String(entry.count) + ")") + "</option>";
        })).join("");

        select.value = hasCurrent ? currentKey : "";
        select.disabled = rows.length === 0;
        select.title = rows.length === 0 ? "No tagged applicants are available yet." : "";
    }

    function renderSpecialCounters() {
        renderSpecialPrintTagSelect();
        const snapshot = specialCounterSnapshot();
        const printRows = specialPrintRows();
        const printButton = byId("specialConsiderationPrintBtn");
        const pdfButton = byId("specialConsiderationPdfBtn");

        setText("specialConsiderationTaggedCount", snapshot.tagged);
        setText("specialConsiderationPriorityCount", snapshot.priority);
        setText("specialConsiderationApprovalCount", snapshot.approval);
        setText("specialConsiderationAvailableCount", snapshot.available);

        if (printButton) {
            printButton.disabled = !currentSchoolYear() || printRows.length === 0;
        }
        if (pdfButton) {
            pdfButton.disabled = !currentSchoolYear() || printRows.length === 0;
        }
    }

    function pdfFileSlug(value, fallback) {
        const slug = (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || fallback;
    }

    function getPdfGenerator() {
        const jsPdfNamespace = window.jspdf || null;
        if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
            return null;
        }
        return jsPdfNamespace.jsPDF;
    }

    function specialSearchQuery() {
        return (byId("specialConsiderationSearchInput") ? byId("specialConsiderationSearchInput").value : "")
            .toString()
            .trim()
            .toLowerCase();
    }

    function matchesSpecialSearch(row, query) {
        const normalizedQuery = (query || "").toString().trim().toLowerCase();
        if (!normalizedQuery) {
            return true;
        }

        const haystack = [
            row && row.applicant_name ? row.applicant_name : "",
            row && row.application_no ? row.application_no : "",
            row && row.scholarship_type ? row.scholarship_type : "",
            row && row.status ? row.status : "",
            row && row.special_label ? row.special_label : "",
            row && row.special_level ? specialTagLabel(row.special_level) : ""
        ].join(" ").toLowerCase();

        return haystack.includes(normalizedQuery);
    }

    function setLoadingState(message) {
        const searchResults = byId("specialConsiderationSearchResults");
        const tableBody = byId("specialConsiderationTableBody");
        const safeMessage = escapeHtml(message || "Loading special consideration students...");

        if (searchResults) {
            searchResults.innerHTML = '<div class="px-3 pb-3 small text-muted">' + safeMessage + "</div>";
        }
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">' + safeMessage + "</td></tr>";
        }
        renderSpecialCounters();
    }

    async function fetchProfiles(context, applicantIds) {
        const profileMap = {};
        const ids = Array.isArray(applicantIds) ? applicantIds.filter(Boolean) : [];

        for (let index = 0; index < ids.length; index += PROFILE_BATCH_SIZE) {
            const batch = ids.slice(index, index + PROFILE_BATCH_SIZE);
            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, barangay")
                .in("id", batch);

            if (result.error) {
                throw new Error("Failed to load applicant names: " + result.error.message);
            }

            (result.data || []).forEach(function (profile) {
                if (profile && profile.id) {
                    profileMap[profile.id] = profile;
                }
            });
        }

        return profileMap;
    }

    async function fetchApplicationsForSpecialConsideration(context, schoolYear) {
        const rows = [];
        let start = 0;

        while (true) {
            const result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, school_year, scholarship_type, sector_classification, status, submitted_at, created_at, updated_at")
                .eq("school_year", schoolYear)
                .neq("status", "draft")
                .order("updated_at", { ascending: false })
                .range(start, start + SPECIAL_APPLICATION_BATCH_SIZE - 1);

            if (result.error) {
                throw new Error("Failed to load special consideration candidates: " + result.error.message);
            }

            const batch = Array.isArray(result.data) ? result.data : [];
            rows.push.apply(rows, batch);

            if (batch.length < SPECIAL_APPLICATION_BATCH_SIZE) {
                break;
            }

            start += SPECIAL_APPLICATION_BATCH_SIZE;
        }

        return rows;
    }

    async function fetchApplicationsByIds(context, applicationIds) {
        const rows = [];
        const ids = Array.isArray(applicationIds) ? applicationIds.filter(Boolean) : [];

        for (let index = 0; index < ids.length; index += SPECIAL_FLAG_BATCH_SIZE) {
            const batch = ids.slice(index, index + SPECIAL_FLAG_BATCH_SIZE);
            const result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, school_year, scholarship_type, sector_classification, status, submitted_at, created_at, updated_at")
                .in("id", batch);

            if (result.error) {
                throw new Error("Failed to load flagged special consideration applications: " + result.error.message);
            }

            rows.push.apply(rows, Array.isArray(result.data) ? result.data : []);
        }

        return rows;
    }

    async function fetchExamRecordsByApplicationIds(context, applicationIds) {
        const examMap = {};
        const ids = Array.isArray(applicationIds) ? applicationIds.filter(Boolean) : [];

        for (let index = 0; index < ids.length; index += SPECIAL_EXAM_LOOKUP_BATCH_SIZE) {
            const batch = ids.slice(index, index + SPECIAL_EXAM_LOOKUP_BATCH_SIZE);
            let result = await context.client
                .from("exam_records")
                .select("id, application_id, raw_score, result, updated_at, room_label, room_seat_no")
                .in("application_id", batch)
                .order("updated_at", { ascending: false });

            if (result.error && /room_label|room_seat_no/i.test(result.error.message || "")) {
                result = await context.client
                    .from("exam_records")
                    .select("id, application_id, raw_score, result, updated_at")
                    .in("application_id", batch)
                    .order("updated_at", { ascending: false });

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            room_label: "",
                            room_seat_no: null
                        });
                    });
                }
            }

            if (result.error) {
                throw new Error("Failed to load exam score records: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                const applicationId = row && row.application_id ? row.application_id : "";
                if (!applicationId) {
                    return;
                }
                examMap[applicationId] = choosePreferredExamRecord(examMap[applicationId] || null, row);
            });
        }

        return examMap;
    }

    async function fetchAllSpecialConsiderationFlags(context) {
        const flagMap = {};
        let start = 0;

        while (true) {
            const result = await context.client
                .from(APPLICATION_STAFF_FLAGS_TABLE)
                .select("application_id, special_consideration_tag, updated_at, created_at")
                .not("special_consideration_tag", "is", null)
                .order("updated_at", { ascending: false })
                .range(start, start + SPECIAL_FLAG_BATCH_SIZE - 1);

            if (result.error) {
                throw result.error;
            }

            const batch = Array.isArray(result.data) ? result.data : [];
            batch.forEach(function (row) {
                const applicationId = row && row.application_id ? row.application_id : "";
                const tag = (row && row.special_consideration_tag ? row.special_consideration_tag : "").toString().trim();
                if (!applicationId || !tag) {
                    return;
                }
                flagMap[applicationId] = {
                    tag: tag,
                    updated_at: row.updated_at || row.created_at || null
                };
            });

            if (batch.length < SPECIAL_FLAG_BATCH_SIZE) {
                break;
            }

            start += SPECIAL_FLAG_BATCH_SIZE;
        }

        return flagMap;
    }

    function renderSearchResults() {
        const target = byId("specialConsiderationSearchResults");
        const schoolYear = currentSchoolYear();
        const query = specialSearchQuery();
        const options = specialOptionEntries();

        if (!target) {
            return;
        }
        if (!schoolYear) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">Save Scholarship Settings first to set the active school year.</div>';
            return;
        }
        if (!specialFlagsAvailable) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">Special consideration storage is not installed yet.</div>';
            return;
        }
        if (!options.length) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">Add Special Consideration first, then search a student to assign one.</div>';
            return;
        }
        if (!specialCandidates.length) {
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">No application records were found for ' + escapeHtml(schoolYear) + ".</div>";
            return;
        }

        let matches = specialCandidates.filter(function (row) {
            return !row.is_reserved_slot;
        });
        let alreadyAllowedMatches = specialRows();

        if (query) {
            matches = matches.filter(function (row) {
                return matchesSpecialSearch(row, query);
            });
            alreadyAllowedMatches = alreadyAllowedMatches.filter(function (row) {
                return matchesSpecialSearch(row, query);
            });
        }

        matches = matches.slice(0, SPECIAL_RESULT_LIMIT);

        if (!matches.length) {
            if (query && alreadyAllowedMatches.length) {
                target.innerHTML = '<div class="px-3 pb-3 small text-muted">Matching student records are already on the allowed list below. Use the table action buttons there if you need to edit or remove them.</div>';
                return;
            }
            target.innerHTML = '<div class="px-3 pb-3 small text-muted">No matching students are available to add.</div>';
            return;
        }

        target.innerHTML = matches.map(function (row) {
            return [
                '<button class="ldss-special-item ldss-special-item-button" type="button" data-special-consideration-pick="' + escapeHtml(row.id) + '">',
                '<div class="ldss-special-item-copy">',
                '<div class="ldss-special-item-name">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>",
                '<div class="ldss-special-item-note">' + escapeHtml((row.application_no || "-") + " | " + formatStatusLabel(row.status) + " | " + (row.scholarship_type || "-")) + "</div>",
                "</div>",
                '<div class="ldss-special-item-actions">',
                '<span class="ldss-special-item-pick">Choose Saved Entry</span>',
                "</div>",
                "</button>"
            ].join("");
        }).join("");
    }

    function renderAllowedTable() {
        const tableBody = byId("specialConsiderationTableBody");
        const rows = specialRows();

        if (!tableBody) {
            return;
        }
        renderSpecialCounters();
        if (!currentSchoolYear()) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Save Scholarship Settings first to set the active school year.</td></tr>';
            return;
        }
        if (!specialFlagsAvailable) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.</td></tr>';
            return;
        }
        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No students are currently on the special consideration allow-list.</td></tr>';
            return;
        }

        tableBody.innerHTML = rows.map(function (row, index) {
            const applicantName = row.applicant_name || "Unknown Applicant";
            const applicantEmail = row.applicant_email || "";
            const scholarshipType = row.scholarship_type || "-";
            const applicationNo = row.application_no || "-";
            const updatedDate = formatDateDisplay((row.flag_updated_at || row.updated_at || "").slice(0, 10));
            const statusLabel = formatStatusLabel(row.status);
            const rankValue = formatRankValue(row.display_rank);
            const scoreValue = formatRawScoreValue(row.raw_score_value);
            const passingClass = specialRowPassedScore(row) ? " ldss-special-row-passing" : "";
            return [
                '<tr class="ldss-secretary-app-row' + passingClass + '" tabindex="0">',
                '<td class="ldss-special-col-no" data-label="No.">' + escapeHtml(String(index + 1)) + "</td>",
                '<td class="ldss-special-col-rank text-center" data-label="Rank"><div class="fw-600">' + escapeHtml(rankValue) + "</div></td>",
                '<td data-label="Applicant">',
                '<div class="ldss-queue-applicant">',
                '<div class="ldss-queue-applicant-body">',
                '<span class="ldss-queue-applicant-name ldss-table-ellipsis" title="' + escapeHtml(applicantName) + '">' + escapeHtml(applicantName) + "</span>",
                '<span class="ldss-queue-applicant-note">' + escapeHtml(applicantEmail || scholarshipType) + "</span>",
                "</div>",
                "</div>",
                "</td>",
                '<td data-label="Application">',
                '<div class="fw-600">' + escapeHtml(applicationNo) + "</div>",
                '<div class="small text-muted">' + escapeHtml((row.school_year || "-") + " | " + scholarshipType) + "</div>",
                "</td>",
                '<td class="ldss-special-col-score text-center" data-label="Score">',
                '<div class="fw-600">' + escapeHtml(scoreValue) + "</div>",
                '<div class="small text-muted">Saved raw score</div>',
                "</td>",
                '<td data-label="Category + Label">',
                specialTagBadgeMarkup(row.special_level),
                '<div class="ldss-special-table-label">' + escapeHtml(row.special_label || "-") + "</div>",
                "</td>",
                '<td data-label="Status">',
                '<span class="ldss-chip ldss-chip-neutral">' + escapeHtml(statusLabel) + "</span>",
                "</td>",
                '<td class="ldss-special-col-updated" data-label="Updated">',
                '<div class="fw-600">' + escapeHtml(updatedDate) + "</div>",
                '<div class="small text-muted">Latest tag update</div>',
                "</td>",
                '<td class="ldss-actions-cell text-end" data-label="Action">',
                '<div class="ldss-special-action-row">',
                '<button class="btn btn-dark btn-sm" type="button" data-special-consideration-edit="' + escapeHtml(row.id) + '">Edit</button>',
                '<button class="btn btn-outline-dark btn-sm" type="button" data-special-consideration-remove="' + escapeHtml(row.id) + '">Remove</button>',
                "</div>",
                "</td>",
                "</tr>"
            ].join("");
        }).join("");
    }

    function specialPrintSummaryLine(schoolYear, counts, filterLabel) {
        return [
            "School Year " + (schoolYear || "-"),
            filterLabel ? "Tag: " + filterLabel : "",
            "Total Tagged " + String(counts.tagged),
            "Priority Review " + String(counts.priority),
            "For Approval " + String(counts.approval)
        ].filter(Boolean).join(" | ");
    }

    function specialPrintTableHeadMarkup() {
        return (
            "<thead>" +
            "<tr>" +
            "<th>NO.</th>" +
            "<th>RANK</th>" +
            "<th>EXAMINEE</th>" +
            "<th>BARANGAY / SECTOR</th>" +
            "<th>SCORE</th>" +
            "<th>SPECIAL CONSIDERATION &amp; CARE OF</th>" +
            "</tr>" +
            "</thead>"
        );
    }

    function specialPrintTableRowMarkup(row, counter) {
        const specialParts = specialCarePrintParts(row);
        const locationParts = barangaySectorPrintParts(row);
        const careTone = specialTagTone(row && row.special_level ? row.special_level : "");
        const passingClass = specialRowPassedScore(row) ? " ldss-special-print-row-passing" : "";
        return (
            '<tr class="' + passingClass.trim() + '">' +
            '<td class="text-center"><span class="ldss-ranking-print-number">' + escapeHtml(String(counter)) + "</span></td>" +
            '<td class="text-center fw-700"><span class="ldss-ranking-print-number">' + escapeHtml(formatRankValue(row.display_rank)) + "</span></td>" +
            "<td>" +
            '<div class="fw-700 ldss-ranking-print-primary">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
            '<div class="small text-muted ldss-ranking-print-secondary">' + escapeHtml(formatApplicationPrintValue(row)) + "</div>" +
            "</td>" +
            "<td>" +
            '<div class="fw-700 ldss-ranking-print-primary">' + escapeHtml(locationParts.barangay) + "</div>" +
            (locationParts.sector ? '<div class="small text-muted ldss-ranking-print-secondary">' + escapeHtml(locationParts.sector) + "</div>" : "") +
            "</td>" +
            '<td class="text-center fw-700 ldss-special-print-score"><span class="ldss-ranking-print-value">' + escapeHtml(formatRawScoreValue(row.raw_score_value)) + "</span></td>" +
            '<td class="text-center ldss-special-print-care ldss-special-print-care-' + escapeHtml(careTone) + '">' +
            '<div class="fw-700 ldss-ranking-print-primary">' + escapeHtml(specialParts.careOf) + "</div>" +
            '<div class="small ldss-ranking-print-secondary">' + escapeHtml(specialParts.status) + "</div>" +
            "</td>" +
            "</tr>"
        );
    }

    function clearSpecialPrintPages() {
        const container = byId("specialConsiderationPrintPages");
        if (container) {
            container.innerHTML = "";
        }
    }

    function renderSpecialPrintPages(rows, filterLabel) {
        const container = byId("specialConsiderationPrintPages");
        const printRows = Array.isArray(rows) ? rows : specialPrintRows();
        const schoolYear = currentSchoolYear();
        const counts = specialCounterSnapshot(printRows);
        const printedAt = new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });

        if (!container) {
            return false;
        }

        if (!printRows.length) {
            container.innerHTML = "";
            return false;
        }

        const summary = specialPrintSummaryLine(schoolYear, counts, filterLabel || "");
        const titleSuffix = filterLabel ? " - " + filterLabel : "";
        container.innerHTML = [
            '<section class="ldss-special-print-document">',
            '<div class="ldss-special-print-header">',
            '<div class="ldss-special-print-brand">',
            '<img class="ldss-special-print-logo" src="' + escapeHtml(specialPrintLogoUrl()) + '" alt="LGU Daet Logo" />',
            '<div class="ldss-special-print-brand-copy">',
            '<div class="ldss-special-print-title">LDSP Special Consideration Tagged Applicants' + escapeHtml(titleSuffix) + '</div>',
            '<div class="ldss-special-print-copy">' + escapeHtml(summary) + "</div>",
            '<div class="ldss-special-print-copy">' + escapeHtml("Printed " + printedAt) + "</div>",
            "</div>",
            "</div>",
            "</div>",
            '<table class="table mb-0 ldss-special-print-table">',
            specialPrintTableHeadMarkup(),
            "<tbody>",
            printRows.map(function (row, index) {
                return specialPrintTableRowMarkup(row, index + 1);
            }).join(""),
            "</tbody></table>",
            "</section>"
        ].join("");

        return true;
    }

    function printAllowedTable() {
        const rows = specialPrintRows();
        const selectedEntry = specialPrintSelectedEntry();

        if (!rows.length) {
            clearSpecialPrintPages();
            showManagerStatus(
                selectedEntry
                    ? "No tagged applicants match the selected tag yet."
                    : "No tagged applicants are available to print yet.",
                "alert-warning"
            );
            return;
        }

        if (!renderSpecialPrintPages(rows, selectedEntry ? selectedEntry.label : "")) {
            showManagerStatus("The print layout could not be prepared right now.", "alert-warning");
            return;
        }

        window.print();
    }

    async function downloadAllowedPdf() {
        const rows = specialPrintRows();
        const selectedEntry = specialPrintSelectedEntry();
        const schoolYear = currentSchoolYear();
        const counts = specialCounterSnapshot(rows);
        const printedAt = new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });

        if (!rows.length) {
            showManagerStatus(
                selectedEntry
                    ? "No tagged applicants match the selected tag yet."
                    : "No tagged applicants are available for PDF download yet.",
                "alert-warning"
            );
            return;
        }

        const JsPdf = getPdfGenerator();
        if (!JsPdf) {
            showManagerStatus("The PDF library is not available right now, so the print view will open instead.", "alert-warning");
            printAllowedTable();
            return;
        }

        try {
            const doc = new JsPdf({
                orientation: "portrait",
                unit: "pt",
                format: [612, 936]
            });

            if (typeof doc.autoTable !== "function") {
                showManagerStatus("The PDF table helper is not available right now, so the print view will open instead.", "alert-warning");
                printAllowedTable();
                return;
            }

            const pageWidth = doc.internal.pageSize.getWidth();
            const left = 18;
            const logoDataUrl = await loadSpecialPrintLogoDataUrl();
            const filterLabel = selectedEntry ? selectedEntry.label : "";
            const summary = specialPrintSummaryLine(schoolYear, counts, filterLabel);
            const titleSuffix = filterLabel ? " - " + filterLabel : "";

            if (logoDataUrl) {
                doc.addImage(logoDataUrl, "PNG", left, 14, 47, 47);
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(15, 23, 42);
            doc.text("LDSP Special Consideration Tagged Applicants" + titleSuffix, left + 55, 30);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(75, 85, 99);
            doc.text(summary, left + 55, 46);
            doc.text("Printed: " + printedAt, left + 55, 59);
            doc.text("LDSP LGU Daet Scholarship System", pageWidth - left, 30, { align: "right" });
            doc.text("System Administrator Workspace", pageWidth - left, 44, { align: "right" });

            doc.autoTable({
                startY: 76,
                head: [["NO.", "RANK", "EXAMINEE", "BARANGAY / SECTOR", "SCORE", "SPECIAL CONSIDERATION & CARE OF"]],
                body: rows.map(function (row, index) {
                    const locationParts = barangaySectorPrintParts(row);
                    return [
                        String(index + 1),
                        formatRankValue(row.display_rank),
                        [row.applicant_name || "Unknown Applicant", formatApplicationPrintValue(row)].join("\n"),
                        [locationParts.barangay, locationParts.sector].filter(Boolean).join("\n"),
                        formatRawScoreValue(row.raw_score_value),
                        formatSpecialCarePrintValue(row)
                    ];
                }),
                margin: { left: left, right: left },
                styles: {
                    font: "helvetica",
                    fontSize: 8.25,
                    cellPadding: 2.8,
                    lineColor: [148, 163, 184],
                    lineWidth: 0.5,
                    textColor: [15, 23, 42],
                    overflow: "ellipsize",
                    valign: "middle"
                },
                headStyles: {
                    fillColor: [226, 232, 240],
                    textColor: [15, 23, 42],
                    fontStyle: "bold",
                    fontSize: 9.2
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: 23, halign: "center", fontStyle: "bold" },
                    1: { cellWidth: 30, halign: "center", fontStyle: "bold" },
                    2: { cellWidth: 184, fontStyle: "bold" },
                    3: { cellWidth: 112 },
                    4: { cellWidth: 36, halign: "center", fontStyle: "bold" },
                    5: { cellWidth: 191, halign: "center", fontStyle: "bold" }
                },
                didParseCell: function (data) {
                    if (data.section !== "body") {
                        return;
                    }
                    if (specialRowPassedScore(rows[data.row.index] || {})) {
                        data.cell.styles.fillColor = [236, 253, 245];
                        data.cell.styles.textColor = [15, 23, 42];
                    }
                    if (data.column.index === 4) {
                        data.cell.styles.fontStyle = "bold";
                    }
                    if (data.column.index === 5) {
                        const sourceRow = rows[data.row.index] || {};
                        const specialParts = specialCarePrintParts(sourceRow);
                        data.cell.styles.halign = "center";
                        data.cell.styles.valign = "top";
                        data.cell.styles.fontStyle = "bold";
                        data.cell.styles.textColor = [15, 23, 42];
                        data.cell.styles.minCellHeight = 20;
                        data.cell.styles.cellPadding = {
                            top: 2.8,
                            right: 2.8,
                            bottom: 8.2,
                            left: 2.8
                        };
                        data.cell.text = [specialParts.careOf];
                    }
                },
                didDrawCell: function (data) {
                    if (data.section !== "body" || data.column.index !== 5) {
                        return;
                    }
                    const sourceRow = rows[data.row.index] || {};
                    const specialParts = specialCarePrintParts(sourceRow);
                    const tone = specialTagTone(sourceRow.special_level || "");
                    const statusColor = tone === "for_approval" ? [180, 83, 9] : [21, 128, 61];

                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(6.9);
                    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
                    doc.text(
                        specialParts.status,
                        data.cell.x + (data.cell.width / 2),
                        data.cell.y + data.cell.height - 4.4,
                        { align: "center" }
                    );
                    doc.setTextColor(15, 23, 42);
                }
            });

            doc.save("ldss-special-consideration" + (filterLabel ? "-" + pdfFileSlug(filterLabel, "selected-tag") : "") + "-" + pdfFileSlug(schoolYear, "active-school-year") + ".pdf");
            showManagerStatus("Special consideration PDF downloaded successfully.", "alert-success");
        } catch (error) {
            showManagerStatus(error && error.message ? error.message : "Failed to build the special consideration PDF.", "alert-danger");
        }
    }

    async function writeAuditEntry(context, entry) {
        const helper = auditHelper();
        if (!helper || !context) {
            return { ok: false, skipped: "missing_helper" };
        }

        try {
            return await helper.logEvent(context, entry);
        } catch (_error) {
            return { ok: false, skipped: "write_failed" };
        }
    }

    async function loadActiveSettings(context) {
        showPageStatus("");

        const fallback = readFallbackStorage();
        const result = await context.client
            .from("ranking_settings")
            .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                applySettingsRecord(cloneSettings(fallback));
                showPageStatus("Using local fallback only. Open Scholarship Settings after the ranking settings table is installed.", "alert-warning");
                return;
            }
            throw new Error("Failed to load scholarship settings: " + result.error.message);
        }

        const active = result.data && result.data.length > 0 ? result.data[0] : null;
        if (!active) {
            applySettingsRecord(cloneSettings(fallback));
            showPageStatus("No active Scholarship Settings record yet. Save Scholarship Settings first to set the active school year.", "alert-warning");
            return;
        }

        applySettingsRecord(active);
    }

    async function saveFlowSetting(context) {
        const toggle = byId("specialConsiderationFlowToggle");
        const previousValue = toggle && toggle.dataset.savedValue === "1";
        const nextValue = toggle ? Boolean(toggle.checked) : false;

        if (!currentSchoolYear()) {
            if (toggle) {
                toggle.checked = Boolean(previousValue);
            }
            syncManagerState();
            showPageStatus("No active Scholarship Settings record yet. Save Scholarship Settings first to set the active school year.", "alert-warning");
            return;
        }

        if (toggle) {
            toggle.disabled = true;
        }

        try {
            const rankingBasis = cloneSettings(activeSettingsRecord && activeSettingsRecord.ranking_basis ? activeSettingsRecord.ranking_basis : {}) || {};
            const controls = Object.assign({}, rankingBasis.controls || {});
            const schoolYear = currentSchoolYear();
            let savedToFallbackOnly = false;
            controls.allow_secretary_special_consideration = nextValue;
            if (!Array.isArray(controls.special_consideration_options)) {
                controls.special_consideration_options = [];
            }
            rankingBasis.controls = controls;

            if (activeSettingsRecord && activeSettingsRecord.id) {
                const payload = Object.assign({}, activeSettingsRecord, {
                    ranking_basis: rankingBasis,
                    is_active: true,
                    managed_by: context.user.id
                });
                const result = await context.client
                    .from("ranking_settings")
                    .upsert(payload, { onConflict: "school_year" })
                    .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
                    .single();

                if (result.error) {
                    throw new Error("Failed to save special consideration flow: " + result.error.message);
                }

                activeSettingsRecord = cloneSettings(result.data);
                writeFallbackStorage(result.data);
            } else {
                activeSettingsRecord = Object.assign({}, cloneSettings(activeSettingsRecord) || {}, {
                    school_year: schoolYear,
                    ranking_basis: rankingBasis
                });
                writeFallbackStorage(activeSettingsRecord);
                savedToFallbackOnly = true;
            }

            applySettingsRecord(activeSettingsRecord);

            if (nextValue) {
                if (savedToFallbackOnly) {
                    showPageStatus("Saved to local fallback only. Open Scholarship Settings after database persistence is ready.", "alert-warning");
                } else {
                    showPageStatus("");
                }
                showFlowModal("specialConsiderationEnabledModal");
            } else {
                if (savedToFallbackOnly) {
                    showPageStatus("Saved to local fallback only. Open Scholarship Settings after database persistence is ready.", "alert-warning");
                } else {
                    showPageStatus("");
                }
                showFlowModal("specialConsiderationDisabledModal");
            }

            await writeAuditEntry(context, {
                module: "special_consideration",
                action: nextValue ? "enable_special_consideration_flow" : "disable_special_consideration_flow",
                recordType: "ranking_settings",
                recordId: activeSettingsRecord && activeSettingsRecord.id ? activeSettingsRecord.id : currentSchoolYear(),
                summary: (nextValue ? "Enabled" : "Disabled") + " special consideration flow for " + currentSchoolYear() + ".",
                details: {
                    school_year: currentSchoolYear(),
                    special_consideration_flow: nextValue
                }
            });
        } catch (error) {
            if (toggle) {
                toggle.checked = Boolean(previousValue);
            }
            syncManagerState();
            showPageStatus(error && error.message ? error.message : "Failed to save special consideration flow.", "alert-danger");
        } finally {
            if (toggle) {
                toggle.disabled = false;
            }
        }
    }

    async function persistSpecialOptionValues(context, nextOptionValues) {
        const schoolYear = currentSchoolYear();
        const normalizedValues = normalizeSpecialOptionValues(nextOptionValues);
        let savedToFallbackOnly = false;

        if (!schoolYear) {
            throw new Error("No active Scholarship Settings record yet. Save Scholarship Settings first to set the active school year.");
        }

        const rankingBasis = cloneSettings(activeSettingsRecord && activeSettingsRecord.ranking_basis ? activeSettingsRecord.ranking_basis : {}) || {};
        const controls = Object.assign({}, rankingBasis.controls || {});
        controls.special_consideration_options = normalizedValues;
        rankingBasis.controls = controls;

        if (activeSettingsRecord && activeSettingsRecord.id) {
            const payload = Object.assign({}, activeSettingsRecord, {
                ranking_basis: rankingBasis,
                is_active: true,
                managed_by: context.user.id
            });
            const result = await context.client
                .from("ranking_settings")
                .upsert(payload, { onConflict: "school_year" })
                .select("id, school_year, quota_slots, waitlist_slots, passing_score, exam_total_items, application_open_date, application_close_date, ranking_basis, is_active, created_at, updated_at")
                .single();

            if (result.error) {
                throw new Error("Failed to save Special Consideration entries: " + result.error.message);
            }

            activeSettingsRecord = cloneSettings(result.data);
            writeFallbackStorage(result.data);
        } else {
            activeSettingsRecord = Object.assign({}, cloneSettings(activeSettingsRecord) || {}, {
                school_year: schoolYear,
                ranking_basis: rankingBasis
            });
            writeFallbackStorage(activeSettingsRecord);
            savedToFallbackOnly = true;
        }

        applySettingsRecord(activeSettingsRecord);
        return {
            savedToFallbackOnly: savedToFallbackOnly
        };
    }

    async function saveSpecialOptionCatalog(context) {
        const labelInput = byId("specialConsiderationOptionLabel");
        const levelSelect = byId("specialConsiderationOptionLevel");
        const modal = catalogModalInstance();
        const normalizedLabel = normalizeSpecialLabel(labelInput ? labelInput.value : "");
        const normalizedLevel = normalizeSpecialTag(levelSelect ? levelSelect.value : DEFAULT_SPECIAL_TAG) || DEFAULT_SPECIAL_TAG;
        const nextValue = encodeSpecialTag(normalizedLevel, normalizedLabel);
        const existingValues = normalizeSpecialOptionValues(specialOptionEntries().map(function (entry) {
            return entry.value;
        }));

        if (!normalizedLabel) {
            throw new Error("Enter the Care Of / person / location first.");
        }
        if (existingValues.some(function (value) { return value.toLowerCase() === nextValue.toLowerCase(); })) {
            throw new Error("That Special Consideration entry already exists.");
        }

        const saveResult = await persistSpecialOptionValues(context, existingValues.concat(nextValue));
        renderSearchResults();
        renderOptionCatalog();
        showManagerStatus(
            saveResult.savedToFallbackOnly
                ? "Saved locally only. Open Scholarship Settings after database persistence is ready."
                : ("Added Special Consideration: " + normalizedLabel + " / " + specialTagLabel(normalizedLevel) + "."),
            saveResult.savedToFallbackOnly ? "alert-warning" : "alert-success"
        );

        if (labelInput) {
            labelInput.value = "";
        }
        if (levelSelect) {
            levelSelect.value = DEFAULT_SPECIAL_TAG;
        }
        if (modal) {
            modal.hide();
        }
    }

    async function deleteSpecialOptionCatalog(context, optionValue) {
        const normalizedValues = normalizeSpecialOptionValues(specialOptionEntries().map(function (entry) {
            return entry.value;
        }));
        const targetValue = (optionValue || "").toString().trim().toLowerCase();
        const nextValues = normalizedValues.filter(function (value) {
            return value.toLowerCase() !== targetValue;
        });

        if (nextValues.length === normalizedValues.length) {
            return;
        }

        const saveResult = await persistSpecialOptionValues(context, nextValues);
        renderSearchResults();
        renderOptionCatalog();
        showManagerStatus(
            saveResult.savedToFallbackOnly
                ? "Saved locally only. Open Scholarship Settings after database persistence is ready."
                : "Deleted Special Consideration entry.",
            saveResult.savedToFallbackOnly ? "alert-warning" : "alert-success"
        );
    }

    async function loadManager(context) {
        const schoolYear = currentSchoolYear();
        const loadToken = specialLoadToken + 1;
        specialLoadToken = loadToken;
        showManagerStatus("");

        if (!schoolYear) {
            specialCandidates = [];
            specialApplicationsById = {};
            setLoadingState("Save Scholarship Settings first to set the active school year.");
            syncManagerState();
            return;
        }

        setLoadingState("Loading special consideration student list...");

        if (loadToken !== specialLoadToken) {
            return;
        }

        let applicationRows = [];
        try {
            applicationRows = await fetchApplicationsForSpecialConsideration(context, schoolYear);
        } catch (error) {
            specialCandidates = [];
            specialApplicationsById = {};
            setLoadingState("Unable to load application records for this school year.");
            throw error;
        }

        if (loadToken !== specialLoadToken) {
            return;
        }
        let flagMap = {};
        if (specialFlagsAvailable) {
            try {
                flagMap = await fetchAllSpecialConsiderationFlags(context);
                specialFlagsAvailable = true;
            } catch (error) {
                if (/does not exist|relation|schema cache/i.test(error && error.message ? error.message : "")) {
                    specialFlagsAvailable = false;
                    showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
                } else {
                    throw new Error("Failed to load special consideration records: " + (error && error.message ? error.message : "Bad Request"));
                }
            }

            if (loadToken !== specialLoadToken) {
                return;
            }
        }

        if (specialFlagsAvailable) {
            const loadedApplicationIds = new Set(applicationRows.map(function (row) {
                return row && row.id ? row.id : "";
            }).filter(Boolean));
            const flaggedOnlyIds = Object.keys(flagMap).filter(function (applicationId) {
                return applicationId && !loadedApplicationIds.has(applicationId);
            });

            if (flaggedOnlyIds.length) {
                const flaggedOnlyRows = await fetchApplicationsByIds(context, flaggedOnlyIds);
                if (loadToken !== specialLoadToken) {
                    return;
                }
                applicationRows = applicationRows.concat(flaggedOnlyRows);
            }
        }

        const applicantIds = Array.from(new Set(applicationRows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));
        const profileMap = await fetchProfiles(context, applicantIds);
        let examMap = {};

        try {
            examMap = await fetchExamRecordsByApplicationIds(context, applicationRows.map(function (row) {
                return row.id;
            }));
        } catch (error) {
            showManagerStatus(
                /does not exist|relation|schema cache/i.test(error && error.message ? error.message : "")
                    ? "Exam records are not installed yet, so score and rank will stay blank for now."
                    : "Score and rank could not be loaded right now, but the Special Consideration list is still available.",
                "alert-warning"
            );
            examMap = {};
        }

        if (loadToken !== specialLoadToken) {
            return;
        }

        specialApplicationsById = {};
        const preparedCandidates = applicationRows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            const flagged = flagMap[row.id] || null;
            const decodedTag = decodeSpecialTag(flagged && flagged.tag ? flagged.tag : "");
            const examRecord = examMap[row.id] || null;

            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile) || (profile && profile.email ? profile.email : row.application_no || "Unknown Applicant"),
                applicant_email: profile && profile.email ? profile.email : "",
                applicant_barangay: profile && profile.barangay ? profile.barangay : "",
                raw_score_value: hasSavedRawScore(examRecord && examRecord.raw_score) ? Number(examRecord.raw_score) : null,
                room_label: examRecord && examRecord.room_label ? examRecord.room_label : "",
                room_seat_no: examRecord && examRecord.room_seat_no != null ? Number(examRecord.room_seat_no) : null,
                is_reserved_slot: Boolean(decodedTag.level),
                special_level: decodedTag.level || "",
                special_label: decodedTag.label || "",
                flag_updated_at: flagged && flagged.updated_at ? flagged.updated_at : null
            });
        });
        const rankMap = rankMapForSpecialCandidates(preparedCandidates, schoolYear);

        specialCandidates = preparedCandidates.map(function (candidate) {
            const enrichedCandidate = Object.assign({}, candidate, {
                display_rank: Object.prototype.hasOwnProperty.call(rankMap, candidate.id) ? rankMap[candidate.id] : null
            });
            specialApplicationsById[enrichedCandidate.id] = enrichedCandidate;
            return enrichedCandidate;
        });

        renderSearchResults();
        renderAllowedTable();
        syncManagerState();
    }

    async function addSpecialConsideration(context, applicationId, selectedLevel, selectedLabel) {
        const row = specialApplicationsById[applicationId];
        const normalizedSelectedLevel = normalizeSpecialTag(selectedLevel) || DEFAULT_SPECIAL_TAG;
        const normalizedSelectedLabel = normalizeSpecialLabel(selectedLabel);
        if (!row) {
            throw new Error("This application record is no longer available. Reload the page and try again.");
        }
        if (!normalizedSelectedLabel) {
            throw new Error("Select a saved Special Consideration before adding this student.");
        }
        if (!specialFlagsAvailable) {
            showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
            return;
        }

        const result = await context.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .upsert({
                application_id: applicationId,
                special_consideration_tag: encodeSpecialTag(normalizedSelectedLevel, normalizedSelectedLabel),
                special_consideration_marked_by: context.user.id
            }, { onConflict: "application_id" });

        if (result.error) {
            if (/does not exist|relation|schema cache/i.test(result.error.message || "")) {
                specialFlagsAvailable = false;
                syncManagerState();
                renderSearchResults();
                renderAllowedTable();
                showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
                return;
            }
            throw new Error("Failed to add special consideration student: " + result.error.message);
        }

        row.is_reserved_slot = true;
        row.special_level = normalizedSelectedLevel;
        row.special_label = normalizedSelectedLabel;
        row.flag_updated_at = new Date().toISOString();
        renderSearchResults();
        renderAllowedTable();
        showManagerStatus("Special consideration saved for " + row.applicant_name + " as " + specialTagLabel(normalizedSelectedLevel) + " / " + normalizedSelectedLabel + ".", "alert-success");

        await writeAuditEntry(context, {
            module: "special_consideration",
            action: "add_special_consideration_student",
            recordType: "application_staff_flags",
            recordId: applicationId,
            targetUserId: row.applicant_id || null,
            targetLabel: row.applicant_name,
            summary: "Granted special consideration to " + row.applicant_name + " as " + specialTagLabel(normalizedSelectedLevel) + " / " + normalizedSelectedLabel + ".",
            details: {
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                status: normalizeStatus(row.status),
                special_level: normalizedSelectedLevel,
                special_label: normalizedSelectedLabel
            }
        });
    }

    async function updateSpecialConsiderationTag(context, applicationId, nextLevel, nextLabel) {
        const row = specialApplicationsById[applicationId];
        const normalizedSelectedLevel = normalizeSpecialTag(nextLevel) || DEFAULT_SPECIAL_TAG;
        const normalizedSelectedLabel = normalizeSpecialLabel(nextLabel);

        if (!row) {
            throw new Error("This application record is no longer available. Reload the page and try again.");
        }
        if (!normalizedSelectedLabel) {
            throw new Error("Select a saved Special Consideration before saving this student.");
        }
        if (!specialFlagsAvailable) {
            showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
            return;
        }

        const result = await context.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .upsert({
                application_id: applicationId,
                special_consideration_tag: encodeSpecialTag(normalizedSelectedLevel, normalizedSelectedLabel),
                special_consideration_marked_by: context.user.id
            }, { onConflict: "application_id" });

        if (result.error) {
            throw new Error("Failed to update special consideration details: " + result.error.message);
        }

        row.is_reserved_slot = true;
        row.special_level = normalizedSelectedLevel;
        row.special_label = normalizedSelectedLabel;
        row.flag_updated_at = new Date().toISOString();
        renderSearchResults();
        renderAllowedTable();
        showManagerStatus("Updated special consideration for " + row.applicant_name + " to " + specialTagLabel(normalizedSelectedLevel) + " / " + normalizedSelectedLabel + ".", "alert-success");

        await writeAuditEntry(context, {
            module: "special_consideration",
            action: "update_special_consideration_tag",
            recordType: "application_staff_flags",
            recordId: applicationId,
            targetUserId: row.applicant_id || null,
            targetLabel: row.applicant_name,
            summary: "Updated special consideration for " + row.applicant_name + " to " + specialTagLabel(normalizedSelectedLevel) + " / " + normalizedSelectedLabel + ".",
            details: {
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                status: normalizeStatus(row.status),
                special_level: normalizedSelectedLevel,
                special_label: normalizedSelectedLabel
            }
        });
    }

    async function removeSpecialConsideration(context, applicationId) {
        const row = specialApplicationsById[applicationId];
        if (!row) {
            throw new Error("This application record is no longer available. Reload the page and try again.");
        }
        if (!specialFlagsAvailable) {
            showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
            return;
        }

        const result = await context.client
            .from(APPLICATION_STAFF_FLAGS_TABLE)
            .delete()
            .eq("application_id", applicationId);

        if (result.error) {
            throw new Error("Failed to remove special consideration student: " + result.error.message);
        }

        row.is_reserved_slot = false;
        row.special_level = "";
        row.special_label = "";
        row.flag_updated_at = new Date().toISOString();
        renderSearchResults();
        renderAllowedTable();
        showManagerStatus("Removed special consideration for " + row.applicant_name + ".", "alert-success");

        await writeAuditEntry(context, {
            module: "special_consideration",
            action: "remove_special_consideration_student",
            recordType: "application_staff_flags",
            recordId: applicationId,
            targetUserId: row.applicant_id || null,
            targetLabel: row.applicant_name,
            summary: "Removed special consideration from " + row.applicant_name + ".",
            details: {
                application_no: row.application_no || "",
                school_year: row.school_year || "",
                status: normalizeStatus(row.status)
            }
        });
    }

    async function saveAssignedSpecialConsideration(context, applicationId, optionValue) {
        const decoded = decodeSpecialTag(optionValue);
        const row = specialApplicationsById[applicationId];

        if (!decoded.level || !decoded.label) {
            throw new Error("Add Special Consideration first before assigning a student.");
        }
        if (row && row.is_reserved_slot) {
            return updateSpecialConsiderationTag(context, applicationId, decoded.level, decoded.label);
        }
        return addSpecialConsideration(context, applicationId, decoded.level, decoded.label);
    }

    function bindEvents(context) {
        const toggle = byId("specialConsiderationFlowToggle");
        const searchInput = byId("specialConsiderationSearchInput");
        const searchResults = byId("specialConsiderationSearchResults");
        const tableBody = byId("specialConsiderationTableBody");
        const catalogList = byId("specialConsiderationCatalogList");
        const addOptionButton = byId("specialConsiderationAddOption");
        const printTagSelect = byId("specialConsiderationPrintTag");
        const pdfButton = byId("specialConsiderationPdfBtn");
        const printButton = byId("specialConsiderationPrintBtn");
        const optionSaveButton = byId("specialConsiderationOptionSave");
        const editSaveButton = byId("specialConsiderationEditSave");
        const flowModalIds = ["specialConsiderationEnabledModal", "specialConsiderationDisabledModal"];

        if (toggle) {
            toggle.addEventListener("change", function () {
                saveFlowSetting(context).catch(function (error) {
                    showPageStatus(error && error.message ? error.message : "Failed to save special consideration flow.", "alert-danger");
                });
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", function () {
                renderSearchResults();
            });
        }

        if (addOptionButton) {
            addOptionButton.addEventListener("click", function () {
                openCatalogModal();
            });
        }

        if (pdfButton) {
            pdfButton.addEventListener("click", function () {
                downloadAllowedPdf();
            });
        }

        if (printButton) {
            printButton.addEventListener("click", function () {
                printAllowedTable();
            });
        }

        if (printTagSelect) {
            printTagSelect.addEventListener("change", function () {
                renderSpecialCounters();
            });
        }

        if (optionSaveButton) {
            optionSaveButton.addEventListener("click", function () {
                saveSpecialOptionCatalog(context).catch(function (error) {
                    showManagerStatus(error && error.message ? error.message : "Failed to save Special Consideration entry.", "alert-danger");
                });
            });
        }

        if (catalogList) {
            catalogList.addEventListener("click", function (event) {
                const button = event.target && event.target.closest ? event.target.closest("[data-special-option-delete]") : null;
                if (!button) {
                    return;
                }
                deleteSpecialOptionCatalog(context, button.getAttribute("data-special-option-delete")).catch(function (error) {
                    showManagerStatus(error && error.message ? error.message : "Failed to delete Special Consideration entry.", "alert-danger");
                });
            });
        }

        if (searchResults) {
            searchResults.addEventListener("click", function (event) {
                const button = event.target && event.target.closest ? event.target.closest("[data-special-consideration-pick]") : null;
                if (!button) {
                    return;
                }
                openEditModal(button.getAttribute("data-special-consideration-pick"));
            });
        }

        if (tableBody) {
            tableBody.addEventListener("click", function (event) {
                const editButton = event.target && event.target.closest ? event.target.closest("[data-special-consideration-edit]") : null;
                if (editButton) {
                    openEditModal(editButton.getAttribute("data-special-consideration-edit"));
                    return;
                }
                const button = event.target && event.target.closest ? event.target.closest("[data-special-consideration-remove]") : null;
                if (!button) {
                    return;
                }
                removeSpecialConsideration(context, button.getAttribute("data-special-consideration-remove")).catch(function (error) {
                    showManagerStatus(error && error.message ? error.message : "Failed to remove special consideration student.", "alert-danger");
                });
            });
        }

        if (editSaveButton) {
            editSaveButton.addEventListener("click", function () {
                const applicationId = byId("specialConsiderationEditApplicationId");
                const optionSelect = byId("specialConsiderationEditOption");
                const modal = editModalInstance();
                const selectedApplicationId = applicationId ? applicationId.value : "";
                const selectedOption = optionSelect ? optionSelect.value : "";

                saveAssignedSpecialConsideration(context, selectedApplicationId, selectedOption).then(function () {
                    if (modal) {
                        modal.hide();
                    }
                }).catch(function (error) {
                    showManagerStatus(error && error.message ? error.message : "Failed to update special consideration details.", "alert-danger");
                });
            });
        }

        flowModalIds.forEach(function (modalId) {
            const modalEl = byId(modalId);
            if (!modalEl) {
                return;
            }
            modalEl.addEventListener("hidden.bs.modal", function () {
                if (specialFlowModalTimer) {
                    clearTimeout(specialFlowModalTimer);
                    specialFlowModalTimer = 0;
                }
            });
        });
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents(context);

        try {
            await loadActiveSettings(context);
        } catch (error) {
            showPageStatus(error && error.message ? error.message : "Failed to load scholarship settings.", "alert-danger");
            applySettingsRecord(cloneSettings(readFallbackStorage()));
        }

        try {
            await loadManager(context);
        } catch (error) {
            showManagerStatus(error && error.message ? error.message : "Failed to load special consideration student list.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
