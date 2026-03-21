(function () {
    "use strict";

    const QUEUE_PAGE_SIZE = 5;
    const PROFILE_BATCH_SIZE = 120;
    const SUPABASE_FETCH_LIMIT = 1000;
    const APPLICATION_AUX_DATA_TABLE = "application_aux_data";
    const REMINDER_LOGS_TABLE = "reminder_email_logs";
    const SECONDARY_LOAD_DELAY_MS = 120;
    const BARANGAY_CHART_LIMIT_DESKTOP = 8;
    const BARANGAY_CHART_LIMIT_TABLET = 6;
    const BARANGAY_CHART_LIMIT_PHONE = 5;
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
    const BARANGAY_COLOR_PALETTE = [
        { fill: "rgba(30, 64, 175, 0.88)", stroke: "rgb(30, 58, 138)" },
        { fill: "rgba(8, 145, 178, 0.86)", stroke: "rgb(14, 116, 144)" },
        { fill: "rgba(14, 165, 233, 0.84)", stroke: "rgb(2, 132, 199)" },
        { fill: "rgba(22, 163, 74, 0.84)", stroke: "rgb(21, 128, 61)" },
        { fill: "rgba(101, 163, 13, 0.84)", stroke: "rgb(77, 124, 15)" },
        { fill: "rgba(202, 138, 4, 0.88)", stroke: "rgb(161, 98, 7)" },
        { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
        { fill: "rgba(234, 88, 12, 0.86)", stroke: "rgb(194, 65, 12)" },
        { fill: "rgba(220, 38, 38, 0.82)", stroke: "rgb(185, 28, 28)" },
        { fill: "rgba(225, 29, 72, 0.82)", stroke: "rgb(190, 24, 93)" },
        { fill: "rgba(190, 24, 93, 0.82)", stroke: "rgb(157, 23, 77)" },
        { fill: "rgba(147, 51, 234, 0.82)", stroke: "rgb(126, 34, 206)" },
        { fill: "rgba(124, 58, 237, 0.82)", stroke: "rgb(109, 40, 217)" },
        { fill: "rgba(79, 70, 229, 0.84)", stroke: "rgb(67, 56, 202)" },
        { fill: "rgba(67, 56, 202, 0.84)", stroke: "rgb(55, 48, 163)" },
        { fill: "rgba(71, 85, 105, 0.86)", stroke: "rgb(51, 65, 85)" },
        { fill: "rgba(51, 65, 85, 0.86)", stroke: "rgb(30, 41, 59)" },
        { fill: "rgba(100, 116, 139, 0.88)", stroke: "rgb(71, 85, 105)" },
        { fill: "rgba(15, 118, 110, 0.84)", stroke: "rgb(17, 94, 89)" },
        { fill: "rgba(13, 148, 136, 0.84)", stroke: "rgb(15, 118, 110)" },
        { fill: "rgba(132, 204, 22, 0.82)", stroke: "rgb(101, 163, 13)" },
        { fill: "rgba(245, 158, 11, 0.86)", stroke: "rgb(217, 119, 6)" },
        { fill: "rgba(249, 115, 22, 0.84)", stroke: "rgb(234, 88, 12)" },
        { fill: "rgba(244, 63, 94, 0.8)", stroke: "rgb(225, 29, 72)" },
        { fill: "rgba(56, 189, 248, 0.84)", stroke: "rgb(14, 165, 233)" }
    ];
    const REMINDER_COOLDOWN_DAYS = {
        draft_only: 5,
        no_application: 7,
        returned_resubmission: 3
    };
    let queueRows = [];
    let queueCurrentPage = 1;
    let noFormRows = [];
    let noFormCurrentPage = 1;
    let draftRows = [];
    let draftCurrentPage = 1;
    let correctionMonitoringRows = [];
    let correctionMonitoringCurrentPage = 1;
    let sectorChart = null;
    let registeredChart = null;
    let barangayChart = null;
    let correctionChart = null;
    let reminderChart = null;
    let registeredApplicantCount = 0;
    let barangayLookup = null;
    let sectorLookup = null;
    let barangayChartExpanded = false;
    let applicationsSupportsSectorClassification = true;
    let correctionNoticeByApplicationId = {};
    let dashboardContext = null;
    let dashboardLoadToken = 0;
    let queueVisualsPromise = null;
    let registeredDataPromise = null;
    let correctionDataPromise = null;
    let reminderDataPromise = null;
    let secondaryWarmupTimer = 0;
    let queueEducationByApplicationId = {};
    let queueEducationLoadingByApplicationId = {};
    let reminderLogLookup = {};
    let registeredStatusCounts = {
        registered: 0,
        submitted: 0,
        draft: 0,
        notSubmitted: 0
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral" }; }
        };
    }

    function escapeHtml(value) {
        return (value || "")
            .toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function cleanupLookupKey(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
    }

    function cleanupBarangayKey(value) {
        return cleanupLookupKey((value || "")
            .toString()
            .replace(/,\s*daet$/i, ""));
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
            return "";
        }

        const lookup = getSectorLookup();
        return lookup[cleanupLookupKey(raw)] || raw;
    }

    function selectedSectorFilter() {
        const select = byId("secretaryDashboardSectorFilter");
        if (!select) {
            return "";
        }
        return normalizeSectorClassification(select.value || "");
    }

    function selectedRegisteredFilter() {
        const select = byId("secretaryDashboardRegisteredFilter");
        if (!select) {
            return "";
        }
        return (select.value || "").toString().trim().toLowerCase();
    }

    function selectedBarangayFilter() {
        const select = byId("secretaryDashboardBarangayFilter");
        if (!select) {
            return "";
        }
        const raw = (select.value || "").toString().trim();
        if (!raw || raw === "__no_barangay__") {
            return raw;
        }
        return normalizeBarangay(raw);
    }

    function selectedCorrectionFilter() {
        const select = byId("secretaryDashboardCorrectionFilter");
        if (!select) {
            return "";
        }
        return (select.value || "").toString().trim().toLowerCase();
    }

    function selectedReminderFilter() {
        const select = byId("secretaryDashboardReminderFilter");
        if (!select) {
            return "";
        }
        return (select.value || "").toString().trim().toLowerCase();
    }

    function sectorShortLabel(label) {
        const normalized = normalizeSectorClassification(label);
        if (normalized === "Person with Disability (PWD)") {
            return "PWD";
        }
        if (normalized === "None of the above") {
            return "General";
        }
        return normalized || "Applications";
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
            return "id, application_no, applicant_id, sector_classification, status, submitted_at, created_at, updated_at";
        }
        return "id, application_no, applicant_id, status, submitted_at, created_at, updated_at";
    }

    function sectorColorMeta(label) {
        const palette = {
            "Person with Disability (PWD)": { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
            "Solo Parent": { fill: "rgba(71, 85, 105, 0.88)", stroke: "rgb(51, 65, 85)" },
            "Child of Solo Parent": { fill: "rgba(202, 138, 4, 0.88)", stroke: "rgb(161, 98, 7)" },
            "Child of Farmer": { fill: "rgba(22, 163, 74, 0.85)", stroke: "rgb(21, 128, 61)" },
            "Child of Fisherfolk": { fill: "rgba(14, 116, 144, 0.86)", stroke: "rgb(8, 145, 178)" },
            Orphan: { fill: "rgba(190, 24, 93, 0.82)", stroke: "rgb(157, 23, 77)" },
            "None of the above": { fill: "rgba(148, 163, 184, 0.9)", stroke: "rgb(100, 116, 139)" },
            "Other Applications": { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" },
            "Other / Legacy": { fill: "rgba(107, 114, 128, 0.88)", stroke: "rgb(75, 85, 99)" },
            Unspecified: { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
        };
        return palette[label] || palette["Other / Legacy"];
    }

    function barangayColorMeta(label) {
        if (label === "Other Applications") {
            return { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" };
        }
        if (label === "No Barangay") {
            return { fill: "rgba(185, 28, 28, 0.86)", stroke: "rgb(153, 27, 27)" };
        }

        const normalized = normalizeBarangay(label);
        const index = DAET_BARANGAYS.indexOf(normalized);
        if (index === -1) {
            return { fill: "rgba(71, 85, 105, 0.86)", stroke: "rgb(51, 65, 85)" };
        }
        return BARANGAY_COLOR_PALETTE[index % BARANGAY_COLOR_PALETTE.length];
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
        const key = cleanupBarangayKey(value);
        if (!key) {
            return "";
        }
        const lookup = getBarangayLookup();
        return lookup[key] || (value || "").toString().trim();
    }

    function showStatus(message, type) {
        const box = byId("secretaryDashboardStatus");
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

    function setDashboardLoading(isLoading) {
        const loading = byId("secretaryDashboardLoading");
        const content = byId("secretaryDashboardContent");

        if (loading) {
            loading.classList.toggle("d-none", !isLoading);
        }
        if (content) {
            content.classList.toggle("d-none", !!isLoading);
            content.setAttribute("aria-busy", isLoading ? "true" : "false");
        }
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function setRegisteredCount(value) {
        const count = byId("secretaryDashboardRegisteredCount");

        if (count) {
            count.textContent = String(value || 0);
        }
    }

    function resetRegisteredStatusCounts() {
        registeredStatusCounts = {
            registered: 0,
            submitted: 0,
            draft: 0,
            notSubmitted: 0
        };
    }

    function setRegisteredStatusCounts(counts) {
        const safeRegistered = Math.max(0, Number((counts && counts.registered) || 0));
        const safeSubmitted = Math.max(0, Math.min(safeRegistered, Number((counts && counts.submitted) || 0)));
        const safeDraft = Math.max(0, Math.min(safeRegistered - safeSubmitted, Number((counts && counts.draft) || 0)));
        const safeNotSubmitted = Math.max(
            0,
            Math.min(safeRegistered - safeSubmitted - safeDraft, Number((counts && counts.notSubmitted) || 0))
        );

        registeredStatusCounts = {
            registered: safeRegistered,
            submitted: safeSubmitted,
            draft: safeDraft,
            notSubmitted: safeNotSubmitted
        };
    }

    function buildRegisteredStatusCounts(registeredCount, submittedCount, draftCount) {
        const safeRegistered = Math.max(0, Number(registeredCount || 0));
        const safeSubmitted = Math.max(0, Math.min(safeRegistered, Number(submittedCount || 0)));
        const safeDraft = Math.max(0, Math.min(safeRegistered - safeSubmitted, Number(draftCount || 0)));

        return {
            registered: safeRegistered,
            submitted: safeSubmitted,
            draft: safeDraft,
            notSubmitted: Math.max(0, safeRegistered - safeSubmitted - safeDraft)
        };
    }

    function renderRegisteredChart(counts) {
        const wrap = byId("secretaryDashboardRegisteredChartWrap");
        const canvas = byId("secretaryDashboardRegisteredChart");
        const empty = byId("secretaryDashboardRegisteredChartEmpty");
        const summary = byId("secretaryDashboardRegisteredChartSummary");
        const label = byId("secretaryDashboardRegisteredChartLabel");
        const total = byId("secretaryDashboardRegisteredCount");
        if (!wrap || !canvas || !empty || !summary || !label || !total) {
            return;
        }

        if (registeredChart) {
            registeredChart.destroy();
            registeredChart = null;
        }

        setRegisteredStatusCounts(counts);
        const safeRegisteredCount = registeredStatusCounts.registered;
        const safeSubmittedCount = registeredStatusCounts.submitted;
        const safeDraftCount = registeredStatusCounts.draft;
        const notSubmittedCount = registeredStatusCounts.notSubmitted;

        const activeFilter = selectedRegisteredFilter();
        let chartLabels = ["Submitted", "Draft", "No Form"];
        let chartData = [safeSubmittedCount, safeDraftCount, notSubmittedCount];
        let centerLabel = "Registered";
        let centerTotal = safeRegisteredCount;

        if (!window.Chart) {
            wrap.classList.add("d-none");
            empty.textContent = "Chart library did not load.";
            empty.classList.remove("d-none");
            summary.classList.add("d-none");
            return;
        }

        if (safeRegisteredCount <= 0) {
            wrap.classList.add("d-none");
            empty.textContent = "No registered applicant data yet.";
            empty.classList.remove("d-none");
            summary.classList.add("d-none");
            return;
        }

        let colors = [
            "rgba(30, 64, 175, 0.88)",
            "rgba(217, 119, 6, 0.88)",
            "rgba(148, 163, 184, 0.92)"
        ];
        let borders = [
            "rgb(30, 58, 138)",
            "rgb(180, 83, 9)",
            "rgb(100, 116, 139)"
        ];

        if (activeFilter === "submitted") {
            chartLabels = ["Submitted", "Other Registered"];
            chartData = [safeSubmittedCount, safeDraftCount + notSubmittedCount];
            centerLabel = "Submitted";
            centerTotal = safeSubmittedCount;
            colors = [
                "rgba(30, 64, 175, 0.88)",
                "rgba(148, 163, 184, 0.92)"
            ];
            borders = [
                "rgb(30, 58, 138)",
                "rgb(100, 116, 139)"
            ];
        } else if (activeFilter === "draft") {
            chartLabels = ["Draft", "Other Registered"];
            chartData = [safeDraftCount, safeSubmittedCount + notSubmittedCount];
            centerLabel = "Draft";
            centerTotal = safeDraftCount;
            colors = [
                "rgba(217, 119, 6, 0.88)",
                "rgba(148, 163, 184, 0.92)"
            ];
            borders = [
                "rgb(180, 83, 9)",
                "rgb(100, 116, 139)"
            ];
        } else if (activeFilter === "not_submitted") {
            chartLabels = ["No Form", "Other Registered"];
            chartData = [notSubmittedCount, safeSubmittedCount + safeDraftCount];
            centerLabel = "No Form";
            centerTotal = notSubmittedCount;
            colors = [
                "rgba(148, 163, 184, 0.92)",
                "rgba(30, 64, 175, 0.88)"
            ];
            borders = [
                "rgb(100, 116, 139)",
                "rgb(30, 58, 138)"
            ];
        }

        label.textContent = centerLabel;
        total.textContent = String(centerTotal);

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");
        summary.classList.add("d-none");

        registeredChart = new window.Chart(canvas, {
            type: "doughnut",
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: colors,
                    borderColor: borders,
                    borderWidth: 1.5,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "72%",
                animation: {
                    duration: 500
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return context.label + ": " + value + " account" + (value === 1 ? "" : "s");
                            }
                        }
                    }
                }
            }
        });
    }

    function buildApplicantName(profile) {
        const first = (profile && profile.first_name ? profile.first_name : "").trim();
        const middle = (profile && profile.middle_name ? profile.middle_name : "").trim();
        const last = (profile && profile.last_name ? profile.last_name : "").trim();
        const joined = [first, middle, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (joined) {
            return joined;
        }
        return profile && profile.email ? profile.email : "Unknown Applicant";
    }

    function buildVerificationUrl(applicationId) {
        return "secretary-interview-verification.html?id=" + encodeURIComponent(applicationId || "");
    }

    async function loadProfilesByIds(context, applicantIds) {
        const profileMap = {};
        let failedBatchCount = 0;
        let lastErrorMessage = "";

        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, barangay")
                .in("id", batchIds);

            if (profileResult.error) {
                failedBatchCount += 1;
                lastErrorMessage = profileResult.error.message || "";
                continue;
            }

            (profileResult.data || []).forEach(function (profile) {
                profileMap[profile.id] = profile;
            });
        }

        return {
            profileMap: profileMap,
            failedBatchCount: failedBatchCount,
            lastErrorMessage: lastErrorMessage
        };
    }

    async function fetchAllApplicantProfiles(context) {
        const rows = [];
        let totalCount = 0;

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const query = context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, barangay, created_at", {
                    count: from === 0 ? "exact" : undefined
                })
                .eq("role", "applicant")
                .order("created_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            const result = await query;
            if (result.error) {
                return {
                    data: rows,
                    count: totalCount,
                    error: result.error
                };
            }

            const batch = result.data || [];
            if (from === 0) {
                totalCount = result.count || batch.length;
            }

            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        return {
            data: rows,
            count: totalCount,
            error: null
        };
    }

    async function fetchDraftApplications(context) {
        const result = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, status, created_at, updated_at")
            .eq("status", "draft")
            .order("updated_at", { ascending: false });

        if (result.error) {
            return {
                data: [],
                error: result.error
            };
        }

        return {
            data: result.data || [],
            error: null
        };
    }

    function buildLatestDraftLookup(rows) {
        const lookup = {};

        (rows || []).forEach(function (row) {
            if (!row || !row.applicant_id || lookup[row.applicant_id]) {
                return;
            }
            lookup[row.applicant_id] = row;
        });

        return lookup;
    }

    function countDraftApplicants(registeredProfiles, submittedApplicantIds, draftLookup) {
        return (registeredProfiles || []).reduce(function (count, profile) {
            if (!profile || !profile.id || submittedApplicantIds.has(profile.id) || !draftLookup[profile.id]) {
                return count;
            }
            return count + 1;
        }, 0);
    }

    async function loadLatestCorrectionNoticesByApplicationIds(context, applicationIds) {
        const noticeMap = {};
        let lastError = null;

        for (let start = 0; start < applicationIds.length; start += PROFILE_BATCH_SIZE) {
            const batchIds = applicationIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!batchIds.length) {
                continue;
            }

            const result = await context.client
                .from("notifications")
                .select("related_application_id, notification_type, title, message, created_at")
                .in("related_application_id", batchIds)
                .in("notification_type", ["application", "reminder"])
                .order("created_at", { ascending: false });

            if (result.error) {
                lastError = result.error;
                continue;
            }

            (result.data || []).forEach(function (row) {
                const applicationId = (row.related_application_id || "").toString().trim();
                if (!applicationId || !isCorrectionNotification(row)) {
                    return;
                }

                const existing = noticeMap[applicationId];
                const currentTime = row.created_at ? new Date(row.created_at).getTime() : 0;
                const existingTime = existing && existing.created_at ? new Date(existing.created_at).getTime() : 0;
                if (!existing || currentTime > existingTime) {
                    noticeMap[applicationId] = row;
                }
            });
        }

        return {
            noticeMap: noticeMap,
            error: lastError
        };
    }

    function formatDate(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        if (!value) {
            return "-";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "-";
        }
        return date.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function correctionNoticeLabel(notice, row) {
        const title = (notice && notice.title ? notice.title : "").toString().trim().toLowerCase();
        const status = normalizeStatus(row && row.status);

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

    function buildCorrectionMonitoringRows(rows, correctionMap) {
        return (rows || [])
            .map(function (row) {
                const notice = correctionMap[row.id] || null;
                const status = normalizeStatus(row.status);
                const noticeAt = new Date(notice && notice.created_at ? notice.created_at : 0).getTime();
                const applicationUpdatedAt = new Date(row.updated_at || row.created_at || 0).getTime();
                const hasUpdatedSinceNotice = !!(
                    notice &&
                    noticeAt &&
                    applicationUpdatedAt &&
                    applicationUpdatedAt > noticeAt &&
                    status !== "returned_for_correction"
                );

                if (!notice && status !== "returned_for_correction") {
                    return null;
                }
                if (hasUpdatedSinceNotice) {
                    return null;
                }

                return {
                    id: row.id,
                    application_no: row.application_no || "-",
                    applicant_name: row.applicant_name || "Unknown Applicant",
                    notice_label: correctionNoticeLabel(notice, row),
                    applicant_update_label: hasUpdatedSinceNotice ? "Completed Update" : "Pending Update",
                    applicant_update_chip: hasUpdatedSinceNotice ? "ldss-chip-success" : "ldss-chip-danger",
                    follow_up_label: hasUpdatedSinceNotice ? "For Checking Again" : "Waiting for Applicant",
                    follow_up_chip: hasUpdatedSinceNotice ? "ldss-chip-accent" : "ldss-chip-neutral",
                    submitted_at: row.submitted_at || row.created_at || "",
                    notice_sent_at: notice && notice.created_at ? notice.created_at : "",
                    updated_at: row.updated_at || row.created_at || "",
                    sort_time: Math.max(noticeAt || 0, applicationUpdatedAt || 0),
                    open_url: "secretary-interview-verification.html?id=" + encodeURIComponent(row.id)
                };
            })
            .filter(Boolean)
            .sort(function (left, right) {
                const leftReady = left.follow_up_label === "For Checking Again" ? 1 : 0;
                const rightReady = right.follow_up_label === "For Checking Again" ? 1 : 0;
                if (leftReady !== rightReady) {
                    return rightReady - leftReady;
                }
                return (right.sort_time || 0) - (left.sort_time || 0);
            });
    }

    function setMetric(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function getQueueProfileMap() {
        const profileMap = {};
        queueRows.forEach(function (row) {
            if (row.profile) {
                profileMap[row.applicant_id] = row.profile;
            }
        });
        return profileMap;
    }

    function waitForNextPaint(delayMs) {
        const waitMs = Math.max(0, Number(delayMs) || 0);
        return new Promise(function (resolve) {
            window.setTimeout(function () {
                if (typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(resolve);
                    return;
                }
                resolve();
            }, waitMs);
        });
    }

    function getSubmittedApplicantIds() {
        return new Set(
            queueRows.map(function (row) {
                return row.applicant_id;
            }).filter(Boolean)
        );
    }

    function getQueueApplicationIds() {
        return Array.from(new Set(
            queueRows.map(function (row) {
                return row.id;
            }).filter(Boolean)
        ));
    }

    function educationTrackLabel(value) {
        const raw = (value || "").toString().trim();
        const normalized = raw.toLowerCase();

        if (!normalized) {
            return "";
        }
        if (normalized === "senior high school graduate") {
            return "Senior High";
        }
        if (normalized === "college graduate" || normalized === "college level") {
            return "College";
        }
        if (normalized === "als graduate") {
            return "ALS";
        }

        return raw;
    }

    async function loadQueueEducationData(applicationIds, loadToken) {
        const currentContext = dashboardContext;
        if (!currentContext || !currentContext.client || !applicationIds.length) {
            return;
        }

        const result = await currentContext.client
            .from(APPLICATION_AUX_DATA_TABLE)
            .select("application_id, payload")
            .in("application_id", applicationIds);

        if (loadToken !== dashboardLoadToken) {
            return;
        }

        const foundMap = {};
        if (!result.error) {
            (result.data || []).forEach(function (row) {
                const applicationId = row && row.application_id ? row.application_id : "";
                const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
                foundMap[applicationId] = educationTrackLabel(payload.highestEducationAttainment || "");
            });
        }

        applicationIds.forEach(function (applicationId) {
            queueEducationByApplicationId[applicationId] = foundMap[applicationId] || "";
            delete queueEducationLoadingByApplicationId[applicationId];
        });

        applyQueuePagination(false);
    }

    function ensureQueueEducationData(rows) {
        const loadToken = dashboardLoadToken;
        const pendingIds = (rows || [])
            .map(function (row) {
                return row && row.id ? row.id : "";
            })
            .filter(function (applicationId) {
                return !!applicationId &&
                    !Object.prototype.hasOwnProperty.call(queueEducationByApplicationId, applicationId) &&
                    !queueEducationLoadingByApplicationId[applicationId];
            });

        if (!pendingIds.length) {
            return;
        }

        pendingIds.forEach(function (applicationId) {
            queueEducationLoadingByApplicationId[applicationId] = true;
        });

        loadQueueEducationData(pendingIds, loadToken);
    }

    function resetDeferredDashboardLoads() {
        if (secondaryWarmupTimer) {
            window.clearTimeout(secondaryWarmupTimer);
            secondaryWarmupTimer = 0;
        }

        queueVisualsPromise = null;
        registeredDataPromise = null;
        correctionDataPromise = null;
        reminderDataPromise = null;
    }

    function ensureQueueVisualsLoaded(loadToken) {
        if (queueVisualsPromise) {
            return queueVisualsPromise;
        }

        queueVisualsPromise = (async function () {
            await waitForNextPaint(0);
            if (loadToken !== dashboardLoadToken) {
                return;
            }

            renderSectorChart(queueRows);
            renderBarangayChart(queueRows, getQueueProfileMap());
        })();

        return queueVisualsPromise;
    }

    function ensureRegisteredDataLoaded(context, loadToken) {
        if (!context || !context.client) {
            return Promise.resolve();
        }
        if (registeredDataPromise) {
            return registeredDataPromise;
        }

        registeredDataPromise = (async function () {
            const submittedApplicantIds = getSubmittedApplicantIds();
            const submittedApplicantCount = submittedApplicantIds.size;
            const results = await Promise.all([
                fetchAllApplicantProfiles(context),
                fetchDraftApplications(context)
            ]);

            if (loadToken !== dashboardLoadToken) {
                return;
            }

            const registeredProfilesResult = results[0];
            const draftApplicationsResult = results[1];
            const draftLookup = buildLatestDraftLookup(draftApplicationsResult.data || []);

            if (registeredProfilesResult.error) {
                setRegisteredCount(0);
                registeredApplicantCount = 0;
                resetRegisteredStatusCounts();
                renderRegisteredChart(registeredStatusCounts);
                noFormRows = [];
                draftRows = [];
                applyNoFormPagination(true, "Unable to load users without form right now.");
                applyDraftPagination(true, "Unable to load draft users right now.");
                return;
            }

            if (draftApplicationsResult.error) {
                showStatus("Registered applicants loaded, but draft preview links are temporarily unavailable.", "alert-warning");
            }

            const registeredProfiles = registeredProfilesResult.data || [];
            registeredApplicantCount = registeredProfilesResult.count || registeredProfiles.length || 0;
            setRegisteredCount(registeredApplicantCount);
            setRegisteredStatusCounts(buildRegisteredStatusCounts(
                registeredApplicantCount,
                submittedApplicantCount,
                countDraftApplicants(registeredProfiles, submittedApplicantIds, draftLookup)
            ));
            renderRegisteredChart(registeredStatusCounts);

            const pendingProfiles = registeredProfiles
                .filter(function (profile) {
                    return !submittedApplicantIds.has(profile.id);
                })
                .map(function (profile) {
                    const draft = draftLookup[profile.id] || null;
                    return {
                        id: profile.id,
                        applicant_name: buildApplicantName(profile),
                        barangay: normalizeBarangay(profile.barangay || "") || "No Barangay",
                        email: profile.email || "",
                        created_at: profile.created_at || "",
                        draft_application_id: draft && draft.id ? draft.id : "",
                        draft_application_no: draft && draft.application_no ? draft.application_no : "",
                        draft_updated_at: draft ? (draft.updated_at || draft.created_at || "") : ""
                    };
                });

            noFormRows = pendingProfiles.filter(function (row) {
                return !row.draft_application_id;
            });
            draftRows = pendingProfiles.filter(function (row) {
                return !!row.draft_application_id;
            });

            applyNoFormPagination(true);
            applyDraftPagination(true);
        })();

        return registeredDataPromise;
    }

    function reminderStateKey(row) {
        return row && row.draft_application_id ? "draft_only" : "no_application";
    }

    function reminderLookupKey(applicantId, reminderType) {
        return (applicantId || "") + "::" + (reminderType || "");
    }

    function cooldownDaysForType(reminderType) {
        return REMINDER_COOLDOWN_DAYS[reminderType] || 7;
    }

    function addDaysToIso(value, days) {
        const parsed = new Date(value || "");
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        parsed.setDate(parsed.getDate() + days);
        return parsed.toISOString();
    }

    function buildReminderLogLookup(logRows) {
        const lookup = {};
        (logRows || []).forEach(function (row) {
            if (!row || row.status !== "sent" || !row.applicant_id || !row.reminder_type || !row.sent_at) {
                return;
            }

            const key = reminderLookupKey(row.applicant_id, row.reminder_type);
            if (!lookup[key]) {
                lookup[key] = {
                    lastSentAt: row.sent_at,
                    timesSent: 1
                };
                return;
            }

            lookup[key].timesSent += 1;
            if (new Date(row.sent_at).getTime() > new Date(lookup[key].lastSentAt).getTime()) {
                lookup[key].lastSentAt = row.sent_at;
            }
        });

        return lookup;
    }

    function fetchReminderRows() {
        return draftRows.concat(noFormRows);
    }

    function isReminderCooldownActive(row) {
        if (!row || !row.cooldown_until) {
            return false;
        }
        const parsed = new Date(row.cooldown_until);
        return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
    }

    function applyReminderLogStateToRows(rows) {
        (rows || []).forEach(function (row) {
            const type = reminderStateKey(row);
            const logMeta = reminderLogLookup[reminderLookupKey(row.id, type)] || null;
            row.last_reminder_sent_at = logMeta ? logMeta.lastSentAt : "";
            row.reminder_times_sent = logMeta ? logMeta.timesSent : 0;
            row.cooldown_until = logMeta ? addDaysToIso(logMeta.lastSentAt, cooldownDaysForType(type)) : "";
        });
    }

    async function fetchReminderLogs(context, applicantIds) {
        const uniqueIds = Array.from(new Set((applicantIds || []).filter(Boolean)));
        if (!uniqueIds.length) {
            return { data: [], error: null };
        }

        const rows = [];
        for (let index = 0; index < uniqueIds.length; index += 200) {
            const batchIds = uniqueIds.slice(index, index + 200);
            const result = await context.client
                .from(REMINDER_LOGS_TABLE)
                .select("applicant_id, reminder_type, status, sent_at")
                .in("applicant_id", batchIds)
                .eq("channel", "email")
                .order("sent_at", { ascending: false });

            if (result.error) {
                return {
                    data: rows,
                    error: result.error
                };
            }

            rows.push.apply(rows, result.data || []);
        }

        return {
            data: rows,
            error: null
        };
    }

    function buildReminderFollowupCounts(rows) {
        return (rows || []).reduce(function (counts, row) {
            counts.total += 1;

            if (!row || !row.last_reminder_sent_at) {
                counts.newNeed += 1;
                return counts;
            }

            if (isReminderCooldownActive(row)) {
                counts.recent += 1;
                return counts;
            }

            counts.readyAgain += 1;
            return counts;
        }, {
            total: 0,
            newNeed: 0,
            readyAgain: 0,
            recent: 0,
            unavailable: false
        });
    }

    function renderReminderChart(counts) {
        const wrap = byId("secretaryDashboardReminderChartWrap");
        const canvas = byId("secretaryDashboardReminderChart");
        const empty = byId("secretaryDashboardReminderChartEmpty");
        const summary = byId("secretaryDashboardReminderChartSummary");
        const label = byId("secretaryDashboardReminderChartLabel");
        const total = byId("secretaryDashboardReminderChartTotal");
        if (!wrap || !canvas || !empty || !summary || !label || !total) {
            return;
        }

        if (reminderChart) {
            reminderChart.destroy();
            reminderChart = null;
        }

        if (!window.Chart) {
            wrap.classList.add("d-none");
            empty.textContent = "Chart library did not load.";
            empty.classList.remove("d-none");
            summary.textContent = "Unable to render reminder chart.";
            summary.classList.remove("d-none");
            label.textContent = "Reminder Users";
            total.textContent = "0";
            return;
        }

        const safeCounts = Object.assign({
            total: 0,
            newNeed: 0,
            readyAgain: 0,
            recent: 0,
            unavailable: false
        }, counts || {});

        total.textContent = String(safeCounts.total);
        if (safeCounts.unavailable) {
            wrap.classList.add("d-none");
            empty.textContent = "Reminder history is unavailable right now.";
            empty.classList.remove("d-none");
            summary.textContent = "Run the reminder logs hotfix or check reminder log access.";
            summary.classList.remove("d-none");
            label.textContent = "Reminder Users";
            return;
        }

        const activeFilter = selectedReminderFilter();
        let chartLabels = ["Needs First Reminder", "Ready Again", "Recently Reminded"];
        let chartData = [safeCounts.newNeed, safeCounts.readyAgain, safeCounts.recent];
        let chartColors = [
            { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
            { fill: "rgba(14, 116, 144, 0.86)", stroke: "rgb(8, 145, 178)" },
            { fill: "rgba(148, 163, 184, 0.9)", stroke: "rgb(100, 116, 139)" }
        ];
        let centerLabel = "Reminder Users";

        if (activeFilter === "new") {
            chartLabels = ["Needs First Reminder", "Other Reminder Users"];
            chartData = [safeCounts.newNeed, safeCounts.readyAgain + safeCounts.recent];
            chartColors = [
                { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
                { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
            ];
            centerLabel = "New Users";
        } else if (activeFilter === "ready_again") {
            chartLabels = ["Ready Again", "Other Reminder Users"];
            chartData = [safeCounts.readyAgain, safeCounts.newNeed + safeCounts.recent];
            chartColors = [
                { fill: "rgba(14, 116, 144, 0.86)", stroke: "rgb(8, 145, 178)" },
                { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
            ];
            centerLabel = "Ready Again";
        } else if (activeFilter === "recent") {
            chartLabels = ["Recently Reminded", "Other Reminder Users"];
            chartData = [safeCounts.recent, safeCounts.newNeed + safeCounts.readyAgain];
            chartColors = [
                { fill: "rgba(148, 163, 184, 0.9)", stroke: "rgb(100, 116, 139)" },
                { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
            ];
            centerLabel = "Recent";
        }

        const hasData = chartData.some(function (value) { return Number(value) > 0; });
        if (!hasData) {
            wrap.classList.add("d-none");
            empty.textContent = "No reminder follow-up data yet.";
            empty.classList.remove("d-none");
            summary.textContent = "No draft or no-form users are waiting for reminders right now.";
            summary.classList.remove("d-none");
            label.textContent = centerLabel;
            return;
        }

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");
        summary.textContent = "";
        summary.classList.add("d-none");
        label.textContent = centerLabel;

        reminderChart = new window.Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors.map(function (color) { return color.fill; }),
                    borderColor: chartColors.map(function (color) { return color.stroke; }),
                    borderWidth: 1.5,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "66%",
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return context.label + ": " + value;
                            }
                        }
                    }
                }
            }
        });
    }

    function ensureReminderDataLoaded(context, loadToken) {
        if (!context || !context.client) {
            return Promise.resolve();
        }
        if (reminderDataPromise) {
            return reminderDataPromise;
        }

        reminderDataPromise = (async function () {
            await ensureRegisteredDataLoaded(context, loadToken);
            if (loadToken !== dashboardLoadToken) {
                return;
            }

            const reminderRows = fetchReminderRows();
            if (!reminderRows.length) {
                reminderLogLookup = {};
                renderReminderChart(buildReminderFollowupCounts([]));
                return;
            }

            const result = await fetchReminderLogs(context, reminderRows.map(function (row) { return row.id; }));
            if (loadToken !== dashboardLoadToken) {
                return;
            }

            if (result.error) {
                reminderLogLookup = {};
                renderReminderChart({
                    total: reminderRows.length,
                    newNeed: 0,
                    readyAgain: 0,
                    recent: 0,
                    unavailable: true
                });
                showStatus("Reminder follow-up history could not be loaded. Showing the rest of the dashboard normally.", "alert-warning");
                return;
            }

            reminderLogLookup = buildReminderLogLookup(result.data || []);
            applyReminderLogStateToRows(reminderRows);
            renderReminderChart(buildReminderFollowupCounts(reminderRows));
        })();

        return reminderDataPromise;
    }

    function ensureCorrectionDataLoaded(context, loadToken) {
        if (!context || !context.client) {
            return Promise.resolve();
        }
        if (correctionDataPromise) {
            return correctionDataPromise;
        }

        correctionDataPromise = (async function () {
            const applicationIds = getQueueApplicationIds();

            if (!applicationIds.length) {
                correctionNoticeByApplicationId = {};
                correctionMonitoringRows = [];
                renderCorrectionChart([], {});
                applyCorrectionMonitoringPagination(true);
                return;
            }

            const correctionNoticeLoad = await loadLatestCorrectionNoticesByApplicationIds(context, applicationIds);
            if (loadToken !== dashboardLoadToken) {
                return;
            }

            correctionNoticeByApplicationId = correctionNoticeLoad.noticeMap || {};
            if (correctionNoticeLoad.error) {
                showStatus(
                    "Correction history could not be loaded completely. Showing available pending correction data only.",
                    "alert-warning"
                );
            }

            correctionMonitoringRows = buildCorrectionMonitoringRows(queueRows, correctionNoticeByApplicationId);
            renderCorrectionChart(queueRows, correctionNoticeByApplicationId);
            applyCorrectionMonitoringPagination(true);
        })();

        return correctionDataPromise;
    }

    function warmDashboardSecondaryData(context, loadToken) {
        if (!context || !context.client) {
            return;
        }

        if (secondaryWarmupTimer) {
            window.clearTimeout(secondaryWarmupTimer);
        }

        secondaryWarmupTimer = window.setTimeout(function () {
            secondaryWarmupTimer = 0;
            if (loadToken !== dashboardLoadToken) {
                return;
            }

            ensureRegisteredDataLoaded(context, loadToken);
            ensureCorrectionDataLoaded(context, loadToken);
            ensureReminderDataLoaded(context, loadToken);
        }, SECONDARY_LOAD_DELAY_MS);
    }

    function populateBarangayFilter() {
        const select = byId("secretaryDashboardBarangayFilter");
        if (!select) {
            return;
        }

        const currentValue = (select.value || "").toString().trim();
        select.innerHTML = '<option value="">All Barangays</option>' +
            DAET_BARANGAYS.map(function (barangay) {
                return '<option value="' + escapeHtml(barangay) + '">' + escapeHtml(barangay) + "</option>";
            }).join("") +
            '<option value="__no_barangay__">No Barangay</option>';

        if (currentValue === "__no_barangay__") {
            select.value = currentValue;
            return;
        }

        const normalizedValue = normalizeBarangay(currentValue);
        if (normalizedValue && DAET_BARANGAYS.indexOf(normalizedValue) !== -1) {
            select.value = normalizedValue;
            return;
        }
        select.value = "";
    }

    function updateBarangayChartToggle(totalRows, limit) {
        const toggleBtn = byId("secretaryDashboardBarangayChartToggleBtn");
        if (!toggleBtn) {
            return;
        }
        toggleBtn.classList.add("d-none");
    }

    function renderSectorChart(rows) {
        const wrap = byId("secretaryDashboardSectorChartWrap");
        const canvas = byId("secretaryDashboardSectorChart");
        const empty = byId("secretaryDashboardSectorChartEmpty");
        const summary = byId("secretaryDashboardSectorChartSummary");
        const label = byId("secretaryDashboardSectorChartLabel");
        const total = byId("secretaryDashboardSectorChartTotal");
        if (!wrap || !canvas || !empty || !summary || !label || !total) {
            return;
        }

        if (sectorChart) {
            sectorChart.destroy();
            sectorChart = null;
        }

        if (!window.Chart) {
            wrap.classList.add("d-none");
            empty.textContent = "Chart library did not load.";
            empty.classList.remove("d-none");
            summary.textContent = "Unable to render sector chart.";
            summary.classList.remove("d-none");
            label.textContent = "Applications";
            total.textContent = "0";
            return;
        }

        if (!applicationsSupportsSectorClassification) {
            wrap.classList.add("d-none");
            empty.textContent = "Sector classification column is not available yet.";
            empty.classList.remove("d-none");
            summary.textContent = "Run the sector classification database update to enable this chart.";
            summary.classList.remove("d-none");
            label.textContent = "Applications";
            total.textContent = String(rows.length);
            return;
        }

        const counts = {};
        SECTOR_CLASSIFICATIONS.forEach(function (sector) {
            counts[sector] = 0;
        });

        let missingCount = 0;
        let legacyCount = 0;
        rows.forEach(function (row) {
            const sector = normalizeSectorClassification(row.sector_classification || "");
            if (!sector) {
                missingCount += 1;
                return;
            }
            if (Object.prototype.hasOwnProperty.call(counts, sector)) {
                counts[sector] += 1;
                return;
            }
            legacyCount += 1;
        });

        const activeSector = selectedSectorFilter();
        const activeSectorLabel = sectorShortLabel(activeSector);
        let chartRows = [];

        if (activeSector) {
            const selectedCount = Object.prototype.hasOwnProperty.call(counts, activeSector) ? counts[activeSector] : 0;
            const otherCount = Math.max(0, rows.length - selectedCount);

            if (selectedCount > 0) {
                chartRows.push({
                    label: activeSector,
                    count: selectedCount
                });
            }

            if (otherCount > 0) {
                chartRows.push({
                    label: "Other Applications",
                    count: otherCount
                });
            }

            label.textContent = activeSectorLabel;
            total.textContent = String(selectedCount);
            summary.textContent = "";
            summary.classList.add("d-none");
        } else {
            chartRows = SECTOR_CLASSIFICATIONS.map(function (sector) {
                return {
                    label: sector,
                    count: counts[sector]
                };
            }).filter(function (row) {
                return row.count > 0;
            });

            if (legacyCount > 0) {
                chartRows.push({
                    label: "Other / Legacy",
                    count: legacyCount
                });
            }

            if (missingCount > 0) {
                chartRows.push({
                    label: "Unspecified",
                    count: missingCount
                });
            }

            label.textContent = "Applications";
            total.textContent = String(rows.length);
            summary.textContent = "";
            summary.classList.add("d-none");
        }

        if (!chartRows.length) {
            wrap.classList.add("d-none");
            empty.textContent = "No sector chart data yet.";
            empty.classList.remove("d-none");
            summary.textContent = "";
            summary.classList.add("d-none");
            return;
        }

        chartRows.forEach(function (row) {
            row.color = sectorColorMeta(row.label);
        });

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");

        sectorChart = new window.Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: chartRows.map(function (row) { return row.label; }),
                datasets: [
                    {
                        data: chartRows.map(function (row) { return row.count; }),
                        backgroundColor: chartRows.map(function (row) { return row.color.fill; }),
                        borderColor: chartRows.map(function (row) { return row.color.stroke; }),
                        borderWidth: 1.5,
                        hoverOffset: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "66%",
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return context.label + ": " + value + " application" + (value === 1 ? "" : "s");
                            }
                        }
                    }
                }
            }
        });
    }

    function renderBarangayChart(rows, profileMap) {
        const wrap = byId("secretaryDashboardBarangayChartWrap");
        const canvas = byId("secretaryDashboardBarangayChart");
        const empty = byId("secretaryDashboardBarangayChartEmpty");
        const summary = byId("secretaryDashboardBarangayChartSummary");
        const label = byId("secretaryDashboardBarangayChartLabel");
        const total = byId("secretaryDashboardBarangayChartTotal");
        if (!wrap || !canvas || !empty || !summary || !label || !total) {
            return;
        }

        if (barangayChart) {
            barangayChart.destroy();
            barangayChart = null;
        }

        if (!window.Chart) {
            wrap.classList.add("d-none");
            empty.textContent = "Chart library did not load.";
            empty.classList.remove("d-none");
            summary.textContent = "";
            summary.classList.add("d-none");
            label.textContent = "Applications";
            total.textContent = "0";
            return;
        }

        const counts = {};
        DAET_BARANGAYS.forEach(function (barangay) {
            counts[barangay] = 0;
        });

        let missingCount = 0;
        rows.forEach(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            const barangay = normalizeBarangay(profile && profile.barangay ? profile.barangay : "");
            if (barangay && Object.prototype.hasOwnProperty.call(counts, barangay)) {
                counts[barangay] += 1;
                return;
            }
            missingCount += 1;
        });

        const chartRows = DAET_BARANGAYS.map(function (barangay) {
            return {
                label: barangay,
                count: counts[barangay],
                isMissing: false
            };
        }).sort(function (left, right) {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return left.label.localeCompare(right.label);
        });

        if (missingCount > 0) {
            chartRows.push({
                label: "No Barangay",
                count: missingCount,
                isMissing: true
            });
        }

        const rowsWithData = chartRows.filter(function (row) {
            return row.count > 0;
        });

        if (!rowsWithData.length) {
            wrap.classList.add("d-none");
            empty.textContent = "No barangay chart data yet.";
            empty.classList.remove("d-none");
            summary.textContent = "";
            summary.classList.add("d-none");
            label.textContent = "Applications";
            total.textContent = "0";
            return;
        }

        const activeFilter = selectedBarangayFilter();
        let displayRows = rowsWithData.slice();
        let centerLabel = "Applications";
        let centerTotal = rows.length;

        if (activeFilter === "__no_barangay__") {
            const withBarangayCount = Math.max(0, rows.length - missingCount);
            displayRows = [];
            if (missingCount > 0) {
                displayRows.push({
                    label: "No Barangay",
                    count: missingCount,
                    isMissing: true
                });
            }
            if (withBarangayCount > 0) {
                displayRows.push({
                    label: "Other Applications",
                    count: withBarangayCount,
                    isOther: true
                });
            }
            centerLabel = "No Barangay";
            centerTotal = missingCount;
        } else if (activeFilter) {
            const selectedCount = Object.prototype.hasOwnProperty.call(counts, activeFilter)
                ? counts[activeFilter]
                : 0;
            const otherCount = Math.max(0, rows.length - selectedCount);
            displayRows = [];
            if (selectedCount > 0) {
                displayRows.push({
                    label: activeFilter,
                    count: selectedCount
                });
            }
            if (otherCount > 0) {
                displayRows.push({
                    label: "Other Applications",
                    count: otherCount,
                    isOther: true
                });
            }
            centerLabel = activeFilter;
            centerTotal = selectedCount;
        }

        label.textContent = centerLabel;
        total.textContent = String(centerTotal);

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");
        summary.textContent = "";
        summary.classList.add("d-none");

        if (!displayRows.length) {
            wrap.classList.add("d-none");
            empty.textContent = "No barangay chart data for the selected filter.";
            empty.classList.remove("d-none");
            return;
        }

        barangayChart = new window.Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: displayRows.map(function (row) { return row.label; }),
                datasets: [
                    {
                        data: displayRows.map(function (row) { return row.count; }),
                        backgroundColor: displayRows.map(function (row) {
                            return barangayColorMeta(row.label).fill;
                        }),
                        borderColor: displayRows.map(function (row) {
                            return barangayColorMeta(row.label).stroke;
                        }),
                        borderWidth: 1.5,
                        hoverOffset: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "66%",
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return context.label + ": " + value + " application" + (value === 1 ? "" : "s");
                            }
                        }
                    }
                }
            }
        });
    }

    function renderCorrectionChart(rows, correctionMap) {
        const wrap = byId("secretaryDashboardCorrectionChartWrap");
        const canvas = byId("secretaryDashboardCorrectionChart");
        const empty = byId("secretaryDashboardCorrectionChartEmpty");
        const summary = byId("secretaryDashboardCorrectionChartSummary");
        const label = byId("secretaryDashboardCorrectionChartLabel");
        const total = byId("secretaryDashboardCorrectionChartTotal");
        if (!wrap || !canvas || !empty || !summary || !label || !total) {
            return;
        }

        if (correctionChart) {
            correctionChart.destroy();
            correctionChart = null;
        }

        if (!window.Chart) {
            wrap.classList.add("d-none");
            empty.textContent = "Chart library did not load.";
            empty.classList.remove("d-none");
            summary.classList.add("d-none");
            label.textContent = "Cases";
            total.textContent = "0";
            return;
        }

        let pendingCount = 0;
        let updatedCount = 0;

        rows.forEach(function (row) {
            const status = normalizeStatus(row.status);
            const notice = correctionMap[row.id] || null;

            if (status === "returned_for_correction") {
                pendingCount += 1;
                return;
            }

            if (!notice) {
                return;
            }

            const applicationUpdatedAt = new Date(row.updated_at || row.created_at || 0).getTime();
            const noticeCreatedAt = new Date(notice.created_at || 0).getTime();
            if (applicationUpdatedAt && noticeCreatedAt && applicationUpdatedAt > noticeCreatedAt) {
                updatedCount += 1;
                return;
            }

            pendingCount += 1;
        });

        const totalCases = pendingCount + updatedCount;
        if (totalCases <= 0) {
            wrap.classList.add("d-none");
            empty.textContent = "No correction or resubmission data yet.";
            empty.classList.remove("d-none");
            summary.classList.add("d-none");
            label.textContent = "Cases";
            total.textContent = "0";
            return;
        }

        const activeFilter = selectedCorrectionFilter();
        let chartLabels = ["Returned / Pending Update", "Resubmitted / Updated"];
        let chartData = [pendingCount, updatedCount];
        let centerLabel = "Cases";
        let centerTotal = totalCases;
        let chartColors = [
            { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
            { fill: "rgba(22, 163, 74, 0.84)", stroke: "rgb(21, 128, 61)" }
        ];

        if (activeFilter === "pending") {
            chartLabels = ["Returned / Pending Update", "Other Cases"];
            chartData = [pendingCount, updatedCount];
            centerLabel = "Pending";
            centerTotal = pendingCount;
            chartColors = [
                { fill: "rgba(217, 119, 6, 0.88)", stroke: "rgb(180, 83, 9)" },
                { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
            ];
        } else if (activeFilter === "updated") {
            chartLabels = ["Resubmitted / Updated", "Other Cases"];
            chartData = [updatedCount, pendingCount];
            centerLabel = "Updated";
            centerTotal = updatedCount;
            chartColors = [
                { fill: "rgba(22, 163, 74, 0.84)", stroke: "rgb(21, 128, 61)" },
                { fill: "rgba(203, 213, 225, 0.95)", stroke: "rgb(148, 163, 184)" }
            ];
        }

        label.textContent = centerLabel;
        total.textContent = String(centerTotal);

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");
        summary.classList.add("d-none");

        correctionChart = new window.Chart(canvas.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors.map(function (color) { return color.fill; }),
                    borderColor: chartColors.map(function (color) { return color.stroke; }),
                    borderWidth: 1.5,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "72%",
                animation: {
                    duration: 500
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return context.label + ": " + value + " application" + (value === 1 ? "" : "s");
                            }
                        }
                    }
                }
            }
        });
    }

    function getPageCount(total) {
        if (total <= 0) {
            return 1;
        }
        return Math.ceil(total / QUEUE_PAGE_SIZE);
    }

    function pageItemMarkup(label, targetPage, disabled, active, ariaLabel) {
        const itemClass = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
        return (
            '<li class="' + itemClass + '">' +
            '<button class="page-link" type="button" data-page="' + targetPage + '" aria-label="' + escapeHtml(ariaLabel || label) + '">' + escapeHtml(label) + "</button>" +
            "</li>"
        );
    }

    function pageStatusItemMarkup(label) {
        return '<li class="page-item disabled ldss-dashboard-page-status"><span class="page-link">' + escapeHtml(label) + "</span></li>";
    }

    function renderQueuePaginationInfo(totalRows) {
        const info = byId("secretaryDashboardQueuePaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "No records";
            return;
        }
        info.textContent = totalRows + " records";
    }

    function renderQueuePagination(totalRows) {
        const pagination = byId("secretaryDashboardQueuePagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", queueCurrentPage - 1, queueCurrentPage <= 1, false, "Previous page"));

        items.push(pageStatusItemMarkup(String(queueCurrentPage) + " / " + String(pageCount)));
        items.push(pageItemMarkup("Next", queueCurrentPage + 1, queueCurrentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function renderNoFormPaginationInfo(totalRows) {
        const info = byId("secretaryDashboardNoFormPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "No records";
            return;
        }
        info.textContent = totalRows + " records";
    }

    function renderNoFormPagination(totalRows) {
        const pagination = byId("secretaryDashboardNoFormPagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", noFormCurrentPage - 1, noFormCurrentPage <= 1, false, "Previous page"));

        items.push(pageStatusItemMarkup(String(noFormCurrentPage) + " / " + String(pageCount)));
        items.push(pageItemMarkup("Next", noFormCurrentPage + 1, noFormCurrentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function renderDraftPaginationInfo(totalRows) {
        const info = byId("secretaryDashboardDraftPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "No records";
            return;
        }
        info.textContent = totalRows + " records";
    }

    function renderDraftPagination(totalRows) {
        const pagination = byId("secretaryDashboardDraftPagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", draftCurrentPage - 1, draftCurrentPage <= 1, false, "Previous page"));
        items.push(pageStatusItemMarkup(String(draftCurrentPage) + " / " + String(pageCount)));
        items.push(pageItemMarkup("Next", draftCurrentPage + 1, draftCurrentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function isExamStage(status) {
        const normalized = normalizeStatus(status);
        return ["pending_exam", "exam_scheduled", "exam_completed", "failed_exam", "passed_exam", "special_endorsement_review"].includes(normalized);
    }

    function isInterviewStage(status) {
        const normalized = normalizeStatus(status);
        return ["for_interview", "interview_scheduled", "interview_completed", "hard_copy_verified"].includes(normalized);
    }

    function renderMetrics(rows) {
        setMetric("secretaryDashboardNewSubmissions", rows.filter(function (row) { return normalizeStatus(row.status) === "submitted"; }).length);
        setMetric("secretaryDashboardForValidation", rows.filter(function (row) { return isExamStage(row.status); }).length);
        setMetric("secretaryDashboardInterviewStage", rows.filter(function (row) { return isInterviewStage(row.status); }).length);
        setMetric("secretaryDashboardForAdmin", rows.filter(function (row) { return normalizeStatus(row.status) === "for_approval"; }).length);
    }

    function renderQueue(rows) {
        const tbody = byId("secretaryDashboardQueueBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No queue records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            const educationValue = Object.prototype.hasOwnProperty.call(queueEducationByApplicationId, row.id)
                ? (queueEducationByApplicationId[row.id] || "-")
                : (queueEducationLoadingByApplicationId[row.id] ? "Loading..." : "Loading...");
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown") + " - " + (row.application_no || "-")) + '">' +
                '<span class="ldss-table-ellipsis ldss-uniform-table-primary">' + escapeHtml(row.applicant_name || "Unknown") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">' + escapeHtml(row.application_no || "-") + "</span>" +
                "</td>" +
                "<td>" + escapeHtml(educationValue) + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDateTime(row.submitted_at || row.created_at)) + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.updated_at || row.created_at)) + "</td>" +
                '<td class="text-end"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(buildVerificationUrl(row.id)) + '">Open</a></td>' +
                "</tr>"
            );
        }).join("");
    }

    function renderNoFormTable(rows, emptyMessage) {
        const tbody = byId("secretaryDashboardNoFormBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">' +
                escapeHtml(emptyMessage || "No users without a submitted or draft form.") +
                "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown Applicant") + " - No form submitted") + '">' +
                '<span class="ldss-table-ellipsis ldss-uniform-table-primary">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">No draft or submitted form yet</span>' +
                "</td>" +
                "<td>" + escapeHtml(row.barangay || "No Barangay") + "</td>" +
                "<td>" + escapeHtml(row.email || "-") + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.created_at)) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderDraftTable(rows, emptyMessage) {
        const tbody = byId("secretaryDashboardDraftBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">' +
                escapeHtml(emptyMessage || "No saved draft forms found.") +
                "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown Applicant") + " - " + (row.barangay || "No Barangay")) + '">' +
                '<span class="ldss-table-ellipsis ldss-uniform-table-primary">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">' + escapeHtml(row.barangay || "No Barangay") + "</span>" +
                "</td>" +
                "<td>" + escapeHtml(row.draft_application_no || "-") + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.draft_updated_at || row.created_at)) + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.created_at)) + "</td>" +
                '<td class="text-end"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(buildVerificationUrl(row.draft_application_id)) + '">View Draft</a></td>' +
                "</tr>"
            );
        }).join("");
    }

    function renderCorrectionMonitoringTable(rows, emptyMessage) {
        const tbody = byId("secretaryDashboardCorrectionTableBody");
        if (!tbody) {
            return;
        }

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">' +
                escapeHtml(emptyMessage || "No pending correction records found.") +
                "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown") + " - " + (row.application_no || "-") + " - " + (row.notice_label || "")) + '">' +
                '<span class="ldss-table-ellipsis ldss-uniform-table-primary">' + escapeHtml(row.applicant_name || "Unknown") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">' + escapeHtml(row.application_no || "-") + "</span>" +
                "</td>" +
                "<td>" + escapeHtml(row.notice_label || "-") + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.submitted_at)) + "</td>" +
                "<td>" + escapeHtml(formatDateTime(row.notice_sent_at || row.updated_at)) + "</td>" +
                '<td class="text-end"><a class="btn btn-outline-dark btn-sm" href="' + escapeHtml(row.open_url) + '">Open</a></td>' +
                "</tr>"
            );
        }).join("");
    }

    function applyQueuePagination(resetPage) {
        if (resetPage) {
            queueCurrentPage = 1;
        }

        const pageCount = getPageCount(queueRows.length);
        if (queueCurrentPage > pageCount) {
            queueCurrentPage = pageCount;
        }
        if (queueCurrentPage < 1) {
            queueCurrentPage = 1;
        }

        const start = (queueCurrentPage - 1) * QUEUE_PAGE_SIZE;
        const pageRows = queueRows.slice(start, start + QUEUE_PAGE_SIZE);

        renderQueue(pageRows);
        renderQueuePaginationInfo(queueRows.length);
        renderQueuePagination(queueRows.length);
        ensureQueueEducationData(pageRows);
    }

    function applyNoFormPagination(resetPage, emptyMessage) {
        if (resetPage) {
            noFormCurrentPage = 1;
        }

        const pageCount = getPageCount(noFormRows.length);
        if (noFormCurrentPage > pageCount) {
            noFormCurrentPage = pageCount;
        }
        if (noFormCurrentPage < 1) {
            noFormCurrentPage = 1;
        }

        const start = (noFormCurrentPage - 1) * QUEUE_PAGE_SIZE;
        const pageRows = noFormRows.slice(start, start + QUEUE_PAGE_SIZE);

        renderNoFormTable(pageRows, emptyMessage);
        renderNoFormPaginationInfo(noFormRows.length);
        renderNoFormPagination(noFormRows.length);
    }

    function applyDraftPagination(resetPage, emptyMessage) {
        if (resetPage) {
            draftCurrentPage = 1;
        }

        const pageCount = getPageCount(draftRows.length);
        if (draftCurrentPage > pageCount) {
            draftCurrentPage = pageCount;
        }
        if (draftCurrentPage < 1) {
            draftCurrentPage = 1;
        }

        const start = (draftCurrentPage - 1) * QUEUE_PAGE_SIZE;
        const pageRows = draftRows.slice(start, start + QUEUE_PAGE_SIZE);

        renderDraftTable(pageRows, emptyMessage);
        renderDraftPaginationInfo(draftRows.length);
        renderDraftPagination(draftRows.length);
    }

    function renderCorrectionMonitoringPaginationInfo(totalRows) {
        const info = byId("secretaryDashboardCorrectionPaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "No records";
            return;
        }
        info.textContent = totalRows + " records";
    }

    function renderCorrectionMonitoringPagination(totalRows) {
        const pagination = byId("secretaryDashboardCorrectionPagination");
        if (!pagination) {
            return;
        }
        if (totalRows <= 0) {
            pagination.innerHTML = "";
            return;
        }

        const pageCount = getPageCount(totalRows);
        const items = [];
        items.push(pageItemMarkup("Previous", correctionMonitoringCurrentPage - 1, correctionMonitoringCurrentPage <= 1, false, "Previous page"));
        items.push(pageStatusItemMarkup(String(correctionMonitoringCurrentPage) + " / " + String(pageCount)));
        items.push(pageItemMarkup("Next", correctionMonitoringCurrentPage + 1, correctionMonitoringCurrentPage >= pageCount, false, "Next page"));
        pagination.innerHTML = items.join("");
    }

    function applyCorrectionMonitoringPagination(resetPage, emptyMessage) {
        if (resetPage) {
            correctionMonitoringCurrentPage = 1;
        }

        const pageCount = getPageCount(correctionMonitoringRows.length);
        if (correctionMonitoringCurrentPage > pageCount) {
            correctionMonitoringCurrentPage = pageCount;
        }
        if (correctionMonitoringCurrentPage < 1) {
            correctionMonitoringCurrentPage = 1;
        }

        const start = (correctionMonitoringCurrentPage - 1) * QUEUE_PAGE_SIZE;
        const pageRows = correctionMonitoringRows.slice(start, start + QUEUE_PAGE_SIZE);

        renderCorrectionMonitoringTable(pageRows, emptyMessage);
        renderCorrectionMonitoringPaginationInfo(correctionMonitoringRows.length);
        renderCorrectionMonitoringPagination(correctionMonitoringRows.length);
    }

    function bindEvents() {
        const sectionTabs = byId("secretaryDashboardSectionTabs");
        if (sectionTabs) {
            sectionTabs.addEventListener("shown.bs.tab", function (event) {
                const tabButton = event.target;
                const tabId = tabButton && tabButton.id ? tabButton.id : "";
                const currentContext = dashboardContext;
                const currentLoadToken = dashboardLoadToken;

                if (tabId === "secretaryDashboardNoFormTab" || tabId === "secretaryDashboardDraftTab") {
                    ensureRegisteredDataLoaded(currentContext, currentLoadToken);
                    return;
                }

                if (tabId === "secretaryDashboardCorrectionTab") {
                    ensureCorrectionDataLoaded(currentContext, currentLoadToken);
                    return;
                }

                if (tabId === "secretaryDashboardQueueTab") {
                    ensureQueueVisualsLoaded(currentLoadToken);
                }
            });
        }

        const pagination = byId("secretaryDashboardQueuePagination");
        if (pagination) {
            pagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(queueRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }

                queueCurrentPage = nextPage;
                applyQueuePagination(false);
            });
        }

        const noFormPagination = byId("secretaryDashboardNoFormPagination");
        if (noFormPagination) {
            noFormPagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(noFormRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }

                noFormCurrentPage = nextPage;
                applyNoFormPagination(false);
            });
        }

        const draftPagination = byId("secretaryDashboardDraftPagination");
        if (draftPagination) {
            draftPagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(draftRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }

                draftCurrentPage = nextPage;
                applyDraftPagination(false);
            });
        }

        const correctionPagination = byId("secretaryDashboardCorrectionPagination");
        if (correctionPagination) {
            correctionPagination.addEventListener("click", function (event) {
                const button = event.target.closest("button[data-page]");
                if (!button || button.closest(".disabled")) {
                    return;
                }

                const nextPage = Number(button.getAttribute("data-page"));
                const pageCount = getPageCount(correctionMonitoringRows.length);
                if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
                    return;
                }

                correctionMonitoringCurrentPage = nextPage;
                applyCorrectionMonitoringPagination(false);
            });
        }

        const chartToggleBtn = byId("secretaryDashboardBarangayChartToggleBtn");
        if (chartToggleBtn) {
            chartToggleBtn.addEventListener("click", function () {
                barangayChartExpanded = !barangayChartExpanded;
                renderBarangayChart(queueRows, getQueueProfileMap());
            });
        }

        const sectorFilter = byId("secretaryDashboardSectorFilter");
        if (sectorFilter) {
            sectorFilter.addEventListener("change", function () {
                renderSectorChart(queueRows);
            });
        }

        const registeredFilter = byId("secretaryDashboardRegisteredFilter");
        if (registeredFilter) {
            registeredFilter.addEventListener("change", function () {
                ensureRegisteredDataLoaded(dashboardContext, dashboardLoadToken);
                renderRegisteredChart(registeredStatusCounts);
            });
        }

        const barangayFilter = byId("secretaryDashboardBarangayFilter");
        if (barangayFilter) {
            barangayFilter.addEventListener("change", function () {
                renderBarangayChart(queueRows, getQueueProfileMap());
            });
        }

        const correctionFilter = byId("secretaryDashboardCorrectionFilter");
        if (correctionFilter) {
            correctionFilter.addEventListener("change", function () {
                ensureCorrectionDataLoaded(dashboardContext, dashboardLoadToken);
                renderCorrectionChart(queueRows, correctionNoticeByApplicationId);
            });
        }

        const reminderFilter = byId("secretaryDashboardReminderFilter");
        if (reminderFilter) {
            reminderFilter.addEventListener("change", function () {
                ensureReminderDataLoaded(dashboardContext, dashboardLoadToken);
                renderReminderChart(buildReminderFollowupCounts(fetchReminderRows()));
            });
        }

        window.addEventListener("resize", function () {
            if (!queueRows.length) {
                return;
            }
            renderBarangayChart(queueRows, getQueueProfileMap());
        });
    }

    async function fetchAllApplications(context) {
        const allRows = [];
        let from = 0;
        const batchSize = 1000;
        while (true) {
            const { data, error } = await context.client
                .from("applications")
                .select(applicationsSelectFields())
                .neq("status", "draft")
                .order("updated_at", { ascending: false })
                .range(from, from + batchSize - 1);
            if (error) {
                throw error;
            }
            if (!data || data.length === 0) {
                break;
            }
            allRows.push(...data);
            if (data.length < batchSize) {
                break;
            }
            from += batchSize;
        }
        return allRows;
    }

    async function loadDashboard(context) {
        const loadToken = dashboardLoadToken + 1;
        dashboardLoadToken = loadToken;
        dashboardContext = context;
        resetDeferredDashboardLoads();

        setDashboardLoading(true);
        try {
            showStatus("");

            queueRows = [];
            queueEducationByApplicationId = {};
            queueEducationLoadingByApplicationId = {};
            setRegisteredCount(0);
            registeredApplicantCount = 0;
            correctionNoticeByApplicationId = {};
            noFormRows = [];
            draftRows = [];
            correctionMonitoringRows = [];
            reminderLogLookup = {};
            resetRegisteredStatusCounts();
            renderRegisteredChart(registeredStatusCounts);
            renderCorrectionChart([], {});
            renderReminderChart(buildReminderFollowupCounts([]));
            applyNoFormPagination(true, "Loading users without form...");
            applyDraftPagination(true, "Loading draft users...");
            applyCorrectionMonitoringPagination(true, "Loading pending correction records...");

            const rows = await fetchAllApplications(context);
            const applicantIds = Array.from(new Set(rows.map(function (row) {
                return row.applicant_id;
            }).filter(Boolean)));

            let profileMap = {};
            if (applicantIds.length > 0) {
                const profileLoad = await loadProfilesByIds(context, applicantIds);
                profileMap = profileLoad.profileMap;

                if (profileLoad.failedBatchCount > 0) {
                    showStatus(
                        "Some applicant profiles could not be loaded on the dashboard queue. " +
                        "Showing available data only." +
                        (profileLoad.lastErrorMessage ? " " + profileLoad.lastErrorMessage : ""),
                        "alert-warning"
                    );
                }
            }

            const enriched = rows.map(function (row) {
                const profile = profileMap[row.applicant_id] || null;
                return Object.assign({}, row, {
                    applicant_name: buildApplicantName(profile),
                    profile: profile
                });
            });

            queueRows = enriched;
            populateBarangayFilter();
            renderMetrics(queueRows);
            applyQueuePagination(true);
            setDashboardLoading(false);
            ensureQueueVisualsLoaded(loadToken);
            warmDashboardSecondaryData(context, loadToken);
        } finally {
            setDashboardLoading(false);
        }
    }

    async function init() {
        const context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents();
        await loadDashboard(context);
    }

    window.addEventListener("DOMContentLoaded", init);
})();
