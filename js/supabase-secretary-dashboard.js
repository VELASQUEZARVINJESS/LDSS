(function () {
    "use strict";

    const QUEUE_PAGE_SIZE = 5;
    const PROFILE_BATCH_SIZE = 120;
    const SUPABASE_FETCH_LIMIT = 1000;
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
    let queueRows = [];
    let queueCurrentPage = 1;
    let noFormRows = [];
    let noFormCurrentPage = 1;
    let correctionMonitoringRows = [];
    let correctionMonitoringCurrentPage = 1;
    let sectorChart = null;
    let registeredChart = null;
    let barangayChart = null;
    let correctionChart = null;
    let registeredApplicantCount = 0;
    let barangayLookup = null;
    let sectorLookup = null;
    let barangayChartExpanded = false;
    let applicationsSupportsSectorClassification = true;
    let correctionNoticeByApplicationId = {};

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
            return "id, application_no, applicant_id, sector_classification, status, created_at, updated_at";
        }
        return "id, application_no, applicant_id, status, created_at, updated_at";
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

    function renderRegisteredChart(registeredCount, submittedCount) {
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

        const safeRegisteredCount = Math.max(0, Number(registeredCount || 0));
        const safeSubmittedCount = Math.max(0, Math.min(safeRegisteredCount, Number(submittedCount || 0)));
        const notSubmittedCount = Math.max(0, safeRegisteredCount - safeSubmittedCount);

        const activeFilter = selectedRegisteredFilter();
        let chartLabels = ["Submitted / Returned", "No Submitted Form"];
        let chartData = [safeSubmittedCount, notSubmittedCount];
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

        const colors = [
            "rgba(30, 64, 175, 0.88)",
            "rgba(148, 163, 184, 0.92)"
        ];
        const borders = [
            "rgb(30, 58, 138)",
            "rgb(100, 116, 139)"
        ];

        if (activeFilter === "submitted") {
            chartLabels = ["Submitted / Returned", "Other Registered"];
            chartData = [safeSubmittedCount, notSubmittedCount];
            centerLabel = "Submitted";
            centerTotal = safeSubmittedCount;
        } else if (activeFilter === "not_submitted") {
            chartLabels = ["No Submitted Form", "Other Registered"];
            chartData = [notSubmittedCount, safeSubmittedCount];
            centerLabel = "No Form";
            centerTotal = notSubmittedCount;
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

                return {
                    id: row.id,
                    application_no: row.application_no || "-",
                    applicant_name: row.applicant_name || "Unknown Applicant",
                    notice_label: correctionNoticeLabel(notice, row),
                    applicant_update_label: hasUpdatedSinceNotice ? "Completed Update" : "Pending Update",
                    applicant_update_chip: hasUpdatedSinceNotice ? "ldss-chip-success" : "ldss-chip-danger",
                    follow_up_label: hasUpdatedSinceNotice ? "For Checking Again" : "Waiting for Applicant",
                    follow_up_chip: hasUpdatedSinceNotice ? "ldss-chip-accent" : "ldss-chip-neutral",
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
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">No queue records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown") + " - " + (row.application_no || "-")) + '">' +
                '<span class="ldss-table-ellipsis fw-semibold">' + escapeHtml(row.applicant_name || "Unknown") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">' + escapeHtml(row.application_no || "-") + "</span>" +
                "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at || row.created_at)) + "</td>" +
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
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">' +
                escapeHtml(emptyMessage || "No registered users without a submitted form.") +
                "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml(row.applicant_name || "Unknown Applicant") + '">' +
                '<span class="ldss-table-ellipsis fw-semibold">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</span>" +
                "</td>" +
                "<td>" + escapeHtml(row.barangay || "No Barangay") + "</td>" +
                "<td>" + escapeHtml(formatDate(row.created_at)) + "</td>" +
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
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">' +
                escapeHtml(emptyMessage || "No return or resubmission records found.") +
                "</td></tr>";
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            return (
                "<tr>" +
                '<td title="' + escapeHtml((row.applicant_name || "Unknown") + " - " + (row.application_no || "-") + " - " + (row.notice_label || "")) + '">' +
                '<span class="ldss-table-ellipsis fw-semibold">' + escapeHtml(row.applicant_name || "Unknown") + "</span>" +
                '<span class="ldss-table-ellipsis ldss-dashboard-meta">' + escapeHtml(row.notice_label || row.application_no || "-") + "</span>" +
                "</td>" +
                '<td><span class="ldss-chip ' + row.applicant_update_chip + '">' + escapeHtml(row.applicant_update_label) + '</span><span class="ldss-dashboard-meta d-block mt-1">' + escapeHtml(row.follow_up_label) + "</span></td>" +
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
                const submittedApplicantCount = new Set(
                    queueRows.map(function (row) {
                        return row.applicant_id;
                    }).filter(Boolean)
                ).size;
                renderRegisteredChart(registeredApplicantCount, submittedApplicantCount);
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
                renderCorrectionChart(queueRows, correctionNoticeByApplicationId);
            });
        }

        window.addEventListener("resize", function () {
            if (!queueRows.length) {
                return;
            }
            renderBarangayChart(queueRows, getQueueProfileMap());
        });
    }

    async function loadDashboard(context) {
        setDashboardLoading(true);
        try {
            showStatus("");

            setRegisteredCount(0);
            registeredApplicantCount = 0;
            correctionNoticeByApplicationId = {};
            noFormRows = [];
            correctionMonitoringRows = [];
            renderRegisteredChart(0, 0);
            renderCorrectionChart([], {});
            applyNoFormPagination(true, "Loading registered users...");
            applyCorrectionMonitoringPagination(true, "Loading return and resubmission records...");

            const registeredProfilesPromise = fetchAllApplicantProfiles(context);

            let appResult = await context.client
                .from("applications")
                .select(applicationsSelectFields())
                .neq("status", "draft")
                .order("updated_at", { ascending: false });

            if (applicationsSupportsSectorClassification && isMissingApplicationsColumnError(appResult.error, "sector_classification")) {
                applicationsSupportsSectorClassification = false;
                appResult = await context.client
                    .from("applications")
                    .select(applicationsSelectFields())
                    .neq("status", "draft")
                    .order("updated_at", { ascending: false });
            }

            if (appResult.error) {
                showStatus("Failed to load dashboard data: " + appResult.error.message, "alert-danger");
                const registeredProfilesResult = await registeredProfilesPromise;
                if (!registeredProfilesResult.error) {
                    setRegisteredCount(registeredProfilesResult.count || (registeredProfilesResult.data || []).length || 0);
                } else {
                    setRegisteredCount(0);
                }
                applyNoFormPagination(true, "Unable to compare submitted forms right now.");
                applyCorrectionMonitoringPagination(true, "Unable to load return and resubmission records right now.");
                return;
            }

            const rows = appResult.data || [];
            const applicantIds = Array.from(new Set(rows.map(function (row) {
                return row.applicant_id;
            }).filter(Boolean)));
            const applicationIds = Array.from(new Set(rows.map(function (row) {
                return row.id;
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

            const correctionNoticeLoad = applicationIds.length > 0
                ? await loadLatestCorrectionNoticesByApplicationIds(context, applicationIds)
                : { noticeMap: {}, error: null };
            correctionNoticeByApplicationId = correctionNoticeLoad.noticeMap || {};
            if (correctionNoticeLoad.error) {
                showStatus(
                    "Correction history could not be loaded completely. Showing available return and resubmission data only.",
                    "alert-warning"
                );
            }
            correctionMonitoringRows = buildCorrectionMonitoringRows(enriched, correctionNoticeByApplicationId);

            const submittedApplicantCount = new Set(
                enriched.map(function (row) {
                    return row.applicant_id;
                }).filter(Boolean)
            ).size;

            const submittedApplicantIds = new Set(
                enriched.map(function (row) {
                    return row.applicant_id;
                }).filter(Boolean)
            );

            const registeredProfilesResult = await registeredProfilesPromise;
            if (registeredProfilesResult.error) {
                setRegisteredCount(0);
                registeredApplicantCount = 0;
                renderRegisteredChart(0, submittedApplicantCount);
                noFormRows = [];
                applyNoFormPagination(true, "Unable to load registered applicants right now.");
            } else {
                const registeredProfiles = registeredProfilesResult.data || [];
                registeredApplicantCount = registeredProfilesResult.count || registeredProfiles.length || 0;
                setRegisteredCount(registeredApplicantCount);
                renderRegisteredChart(registeredApplicantCount, submittedApplicantCount);
                noFormRows = registeredProfiles
                    .filter(function (profile) {
                        return !submittedApplicantIds.has(profile.id);
                    })
                    .map(function (profile) {
                        return {
                            id: profile.id,
                            applicant_name: buildApplicantName(profile),
                            barangay: normalizeBarangay(profile.barangay || "") || "No Barangay",
                            email: profile.email || "",
                            created_at: profile.created_at || ""
                        };
                    });
                applyNoFormPagination(true);
            }

            queueRows = enriched;
            populateBarangayFilter();
            renderMetrics(queueRows);
            renderSectorChart(queueRows);
            renderBarangayChart(queueRows, profileMap);
            renderCorrectionChart(queueRows, correctionNoticeByApplicationId);
            applyQueuePagination(true);
            applyCorrectionMonitoringPagination(true);
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
