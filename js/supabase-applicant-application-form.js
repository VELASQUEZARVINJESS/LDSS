(function () {
    "use strict";

    const EDITABLE_STATUSES = ["draft", "returned_for_correction"];
    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
    const PROFILE_CACHE_PREFIX = "ldss:profile-cache:";
    const MAX_AWARDS = 5;

    const DOC_FIELDS = [
        {
            inputId: "reqApplicantPhoto",
            docType: "applicant_photo",
            label: "Applicant 1x1 Photo",
            allowedExtensions: [".jpg", ".jpeg", ".png"],
            allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png"],
            fileTypeHint: "JPG or PNG only",
            requiredOnSubmit: true,
            syncToProfilePhoto: true
        }
    ];

    const DOC_LABELS = {
        applicant_photo: "Applicant 1x1 Photo"
    };

    let currentApplication = null;
    let isSaving = false;
    let isSubmitting = false;
    let applicantPhotoPreviewObjectUrl = "";
    let submittedModalInstance = null;
    let privacyModalInstance = null;
    let applicationPolicyModalInstance = null;
    let pendingSubmitContext = null;
    let submittedTrackingUrl = "";
    let applicationsSupportsSectorClassification = true;

    function byId(id) {
        return document.getElementById(id);
    }

    function nullIfBlank(value) {
        const normalized = (value || "").toString().trim();
        return normalized ? normalized : null;
    }

    function upperTextOrNull(value) {
        const normalized = nullIfBlank(value);
        return normalized ? normalized.toUpperCase() : null;
    }

    function normalizeMiddleNameValue(value) {
        const normalized = (value || "").toString().trim();
        if (!normalized) {
            return "N/A";
        }
        if (/^n\s*\/?\s*a$/i.test(normalized)) {
            return "N/A";
        }
        return normalized.toUpperCase();
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

    function mobileForInput(value) {
        const raw = (value || "").toString().trim();
        if (/^\+639\d{9}$/.test(raw)) {
            return "0" + raw.slice(3);
        }
        return raw;
    }

    function setStatus(message, type, isHtml) {
        const target = byId("applicationFormStatus");
        if (!target) {
            return;
        }
        if (!message) {
            target.className = "alert d-none";
            target.textContent = "";
            return;
        }
        target.className = "alert " + (type || "alert-info");
        if (isHtml) {
            target.innerHTML = message;
        } else {
            target.textContent = message;
        }
    }

    function setApplicationIdDisplay(applicationNo) {
        const target = byId("applicationFormIdDisplay");
        if (!target) {
            return;
        }
        if (!applicationNo) {
            target.textContent = "Application ID: New draft (not yet saved)";
            return;
        }
        target.textContent = "Application ID: " + applicationNo;
    }

    function isUploadServerUnavailableMessage(message) {
        const text = (message || "").toString().toLowerCase();
        return text.includes("upload server is not available") || text.includes("failed to fetch") || text.includes("networkerror");
    }

    function isUploadAccessDeniedMessage(message) {
        const text = (message || "").toString().toLowerCase();
        return text.includes("access token") || text.includes("authentication") || text.includes("cannot upload") || text.includes("not allowed");
    }

    function shouldUppercaseField(input) {
        if (!input || !input.tagName) {
            return false;
        }
        const tagName = input.tagName.toLowerCase();
        if (tagName === "textarea") {
            return true;
        }
        if (tagName !== "input") {
            return false;
        }

        const type = (input.type || "text").toLowerCase();
        return ["text", "search", "tel"].includes(type) && type !== "email";
    }

    function enforceUppercaseFieldValue(input) {
        if (!shouldUppercaseField(input)) {
            return;
        }
        const original = input.value || "";
        const upper = original.toUpperCase();
        if (upper === original) {
            return;
        }
        const start = typeof input.selectionStart === "number" ? input.selectionStart : null;
        const end = typeof input.selectionEnd === "number" ? input.selectionEnd : null;
        input.value = upper;
        if (start !== null && end !== null && typeof input.setSelectionRange === "function") {
            input.setSelectionRange(start, end);
        }
    }

    function setSelectValue(id, value) {
        const select = byId(id);
        if (!select) {
            return;
        }
        const normalized = (value || "").toString().trim();
        if (!normalized) {
            return;
        }
        const found = Array.from(select.options).find(function (opt) {
            return opt.value.toLowerCase() === normalized.toLowerCase();
        });
        if (found) {
            select.value = found.value;
            return;
        }
        const dynamicOption = document.createElement("option");
        dynamicOption.value = normalized;
        dynamicOption.textContent = normalized;
        select.appendChild(dynamicOption);
        select.value = normalized;
    }

    function normalizeParentStatusValue(value) {
        const normalized = (value || "").toString().trim().toLowerCase();
        if (!normalized) {
            return "";
        }
        if (normalized === "alive" || normalized === "living" || normalized === "living / alive") {
            return "Alive";
        }
        if (normalized === "deceased") {
            return "Deceased";
        }
        return (value || "").toString().trim();
    }

    function getRadioValue(name) {
        const selected = document.querySelector("input[name=\"" + name + "\"]:checked");
        return selected ? normalizeParentStatusValue(selected.value) : "";
    }

    function setRadioValue(name, value) {
        const normalized = normalizeParentStatusValue(value);
        document.querySelectorAll("input[name=\"" + name + "\"]").forEach(function (radio) {
            radio.checked = normalizeParentStatusValue(radio.value) === normalized;
        });
    }

    function setRadioGroupDisabled(name, disabled) {
        document.querySelectorAll("input[name=\"" + name + "\"]").forEach(function (radio) {
            radio.disabled = !!disabled;
        });
    }

    function applicationSelectFields() {
        if (applicationsSupportsSectorClassification) {
            return "id, application_no, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, is_locked, created_at, updated_at";
        }
        return "id, application_no, application_type, scholarship_type, school_year, status, submitted_at, is_locked, created_at, updated_at";
    }

    function applicationMutationPayload(payload) {
        const normalized = payload && typeof payload === "object" ? Object.assign({}, payload) : {};
        if (!applicationsSupportsSectorClassification) {
            delete normalized.sector_classification;
        }
        return normalized;
    }

    function isMissingApplicationsColumnError(error, columnName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedColumn = (columnName || "").toString().toLowerCase();
        if (!text || !normalizedColumn) {
            return false;
        }
        return text.includes(normalizedColumn) && (text.includes("does not exist") || text.includes("schema cache"));
    }

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        return {
            applicationId: params.get("application_id")
        };
    }

    function profileCacheKey(userId) {
        return PROFILE_CACHE_PREFIX + userId;
    }

    function writeProfileCache(userId, profile) {
        if (!userId || !profile) {
            return;
        }
        try {
            localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
        } catch (error) {
            // Non-fatal: browser storage may be disabled.
        }
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

    function auxMetaKey(userId, applicationId) {
        return "ldss:application-form-meta:" + userId + ":" + (applicationId || "new");
    }

    function readAuxMeta(userId, applicationId) {
        try {
            const raw = localStorage.getItem(auxMetaKey(userId, applicationId));
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return typeof parsed === "object" && parsed ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function setAgreementValidity(isInvalid) {
        const checkbox = byId("applicationAgreement");
        if (!checkbox) {
            return;
        }
        checkbox.classList.toggle("is-invalid", !!isInvalid);
    }

    function setPrivacyNoticeValidity(isInvalid) {
        const checkbox = byId("privacyNoticeAgreement");
        if (!checkbox) {
            return;
        }
        checkbox.classList.toggle("is-invalid", !!isInvalid);
    }

    function hasAgreement() {
        const checkbox = byId("applicationAgreement");
        if (!checkbox) {
            return true;
        }
        return !!checkbox.checked;
    }

    function requireAgreementOrThrow(actionLabel) {
        if (hasAgreement()) {
            setAgreementValidity(false);
            return;
        }

        setAgreementValidity(true);
        const checkbox = byId("applicationAgreement");
        if (checkbox && typeof checkbox.focus === "function") {
            checkbox.focus();
        }
        throw new Error("Please agree that all information is correct before " + actionLabel + ".");
    }

    function hasPrivacyNoticeAgreement() {
        const checkbox = byId("privacyNoticeAgreement");
        if (!checkbox) {
            return true;
        }
        return !!checkbox.checked;
    }

    function getPrivacyModal() {
        const modalEl = byId("dataPrivacyModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        if (!privacyModalInstance) {
            privacyModalInstance = new window.bootstrap.Modal(modalEl);
        }
        return privacyModalInstance;
    }

    function openPrivacyModalForReview() {
        const modal = getPrivacyModal();
        if (!modal) {
            return;
        }
        modal.show();
    }

    function acknowledgePrivacyNotice() {
        const checkbox = byId("privacyNoticeAgreement");
        if (checkbox) {
            checkbox.checked = true;
        }
        setPrivacyNoticeValidity(false);
        const modal = getPrivacyModal();
        if (modal) {
            modal.hide();
        }
    }

    function requirePrivacyNoticeOrThrow(actionLabel) {
        if (hasPrivacyNoticeAgreement()) {
            setPrivacyNoticeValidity(false);
            return;
        }

        setPrivacyNoticeValidity(true);
        openPrivacyModalForReview();
        throw new Error("Please review and acknowledge the Data Privacy Notice before " + actionLabel + ".");
    }

    function getApplicationPolicyModal() {
        const modalEl = byId("applicationPolicyModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        if (!applicationPolicyModalInstance) {
            applicationPolicyModalInstance = new window.bootstrap.Modal(modalEl);
        }
        return applicationPolicyModalInstance;
    }

    function openApplicationPolicyModal() {
        const modal = getApplicationPolicyModal();
        if (modal) {
            modal.show();
            return true;
        }
        return false;
    }

    function getSubmittedModal() {
        const modalEl = byId("applicationSubmittedModal");
        if (!modalEl || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        if (!submittedModalInstance) {
            submittedModalInstance = new window.bootstrap.Modal(modalEl);
        }
        return submittedModalInstance;
    }

    function showSubmittedModal(submittedApplication, profileWarning) {
        const submittedId = submittedApplication && submittedApplication.id ? submittedApplication.id : "";
        const submittedNo = submittedApplication && submittedApplication.application_no ? submittedApplication.application_no : submittedId;
        submittedTrackingUrl = submittedId ? "application-detail.html?id=" + encodeURIComponent(submittedId) : "";

        const messageEl = byId("applicationSubmittedModalMessage");
        if (messageEl) {
            let message = "Application " + submittedNo + " submitted successfully.";
            if (profileWarning) {
                message += " Profile warning: " + profileWarning;
            }
            messageEl.textContent = message;
        }

        const openBtn = byId("applicationSubmittedModalOpenBtn");
        if (openBtn) {
            openBtn.disabled = !submittedTrackingUrl;
        }

        const modal = getSubmittedModal();
        if (modal) {
            modal.show();
            return;
        }
        if (submittedTrackingUrl) {
            window.location.href = submittedTrackingUrl;
        }
    }

    function normalizeAwardItem(item) {
        const safeItem = item && typeof item === "object" ? item : {};
        return {
            natureDescription: upperTextOrNull(
                safeItem.natureDescription ||
                    safeItem.awardNatureDescription ||
                    safeItem.description ||
                    ""
            ),
            schoolName: upperTextOrNull(safeItem.schoolName || safeItem.awardSchoolName || ""),
            yearAwarded: nullIfBlank(safeItem.yearAwarded || safeItem.awardSchoolYear || "")
        };
    }

    function normalizeAwardList(awards) {
        if (!Array.isArray(awards)) {
            return [];
        }
        return awards
            .map(normalizeAwardItem)
            .filter(function (award) {
                return award.natureDescription || award.schoolName || award.yearAwarded;
            })
            .slice(0, MAX_AWARDS);
    }

    function createAwardInputColumn(labelText, field, value) {
        const col = document.createElement("div");
        col.className = "col-md-4";

        const label = document.createElement("label");
        label.className = "small mb-1";
        label.textContent = labelText;

        const input = document.createElement("input");
        input.className = "form-control";
        input.type = "text";
        input.value = value || "";
        input.setAttribute("data-award-input", "true");
        input.setAttribute("data-award-field", field);

        col.appendChild(label);
        col.appendChild(input);
        return col;
    }

    function createAwardRow(award) {
        const row = document.createElement("div");
        row.className = "col-12";
        row.setAttribute("data-award-row", "true");

        const rowFields = document.createElement("div");
        rowFields.className = "row g-3 align-items-end";

        rowFields.appendChild(
            createAwardInputColumn(
                "Nature of Award / Description of Award",
                "natureDescription",
                award && award.natureDescription ? award.natureDescription : ""
            )
        );
        rowFields.appendChild(
            createAwardInputColumn(
                "What School",
                "schoolName",
                award && award.schoolName ? award.schoolName : ""
            )
        );
        rowFields.appendChild(
            createAwardInputColumn(
                "Date or Year Awarded",
                "yearAwarded",
                award && award.yearAwarded ? award.yearAwarded : ""
            )
        );

        const actionCol = document.createElement("div");
        actionCol.className = "col-12 d-flex justify-content-end";
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn-outline-secondary btn-sm";
        removeBtn.textContent = "Remove";
        removeBtn.setAttribute("data-award-remove", "true");
        actionCol.appendChild(removeBtn);
        rowFields.appendChild(actionCol);

        row.appendChild(rowFields);
        return row;
    }

    function collectAwardsFromForm() {
        const container = byId("awardsRows");
        if (!container) {
            return [];
        }

        const rows = Array.from(container.querySelectorAll("[data-award-row='true']"));
        return rows
            .map(function (row) {
                const natureInput = row.querySelector("[data-award-field='natureDescription']");
                const schoolInput = row.querySelector("[data-award-field='schoolName']");
                const yearInput = row.querySelector("[data-award-field='yearAwarded']");
                const award = normalizeAwardItem({
                    natureDescription: natureInput ? natureInput.value : "",
                    schoolName: schoolInput ? schoolInput.value : "",
                    yearAwarded: yearInput ? yearInput.value : ""
                });
                return award;
            })
            .filter(function (award) {
                return award.natureDescription || award.schoolName || award.yearAwarded;
            })
            .slice(0, MAX_AWARDS);
    }

    function isFormCurrentlyEditable() {
        return isEditable(currentApplication);
    }

    function updateAwardControlsState(editableOverride) {
        const container = byId("awardsRows");
        const addBtn = byId("awardAddBtn");
        if (!container) {
            if (addBtn) {
                const fallbackEditable = typeof editableOverride === "boolean" ? editableOverride : isFormCurrentlyEditable();
                addBtn.disabled = !fallbackEditable;
            }
            return;
        }

        const rows = Array.from(container.querySelectorAll("[data-award-row='true']"));
        const editable = typeof editableOverride === "boolean" ? editableOverride : isFormCurrentlyEditable();
        if (addBtn) {
            addBtn.disabled = !editable || rows.length >= MAX_AWARDS;
        }

        rows.forEach(function (row) {
            const removeBtn = row.querySelector("[data-award-remove='true']");
            if (!removeBtn) {
                return;
            }
            removeBtn.disabled = !editable || rows.length <= 1;
        });
    }

    function renderAwardRows(awards) {
        const container = byId("awardsRows");
        if (!container) {
            return;
        }
        container.innerHTML = "";
        const normalized = normalizeAwardList(awards);
        const rows = normalized.length > 0 ? normalized : [{}];
        rows.forEach(function (award) {
            container.appendChild(createAwardRow(award));
        });
        updateAwardControlsState();
    }

    function addAwardRow() {
        const container = byId("awardsRows");
        if (!container) {
            return;
        }
        const currentRows = container.querySelectorAll("[data-award-row='true']").length;
        if (currentRows >= MAX_AWARDS) {
            return;
        }
        container.appendChild(createAwardRow({}));
        updateAwardControlsState();
    }

    function removeAwardRow(targetButton) {
        const container = byId("awardsRows");
        if (!container || !targetButton) {
            return;
        }
        const row = targetButton.closest("[data-award-row='true']");
        if (!row) {
            return;
        }

        const allRows = Array.from(container.querySelectorAll("[data-award-row='true']"));
        if (allRows.length <= 1) {
            row.querySelectorAll("[data-award-input='true']").forEach(function (input) {
                input.value = "";
                input.classList.remove("is-invalid");
            });
            updateAwardControlsState();
            return;
        }

        row.remove();
        updateAwardControlsState();
    }

    function writeAuxMeta(userId, applicationId) {
        if (!userId || !applicationId) {
            return;
        }
        const spouseFieldIds = ["spouseName", "spouseChildrenCount", "spouseOccupation", "spouseEducation", "intendedSchool"];
        const hasSpouseDetails = spouseFieldIds.some(function (id) {
            const input = byId(id);
            return !!(input && nullIfBlank(input.value));
        });
        // TODO(Supabase): move these auxiliary fields to a dedicated application details table.
        const payload = {
            religion: nullIfBlank(byId("religion") ? byId("religion").value : ""),
            placeOfBirth: upperTextOrNull(byId("placeOfBirth") ? byId("placeOfBirth").value : ""),
            additionalData: nullIfBlank(byId("additionalData") ? byId("additionalData").value : ""),
            highestEducationAttainment: nullIfBlank(byId("highestEducationAttainment") ? byId("highestEducationAttainment").value : ""),
            highestGradeYearLevel: nullIfBlank(byId("highestGradeYearLevel") ? byId("highestGradeYearLevel").value : ""),
            schoolType: nullIfBlank(byId("schoolType") ? byId("schoolType").value : ""),
            grantAppliedFor: nullIfBlank(byId("grantAppliedFor") ? byId("grantAppliedFor").value : ""),
            awards: collectAwardsFromForm(),
            fatherStatus: nullIfBlank(getRadioValue("fatherStatus")),
            fatherFirstName: upperTextOrNull(byId("fatherFirstName") ? byId("fatherFirstName").value : ""),
            fatherMiddleName: upperTextOrNull(byId("fatherMiddleName") ? byId("fatherMiddleName").value : ""),
            fatherLastName: upperTextOrNull(byId("fatherLastName") ? byId("fatherLastName").value : ""),
            motherStatus: nullIfBlank(getRadioValue("motherStatus")),
            motherFirstName: upperTextOrNull(byId("motherFirstName") ? byId("motherFirstName").value : ""),
            motherMiddleName: upperTextOrNull(byId("motherMiddleName") ? byId("motherMiddleName").value : ""),
            motherMaidenName: upperTextOrNull(byId("motherMaidenName") ? byId("motherMaidenName").value : ""),
            fatherAddress: upperTextOrNull(byId("fatherAddress") ? byId("fatherAddress").value : ""),
            motherAddress: upperTextOrNull(byId("motherAddress") ? byId("motherAddress").value : ""),
            fatherOccupation: upperTextOrNull(byId("fatherOccupation") ? byId("fatherOccupation").value : ""),
            fatherEducationAttainment: nullIfBlank(byId("fatherEducationAttainment") ? byId("fatherEducationAttainment").value : ""),
            gwa: nullIfBlank(byId("gwa") ? byId("gwa").value : ""),
            motherOccupation: upperTextOrNull(byId("motherOccupation") ? byId("motherOccupation").value : ""),
            motherEducationAttainment: nullIfBlank(byId("motherEducationAttainment") ? byId("motherEducationAttainment").value : ""),
            totalParentsGrossIncome: nullIfBlank(byId("totalParentsGrossIncome") ? byId("totalParentsGrossIncome").value : ""),
            childrenInFamily: nullIfBlank(byId("childrenInFamily") ? byId("childrenInFamily").value : ""),
            brotherCount: nullIfBlank(byId("brotherCount") ? byId("brotherCount").value : ""),
            sisterCount: nullIfBlank(byId("sisterCount") ? byId("sisterCount").value : ""),
            isMarriedApplicant: hasSpouseDetails,
            spouseName: upperTextOrNull(byId("spouseName") ? byId("spouseName").value : ""),
            spouseChildrenCount: nullIfBlank(byId("spouseChildrenCount") ? byId("spouseChildrenCount").value : ""),
            spouseOccupation: upperTextOrNull(byId("spouseOccupation") ? byId("spouseOccupation").value : ""),
            spouseEducation: upperTextOrNull(byId("spouseEducation") ? byId("spouseEducation").value : ""),
            intendedSchool: upperTextOrNull(byId("intendedSchool") ? byId("intendedSchool").value : ""),
            degreeProgramCourse: upperTextOrNull(byId("degreeProgramCourse") ? byId("degreeProgramCourse").value : "")
        };
        try {
            localStorage.setItem(auxMetaKey(userId, applicationId), JSON.stringify(payload));
        } catch (error) {
            // Non-fatal: browser storage may be disabled.
        }
    }

    function applyAuxMeta(userId, applicationId) {
        const payload = readAuxMeta(userId, applicationId);
        if (byId("religion")) {
            setSelectValue("religion", payload.religion || "");
        }
        if (byId("placeOfBirth")) {
            byId("placeOfBirth").value = payload.placeOfBirth || "";
        }
        if (byId("additionalData") && !(currentApplication && currentApplication.sector_classification)) {
            setSelectValue("additionalData", payload.additionalData || "");
        }
        if (byId("highestEducationAttainment")) {
            setSelectValue("highestEducationAttainment", payload.highestEducationAttainment || "");
        }
        if (byId("highestGradeYearLevel")) {
            setSelectValue("highestGradeYearLevel", payload.highestGradeYearLevel || "");
        }
        if (byId("schoolType")) {
            setSelectValue("schoolType", payload.schoolType || "");
        }
        if (byId("grantAppliedFor")) {
            setSelectValue("grantAppliedFor", payload.grantAppliedFor || "Degree Course");
        }
        let awards = normalizeAwardList(payload.awards);
        if (awards.length === 0) {
            awards = normalizeAwardList([
                {
                    awardNatureDescription: payload.awardNatureDescription || "",
                    awardSchoolName: payload.awardSchoolName || "",
                    awardSchoolYear: payload.awardSchoolYear || ""
                }
            ]);
        }
        renderAwardRows(awards);
        setRadioValue("fatherStatus", payload.fatherStatus || "");
        if (byId("fatherFirstName")) {
            byId("fatherFirstName").value = payload.fatherFirstName || "";
        }
        if (byId("fatherMiddleName")) {
            byId("fatherMiddleName").value = payload.fatherMiddleName || "";
        }
        if (byId("fatherLastName")) {
            byId("fatherLastName").value = payload.fatherLastName || "";
        }
        setRadioValue("motherStatus", payload.motherStatus || "");
        if (byId("motherFirstName")) {
            byId("motherFirstName").value = payload.motherFirstName || "";
        }
        if (byId("motherMiddleName")) {
            byId("motherMiddleName").value = payload.motherMiddleName || "";
        }
        if (byId("motherMaidenName")) {
            byId("motherMaidenName").value = payload.motherMaidenName || "";
        }
        if (byId("fatherAddress")) {
            byId("fatherAddress").value = payload.fatherAddress || "";
        }
        if (byId("motherAddress")) {
            byId("motherAddress").value = payload.motherAddress || "";
        }
        if (byId("fatherOccupation")) {
            byId("fatherOccupation").value = payload.fatherOccupation || "";
        }
        if (byId("fatherEducationAttainment")) {
            byId("fatherEducationAttainment").value = payload.fatherEducationAttainment || "";
        }
        if (byId("gwa")) {
            byId("gwa").value = payload.gwa || "";
        }
        if (byId("motherOccupation")) {
            byId("motherOccupation").value = payload.motherOccupation || "";
        }
        if (byId("motherEducationAttainment")) {
            byId("motherEducationAttainment").value = payload.motherEducationAttainment || "";
        }
        if (byId("totalParentsGrossIncome")) {
            byId("totalParentsGrossIncome").value = payload.totalParentsGrossIncome || "";
        }
        if (byId("childrenInFamily")) {
            byId("childrenInFamily").value = payload.childrenInFamily || "";
        }
        if (byId("brotherCount")) {
            byId("brotherCount").value = payload.brotherCount || "";
        }
        if (byId("sisterCount")) {
            byId("sisterCount").value = payload.sisterCount || "";
        }
        if (byId("spouseName")) {
            byId("spouseName").value = payload.spouseName || "";
        }
        if (byId("spouseChildrenCount")) {
            byId("spouseChildrenCount").value = payload.spouseChildrenCount || "";
        }
        if (byId("spouseOccupation")) {
            byId("spouseOccupation").value = payload.spouseOccupation || "";
        }
        if (byId("spouseEducation")) {
            byId("spouseEducation").value = payload.spouseEducation || "";
        }
        if (byId("intendedSchool")) {
            byId("intendedSchool").value = payload.intendedSchool || "";
        }
        if (byId("degreeProgramCourse")) {
            byId("degreeProgramCourse").value = payload.degreeProgramCourse || "";
        }
    }

    function collectApplicationPayload() {
        const schoolYear = nullIfBlank(byId("schoolYear") ? byId("schoolYear").value : "");
        const hiddenScholarshipType = nullIfBlank(byId("scholarshipType") ? byId("scholarshipType").value : "");
        const degreeProgramCourse = upperTextOrNull(byId("degreeProgramCourse") ? byId("degreeProgramCourse").value : "");
        const scholarshipType = degreeProgramCourse || hiddenScholarshipType;

        return {
            school_year: schoolYear,
            scholarship_type: scholarshipType,
            application_type: (byId("applicantCategory") && byId("applicantCategory").value === "renewal") ? "renewal" : "new",
            sector_classification: nullIfBlank(byId("additionalData") ? byId("additionalData").value : "")
        };
    }

    function collectProfilePayload() {
        const monthlyIncomeRaw = byId("totalParentsGrossIncome") ? byId("totalParentsGrossIncome").value : "";
        const monthlyIncomeParsed = monthlyIncomeRaw === "" ? null : Number(monthlyIncomeRaw);
        const middleNameInput = byId("middleName");
        const normalizedMiddleName = normalizeMiddleNameValue(middleNameInput ? middleNameInput.value : "");
        const fatherNameParts = [
            byId("fatherFirstName") ? byId("fatherFirstName").value : "",
            byId("fatherMiddleName") ? byId("fatherMiddleName").value : "",
            byId("fatherLastName") ? byId("fatherLastName").value : ""
        ]
            .map(function (value) {
                return (value || "").toString().trim().toUpperCase();
            })
            .filter(function (value) {
                return value.length > 0;
            });

        if (middleNameInput) {
            middleNameInput.value = normalizedMiddleName;
        }

        return {
            first_name: upperTextOrNull(byId("firstName") ? byId("firstName").value : ""),
            middle_name: normalizedMiddleName,
            last_name: upperTextOrNull(byId("lastName") ? byId("lastName").value : ""),
            sex: nullIfBlank(byId("sex") ? byId("sex").value : ""),
            civil_status: nullIfBlank(byId("civilStatus") ? byId("civilStatus").value : ""),
            date_of_birth: nullIfBlank(byId("dateOfBirth") ? byId("dateOfBirth").value : ""),
            address: upperTextOrNull(byId("permanentAddress") ? byId("permanentAddress").value : ""),
            mobile_number: normalizeMobileForStorage(byId("contactNumber") ? byId("contactNumber").value : ""),
            email: nullIfBlank(byId("emailAddress") ? byId("emailAddress").value.toLowerCase() : ""),
            school_name: upperTextOrNull(byId("schoolName") ? byId("schoolName").value : ""),
            course_or_strand: upperTextOrNull(byId("degreeProgramCourse") ? byId("degreeProgramCourse").value : ""),
            year_level: nullIfBlank(byId("highestGradeYearLevel") ? byId("highestGradeYearLevel").value : ""),
            guardian_name: fatherNameParts.length > 0 ? fatherNameParts.join(" ") : null,
            guardian_occupation: upperTextOrNull(byId("fatherOccupation") ? byId("fatherOccupation").value : ""),
            monthly_income: Number.isNaN(monthlyIncomeParsed) ? null : monthlyIncomeParsed
        };
    }

    function setInputValidity(inputId, isInvalid) {
        const input = byId(inputId);
        if (input) {
            input.classList.toggle("is-invalid", !!isInvalid);
            return;
        }
        const radioGroup = document.querySelectorAll("input[name=\"" + inputId + "\"]");
        if (radioGroup.length === 0) {
            return;
        }
        radioGroup.forEach(function (radio) {
            radio.classList.toggle("is-invalid", !!isInvalid);
        });
    }

    function setFileFeedback(inputId, message, isError) {
        const feedback = byId(inputId + "Feedback");
        if (!feedback) {
            return;
        }
        feedback.textContent = message || "";
        feedback.className = "form-text " + (isError ? "text-danger" : "text-muted");
    }

    function clearFileFeedback() {
        DOC_FIELDS.forEach(function (doc) {
            setFileFeedback(doc.inputId, "", false);
        });
    }

    function fileExtension(fileName) {
        const text = (fileName || "").toLowerCase();
        const index = text.lastIndexOf(".");
        if (index < 0) {
            return "";
        }
        return text.slice(index);
    }

    function setApplicantPhotoPreviewUrl(url) {
        const image = byId("reqApplicantPhotoPreview");
        const placeholder = byId("reqApplicantPhotoPlaceholder");
        if (!image || !placeholder) {
            return;
        }

        if (!url) {
            image.src = "";
            image.classList.add("d-none");
            placeholder.classList.remove("d-none");
            return;
        }

        image.src = url;
        image.classList.remove("d-none");
        placeholder.classList.add("d-none");
    }

    function clearApplicantPhotoPreviewObjectUrl() {
        if (!applicantPhotoPreviewObjectUrl) {
            return;
        }
        try {
            URL.revokeObjectURL(applicantPhotoPreviewObjectUrl);
        } catch (error) {
            // Ignore URL cleanup errors.
        }
        applicantPhotoPreviewObjectUrl = "";
    }

    function setApplicantPhotoPreview(file) {
        if (!file) {
            clearApplicantPhotoPreviewObjectUrl();
            setApplicantPhotoPreviewUrl("");
            return;
        }

        clearApplicantPhotoPreviewObjectUrl();
        try {
            applicantPhotoPreviewObjectUrl = URL.createObjectURL(file);
            setApplicantPhotoPreviewUrl(applicantPhotoPreviewObjectUrl);
        } catch (error) {
            setApplicantPhotoPreviewUrl("");
        }
    }

    async function loadStoredApplicantPhotoPreview(context, storagePath) {
        if (!context || !context.client || !storagePath) {
            return;
        }

        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return;
        }

        clearApplicantPhotoPreviewObjectUrl();
        const previewUrl = await window.ldssUploads.createObjectUrl(context, storagePath);
        if (!previewUrl) {
            return;
        }
        if (previewUrl.indexOf("blob:") === 0) {
            applicantPhotoPreviewObjectUrl = previewUrl;
        }
        setApplicantPhotoPreviewUrl(previewUrl);
    }

    function validateSelectedFiles() {
        const errors = [];
        clearFileFeedback();

        DOC_FIELDS.forEach(function (doc) {
            const input = byId(doc.inputId);
            if (!input || !input.files || input.files.length === 0) {
                return;
            }

            const file = input.files[0];
            if (!file) {
                return;
            }

            const extension = fileExtension(file.name);
            const type = (file.type || "").toLowerCase();
            const extensionAllowed = !doc.allowedExtensions || doc.allowedExtensions.includes(extension);
            const mimeAllowed = !type || !doc.allowedMimeTypes || doc.allowedMimeTypes.includes(type);

            if (!extensionAllowed || !mimeAllowed) {
                const typeMessage = "Invalid file type. Use " + (doc.fileTypeHint || "supported file format") + ".";
                setFileFeedback(doc.inputId, typeMessage, true);
                errors.push(doc.label + ": " + typeMessage);
                return;
            }

            const maxBytes = doc.maxSizeBytes || MAX_FILE_SIZE_BYTES;
            if (file.size > maxBytes) {
                const sizeMessage = "File exceeds 10MB limit.";
                setFileFeedback(doc.inputId, sizeMessage, true);
                errors.push(doc.label + ": " + sizeMessage);
                return;
            }

            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            setFileFeedback(doc.inputId, "Selected: " + file.name + " (" + sizeMb + " MB)", false);
        });

        return errors;
    }

    function validateFormFields(mode) {
        const errors = [];

        const schoolYear = byId("schoolYear") ? byId("schoolYear").value.trim() : "";
        const grantAppliedFor = byId("grantAppliedFor") ? byId("grantAppliedFor").value.trim() : "";
        const lastName = byId("lastName") ? byId("lastName").value.trim() : "";
        const firstName = byId("firstName") ? byId("firstName").value.trim() : "";
        const sex = byId("sex") ? byId("sex").value.trim() : "";
        const civilStatus = byId("civilStatus") ? byId("civilStatus").value.trim() : "";
        const religion = byId("religion") ? byId("religion").value.trim() : "";
        const dateOfBirth = byId("dateOfBirth") ? byId("dateOfBirth").value.trim() : "";
        const placeOfBirth = byId("placeOfBirth") ? byId("placeOfBirth").value.trim() : "";
        const additionalData = byId("additionalData") ? byId("additionalData").value.trim() : "";
        const permanentAddress = byId("permanentAddress") ? byId("permanentAddress").value.trim() : "";
        const contactNumber = byId("contactNumber") ? byId("contactNumber").value.trim() : "";
        const emailAddress = byId("emailAddress") ? byId("emailAddress").value.trim() : "";
        const highestEducationAttainment = byId("highestEducationAttainment") ? byId("highestEducationAttainment").value.trim() : "";
        const highestGradeYearLevel = byId("highestGradeYearLevel") ? byId("highestGradeYearLevel").value.trim() : "";
        const schoolName = byId("schoolName") ? byId("schoolName").value.trim() : "";
        const schoolType = byId("schoolType") ? byId("schoolType").value.trim() : "";
        const fatherStatus = getRadioValue("fatherStatus");
        const fatherFirstName = byId("fatherFirstName") ? byId("fatherFirstName").value.trim() : "";
        const fatherMiddleName = byId("fatherMiddleName") ? byId("fatherMiddleName").value.trim() : "";
        const fatherLastName = byId("fatherLastName") ? byId("fatherLastName").value.trim() : "";
        const motherStatus = getRadioValue("motherStatus");
        const motherFirstName = byId("motherFirstName") ? byId("motherFirstName").value.trim() : "";
        const motherMiddleName = byId("motherMiddleName") ? byId("motherMiddleName").value.trim() : "";
        const motherMaidenName = byId("motherMaidenName") ? byId("motherMaidenName").value.trim() : "";
        const fatherAddress = byId("fatherAddress") ? byId("fatherAddress").value.trim() : "";
        const motherAddress = byId("motherAddress") ? byId("motherAddress").value.trim() : "";
        const fatherOccupation = byId("fatherOccupation") ? byId("fatherOccupation").value.trim() : "";
        const motherOccupation = byId("motherOccupation") ? byId("motherOccupation").value.trim() : "";
        const fatherEducationAttainment = byId("fatherEducationAttainment") ? byId("fatherEducationAttainment").value.trim() : "";
        const motherEducationAttainment = byId("motherEducationAttainment") ? byId("motherEducationAttainment").value.trim() : "";
        const monthlyIncomeRaw = byId("totalParentsGrossIncome") ? byId("totalParentsGrossIncome").value.trim() : "";
        const childrenInFamilyRaw = byId("childrenInFamily") ? byId("childrenInFamily").value.trim() : "";
        const brotherCountRaw = byId("brotherCount") ? byId("brotherCount").value.trim() : "";
        const sisterCountRaw = byId("sisterCount") ? byId("sisterCount").value.trim() : "";
        const gwaRaw = byId("gwa") ? byId("gwa").value.trim() : "";
        const spouseName = byId("spouseName") ? byId("spouseName").value.trim() : "";
        const spouseChildrenCount = byId("spouseChildrenCount") ? byId("spouseChildrenCount").value.trim() : "";
        const spouseOccupation = byId("spouseOccupation") ? byId("spouseOccupation").value.trim() : "";
        const spouseEducation = byId("spouseEducation") ? byId("spouseEducation").value.trim() : "";
        const intendedSchool = byId("intendedSchool") ? byId("intendedSchool").value.trim() : "";
        const degreeProgramCourse = byId("degreeProgramCourse") ? byId("degreeProgramCourse").value.trim() : "";

        setInputValidity("schoolYear", !schoolYear);
        setInputValidity("grantAppliedFor", false);

        if (!schoolYear) {
            errors.push("School Year is required.");
        }
        if (schoolYear && !/^\d{4}-\d{4}$/.test(schoolYear)) {
            errors.push("School Year format must be YYYY-YYYY.");
            setInputValidity("schoolYear", true);
        }

        const submitting = mode === "submit";
        const requiredChecks = [
            { id: "lastName", label: "Last Name", value: lastName },
            { id: "firstName", label: "First Name", value: firstName },
            { id: "sex", label: "Sex", value: sex },
            { id: "civilStatus", label: "Status", value: civilStatus },
            { id: "religion", label: "Religion", value: religion },
            { id: "dateOfBirth", label: "Date of Birth", value: dateOfBirth },
            { id: "placeOfBirth", label: "Place of Birth", value: placeOfBirth },
            { id: "additionalData", label: "Sector Classification", value: additionalData },
            { id: "permanentAddress", label: "Permanent Address", value: permanentAddress },
            { id: "contactNumber", label: "Contact Number", value: contactNumber },
            { id: "emailAddress", label: "Email Address", value: emailAddress },
            { id: "highestEducationAttainment", label: "Highest Educational Attainment", value: highestEducationAttainment },
            { id: "highestGradeYearLevel", label: "Highest Grade/Year", value: highestGradeYearLevel },
            { id: "gwa", label: "General Weighted Average (0-100)", value: gwaRaw },
            { id: "schoolName", label: "School Name", value: schoolName },
            { id: "schoolType", label: "School Type", value: schoolType },
            { id: "grantAppliedFor", label: "Grant Applied For", value: grantAppliedFor },
            { id: "degreeProgramCourse", label: "Degree Course", value: degreeProgramCourse },
            { id: "fatherStatus", label: "Father", value: fatherStatus },
            { id: "motherStatus", label: "Mother", value: motherStatus },
            { id: "fatherFirstName", label: "Father First Name", value: fatherFirstName },
            { id: "fatherMiddleName", label: "Father Middle Name", value: fatherMiddleName },
            { id: "fatherLastName", label: "Father Surname", value: fatherLastName },
            { id: "motherFirstName", label: "Mother First Name", value: motherFirstName },
            { id: "motherMiddleName", label: "Mother Middle Name", value: motherMiddleName },
            { id: "motherMaidenName", label: "Mother Maiden Name", value: motherMaidenName },
            { id: "fatherAddress", label: "Father Address", value: fatherAddress },
            { id: "motherAddress", label: "Mother Address", value: motherAddress },
            { id: "fatherOccupation", label: "Father Occupation", value: fatherOccupation },
            { id: "motherOccupation", label: "Mother Occupation", value: motherOccupation },
            { id: "fatherEducationAttainment", label: "Father Educational Attainment", value: fatherEducationAttainment },
            { id: "motherEducationAttainment", label: "Mother Educational Attainment", value: motherEducationAttainment },
            { id: "totalParentsGrossIncome", label: "Total Parents Gross Income", value: monthlyIncomeRaw },
            { id: "childrenInFamily", label: "No. of Children in Family", value: childrenInFamilyRaw },
            { id: "brotherCount", label: "No. of Brothers", value: brotherCountRaw },
            { id: "sisterCount", label: "No. of Sisters", value: sisterCountRaw }
        ];

        requiredChecks.forEach(function (item) {
            const missing = submitting && !item.value;
            setInputValidity(item.id, missing);
            if (missing) {
                errors.push(item.label + " is required before submission.");
            }
        });

        if (contactNumber) {
            const normalizedMobile = normalizeMobileForStorage(contactNumber) || "";
            const validMobile = /^\+?\d{10,15}$/.test(normalizedMobile.replace(/\s+/g, ""));
            setInputValidity("contactNumber", !validMobile);
            if (!validMobile) {
                errors.push("Contact Number is invalid.");
            }
        }

        if (emailAddress) {
            const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress);
            setInputValidity("emailAddress", !validEmail);
            if (!validEmail) {
                errors.push("Email Address is invalid.");
            }
        }

        if (submitting && !monthlyIncomeRaw) {
            setInputValidity("totalParentsGrossIncome", true);
            errors.push("Total Parents Gross Income is required before submission.");
        } else if (monthlyIncomeRaw) {
            const income = Number(monthlyIncomeRaw);
            const invalidIncome = Number.isNaN(income) || income < 0;
            setInputValidity("totalParentsGrossIncome", invalidIncome);
            if (invalidIncome) {
                errors.push("Total Parents Gross Income must be a valid non-negative number.");
            }
        } else {
            setInputValidity("totalParentsGrossIncome", false);
        }

        if (gwaRaw) {
            const normalizedGwa = gwaRaw.replace(/%/g, "").trim();
            const gwa = Number(normalizedGwa);
            const invalidGwa = Number.isNaN(gwa) || gwa < 0 || gwa > 100;
            setInputValidity("gwa", invalidGwa);
            if (invalidGwa) {
                errors.push("General Weighted Average must be a number between 0 and 100.");
            } else if (byId("gwa")) {
                byId("gwa").value = normalizedGwa;
            }
        } else {
            setInputValidity("gwa", false);
        }

        const childrenInFamily = childrenInFamilyRaw === "" ? null : Number(childrenInFamilyRaw);
        const brotherCount = brotherCountRaw === "" ? null : Number(brotherCountRaw);
        const sisterCount = sisterCountRaw === "" ? null : Number(sisterCountRaw);
        const childrenInvalid =
            (childrenInFamily !== null && (Number.isNaN(childrenInFamily) || childrenInFamily < 0)) ||
            (brotherCount !== null && (Number.isNaN(brotherCount) || brotherCount < 0)) ||
            (sisterCount !== null && (Number.isNaN(sisterCount) || sisterCount < 0));

        if (childrenInvalid) {
            errors.push("Children/Brother/Sister counts must be valid non-negative numbers.");
        } else if (
            submitting &&
            childrenInFamily !== null &&
            brotherCount !== null &&
            sisterCount !== null &&
            childrenInFamily !== brotherCount + sisterCount
        ) {
            errors.push("No. of Children in Family must equal Brothers + Sisters.");
            setInputValidity("childrenInFamily", true);
            setInputValidity("brotherCount", true);
            setInputValidity("sisterCount", true);
        }

        ["spouseName", "spouseChildrenCount", "spouseOccupation", "spouseEducation", "intendedSchool"].forEach(function (id) {
            setInputValidity(id, false);
        });

        if (spouseChildrenCount) {
            const spouseChildren = Number(spouseChildrenCount);
            if (Number.isNaN(spouseChildren) || spouseChildren < 0) {
                errors.push("Spouse No. of Children must be a valid non-negative number.");
                setInputValidity("spouseChildrenCount", true);
            }
        }

        return errors;
    }

    function applyProfileToForm(profile) {
        if (!profile) {
            return;
        }
        if (byId("lastName")) {
            byId("lastName").value = profile.last_name || "";
        }
        if (byId("firstName")) {
            byId("firstName").value = profile.first_name || "";
        }
        if (byId("middleName")) {
            byId("middleName").value = profile.middle_name || "";
        }
        if (byId("sex")) {
            setSelectValue("sex", profile.sex || "");
        }
        if (byId("civilStatus")) {
            setSelectValue("civilStatus", profile.civil_status || "");
        }
        if (byId("dateOfBirth")) {
            byId("dateOfBirth").value = profile.date_of_birth || "";
        }
        if (byId("permanentAddress")) {
            byId("permanentAddress").value = profile.address || "";
        }
        if (byId("contactNumber")) {
            byId("contactNumber").value = mobileForInput(profile.mobile_number || "");
        }
        if (byId("emailAddress")) {
            byId("emailAddress").value = profile.email || "";
        }
        if (byId("schoolName")) {
            byId("schoolName").value = profile.school_name || "";
        }
        if (byId("highestGradeYearLevel")) {
            setSelectValue("highestGradeYearLevel", profile.year_level || "");
        }
        if (byId("fatherOccupation")) {
            byId("fatherOccupation").value = profile.guardian_occupation || "";
        }
        if (byId("degreeProgramCourse")) {
            byId("degreeProgramCourse").value = profile.course_or_strand || "";
        }
        if (byId("totalParentsGrossIncome")) {
            byId("totalParentsGrossIncome").value = profile.monthly_income || "";
        }
    }

    function applyApplicationToForm(application) {
        if (!application) {
            return;
        }
        setSelectValue("schoolYear", application.school_year || "");
        if (byId("scholarshipType")) {
            byId("scholarshipType").value = application.scholarship_type || "";
        }
        if (byId("grantAppliedFor")) {
            setSelectValue("grantAppliedFor", "Degree Course");
        }
        if (byId("degreeProgramCourse") && !byId("degreeProgramCourse").value && application.scholarship_type) {
            byId("degreeProgramCourse").value = application.scholarship_type;
        }
        if (byId("additionalData")) {
            setSelectValue("additionalData", application.sector_classification || "");
        }
        setSelectValue("applicantCategory", application.application_type || "new");
        setApplicationIdDisplay(application.application_no || "");
    }

    function isEditable(application) {
        if (!application) {
            return true;
        }
        if (application.is_locked) {
            return false;
        }
        return EDITABLE_STATUSES.includes(application.status);
    }

    function setFormEditableState(editable) {
        const fieldIds = [
            "schoolYear",
            "scholarshipType",
            "applicantCategory",
            "lastName",
            "firstName",
            "middleName",
            "sex",
            "civilStatus",
            "religion",
            "dateOfBirth",
            "placeOfBirth",
            "additionalData",
            "permanentAddress",
            "contactNumber",
            "emailAddress",
            "highestEducationAttainment",
            "highestGradeYearLevel",
            "schoolName",
            "schoolType",
            "grantAppliedFor",
            "fatherFirstName",
            "fatherMiddleName",
            "fatherLastName",
            "motherFirstName",
            "motherMiddleName",
            "motherMaidenName",
            "fatherAddress",
            "motherAddress",
            "fatherOccupation",
            "fatherEducationAttainment",
            "gwa",
            "motherOccupation",
            "motherEducationAttainment",
            "totalParentsGrossIncome",
            "childrenInFamily",
            "brotherCount",
            "sisterCount",
            "spouseName",
            "spouseChildrenCount",
            "spouseOccupation",
            "spouseEducation",
            "intendedSchool",
            "degreeProgramCourse",
            "reqApplicantPhoto",
            "applicationAgreement",
            "privacyNoticeAgreement",
            "awardAddBtn",
            "saveDraftBtn",
            "submitApplicationBtn"
        ];
        fieldIds.forEach(function (id) {
            const el = byId(id);
            if (el) {
                el.disabled = !editable;
            }
        });
        setRadioGroupDisabled("fatherStatus", !editable);
        setRadioGroupDisabled("motherStatus", !editable);
        document.querySelectorAll("#awardsRows [data-award-input='true']").forEach(function (input) {
            input.disabled = !editable;
        });
        updateAwardControlsState(editable);
    }

    function setActionLoading(mode, isLoading) {
        const saveBtn = byId("saveDraftBtn");
        const submitBtn = byId("submitApplicationBtn");
        if (!saveBtn || !submitBtn) {
            return;
        }
        if (!isLoading) {
            saveBtn.disabled = false;
            submitBtn.disabled = false;
            saveBtn.textContent = "Save Draft";
            submitBtn.textContent = "Submit Application";
            if (!isEditable(currentApplication)) {
                setFormEditableState(false);
            }
            return;
        }

        saveBtn.disabled = true;
        submitBtn.disabled = true;
        if (mode === "submit") {
            submitBtn.textContent = "Submitting...";
        } else {
            saveBtn.textContent = "Saving...";
        }
    }

    async function loadProfile(context) {
        const result = await context.client
            .from("profiles")
            .select("first_name, middle_name, last_name, sex, civil_status, date_of_birth, address, mobile_number, email, school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income, applicant_photo_path")
            .eq("id", context.user.id)
            .single();

        if (result.error || !result.data) {
            return readProfileCache(context.user.id);
        }
        writeProfileCache(context.user.id, result.data);
        return result.data;
    }

    async function loadApplication(context, applicationId) {
        let result = await context.client
            .from("applications")
            .select(applicationSelectFields())
            .eq("id", applicationId)
            .eq("applicant_id", context.user.id)
            .single();

        if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(result.error, "sector_classification")) {
            applicationsSupportsSectorClassification = false;
            result = await context.client
                .from("applications")
                .select(applicationSelectFields())
                .eq("id", applicationId)
                .eq("applicant_id", context.user.id)
                .single();
        }

        if (result.error) {
            return null;
        }
        return result.data;
    }

    async function findLatestEditableDraft(context) {
        const result = await context.client
            .from("applications")
            .select("id, application_no, status")
            .eq("applicant_id", context.user.id)
            .in("status", EDITABLE_STATUSES)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }
        return result.data[0];
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

    function describeIntakeClosedReason(policy) {
        if (!policy) {
            return "New application filing is currently closed by System Administrator.";
        }
        if (policy.reason === "before_open_date" && policy.openDate) {
            return "New application filing opens on " + formatDate(policy.openDate) + ".";
        }
        if (policy.reason === "after_close_date" && policy.closeDate) {
            return "New application filing closed on " + formatDate(policy.closeDate) + ".";
        }
        if (policy.reason === "closed_by_admin") {
            return "New application filing is currently turned OFF by System Administrator.";
        }
        return "New application filing is currently closed by System Administrator.";
    }

    async function loadIntakePolicy(context) {
        const fallback = {
            isOpen: true,
            reason: "open",
            openDate: "",
            closeDate: ""
        };

        const result = await context.client.rpc("application_intake_is_open");
        if (result.error || !result.data || typeof result.data !== "object") {
            return fallback;
        }

        return {
            isOpen: result.data.is_open !== false,
            reason: (result.data.reason || "open").toString(),
            openDate: toIsoDateOnly(result.data.open_date || ""),
            closeDate: toIsoDateOnly(result.data.close_date || "")
        };
    }

    async function assertApplicationIntakeOpen(context) {
        const policy = await loadIntakePolicy(context);
        if (policy.isOpen) {
            return;
        }
        throw new Error(describeIntakeClosedReason(policy));
    }

    async function findExistingAttemptForSchoolYear(context, schoolYear, excludeApplicationId) {
        const normalizedSchoolYear = nullIfBlank(schoolYear);
        if (!normalizedSchoolYear) {
            return null;
        }

        let query = context.client
            .from("applications")
            .select("id, application_no, school_year, status")
            .eq("applicant_id", context.user.id)
            .eq("school_year", normalizedSchoolYear)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (excludeApplicationId) {
            query = query.neq("id", excludeApplicationId);
        }

        const result = await query;
        if (result.error || !result.data || result.data.length === 0) {
            return null;
        }

        return result.data[0];
    }

    async function ensureSingleAttemptPerSchoolYear(context, schoolYear, excludeApplicationId) {
        const existing = await findExistingAttemptForSchoolYear(context, schoolYear, excludeApplicationId);
        if (!existing) {
            return;
        }

        const existingRef = existing.application_no || existing.id;
        const selectedYear = existing.school_year || schoolYear;
        const trackingLink = "application-detail.html?id=" + encodeURIComponent(existing.id);

        throw new Error(
            "Only one application attempt per school year is allowed. " +
            "You already have " +
            existingRef +
            " for " +
            selectedYear +
            ". Open tracking: " +
            trackingLink
        );
    }

    async function saveProfile(context) {
        const patch = collectProfilePayload();
        const result = await context.client
            .from("profiles")
            .update(patch)
            .eq("id", context.user.id)
            .select("first_name, middle_name, last_name, sex, civil_status, date_of_birth, address, mobile_number, email, school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income, applicant_photo_path")
            .single();

        if (result.error) {
            return result.error.message;
        }
        if (result.data) {
            writeProfileCache(context.user.id, result.data);
        }
        return "";
    }

    async function saveApplicantPhotoPath(context, storagePath) {
        if (!storagePath) {
            return "";
        }

        const result = await context.client
            .from("profiles")
            .update({ applicant_photo_path: storagePath })
            .eq("id", context.user.id)
            .select("first_name, middle_name, last_name, sex, civil_status, date_of_birth, address, mobile_number, email, school_name, course_or_strand, year_level, guardian_name, guardian_occupation, monthly_income, applicant_photo_path")
            .single();

        if (result.error) {
            return result.error.message || "Failed to sync applicant photo path.";
        }

        if (result.data) {
            writeProfileCache(context.user.id, result.data);
        }

        return "";
    }

    async function saveOrCreateDraft(context) {
        const payload = collectApplicationPayload();
        if (!payload.school_year || !payload.scholarship_type) {
            throw new Error("School Year and Scholarship Type are required.");
        }

        await ensureSingleAttemptPerSchoolYear(
            context,
            payload.school_year,
            currentApplication && currentApplication.id ? currentApplication.id : ""
        );

        if (currentApplication) {
            if (!isEditable(currentApplication)) {
                throw new Error("This application is no longer editable.");
            }
            let updateResult = await context.client
                .from("applications")
                .update(applicationMutationPayload({
                    school_year: payload.school_year,
                    scholarship_type: payload.scholarship_type,
                    application_type: payload.application_type,
                    sector_classification: payload.sector_classification
                }))
                .eq("id", currentApplication.id)
                .eq("applicant_id", context.user.id)
                .select(applicationSelectFields())
                .single();

            if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(updateResult.error, "sector_classification")) {
                applicationsSupportsSectorClassification = false;
                updateResult = await context.client
                    .from("applications")
                    .update(applicationMutationPayload({
                        school_year: payload.school_year,
                        scholarship_type: payload.scholarship_type,
                        application_type: payload.application_type,
                        sector_classification: payload.sector_classification
                    }))
                    .eq("id", currentApplication.id)
                    .eq("applicant_id", context.user.id)
                    .select(applicationSelectFields())
                    .single();
            }

            if (updateResult.error) {
                throw new Error(updateResult.error.message);
            }
            currentApplication = updateResult.data;
            setApplicationIdDisplay(currentApplication.application_no || "");
            return currentApplication;
        }

        await assertApplicationIntakeOpen(context);

        let insertResult = await context.client
            .from("applications")
            .insert(applicationMutationPayload({
                applicant_id: context.user.id,
                school_year: payload.school_year,
                scholarship_type: payload.scholarship_type,
                application_type: payload.application_type,
                sector_classification: payload.sector_classification,
                status: "draft"
            }))
            .select(applicationSelectFields())
            .single();

        if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(insertResult.error, "sector_classification")) {
            applicationsSupportsSectorClassification = false;
            insertResult = await context.client
                .from("applications")
                .insert(applicationMutationPayload({
                    applicant_id: context.user.id,
                    school_year: payload.school_year,
                    scholarship_type: payload.scholarship_type,
                    application_type: payload.application_type,
                    sector_classification: payload.sector_classification,
                    status: "draft"
                }))
                .select(applicationSelectFields())
                .single();
        }

        if (insertResult.error) {
            throw new Error(insertResult.error.message);
        }

        currentApplication = insertResult.data;
        setApplicationIdDisplay(currentApplication.application_no || "");
        window.history.replaceState({}, "", "applicant-application-form.html?application_id=" + encodeURIComponent(currentApplication.id));
        return currentApplication;
    }

    async function submitApplication(context) {
        if (!currentApplication || !currentApplication.id) {
            throw new Error("No draft application found to submit.");
        }
        if (!isEditable(currentApplication)) {
            throw new Error("This application is no longer editable.");
        }

        await ensureSingleAttemptPerSchoolYear(
            context,
            currentApplication.school_year,
            currentApplication.id
        );

        let result = await context.client
            .from("applications")
            .update({
                status: "submitted",
                submitted_at: new Date().toISOString()
            })
            .eq("id", currentApplication.id)
            .eq("applicant_id", context.user.id)
            .select(applicationSelectFields())
            .single();

        if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(result.error, "sector_classification")) {
            applicationsSupportsSectorClassification = false;
            result = await context.client
                .from("applications")
                .update({
                    status: "submitted",
                    submitted_at: new Date().toISOString()
                })
                .eq("id", currentApplication.id)
                .eq("applicant_id", context.user.id)
                .select(applicationSelectFields())
                .single();
        }

        if (result.error) {
            throw new Error(result.error.message);
        }

        currentApplication = result.data;
        setApplicationIdDisplay(currentApplication.application_no || "");
        return currentApplication;
    }

    async function upsertDocumentRow(context, applicationId, docType, storagePath, file) {
        const existing = await context.client
            .from("application_documents")
            .select("id")
            .eq("application_id", applicationId)
            .eq("document_type", docType)
            .order("created_at", { ascending: false })
            .limit(1);

        if (existing.error) {
            return existing.error.message;
        }

        const payload = {
            application_id: applicationId,
            document_type: docType,
            storage_path: storagePath,
            original_filename: file.name,
            mime_type: file.type || "application/octet-stream",
            file_size_bytes: file.size,
            verification_status: "pending",
            verification_notes: null,
            uploaded_by: context.user.id
        };

        if (existing.data && existing.data.length > 0) {
            const updateResult = await context.client
                .from("application_documents")
                .update(payload)
                .eq("id", existing.data[0].id);
            return updateResult.error ? updateResult.error.message : "";
        }

        const insertResult = await context.client
            .from("application_documents")
            .insert(payload);
        return insertResult.error ? insertResult.error.message : "";
    }

    async function uploadSelectedDocuments(context, applicationId) {
        const uploaded = [];
        const errors = [];
        let fatalCode = "";

        for (const doc of DOC_FIELDS) {
            const input = byId(doc.inputId);
            if (!input || !input.files || input.files.length === 0) {
                continue;
            }

            const file = input.files[0];
            if (!file) {
                continue;
            }
            const maxBytes = doc.maxSizeBytes || MAX_FILE_SIZE_BYTES;
            if (file.size > maxBytes) {
                errors.push(doc.label + ": file exceeds 10MB limit.");
                continue;
            }

            let path = "";
            try {
                if (!window.ldssUploads || typeof window.ldssUploads.uploadFile !== "function") {
                    throw new Error("Upload client is not available.");
                }
                const uploadResult = await window.ldssUploads.uploadFile(context, file, {
                    applicationId: applicationId,
                    documentType: doc.docType
                });
                path = uploadResult && uploadResult.path ? uploadResult.path : "";
                if (!path) {
                    throw new Error("Upload server did not return a file path.");
                }
            } catch (error) {
                const uploadMessage = error && error.message ? error.message : "Unknown upload error.";
                if (isUploadServerUnavailableMessage(uploadMessage)) {
                    fatalCode = "upload_server_unavailable";
                    errors.push(doc.label + ": " + uploadMessage);
                    break;
                }
                if (isUploadAccessDeniedMessage(uploadMessage)) {
                    fatalCode = "upload_access_denied";
                }
                errors.push(doc.label + ": " + uploadMessage);
                continue;
            }

            const rowErrorMessage = await upsertDocumentRow(context, applicationId, doc.docType, path, file);
            if (rowErrorMessage) {
                errors.push(doc.label + ": " + rowErrorMessage);
                continue;
            }

            if (doc.syncToProfilePhoto) {
                const profilePhotoError = await saveApplicantPhotoPath(context, path);
                if (profilePhotoError) {
                    errors.push(doc.label + ": " + profilePhotoError);
                    continue;
                }
            }

            uploaded.push(doc.label);
            input.value = "";
        }

        return {
            uploaded: uploaded,
            errors: errors,
            fatalCode: fatalCode
        };
    }

    async function getMissingRequiredDocuments(context, applicationId) {
        const result = await context.client
            .from("application_documents")
            .select("document_type")
            .eq("application_id", applicationId);

        if (result.error) {
            throw new Error(result.error.message);
        }

        const present = new Set((result.data || []).map(function (row) { return row.document_type; }));
        return DOC_FIELDS
            .filter(function (doc) {
                if (doc.requiredOnSubmit === false) {
                    return false;
                }
                return !present.has(doc.docType);
            })
            .map(function (doc) {
                return DOC_LABELS[doc.docType] || doc.docType;
            });
    }

    async function handleSaveDraft(context) {
        if (isSaving || isSubmitting) {
            return;
        }
        try {
            requireAgreementOrThrow("saving draft");
        } catch (error) {
            setStatus(error.message || "Please agree before saving draft.", "alert-warning");
            return;
        }

        isSaving = true;
        setStatus("", "");
        setActionLoading("draft", true);

        try {
            const fieldErrors = validateFormFields("draft");
            const fileErrors = validateSelectedFiles();
            const validationErrors = fieldErrors.concat(fileErrors);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join(" | "));
            }

            const application = await saveOrCreateDraft(context);
            writeAuxMeta(context.user.id, application.id);
            const profileErrorMessage = await saveProfile(context);
            const uploadResult = await uploadSelectedDocuments(context, application.id);

            if (uploadResult.errors.length > 0 || profileErrorMessage) {
                const details = [];
                if (profileErrorMessage) {
                    details.push("Profile update warning: " + profileErrorMessage);
                }
                if (uploadResult.errors.length > 0) {
                    details.push("Upload warnings: " + uploadResult.errors.join(" | "));
                    if (uploadResult.fatalCode === "upload_server_unavailable") {
                        details.push("Start the Node upload server and verify that LDSS_UPLOAD_API_BASE points to /api/uploads.");
                    } else if (uploadResult.fatalCode === "upload_access_denied") {
                        details.push("Check the Node upload server auth/config and try again.");
                    }
                }
                setStatus("Draft saved (" + (application.application_no || application.id) + "). " + details.join(" "), "alert-warning");
                return;
            }

            if (uploadResult.uploaded.length > 0) {
                setStatus(
                    "Draft saved (" + (application.application_no || application.id) + "). Uploaded: " + uploadResult.uploaded.join(", ") + ".",
                    "alert-success"
                );
            } else {
                setStatus("Draft saved (" + (application.application_no || application.id) + ").", "alert-success");
            }
        } catch (error) {
            setStatus("Failed to save draft: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            isSaving = false;
            setActionLoading("draft", false);
        }
    }

    async function runConfirmedSubmission(context) {
        if (isSubmitting || isSaving || !context) {
            return;
        }

        pendingSubmitContext = null;
        isSubmitting = true;
        setStatus("", "");
        setActionLoading("submit", true);

        try {
            const application = await saveOrCreateDraft(context);
            writeAuxMeta(context.user.id, application.id);
            const profileErrorMessage = await saveProfile(context);

            const uploadResult = await uploadSelectedDocuments(context, application.id);
            if (uploadResult.errors.length > 0) {
                if (uploadResult.fatalCode === "upload_server_unavailable") {
                    throw new Error(
                        "Upload server is not available. Start the Node server and make sure /api/uploads is reachable."
                    );
                }
                if (uploadResult.fatalCode === "upload_access_denied") {
                    throw new Error(
                        "Upload request was denied by the Node upload server. Check server auth/config, then retry."
                    );
                }
                throw new Error(
                    "Unable to submit because some uploads failed. " +
                    uploadResult.errors.join(" | ")
                );
            }

            const missingDocs = await getMissingRequiredDocuments(context, application.id);
            if (missingDocs.length > 0) {
                throw new Error("Missing required uploads: " + missingDocs.join(", ") + ".");
            }

            const submitted = await submitApplication(context);
            setFormEditableState(false);
            if (profileErrorMessage) {
                setStatus(
                    "Application submitted (" + (submitted.application_no || submitted.id) + "). Profile warning: " + profileErrorMessage,
                    "alert-warning"
                );
            } else {
                setStatus("Application submitted (" + (submitted.application_no || submitted.id) + ").", "alert-success");
            }
            showSubmittedModal(submitted, profileErrorMessage);
        } catch (error) {
            setStatus("Submission failed: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            isSubmitting = false;
            setActionLoading("submit", false);
        }
    }

    async function handleSubmit(context) {
        if (isSubmitting || isSaving) {
            return;
        }
        try {
            requireAgreementOrThrow("submitting");
            requirePrivacyNoticeOrThrow("submitting");

            const fieldErrors = validateFormFields("submit");
            const fileErrors = validateSelectedFiles();
            const validationErrors = fieldErrors.concat(fileErrors);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join(" | "));
            }
        } catch (error) {
            setStatus(error.message || "Please agree before submission.", "alert-warning");
            return;
        }

        pendingSubmitContext = context;
        if (openApplicationPolicyModal()) {
            return;
        }

        const confirmed = window.confirm(
            "Only one application submission is allowed per school year.\n\n" +
                "After you submit this application, please wait for the examination schedule or further notice from the scholarship office.\n\n" +
                "Do you want to continue?"
        );
        if (!confirmed) {
            pendingSubmitContext = null;
            return;
        }

        await runConfirmedSubmission(context);
    }

    function bindInlineValidation() {
        const inputIds = [
            "schoolYear",
            "scholarshipType",
            "lastName",
            "firstName",
            "middleName",
            "sex",
            "civilStatus",
            "religion",
            "dateOfBirth",
            "placeOfBirth",
            "additionalData",
            "permanentAddress",
            "contactNumber",
            "emailAddress",
            "highestEducationAttainment",
            "highestGradeYearLevel",
            "schoolName",
            "schoolType",
            "grantAppliedFor",
            "fatherFirstName",
            "fatherMiddleName",
            "fatherLastName",
            "motherFirstName",
            "motherMiddleName",
            "motherMaidenName",
            "fatherAddress",
            "motherAddress",
            "fatherOccupation",
            "fatherEducationAttainment",
            "motherOccupation",
            "motherEducationAttainment",
            "totalParentsGrossIncome",
            "childrenInFamily",
            "brotherCount",
            "sisterCount",
            "spouseName",
            "spouseChildrenCount",
            "spouseOccupation",
            "spouseEducation",
            "intendedSchool",
            "degreeProgramCourse",
            "gwa"
        ];
        inputIds.forEach(function (id) {
            const input = byId(id);
            if (!input) {
                return;
            }
            input.addEventListener("input", function () {
                enforceUppercaseFieldValue(input);
                input.classList.remove("is-invalid");
            });
            input.addEventListener("change", function () {
                enforceUppercaseFieldValue(input);
                input.classList.remove("is-invalid");
            });
        });

        ["fatherStatus", "motherStatus"].forEach(function (name) {
            document.querySelectorAll("input[name=\"" + name + "\"]").forEach(function (input) {
                input.addEventListener("change", function () {
                    setInputValidity(name, false);
                });
            });
        });

        DOC_FIELDS.forEach(function (doc) {
            const input = byId(doc.inputId);
            if (!input) {
                return;
            }
            input.addEventListener("change", function () {
                validateSelectedFiles();
                if (doc.inputId === "reqApplicantPhoto") {
                    const selected = input.files && input.files[0] ? input.files[0] : null;
                    setApplicantPhotoPreview(selected);
                }
            });
        });

        const agreementCheckbox = byId("applicationAgreement");
        if (agreementCheckbox) {
            agreementCheckbox.addEventListener("change", function () {
                setAgreementValidity(!agreementCheckbox.checked);
            });
        }

        const privacyCheckbox = byId("privacyNoticeAgreement");
        if (privacyCheckbox) {
            privacyCheckbox.addEventListener("change", function () {
                setPrivacyNoticeValidity(!privacyCheckbox.checked);
            });
        }

        const openPrivacyBtn = byId("openPrivacyNoticeBtn");
        if (openPrivacyBtn) {
            openPrivacyBtn.addEventListener("click", function () {
                openPrivacyModalForReview();
            });
        }

        const privacyAcknowledgeBtn = byId("dataPrivacyAcknowledgeBtn");
        if (privacyAcknowledgeBtn) {
            privacyAcknowledgeBtn.addEventListener("click", function () {
                acknowledgePrivacyNotice();
            });
        }

        const policyConfirmBtn = byId("applicationPolicyConfirmBtn");
        if (policyConfirmBtn) {
            policyConfirmBtn.addEventListener("click", function () {
                const modal = getApplicationPolicyModal();
                if (modal) {
                    modal.hide();
                }
                runConfirmedSubmission(pendingSubmitContext);
            });
        }

        const awardsContainer = byId("awardsRows");
        if (awardsContainer) {
            awardsContainer.addEventListener("input", function (event) {
                const target = event.target;
                if (target && target.matches("[data-award-input='true']")) {
                    enforceUppercaseFieldValue(target);
                    target.classList.remove("is-invalid");
                }
            });
            awardsContainer.addEventListener("change", function (event) {
                const target = event.target;
                if (target && target.matches("[data-award-input='true']")) {
                    enforceUppercaseFieldValue(target);
                    target.classList.remove("is-invalid");
                }
            });
            awardsContainer.addEventListener("click", function (event) {
                const target = event.target;
                if (!target || !target.closest) {
                    return;
                }
                const removeBtn = target.closest("[data-award-remove='true']");
                if (!removeBtn) {
                    return;
                }
                removeAwardRow(removeBtn);
            });
        }

        const awardAddBtn = byId("awardAddBtn");
        if (awardAddBtn) {
            awardAddBtn.addEventListener("click", function () {
                addAwardRow();
            });
        }

        const openTrackingBtn = byId("applicationSubmittedModalOpenBtn");
        if (openTrackingBtn) {
            openTrackingBtn.addEventListener("click", function () {
                if (!submittedTrackingUrl) {
                    return;
                }
                window.location.href = submittedTrackingUrl;
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        submittedTrackingUrl = "";
        pendingSubmitContext = null;
        setAgreementValidity(false);
        setPrivacyNoticeValidity(false);
        const openTrackingBtn = byId("applicationSubmittedModalOpenBtn");
        if (openTrackingBtn) {
            openTrackingBtn.disabled = true;
        }

        renderAwardRows([]);

        const profile = await loadProfile(context);
        applyProfileToForm(profile);
        if (profile && profile.applicant_photo_path) {
            await loadStoredApplicantPhotoPreview(context, profile.applicant_photo_path);
        }

        const query = parseQuery();
        if (query.applicationId) {
            const existing = await loadApplication(context, query.applicationId);
            if (!existing) {
                setStatus("Requested draft was not found. You can create a new application below.", "alert-warning");
            } else {
                currentApplication = existing;
                applyApplicationToForm(existing);
                applyAuxMeta(context.user.id, existing.id);

                if (!isEditable(existing)) {
                    setFormEditableState(false);
                    const detailLink = "application-detail.html?id=" + encodeURIComponent(existing.id);
                    setStatus(
                        "This application is already submitted or locked. Use tracking page instead: <a href=\"" + detailLink + "\">Open Tracking</a>.",
                        "alert-warning",
                        true
                    );
                    return;
                }
            }
        } else {
            const latestDraft = await findLatestEditableDraft(context);
            if (latestDraft) {
                const continueLink = "applicant-application-form.html?application_id=" + encodeURIComponent(latestDraft.id);
                setStatus(
                    "You have an existing draft (" + latestDraft.application_no + "). <a href=\"" + continueLink + "\">Continue Draft</a> or start a new one below.",
                    "alert-info",
                    true
                );
            } else {
                const intakePolicy = await loadIntakePolicy(context);
                if (!intakePolicy.isOpen) {
                    setFormEditableState(false);
                    setStatus(describeIntakeClosedReason(intakePolicy), "alert-warning");
                }
            }
            applyAuxMeta(context.user.id, "new");
        }

        const saveBtn = byId("saveDraftBtn");
        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                handleSaveDraft(context);
            });
        }

        const submitBtn = byId("submitApplicationBtn");
        if (submitBtn) {
            submitBtn.addEventListener("click", function () {
                handleSubmit(context);
            });
        }

        bindInlineValidation();

        if (!hasPrivacyNoticeAgreement()) {
            window.setTimeout(function () {
                openPrivacyModalForReview();
            }, 120);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
