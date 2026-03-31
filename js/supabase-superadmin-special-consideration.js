(function () {
    "use strict";

    const STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const APPLICATION_STAFF_FLAGS_TABLE = "application_staff_flags";
    const LEGACY_RESERVED_SLOT_TAG = "reserved_slot_exception";
    const SPECIAL_TAG_DELIMITER = "::";
    const PROFILE_BATCH_SIZE = 120;
    const SPECIAL_RESULT_LIMIT = 8;
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
            (profile.first_name || "").trim(),
            (profile.middle_name || "").trim(),
            (profile.last_name || "").trim()
        ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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

    function setLoadingState(message) {
        const searchResults = byId("specialConsiderationSearchResults");
        const tableBody = byId("specialConsiderationTableBody");
        const safeMessage = escapeHtml(message || "Loading special consideration students...");

        if (searchResults) {
            searchResults.innerHTML = '<div class="px-3 pb-3 small text-muted">' + safeMessage + "</div>";
        }
        if (tableBody) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">' + safeMessage + "</td></tr>";
        }
    }

    async function fetchProfiles(context, applicantIds) {
        const profileMap = {};
        const ids = Array.isArray(applicantIds) ? applicantIds.filter(Boolean) : [];

        for (let index = 0; index < ids.length; index += PROFILE_BATCH_SIZE) {
            const batch = ids.slice(index, index + PROFILE_BATCH_SIZE);
            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email")
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

    function renderSearchResults() {
        const target = byId("specialConsiderationSearchResults");
        const schoolYear = currentSchoolYear();
        const query = (byId("specialConsiderationSearchInput") ? byId("specialConsiderationSearchInput").value : "").toString().trim().toLowerCase();
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

        if (query) {
            matches = matches.filter(function (row) {
                const haystack = [
                    row.applicant_name,
                    row.application_no,
                    row.scholarship_type,
                    row.status
                ].join(" ").toLowerCase();
                return haystack.includes(query);
            });
        }

        matches = matches.slice(0, SPECIAL_RESULT_LIMIT);

        if (!matches.length) {
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
        if (!currentSchoolYear()) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Save Scholarship Settings first to set the active school year.</td></tr>';
            return;
        }
        if (!specialFlagsAvailable) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.</td></tr>';
            return;
        }
        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No students are currently on the special consideration allow-list.</td></tr>';
            return;
        }

        tableBody.innerHTML = rows.map(function (row) {
            return [
                "<tr>",
                "<td>",
                '<div class="fw-600">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>",
                '<div class="small text-muted">' + escapeHtml(row.scholarship_type || "-") + "</div>",
                "</td>",
                "<td>",
                '<div class="fw-600">' + escapeHtml(row.application_no || "-") + "</div>",
                '<div class="small text-muted">Updated ' + escapeHtml(formatDateDisplay((row.flag_updated_at || row.updated_at || "").slice(0, 10))) + "</div>",
                "</td>",
                "<td>",
                specialTagBadgeMarkup(row.special_level),
                '<div class="ldss-special-table-label">' + escapeHtml(row.special_label || "-") + "</div>",
                "</td>",
                "<td>",
                '<span class="ldss-chip ldss-chip-neutral">' + escapeHtml(formatStatusLabel(row.status)) + "</span>",
                "</td>",
                '<td class="text-end"><button class="btn btn-dark btn-sm me-2" type="button" data-special-consideration-edit="' + escapeHtml(row.id) + '">Edit</button><button class="btn btn-outline-dark btn-sm" type="button" data-special-consideration-remove="' + escapeHtml(row.id) + '">Remove</button></td>',
                "</tr>"
            ].join("");
        }).join("");
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

        const applicationResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, school_year, scholarship_type, status, submitted_at, created_at, updated_at")
            .eq("school_year", schoolYear)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(500);

        if (loadToken !== specialLoadToken) {
            return;
        }

        if (applicationResult.error) {
            specialCandidates = [];
            specialApplicationsById = {};
            setLoadingState("Unable to load application records for this school year.");
            throw new Error("Failed to load special consideration candidates: " + applicationResult.error.message);
        }

        const applicationRows = applicationResult.data || [];
        const applicantIds = Array.from(new Set(applicationRows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean)));
        const profileMap = await fetchProfiles(context, applicantIds);

        if (loadToken !== specialLoadToken) {
            return;
        }

        let flagMap = {};
        if (specialFlagsAvailable && applicationRows.length) {
            const flagResult = await context.client
                .from(APPLICATION_STAFF_FLAGS_TABLE)
                .select("application_id, special_consideration_tag, updated_at, created_at")
                .in("application_id", applicationRows.map(function (row) { return row.id; }));

            if (loadToken !== specialLoadToken) {
                return;
            }

            if (flagResult.error) {
                if (/does not exist|relation|schema cache/i.test(flagResult.error.message || "")) {
                    specialFlagsAvailable = false;
                    showManagerStatus("Special consideration storage is not installed yet. Apply the 2026-03-24 SQL hotfix first.", "alert-warning");
                } else {
                    throw new Error("Failed to load special consideration records: " + flagResult.error.message);
                }
            } else {
                specialFlagsAvailable = true;
                (flagResult.data || []).forEach(function (row) {
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
            }
        }

        specialApplicationsById = {};
        specialCandidates = applicationRows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            const flagged = flagMap[row.id] || null;
            const decodedTag = decodeSpecialTag(flagged && flagged.tag ? flagged.tag : "");
            const candidate = Object.assign({}, row, {
                applicant_name: buildApplicantName(profile) || (profile && profile.email ? profile.email : row.application_no || "Unknown Applicant"),
                is_reserved_slot: Boolean(decodedTag.level),
                special_level: decodedTag.level || "",
                special_label: decodedTag.label || "",
                flag_updated_at: flagged && flagged.updated_at ? flagged.updated_at : null
            });
            specialApplicationsById[candidate.id] = candidate;
            return candidate;
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
