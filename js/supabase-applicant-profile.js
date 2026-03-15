(function () {
    "use strict";

    const PROFILE_CACHE_PREFIX = "ldss:profile-cache:";

    function byId(id) {
        return document.getElementById(id);
    }

    function profileCacheKey(userId) {
        return PROFILE_CACHE_PREFIX + userId;
    }

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        return {
            completeBarangay: params.get("complete") === "barangay",
            completeGender: params.get("complete") === "gender"
        };
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

    function textValue(value, fallback) {
        const normalized = (value || "").toString().trim();
        if (normalized) {
            return normalized;
        }
        return fallback || "-";
    }

    function showProfileStatus(message, type) {
        const target = byId("profileStatus");
        if (!target) {
            return;
        }
        target.textContent = message;
        target.className = "alert " + (type || "alert-info");
        target.classList.remove("d-none");
    }

    function hideProfileStatus() {
        const target = byId("profileStatus");
        if (!target) {
            return;
        }
        target.classList.add("d-none");
        target.textContent = "";
    }

    function formatDateDisplay(value) {
        if (!value) {
            return "-";
        }
        const parsed = new Date(value + "T00:00:00");
        if (Number.isNaN(parsed.getTime())) {
            return textValue(value);
        }
        return parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    function formatIncomeDisplay(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "-";
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return textValue(value);
        }
        return "PHP " + numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatMobileDisplay(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return "-";
        }
        if (/^\+639\d{9}$/.test(raw)) {
            const local = "0" + raw.slice(3);
            return local.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3");
        }
        return raw;
    }

    function normalizeMobileForStorage(value) {
        const raw = (value || "").toString().trim();
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

    function explainProfileSaveError(message) {
        const text = (message || "").toString();
        const normalized = text.toLowerCase();
        if (
            normalized.includes("profiles_mobile_number_key") ||
            (normalized.includes("duplicate key value") && normalized.includes("mobile_number"))
        ) {
            return "Mobile number is already used by another account. Please enter a different contact number.";
        }
        return text;
    }

    function setText(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = textValue(value);
        }
    }

    function setProfileOverviewPhoto(url, useFallback) {
        const image = byId("profileOverviewPhoto");
        if (!image) {
            return;
        }

        const fallbackSrc = "../img/daet-lgu.png";
        image.src = url || fallbackSrc;
        image.classList.remove("ldss-profile-avatar-image", "ldss-profile-avatar-photo");
        image.classList.add(useFallback ? "ldss-profile-avatar-image" : "ldss-profile-avatar-photo");
        image.alt = useFallback ? "Daet LGU Logo" : "Applicant 1x1 Photo";
        image.onerror = function () {
            image.onerror = null;
            image.src = fallbackSrc;
            image.classList.remove("ldss-profile-avatar-photo");
            image.classList.add("ldss-profile-avatar-image");
            image.alt = "Daet LGU Logo";
        };
    }

    function isMissingApplicationsColumnError(error, columnName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedColumn = (columnName || "").toString().toLowerCase();
        if (!text || !normalizedColumn) {
            return false;
        }
        return text.includes(normalizedColumn) && (text.includes("does not exist") || text.includes("schema cache"));
    }

    function auxMetaKey(userId, applicationId) {
        return "ldss:application-form-meta:" + userId + ":" + (applicationId || "new");
    }

    function readAuxMeta(userId, applicationId) {
        if (!userId || !applicationId) {
            return {};
        }
        try {
            const raw = localStorage.getItem(auxMetaKey(userId, applicationId));
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function buildPersonName(parts, fallback) {
        const normalized = (parts || [])
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(function (value) {
                return value.length > 0 && value !== "N/A";
            });
        if (normalized.length > 0) {
            return normalized.join(" ");
        }
        return textValue(fallback);
    }

    function selectSetValue(selectElement, value) {
        if (!selectElement) {
            return;
        }
        const normalized = (value || "").toString().trim();
        if (!normalized) {
            return;
        }
        const option = Array.from(selectElement.options).find(function (opt) {
            return opt.value.toLowerCase() === normalized.toLowerCase();
        });
        if (option) {
            selectElement.value = option.value;
            return;
        }
        const dynamicOption = document.createElement("option");
        dynamicOption.value = normalized;
        dynamicOption.textContent = normalized;
        selectElement.appendChild(dynamicOption);
        selectElement.value = normalized;
    }

    function composeFullName(profile) {
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });
        return parts.join(" ");
    }

    function splitFullName(fullName) {
        const parts = (fullName || "")
            .split(/\s+/)
            .map(function (value) {
                return value.trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });

        if (parts.length === 0) {
            return { first_name: "", middle_name: "", last_name: "" };
        }
        if (parts.length === 1) {
            return { first_name: parts[0], middle_name: "", last_name: "" };
        }
        if (parts.length === 2) {
            return { first_name: parts[0], middle_name: "", last_name: parts[1] };
        }
        return {
            first_name: parts[0],
            middle_name: parts.slice(1, -1).join(" "),
            last_name: parts[parts.length - 1]
        };
    }

    function normalizeBarangayLabel(rawValue) {
        const cleaned = textValue(rawValue, "").replace(/\s+/g, " ").trim();
        if (!cleaned) {
            return "";
        }
        const lower = cleaned.toLowerCase();
        if (lower.includes("daet")) {
            return cleaned;
        }
        if (lower.startsWith("barangay ")) {
            return cleaned + ", Daet";
        }
        return "Barangay " + cleaned + ", Daet";
    }

    function buildFullAddress(profile) {
        const address = textValue(profile && profile.address, "");
        const barangay = normalizeBarangayLabel(profile && profile.barangay);

        if (!address && !barangay) {
            return "-";
        }
        if (!address) {
            return barangay || "-";
        }
        if (!barangay) {
            return address;
        }

        const addressLower = address.toLowerCase();
        const rawBarangay = textValue(profile && profile.barangay, "").toLowerCase();
        const normalizedBarangay = barangay.toLowerCase();
        if (
            (rawBarangay && addressLower.includes(rawBarangay)) ||
            addressLower.includes(normalizedBarangay) ||
            addressLower.includes(normalizedBarangay.replace(", daet", ""))
        ) {
            return address;
        }

        return address + ", " + barangay;
    }

    function parseBarangayText(text) {
        if (!text) {
            return [];
        }
        const seen = new Set();
        return text
            .split(/\r?\n/)
            .map(function (line) {
                return line.replace(/^\s*\d+\s*[\.\)-]\s*/, "").replace(/^\s*[-*]\s*/, "").trim();
            })
            .filter(function (line) {
                return line.length > 0;
            })
            .map(function (line) {
                return normalizeBarangayLabel(line);
            })
            .filter(function (line) {
                if (!line) {
                    return false;
                }
                const key = line.toLowerCase();
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
    }

    async function loadBarangayDropdown(selectedValue) {
        const select = byId("modalBarangay");
        if (!select) {
            return;
        }

        const sourceFiles = ["../BARANGAY-DAET.TXT", "../BARANGAY-DAET LIST.TXT"];
        let barangays = [];

        for (const filePath of sourceFiles) {
            try {
                const response = await fetch(filePath, { cache: "no-store" });
                if (!response.ok) {
                    continue;
                }
                const text = await response.text();
                const parsed = parseBarangayText(text);
                if (parsed.length > 0) {
                    barangays = parsed;
                    break;
                }
            } catch (error) {
                // Keep fallback option if file is unavailable.
            }
        }

        select.innerHTML = "";
        if (barangays.length === 0) {
            const fallback = normalizeBarangayLabel(selectedValue) || "Barangay Alawihao, Daet";
            const option = document.createElement("option");
            option.value = fallback;
            option.textContent = fallback;
            option.selected = true;
            select.appendChild(option);
            return;
        }

        barangays.forEach(function (label) {
            const option = document.createElement("option");
            option.value = label;
            option.textContent = label;
            select.appendChild(option);
        });

        const selectedNormalized = normalizeBarangayLabel(selectedValue);
        if (selectedNormalized) {
            selectSetValue(select, selectedNormalized);
        }
    }

    async function ensureProfileRow(context) {
        const profileQuery = await context.client.from("profiles").select("*").eq("id", context.user.id).single();
        if (!profileQuery.error && profileQuery.data) {
            return profileQuery.data;
        }

        const insertPayload = {
            id: context.user.id,
            role: "applicant",
            email: context.user.email || null
        };
        const upsertResult = await context.client.from("profiles").upsert(insertPayload, { onConflict: "id" }).select("*").single();
        if (upsertResult.error) {
            throw upsertResult.error;
        }
        return upsertResult.data;
    }

    async function loadLatestApplicationSummary(context, profile) {
        let latest = await context.client
            .from("applications")
            .select("id, application_no, sector_classification")
            .eq("applicant_id", context.user.id)
            .order("created_at", { ascending: false })
            .limit(1);

        if (latest.error && isMissingApplicationsColumnError(latest.error, "sector_classification")) {
            latest = await context.client
                .from("applications")
                .select("id, application_no")
                .eq("applicant_id", context.user.id)
                .order("created_at", { ascending: false })
                .limit(1);
        }

        if (latest.error || !latest.data || latest.data.length === 0) {
            setText("profileLatestApplicationNo", "-");
            setText("profileLatestScholarshipType", "DEGREE COURSE");
            return;
        }

        const row = latest.data[0];
        setText("profileLatestApplicationNo", row.application_no);
        setText("profileLatestScholarshipType", "DEGREE COURSE");
    }

    function fillProfileDisplay(profile) {
        const fullName = composeFullName(profile);
        setText("profileNameDisplay", fullName || contextUserEmailFallback(profile));
        setText("profileDobDisplay", formatDateDisplay(profile.date_of_birth));
        setText("profileCivilStatusDisplay", profile.civil_status);
        setText("profileSexDisplay", profile.sex);
        setText("profileBarangayDisplay", normalizeBarangayLabel(profile.barangay) || profile.barangay || "-");
        setText("profileEmailDisplay", profile.email);
        setText("profileMobileDisplay", formatMobileDisplay(profile.mobile_number));
        setText("profileAddressDisplay", buildFullAddress(profile));
    }

    function contextUserEmailFallback(profile) {
        if (profile && profile.email) {
            return profile.email;
        }
        if (window.ldssAuthContext && window.ldssAuthContext.user && window.ldssAuthContext.user.email) {
            return window.ldssAuthContext.user.email;
        }
        return "-";
    }

    async function fillProfileModal(profile) {
        const fullName = composeFullName(profile);
        if (byId("modalFullName")) {
            byId("modalFullName").value = fullName;
        }
        if (byId("modalDob")) {
            byId("modalDob").value = profile.date_of_birth || "";
        }
        selectSetValue(byId("modalCivilStatus"), profile.civil_status || "");
        selectSetValue(byId("modalSex"), profile.sex || "");
        if (byId("modalEmail")) {
            byId("modalEmail").value = profile.email || "";
        }
        if (byId("modalMobile")) {
            const mobileDisplay = formatMobileDisplay(profile.mobile_number);
            byId("modalMobile").value = mobileDisplay === "-" ? "" : mobileDisplay.replace(/\s/g, "");
        }
        if (byId("modalAddress")) {
            byId("modalAddress").value = profile.address || "";
        }
        if (byId("modalSchool")) {
            byId("modalSchool").value = profile.school_name || "";
        }
        if (byId("modalCourse")) {
            byId("modalCourse").value = profile.course_or_strand || "";
        }
        selectSetValue(byId("modalYearLevel"), profile.year_level || "");
        if (byId("modalGuardian")) {
            byId("modalGuardian").value = profile.guardian_name || "";
        }
        if (byId("modalOccupation")) {
            byId("modalOccupation").value = profile.guardian_occupation || "";
        }
        if (byId("modalIncome")) {
            byId("modalIncome").value = profile.monthly_income || "";
        }
        await loadBarangayDropdown(profile.barangay || "");
    }

    async function updateProfile(context, patch, successMessage) {
        const result = await context.client.from("profiles").update(patch).eq("id", context.user.id).select("*").single();
        if (result.error) {
            showProfileStatus("Save failed: " + explainProfileSaveError(result.error.message), "alert-danger");
            return null;
        }
        writeProfileCache(context.user.id, result.data);
        showProfileStatus(successMessage, "alert-success");
        fillProfileDisplay(result.data);
        await fillProfileModal(result.data);
        return result.data;
    }

    async function loadProfileOverviewPhoto(context, profile) {
        if (!profile || !profile.applicant_photo_path || !window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            setProfileOverviewPhoto("", true);
            return;
        }

        try {
            const photoUrl = await window.ldssUploads.createObjectUrl(context, profile.applicant_photo_path);
            setProfileOverviewPhoto(photoUrl, !photoUrl);
        } catch (error) {
            setProfileOverviewPhoto("", true);
        }
    }

    function closeModal(modalId) {
        if (!window.bootstrap || !window.bootstrap.Modal) {
            return;
        }
        const modalElement = byId(modalId);
        if (!modalElement) {
            return;
        }
        const instance = window.bootstrap.Modal.getInstance(modalElement);
        if (instance) {
            instance.hide();
        }
    }

    function openModal(modalId) {
        if (!window.bootstrap || !window.bootstrap.Modal) {
            return;
        }
        const modalElement = byId(modalId);
        if (!modalElement) {
            return;
        }
        const instance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
        instance.show();
    }

    function bindSaveHandlers(context) {
        const savePersonalBtn = byId("savePersonalBtn");
        if (savePersonalBtn) {
            savePersonalBtn.addEventListener("click", async function () {
                hideProfileStatus();
                const names = splitFullName(byId("modalFullName") ? byId("modalFullName").value : "");
                const patch = {
                    first_name: names.first_name || null,
                    middle_name: names.middle_name || null,
                    last_name: names.last_name || null,
                    date_of_birth: byId("modalDob") ? (byId("modalDob").value || null) : null,
                    civil_status: byId("modalCivilStatus") ? (byId("modalCivilStatus").value || null) : null,
                    sex: byId("modalSex") ? (byId("modalSex").value || null) : null,
                    barangay: byId("modalBarangay") ? (byId("modalBarangay").value || null) : null
                };
                const data = await updateProfile(context, patch, "Personal information updated.");
                if (data) {
                    closeModal("modalEditPersonal");
                }
            });
        }

        const saveContactBtn = byId("saveContactBtn");
        if (saveContactBtn) {
            saveContactBtn.addEventListener("click", async function () {
                hideProfileStatus();
                const patch = {
                    email: byId("modalEmail") ? (byId("modalEmail").value.trim().toLowerCase() || null) : null,
                    mobile_number: byId("modalMobile") ? normalizeMobileForStorage(byId("modalMobile").value) : null,
                    address: byId("modalAddress") ? (byId("modalAddress").value.trim() || null) : null
                };
                const data = await updateProfile(context, patch, "Contact information updated.");
                if (data) {
                    closeModal("modalEditContact");
                }
            });
        }

        const saveEducationBtn = byId("saveEducationBtn");
        if (saveEducationBtn) {
            saveEducationBtn.addEventListener("click", async function () {
                hideProfileStatus();
                const patch = {
                    school_name: byId("modalSchool") ? (byId("modalSchool").value.trim() || null) : null,
                    course_or_strand: byId("modalCourse") ? (byId("modalCourse").value.trim() || null) : null,
                    year_level: byId("modalYearLevel") ? (byId("modalYearLevel").value || null) : null
                };
                const data = await updateProfile(context, patch, "Educational information updated.");
                if (data) {
                    closeModal("modalEditEducation");
                }
            });
        }

        const saveFamilyBtn = byId("saveFamilyBtn");
        if (saveFamilyBtn) {
            saveFamilyBtn.addEventListener("click", async function () {
                hideProfileStatus();
                const incomeValue = byId("modalIncome") ? byId("modalIncome").value : "";
                const parsedIncome = incomeValue === "" ? null : Number(incomeValue);
                const patch = {
                    guardian_name: byId("modalGuardian") ? (byId("modalGuardian").value.trim() || null) : null,
                    guardian_occupation: byId("modalOccupation") ? (byId("modalOccupation").value.trim() || null) : null,
                    monthly_income: Number.isNaN(parsedIncome) ? null : parsedIncome
                };
                const data = await updateProfile(context, patch, "Family background updated.");
                if (data) {
                    closeModal("modalEditFamily");
                }
            });
        }
    }

    async function init() {
        const authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        try {
            hideProfileStatus();
            const profile = await ensureProfileRow(authContext);
            writeProfileCache(authContext.user.id, profile);
            fillProfileDisplay(profile);
            await fillProfileModal(profile);
            await loadProfileOverviewPhoto(authContext, profile);
            await loadLatestApplicationSummary(authContext, profile);
            bindSaveHandlers(authContext);
            const query = parseQuery();
            if (query.completeBarangay || query.completeGender) {
                showProfileStatus(
                    query.completeGender
                        ? "Please select your gender, then click Save."
                        : "Please select your barangay, then click Save.",
                    "alert-warning"
                );
                openModal("modalEditPersonal");
                window.setTimeout(function () {
                    const targetField = query.completeGender ? byId("modalSex") : byId("modalBarangay");
                    if (targetField && typeof targetField.focus === "function") {
                        targetField.focus();
                    }
                }, 180);
            }
        } catch (error) {
            showProfileStatus("Failed to load profile record. Please refresh.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
