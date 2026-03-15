(function () {
    "use strict";

    const PHOTO_DOC_TYPE = "applicant_photo";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    let autoPrintTriggered = false;
    let profilesSupportsPlaceOfBirth = true;
    let applicationAuxDataAvailable = true;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            statusMeta: function (status) {
                return {
                    label: (status || "-").toString().replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); })
                };
            }
        };
    }

    function valueOrDash(value) {
        const text = (value || "").toString().trim();
        return text || "-";
    }

    function setText(id, value) {
        const target = byId(id);
        if (!target) {
            return;
        }
        target.textContent = valueOrDash(value);
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
            month: "long",
            day: "numeric"
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

    function showStatus(message, type) {
        const alert = byId("applicantPrintStatus");
        if (!alert) {
            return;
        }
        if (!message) {
            alert.className = "alert d-none ldss-print-hide";
            alert.textContent = "";
            return;
        }
        alert.className = "alert ldss-print-hide " + (type || "alert-info");
        alert.textContent = message;
        alert.classList.remove("d-none");
    }

    function buildApplicantName(profile) {
        const parts = [profile && profile.first_name, profile && profile.middle_name, profile && profile.last_name]
            .map(function (value) {
                return (value || "").toString().trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });
        const fullName = parts.join(" ");
        return fullName || (profile && profile.email ? profile.email : "-");
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

    function statusLabel(status) {
        return workflow().statusMeta(status || "").label;
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

    function isMissingAuxDataTableError(error) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        return text.includes(APPLICATION_AUX_DATA_TABLE) && (text.includes("does not exist") || text.includes("relation") || text.includes("schema cache"));
    }

    async function fetchSharedAuxMeta(context, applicationId) {
        if (!context || !context.client || !applicationId || !applicationAuxDataAvailable) {
            return null;
        }

        const result = await context.client
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

    function parseQuery() {
        const params = new URLSearchParams(window.location.search);
        return {
            id: params.get("id"),
            applicationNo: params.get("application_no"),
            download: params.get("download") === "1"
        };
    }

    function profileSelectFields() {
        const base = "id, first_name, middle_name, last_name, sex, civil_status, date_of_birth, barangay, address, email, mobile_number, school_name, course_or_strand, year_level, student_number, guardian_name, guardian_occupation, monthly_income, applicant_photo_path";
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

    function setPhoto(url) {
        const image = byId("applicantSheetPhoto");
        const placeholder = byId("applicantSheetPhotoPlaceholder");
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

    async function createSignedUrl(context, path) {
        if (!path) {
            return "";
        }
        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        return window.ldssUploads.createObjectUrl(context, path);
    }

    function latestDocumentsByType(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            const key = row.document_type;
            if (!key) {
                return;
            }
            if (!map[key]) {
                map[key] = row;
                return;
            }
            const existingTs = new Date(map[key].created_at || 0).getTime();
            const currentTs = new Date(row.created_at || 0).getTime();
            if (currentTs > existingTs) {
                map[key] = row;
            }
        });
        return map;
    }

    async function fetchApplication(context, query) {
        const baseQuery = context.client
            .from("applications")
            .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
            .eq("applicant_id", context.user.id);

        if (query.id) {
            const byIdResult = await baseQuery.eq("id", query.id).maybeSingle();
            if (!byIdResult.error && byIdResult.data) {
                return byIdResult.data;
            }
        }

        if (query.applicationNo) {
            const byNoResult = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
                .eq("applicant_id", context.user.id)
                .eq("application_no", query.applicationNo)
                .maybeSingle();
            if (!byNoResult.error && byNoResult.data) {
                return byNoResult.data;
            }
        }

        const latestResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, application_type, scholarship_type, school_year, sector_classification, status, submitted_at, created_at, updated_at")
            .eq("applicant_id", context.user.id)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (latestResult.error || !latestResult.data || latestResult.data.length === 0) {
            return null;
        }

        return latestResult.data[0];
    }

    async function fetchProfile(context) {
        let result = await context.client
            .from("profiles")
            .select(profileSelectFields())
            .eq("id", context.user.id)
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(result.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            result = await context.client
                .from("profiles")
                .select(profileSelectFields())
                .eq("id", context.user.id)
                .maybeSingle();
        }

        if (result.error) {
            return null;
        }

        return result.data || null;
    }

    async function fetchDocuments(context, applicationId) {
        const result = await context.client
            .from("application_documents")
            .select("document_type, storage_path, original_filename, verification_status, created_at")
            .eq("application_id", applicationId)
            .in("document_type", [PHOTO_DOC_TYPE]);

        if (result.error || !result.data) {
            return [];
        }

        return result.data;
    }

    function renderApplicationId(applicationNo) {
        setText("applicantPrintApplicationIdDisplay", "Application ID: " + valueOrDash(applicationNo));
    }

    function renderSheet(application, profile, auxMeta) {
        const safeMeta = auxMeta || {};
        const fatherName = buildPersonName([
            safeMeta.fatherFirstName,
            safeMeta.fatherMiddleName,
            safeMeta.fatherLastName
        ], profile ? profile.guardian_name : "");
        const motherName = buildPersonName([
            safeMeta.motherFirstName,
            safeMeta.motherMiddleName,
            safeMeta.motherMaidenName
        ], "");

        renderApplicationId(application ? application.application_no : "-");
        setText("appSheetApplicationNo", application ? application.application_no : "-");
        setText("appSheetDateFiled", application ? formatDate(application.submitted_at || application.created_at) : "-");
        setText("appSheetScholarshipType", application ? application.scholarship_type : "-");
        setText("appSheetSchoolYear", application ? application.school_year : "-");
        setText("appSheetApplicationType", application ? applicationTypeLabel(application.application_type) : "-");

        setText("appSheetFullName", profile ? buildApplicantName(profile) : "-");
        setText("appSheetDateOfBirth", profile ? formatDate(profile.date_of_birth) : "-");
        setText("appSheetSex", profile ? profile.sex : "-");
        setText("appSheetCivilStatus", profile ? profile.civil_status : "-");
        setText("appSheetPlaceOfBirth", (profile && profile.place_of_birth) || safeMeta.placeOfBirth || "");
        setText("appSheetReligion", safeMeta.religion || "");
        setText("appSheetSectorClassification", (application && application.sector_classification) || safeMeta.additionalData || "");
        setText("appSheetAddress", profile ? buildAddress(profile) : "-");
        setText("appSheetContact", profile ? profile.mobile_number : "-");
        setText("appSheetEmail", profile ? profile.email : "-");

        setText("appSheetSchoolName", profile ? profile.school_name : "-");
        setText("appSheetYearLevel", profile ? profile.year_level : "-");
        setText("appSheetCourse", profile ? profile.course_or_strand : "-");

        setText("appSheetFatherName", fatherName);
        setText("appSheetFatherStatus", normalizedParentStatus(safeMeta.fatherStatus));
        setText("appSheetFatherOccupation", safeMeta.fatherOccupation || (profile ? profile.guardian_occupation : ""));
        setText("appSheetFatherAddress", safeMeta.fatherAddress || "");

        setText("appSheetMotherName", motherName);
        setText("appSheetMotherStatus", normalizedParentStatus(safeMeta.motherStatus));
        setText("appSheetMotherOccupation", safeMeta.motherOccupation || "");
        setText("appSheetMotherAddress", safeMeta.motherAddress || "");

        setText(
            "appSheetGrossIncome",
            safeMeta.totalParentsGrossIncome
                ? formatMoney(safeMeta.totalParentsGrossIncome)
                : (profile ? formatMoney(profile.monthly_income) : "-")
        );
        setText("appSheetChildrenInFamily", safeMeta.childrenInFamily || "");
        setText("appSheetBrotherCount", safeMeta.brotherCount || "");
        setText("appSheetSisterCount", safeMeta.sisterCount || "");
        setText("appSheetSpouseName", safeMeta.spouseName || "");
        setText("appSheetSpouseChildrenCount", safeMeta.spouseChildrenCount || "");
        setText("appSheetSpouseOccupation", safeMeta.spouseOccupation || "");
    }

    async function loadRecord(context, query) {
        showStatus("Loading printable application form...", "alert-info");

        const application = await fetchApplication(context, query);
        if (!application) {
            renderSheet(null, null, {});
            setPhoto("");
            showStatus("No application record was found for this account.", "alert-warning");
            return false;
        }

        const [profile, docs] = await Promise.all([
            fetchProfile(context),
            fetchDocuments(context, application.id)
        ]);
        const auxMeta = (await fetchSharedAuxMeta(context, application.id)) || readAuxMeta(context.user.id, application.id);

        const latestDocs = latestDocumentsByType(docs);
        const photoDoc = latestDocs[PHOTO_DOC_TYPE] || null;
        const applicantPhotoPath = (profile && profile.applicant_photo_path) || (photoDoc ? photoDoc.storage_path : "");
        const photoUrl = await createSignedUrl(context, applicantPhotoPath);

        renderSheet(application, profile, auxMeta);
        setPhoto(photoUrl);
        showStatus("Printable form is ready. Use Print and choose Save as PDF if needed.", "alert-success");
        return true;
    }

    function bindActions() {
        const printBtn = byId("applicantPrintBtn");
        if (!printBtn) {
            return;
        }
        printBtn.addEventListener("click", function () {
            window.print();
        });
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client) {
            return;
        }

        bindActions();

        const query = parseQuery();
        const loaded = await loadRecord(context, query);
        if (loaded && query.download && !autoPrintTriggered) {
            autoPrintTriggered = true;
            window.setTimeout(function () {
                window.print();
            }, 350);
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
