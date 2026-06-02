(function () {
    "use strict";

    const STORAGE_BUCKET = window.LDSS_STORAGE_BUCKET || "ldss-documents";
    const TAX_DOC_TYPE = "income_certificate";
    const PHOTO_DOC_TYPE = "applicant_photo";
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const NON_PRINTABLE_STATUSES = ["draft"];

    const TAX_DOC_STATUS_META = {
        pending: { label: "For Review", chipClass: "ldss-chip-accent" },
        verified: { label: "Verified", chipClass: "ldss-chip-success" },
        rejected: { label: "Rejected", chipClass: "ldss-chip-danger" },
        needs_reupload: { label: "Needs Reupload", chipClass: "ldss-chip-danger" },
        missing: { label: "Missing", chipClass: "ldss-chip-neutral" }
    };

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
                    label: (status || "-").toString().replace(/_/g, " ").replace(/\b\w/g, function (char) { return char.toUpperCase(); }),
                    chipClass: "ldss-chip-neutral"
                };
            }
        };
    }

    function normalizeStatusValue(status) {
        return (status || "").toString().trim().toLowerCase();
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
        return "PHP " + numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function showStatus(message, type) {
        const alert = byId("secretaryPrintStatus");
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
    }

    function canPrintApplication(application) {
        const status = normalizeStatusValue(application && application.status);
        return Boolean(application && status && !NON_PRINTABLE_STATUSES.includes(status));
    }

    function buildApplicantName(profile) {
        const firstName = (profile && profile.first_name ? profile.first_name : "").toString().trim();
        const middleName = (profile && profile.middle_name ? profile.middle_name : "").toString().trim();
        const lastName = (profile && profile.last_name ? profile.last_name : "").toString().trim();
        const trailingNames = [firstName, middleName].filter(function (value) {
            return value.length > 0;
        }).join(" ");

        if (lastName && trailingNames) {
            return lastName + ", " + trailingNames;
        }

        return lastName || trailingNames || (profile && profile.email ? profile.email : "-");
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

        return cleanupAddressDisplay([address, barangay].filter(Boolean).join(", ")) || "-";
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

    function isMissingProfilesColumnError(error, columnName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedColumn = (columnName || "").toString().toLowerCase();
        if (!text || !normalizedColumn) {
            return false;
        }
        return text.includes(normalizedColumn) && (text.includes("does not exist") || text.includes("schema cache"));
    }

    function profileSelectFields() {
        const base = "id, first_name, middle_name, last_name, sex, civil_status, date_of_birth, barangay, address, email, mobile_number, school_name, course_or_strand, year_level, student_number, guardian_name, guardian_occupation, monthly_income, applicant_photo_path";
        if (profilesSupportsPlaceOfBirth) {
            return base + ", place_of_birth";
        }
        return base;
    }

    function normalizedLookup(raw) {
        const text = (raw || "").toString().trim();
        if (!text) {
            return { id: "", applicationNo: "" };
        }
        if (/^ldss-/i.test(text)) {
            return { id: "", applicationNo: text };
        }
        return { id: text, applicationNo: "" };
    }

    function setTaxChip(status) {
        const chip = byId("secretaryPrintTaxChip");
        if (!chip) {
            return;
        }
        const meta = TAX_DOC_STATUS_META[status] || TAX_DOC_STATUS_META.missing;
        chip.className = "ldss-chip " + meta.chipClass;
        chip.textContent = meta.label;
    }

    function setTaxFileLink(url) {
        const link = byId("secretaryPrintTaxLink");
        if (!link) {
            return;
        }
        if (!url) {
            link.removeAttribute("href");
            link.classList.add("d-none");
            return;
        }
        link.href = url;
        link.classList.remove("d-none");
    }

    function setPhoto(url) {
        const image = byId("secretarySheetPhoto");
        const placeholder = byId("secretarySheetPhotoPlaceholder");
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

    function setPrintAvailability(application) {
        const printBtn = byId("secretaryPrintBtn");
        if (!printBtn) {
            return;
        }

        const printable = canPrintApplication(application);
        printBtn.disabled = !printable;
        if (printable) {
            printBtn.removeAttribute("title");
            return;
        }
        printBtn.title = "Printing is available after the application is submitted.";
    }

    async function createSignedUrl(context, path) {
        if (!path) {
            return "";
        }
        if (!window.ldssUploads || typeof window.ldssUploads.createObjectUrl !== "function") {
            return "";
        }
        try {
            return await window.ldssUploads.createObjectUrl(context, path);
        } catch (error) {
            const message = error && error.message ? error.message : "";
            const isHostedPreviewRouteIssue =
                message.includes("Upload API route was not found")
                || message.includes("Upload API returned an HTML page")
                || message.includes("Upload server is not available right now")
                || message.includes("Failed to fetch");

            // Keep the printable form usable even if an older hosted file
            // preview cannot be loaded on the current deployment.
            if (isHostedPreviewRouteIssue) {
                return "";
            }
            throw error;
        }
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

    async function fetchApplication(context, lookup) {
        const selectFields = "id, application_no, applicant_id, application_type, scholarship_type, school_year, status, submitted_at, created_at, updated_at";

        if (lookup && lookup.id) {
            const idResult = await context.client
                .from("applications")
                .select(selectFields)
                .eq("id", lookup.id)
                .maybeSingle();
            if (!idResult.error && idResult.data) {
                return idResult.data;
            }
        }

        if (lookup && lookup.applicationNo) {
            const noResult = await context.client
                .from("applications")
                .select(selectFields)
                .eq("application_no", lookup.applicationNo)
                .maybeSingle();
            if (!noResult.error && noResult.data) {
                return noResult.data;
            }
        }

        const latestResult = await context.client
            .from("applications")
            .select(selectFields)
            .neq("status", "draft")
            .order("updated_at", { ascending: false })
            .limit(1);

        if (latestResult.error || !latestResult.data || latestResult.data.length === 0) {
            return null;
        }

        return latestResult.data[0];
    }

    async function fetchProfile(context, userId) {
        if (!userId) {
            return null;
        }

        let result = await context.client
            .from("profiles")
            .select(profileSelectFields())
            .eq("id", userId)
            .maybeSingle();

        if (profilesSupportsPlaceOfBirth && isMissingProfilesColumnError(result.error, "place_of_birth")) {
            profilesSupportsPlaceOfBirth = false;
            result = await context.client
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

    async function fetchDocuments(context, applicationId) {
        if (!applicationId) {
            return [];
        }

        const result = await context.client
            .from("application_documents")
            .select("document_type, storage_path, original_filename, verification_status, created_at")
            .eq("application_id", applicationId)
            .in("document_type", [TAX_DOC_TYPE, PHOTO_DOC_TYPE]);

        if (result.error || !result.data) {
            return [];
        }

        return result.data;
    }

    function renderMeta(application, profile, taxDoc) {
        setText("secretaryPrintApplicationNo", application ? application.application_no : "-");
        setText("secretaryPrintApplicantName", profile ? buildApplicantName(profile) : "-");
        setText("secretaryPrintUpdatedAt", application ? formatDateTime(application.updated_at) : "-");
        setTaxChip(taxDoc ? taxDoc.verification_status : "missing");
        setPrintAvailability(application);
    }

    function renderSheet(application, profile, auxMeta, taxDoc) {
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

        setText("sheetApplicationNo", application ? application.application_no : "-");
        setText("sheetDateFiled", application ? formatDate(application.submitted_at || application.created_at) : "-");
        setText("sheetScholarshipType", application ? application.scholarship_type : "-");
        setText("sheetSchoolYear", application ? application.school_year : "-");
        setText("sheetApplicationType", application ? applicationTypeLabel(application.application_type) : "-");

        setText("sheetFullName", profile ? buildApplicantName(profile) : "-");
        setText("sheetDateOfBirth", profile ? formatDate(profile.date_of_birth) : "-");
        setText("sheetSex", profile ? profile.sex : "-");
        setText("sheetCivilStatus", profile ? profile.civil_status : "-");
        setText("sheetPlaceOfBirth", (profile && profile.place_of_birth) || safeMeta.placeOfBirth || "");
        setText("sheetReligion", safeMeta.religion || "");
        setText("sheetSectorClassification", (application && application.sector_classification) || safeMeta.additionalData || "");
        setText("sheetAddress", profile ? buildAddress(profile) : "-");
        setText("sheetContact", profile ? profile.mobile_number : "-");
        setText("sheetEmail", profile ? profile.email : "-");

        setText("sheetSchoolName", profile ? profile.school_name : "-");
        setText("sheetYearLevel", profile ? profile.year_level : "-");
        setText("sheetCourse", profile ? profile.course_or_strand : "-");
        setText("sheetFatherName", fatherName);
        setText("sheetFatherStatus", normalizedParentStatus(safeMeta.fatherStatus));
        setText("sheetFatherOccupation", safeMeta.fatherOccupation || (profile ? profile.guardian_occupation : ""));
        setText("sheetFatherAddress", safeMeta.fatherAddress || "");
        setText("sheetMotherName", motherName);
        setText("sheetMotherStatus", normalizedParentStatus(safeMeta.motherStatus));
        setText("sheetMotherOccupation", safeMeta.motherOccupation || "");
        setText("sheetMotherAddress", safeMeta.motherAddress || "");
        setText(
            "sheetGrossIncome",
            safeMeta.totalParentsGrossIncome
                ? formatMoney(safeMeta.totalParentsGrossIncome)
                : (profile ? formatMoney(profile.monthly_income) : "-")
        );
        setText("sheetChildrenInFamily", safeMeta.childrenInFamily || "");
        setText("sheetBrotherCount", safeMeta.brotherCount || "");
        setText("sheetSisterCount", safeMeta.sisterCount || "");
        setText("sheetSpouseName", safeMeta.spouseName || "");
        setText("sheetSpouseChildrenCount", safeMeta.spouseChildrenCount || "");
        setText("sheetSpouseOccupation", safeMeta.spouseOccupation || "");

    }

    async function loadRecord(context, lookup, requestedByUser) {
        showStatus("Loading application record...", "alert-info");

        try {
            const application = await fetchApplication(context, lookup || {});
            if (!application) {
                renderMeta(null, null, null);
                renderSheet(null, null, {}, null);
                setPhoto("");
                setTaxFileLink("");
                showStatus("No application records found.", "alert-warning");
                return false;
            }

            const [profile, docs, auxMeta] = await Promise.all([
                fetchProfile(context, application.applicant_id),
                fetchDocuments(context, application.id),
                fetchSharedAuxMeta(context, application.id)
            ]);

            const latestDocs = latestDocumentsByType(docs);
            const taxDoc = latestDocs[TAX_DOC_TYPE] || null;
            const photoDoc = latestDocs[PHOTO_DOC_TYPE] || null;

            renderMeta(application, profile, taxDoc);
            renderSheet(application, profile, auxMeta || {}, taxDoc);
            setPhoto("");
            setTaxFileLink("");

            const applicantPhotoPath = (profile && profile.applicant_photo_path) || (photoDoc ? photoDoc.storage_path : "");
            const taxFilePath = taxDoc ? taxDoc.storage_path : "";

            const [photoUrl, taxUrl] = await Promise.all([
                createSignedUrl(context, applicantPhotoPath),
                createSignedUrl(context, taxFilePath)
            ]);

            setPhoto(photoUrl);
            setTaxFileLink(taxUrl);

            if (!canPrintApplication(application)) {
                showStatus(
                    "Draft records are not ready for printing yet. Submit the application first or load a different application record.",
                    "alert-warning"
                );
                return false;
            }

            if (requestedByUser) {
                showStatus("Loaded " + application.application_no + " successfully.", "alert-success");
            } else {
                showStatus("");
            }
            return true;
        } catch (error) {
            console.error("Secretary print form failed to load record.", error);
            showStatus(
                "Unable to finish loading this printable application record. "
                + (error && error.message ? error.message : "Please try again."),
                "alert-danger"
            );
            return false;
        }
    }

    function bindActions(context) {
        const loadBtn = byId("secretaryPrintLoadBtn");
        const latestBtn = byId("secretaryPrintLoadLatestBtn");
        const printBtn = byId("secretaryPrintBtn");
        const searchInput = byId("secretaryPrintSearchInput");

        if (loadBtn) {
            loadBtn.addEventListener("click", function () {
                const lookup = normalizedLookup(searchInput ? searchInput.value : "");
                if (!lookup.id && !lookup.applicationNo) {
                    showStatus("Enter an application ID or number, or use Load Latest.", "alert-warning");
                    return;
                }
                loadRecord(context, lookup, true);
            });
        }

        if (latestBtn) {
            latestBtn.addEventListener("click", function () {
                if (searchInput) {
                    searchInput.value = "";
                }
                loadRecord(context, {}, true);
            });
        }

        if (printBtn) {
            printBtn.addEventListener("click", function () {
                if (printBtn.disabled) {
                    return;
                }
                window.print();
            });
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client) {
            return;
        }

        bindActions(context);

        const query = parseQuery();
        const autoLookup = query.id
            ? { id: query.id, applicationNo: "" }
            : (query.applicationNo ? { id: "", applicationNo: query.applicationNo } : {});

        if (autoLookup.id || autoLookup.applicationNo) {
            const input = byId("secretaryPrintSearchInput");
            if (input) {
                input.value = autoLookup.id || autoLookup.applicationNo;
            }
            const loaded = await loadRecord(context, autoLookup, false);
            if (loaded && query.download && !autoPrintTriggered) {
                autoPrintTriggered = true;
                window.setTimeout(function () {
                    window.print();
                }, 350);
            }
            return;
        }

        await loadRecord(context, {}, false);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
