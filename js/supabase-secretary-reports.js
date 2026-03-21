(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const SECTOR_CLASSIFICATIONS = [
        "Person with Disability (PWD)",
        "Solo Parent",
        "Child of Solo Parent",
        "Child of Farmer",
        "Child of Fisherfolk",
        "Orphan",
        "None of the above"
    ];
    const SECTOR_CLASSIFICATION_ALIASES = {
        "Person with Disability (PWD)": ["PWD", "Person with Disability"],
        "Solo Parent": ["Solo parent"],
        "Child of Solo Parent": ["Child of solo parent"],
        "Child of Farmer": ["Child of farmer"],
        "Child of Fisherfolk": ["Child of fisherfolk"],
        Orphan: ["orphan"],
        "None of the above": ["None", "None of Above"]
    };
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
    const DAET_BARANGAY_ALIASES = {
        "Barangay I": ["BRGY I", "BRGY 1", "BARANGAY 1"],
        "Barangay II": ["BRGY II", "BRGY 2", "BARANGAY 2"],
        "Barangay III": ["BRGY III", "BRGY 3", "BARANGAY 3"],
        "Barangay IV": ["BRGY IV", "BRGY 4", "BARANGAY 4"],
        "Barangay V": ["BRGY V", "BRGY 5", "BARANGAY 5"],
        "Barangay VI": ["BRGY VI", "BRGY 6", "BARANGAY 6"],
        "Barangay VII": ["BRGY VII", "BRGY 7", "BARANGAY 7"],
        "Barangay VIII": ["BRGY VIII", "BRGY 8", "BARANGAY 8"]
    };

    let authContext = null;
    let applicantProfiles = [];
    let applicationRows = [];
    let profileByApplicantId = {};
    let applicationsSupportsSectorClassification = true;
    let sectorLookup = null;
    let barangayLookup = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            STATUS_ORDER: [],
            normalizeStatus: function (status) {
                return (status || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return {
                    label: (status || "-").toString(),
                    chipClass: "ldss-chip-neutral"
                };
            }
        };
    }

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function showStatus(message, type) {
        const box = byId("secretaryReportsStatus");
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

    function setMetric(id, value) {
        const element = byId(id);
        if (element) {
            element.textContent = String(value);
        }
    }

    function formatDateTime(value) {
        const parsed = new Date(value || Date.now());
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

    function cleanupLookupKey(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function cleanupBarangayKey(value) {
        return cleanupLookupKey((value || "").toString().replace(/,\s*daet$/i, ""));
    }

    function getBarangayLookup() {
        if (barangayLookup) {
            return barangayLookup;
        }

        barangayLookup = {};
        DAET_BARANGAYS.forEach(function (barangay) {
            const variants = [barangay].concat(DAET_BARANGAY_ALIASES[barangay] || []);
            if (!/^barangay\s+/i.test(barangay)) {
                variants.push("Barangay " + barangay);
            }
            variants.forEach(function (variant) {
                barangayLookup[cleanupBarangayKey(variant)] = barangay;
                barangayLookup[cleanupBarangayKey(variant + ", Daet")] = barangay;
            });
        });

        return barangayLookup;
    }

    function normalizeBarangay(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return "No Barangay";
        }
        return getBarangayLookup()[cleanupBarangayKey(raw)] || raw;
    }

    function getSectorLookup() {
        if (sectorLookup) {
            return sectorLookup;
        }

        sectorLookup = {};
        SECTOR_CLASSIFICATIONS.forEach(function (sector) {
            const variants = [sector].concat(SECTOR_CLASSIFICATION_ALIASES[sector] || []);
            variants.forEach(function (variant) {
                sectorLookup[cleanupLookupKey(variant)] = sector;
            });
        });

        return sectorLookup;
    }

    function normalizeSectorClassification(value) {
        const raw = (value || "").toString().trim();
        if (!raw) {
            return "Unspecified";
        }
        return getSectorLookup()[cleanupLookupKey(raw)] || raw;
    }

    function normalizeStatus(value) {
        return workflow().normalizeStatus(value);
    }

    function statusMeta(value) {
        return workflow().statusMeta(value);
    }

    function statusSortIndex(status) {
        const order = workflow().STATUS_ORDER || [];
        const normalized = normalizeStatus(status);
        const index = order.indexOf(normalized);
        return index >= 0 ? index : (order.length + 99);
    }

    function schoolYearSortValue(value) {
        const match = ((value || "").toString().trim()).match(/^(\d{4})-(\d{4})$/);
        if (!match) {
            return -1;
        }
        return Number(match[1]) * 10000 + Number(match[2]);
    }

    function compareRecordFreshness(left, right) {
        const leftTime = new Date((left && (left.updated_at || left.created_at)) || 0).getTime();
        const rightTime = new Date((right && (right.updated_at || right.created_at)) || 0).getTime();
        return rightTime - leftTime;
    }

    function isMissingApplicationsColumnError(error, columnName) {
        const text = (((error && error.message) || "") + " " + ((error && error.details) || "")).toLowerCase();
        const normalizedColumn = (columnName || "").toString().toLowerCase();
        if (!text || !normalizedColumn) {
            return false;
        }
        return text.indexOf(normalizedColumn) !== -1 && (
            text.indexOf("column") !== -1 ||
            text.indexOf("schema cache") !== -1 ||
            text.indexOf("does not exist") !== -1
        );
    }

    function applicationsSelectFields() {
        if (applicationsSupportsSectorClassification) {
            return "id, applicant_id, school_year, sector_classification, status, created_at, updated_at";
        }
        return "id, applicant_id, school_year, status, created_at, updated_at";
    }

    async function fetchAllApplicantProfiles(context) {
        const rows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("profiles")
                .select("id, barangay, school_name")
                .eq("role", "applicant")
                .order("created_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                return { data: rows, error: result.error };
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        return { data: rows, error: null };
    }

    async function fetchAllApplications(context) {
        const rows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("applications")
                .select(applicationsSelectFields())
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(result.error, "sector_classification")) {
                    applicationsSupportsSectorClassification = false;
                    return fetchAllApplications(context);
                }
                return { data: rows, error: result.error };
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        return { data: rows, error: null };
    }

    function selectedSchoolYear() {
        const select = byId("secretaryReportsSchoolYearFilter");
        return select ? (select.value || "").toString().trim() : "";
    }

    function latestApplicationsByApplicantForSchoolYear(schoolYear) {
        const map = {};
        const filteredRows = applicationRows.filter(function (row) {
            return !!row && !!row.applicant_id && ((row.school_year || "").toString().trim() === schoolYear);
        });

        filteredRows.forEach(function (row) {
            const existing = map[row.applicant_id];
            if (!existing || compareRecordFreshness(existing, row) > 0) {
                map[row.applicant_id] = row;
            }
        });

        return Object.keys(map).map(function (key) {
            return map[key];
        });
    }

    function buildSchoolYearOptions() {
        const options = Array.from(new Set(applicationRows
            .map(function (row) { return (row && row.school_year ? row.school_year : "").toString().trim(); })
            .filter(Boolean)))
            .sort(function (left, right) {
                return schoolYearSortValue(right) - schoolYearSortValue(left);
            });

        const select = byId("secretaryReportsSchoolYearFilter");
        if (!select) {
            return;
        }

        if (!options.length) {
            select.innerHTML = '<option value="">No school year records yet</option>';
            return;
        }

        const currentValue = select.value;
        select.innerHTML = options.map(function (schoolYear) {
            return '<option value="' + escapeHtml(schoolYear) + '">' + escapeHtml(schoolYear) + "</option>";
        }).join("");

        if (currentValue && options.indexOf(currentValue) !== -1) {
            select.value = currentValue;
        } else {
            select.value = options[0];
        }
    }

    function summaryRowsToMarkup(rows, emptyMessage, renderRow) {
        if (!rows.length) {
            return '<tr><td colspan="3" class="text-center py-4 text-muted">' + escapeHtml(emptyMessage) + "</td></tr>";
        }
        return rows.map(renderRow).join("");
    }

    function schoolNameLabel(value) {
        const normalized = (value || "").toString().trim();
        return normalized || "Not specified";
    }

    function buildSummary() {
        const schoolYear = selectedSchoolYear();
        const latestRows = schoolYear ? latestApplicationsByApplicantForSchoolYear(schoolYear) : [];
        const totalRegistered = applicantProfiles.length;
        const filedCount = latestRows.length;
        const submittedCount = latestRows.filter(function (row) {
            return normalizeStatus(row.status) !== "draft";
        }).length;
        const draftCount = latestRows.filter(function (row) {
            return normalizeStatus(row.status) === "draft";
        }).length;
        const noApplicationCount = Math.max(totalRegistered - filedCount, 0);
        const approvedCount = latestRows.filter(function (row) {
            return normalizeStatus(row.status) === "approved";
        }).length;

        const statusCounts = {};
        const barangaySummary = {};
        const sectorSummary = {};
        const schoolSummary = {};

        latestRows.forEach(function (row) {
            const statusKey = normalizeStatus(row.status) || "unspecified";
            const profile = profileByApplicantId[row.applicant_id] || {};
            const barangay = normalizeBarangay(profile.barangay || "");
            const sector = normalizeSectorClassification(row.sector_classification || "");
            const school = schoolNameLabel(profile.school_name || "");

            statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;

            if (!barangaySummary[barangay]) {
                barangaySummary[barangay] = { label: barangay, filed: 0, approved: 0 };
            }
            barangaySummary[barangay].filed += 1;
            if (statusKey === "approved" || statusKey === "released") {
                barangaySummary[barangay].approved += 1;
            }

            if (!sectorSummary[sector]) {
                sectorSummary[sector] = { label: sector, filed: 0, approved: 0 };
            }
            sectorSummary[sector].filed += 1;
            if (statusKey === "approved" || statusKey === "released") {
                sectorSummary[sector].approved += 1;
            }

            if (!schoolSummary[school]) {
                schoolSummary[school] = { label: school, filed: 0, approved: 0 };
            }
            schoolSummary[school].filed += 1;
            if (statusKey === "approved" || statusKey === "released") {
                schoolSummary[school].approved += 1;
            }
        });

        const statusRows = Object.keys(statusCounts)
            .map(function (statusKey) {
                return {
                    key: statusKey,
                    count: statusCounts[statusKey],
                    meta: statusMeta(statusKey)
                };
            })
            .sort(function (left, right) {
                if (right.count !== left.count) {
                    return right.count - left.count;
                }
                return statusSortIndex(left.key) - statusSortIndex(right.key);
            });

        function summarySorter(left, right) {
            if (right.filed !== left.filed) {
                return right.filed - left.filed;
            }
            return left.label.localeCompare(right.label);
        }

        return {
            schoolYear: schoolYear,
            totalRegistered: totalRegistered,
            filedCount: filedCount,
            submittedCount: submittedCount,
            draftCount: draftCount,
            noApplicationCount: noApplicationCount,
            approvedCount: approvedCount,
            statusRows: statusRows,
            barangayRows: Object.keys(barangaySummary).map(function (key) { return barangaySummary[key]; }).sort(summarySorter),
            sectorRows: Object.keys(sectorSummary).map(function (key) { return sectorSummary[key]; }).sort(summarySorter),
            schoolRows: Object.keys(schoolSummary).map(function (key) { return schoolSummary[key]; }).sort(summarySorter)
        };
    }

    function renderSummary(summary) {
        setMetric("secretaryReportsRegisteredCount", summary.totalRegistered);
        setMetric("secretaryReportsFiledCount", summary.filedCount);
        setMetric("secretaryReportsSubmittedCount", summary.submittedCount);
        setMetric("secretaryReportsDraftCount", summary.draftCount);
        setMetric("secretaryReportsNoApplicationCount", summary.noApplicationCount);
        setMetric("secretaryReportsApprovedCount", summary.approvedCount);

        const selectedYearLabel = summary.schoolYear || "-";
        const coverageNote = byId("secretaryReportsCoverageNote");
        if (coverageNote) {
            coverageNote.textContent = "General summaries use the latest application per applicant for school year " + selectedYearLabel + ".";
        }
        const schoolYearLabel = byId("secretaryReportsSelectedSchoolYearLabel");
        if (schoolYearLabel) {
            schoolYearLabel.textContent = "School Year: " + selectedYearLabel;
        }
        const generatedAt = byId("secretaryReportsGeneratedAt");
        if (generatedAt) {
            generatedAt.textContent = formatDateTime(new Date().toISOString());
        }

        const statusBody = byId("secretaryReportsStatusSummaryBody");
        if (statusBody) {
            if (!summary.statusRows.length) {
                statusBody.innerHTML = '<tr><td colspan="2" class="text-center py-4 text-muted">No application records yet for this school year.</td></tr>';
            } else {
                statusBody.innerHTML = summary.statusRows.map(function (row) {
                    return (
                        "<tr>" +
                        "<td><span class=\"" + escapeHtml(row.meta.chipClass || "ldss-chip-neutral") + "\">" + escapeHtml(row.meta.label || row.key) + "</span></td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.count)) + "</td>" +
                        "</tr>"
                    );
                }).join("");
            }
        }

        const barangayBody = byId("secretaryReportsBarangaySummaryBody");
        if (barangayBody) {
            barangayBody.innerHTML = summaryRowsToMarkup(
                summary.barangayRows,
                "No barangay summary available for this school year.",
                function (row) {
                    return (
                        "<tr>" +
                        "<td>" + escapeHtml(row.label) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.filed)) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.approved)) + "</td>" +
                        "</tr>"
                    );
                }
            );
        }

        const sectorBody = byId("secretaryReportsSectorSummaryBody");
        if (sectorBody) {
            sectorBody.innerHTML = summaryRowsToMarkup(
                summary.sectorRows,
                "No sector classification summary available for this school year.",
                function (row) {
                    return (
                        "<tr>" +
                        "<td>" + escapeHtml(row.label) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.filed)) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.approved)) + "</td>" +
                        "</tr>"
                    );
                }
            );
        }

        const schoolBody = byId("secretaryReportsSchoolSummaryBody");
        if (schoolBody) {
            schoolBody.innerHTML = summaryRowsToMarkup(
                summary.schoolRows,
                "No school summary available for this school year.",
                function (row) {
                    return (
                        "<tr>" +
                        "<td>" + escapeHtml(row.label) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.filed)) + "</td>" +
                        "<td class=\"text-end\">" + escapeHtml(String(row.approved)) + "</td>" +
                        "</tr>"
                    );
                }
            );
        }
    }

    function showLoading(isLoading) {
        const loadingCard = byId("secretaryReportsLoading");
        const content = byId("secretaryReportsContent");

        if (loadingCard) {
            loadingCard.classList.toggle("d-none", !isLoading);
        }
        if (content) {
            content.classList.toggle("d-none", isLoading);
        }
    }

    function bindEvents() {
        const refreshBtn = byId("secretaryReportsRefreshBtn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                renderSummary(buildSummary());
            });
        }

        const schoolYearFilter = byId("secretaryReportsSchoolYearFilter");
        if (schoolYearFilter) {
            schoolYearFilter.addEventListener("change", function () {
                renderSummary(buildSummary());
            });
        }

        const printBtn = byId("secretaryReportsPrintBtn");
        if (printBtn) {
            printBtn.addEventListener("click", function () {
                renderSummary(buildSummary());
                window.print();
            });
        }
    }

    async function loadData(context) {
        showStatus("");
        showLoading(true);

        const [profilesResult, applicationsResult] = await Promise.all([
            fetchAllApplicantProfiles(context),
            fetchAllApplications(context)
        ]);

        if (profilesResult.error) {
            throw new Error("Failed to load applicant profiles: " + profilesResult.error.message);
        }
        if (applicationsResult.error) {
            throw new Error("Failed to load application records: " + applicationsResult.error.message);
        }

        applicantProfiles = profilesResult.data || [];
        applicationRows = applicationsResult.data || [];
        profileByApplicantId = {};
        applicantProfiles.forEach(function (profile) {
            if (profile && profile.id) {
                profileByApplicantId[profile.id] = profile;
            }
        });

        buildSchoolYearOptions();
        renderSummary(buildSummary());
        showLoading(false);
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        authContext = context;
        bindEvents();

        try {
            await loadData(context);
        } catch (error) {
            showLoading(false);
            showStatus(error && error.message ? error.message : "Failed to load secretary reports.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
