(function () {
    "use strict";

    const QUEUE_PAGE_SIZE = 8;
    const PROFILE_BATCH_SIZE = 120;
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
    let queueRows = [];
    let queueCurrentPage = 1;
    let sectorChart = null;
    let barangayChart = null;
    let barangayLookup = null;
    let sectorLookup = null;
    let barangayChartExpanded = false;
    let applicationsSupportsSectorClassification = true;

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
        if (!wrap || !canvas || !empty || !summary) {
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

        updateBarangayChartToggle(rowsWithData.length, 0);

        if (!rowsWithData.length) {
            wrap.classList.add("d-none");
            empty.textContent = "No barangay chart data yet.";
            empty.classList.remove("d-none");
            summary.textContent = "";
            summary.classList.add("d-none");
            return;
        }

        const displayRows = rowsWithData;

        wrap.classList.remove("d-none");
        empty.classList.add("d-none");
        wrap.style.height = Math.max(220, displayRows.length * 18 + 36) + "px";
        summary.textContent = "";
        summary.classList.add("d-none");

        barangayChart = new window.Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: displayRows.map(function (row) { return row.label; }),
                datasets: [
                    {
                        label: "Applications",
                        data: displayRows.map(function (row) { return row.count; }),
                        backgroundColor: displayRows.map(function (row) {
                            if (row.isOther) {
                                return "rgba(148, 163, 184, 0.9)";
                            }
                            return row.isMissing ? "rgba(185, 28, 28, 0.86)" : "rgba(71, 85, 105, 0.86)";
                        }),
                        borderColor: displayRows.map(function (row) {
                            if (row.isOther) {
                                return "rgb(100, 116, 139)";
                            }
                            return row.isMissing ? "rgb(153, 27, 27)" : "rgb(51, 65, 85)";
                        }),
                        borderWidth: 1,
                        borderRadius: 8,
                        barThickness: 12,
                        maxBarThickness: 14
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 4,
                        right: 12,
                        bottom: 4,
                        left: 4
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                const value = Number(context.raw || 0);
                                return value + " application" + (value === 1 ? "" : "s");
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                            stepSize: 1,
                            color: "#475569"
                        },
                        grid: {
                            color: "rgba(148, 163, 184, 0.18)"
                        },
                        border: {
                            display: false
                        }
                    },
                    y: {
                        ticks: {
                            autoSkip: false,
                            color: "#334155",
                            font: {
                                size: 9
                            }
                        },
                        grid: {
                            display: false
                        },
                        border: {
                            display: false
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

    function renderQueuePaginationInfo(totalRows) {
        const info = byId("secretaryDashboardQueuePaginationInfo");
        if (!info) {
            return;
        }
        if (totalRows <= 0) {
            info.textContent = "Showing 0 of 0 records";
            return;
        }
        const start = (queueCurrentPage - 1) * QUEUE_PAGE_SIZE + 1;
        const end = Math.min(queueCurrentPage * QUEUE_PAGE_SIZE, totalRows);
        info.textContent = "Showing " + start + "-" + end + " of " + totalRows + " records";
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

        let startPage = Math.max(1, queueCurrentPage - 2);
        let endPage = Math.min(pageCount, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let page = startPage; page <= endPage; page += 1) {
            items.push(pageItemMarkup(String(page), page, false, page === queueCurrentPage, "Page " + page));
        }

        items.push(pageItemMarkup("Next", queueCurrentPage + 1, queueCurrentPage >= pageCount, false, "Next page"));
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
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No queue records found.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            return (
                "<tr>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown") + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml(formatDate(row.updated_at || row.created_at)) + "</td>" +
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

        window.addEventListener("resize", function () {
            if (!queueRows.length) {
                return;
            }
            renderBarangayChart(queueRows, getQueueProfileMap());
        });
    }

    async function loadDashboard(context) {
        showStatus("");

        setRegisteredCount(0);

        const registeredCountPromise = context.client
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("role", "applicant");

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
            const registeredCountResult = await registeredCountPromise;
            if (!registeredCountResult.error) {
                setRegisteredCount(registeredCountResult.count || 0);
            } else {
                setRegisteredCount(0);
            }
            return;
        }

        const rows = appResult.data || [];
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

        const registeredCountResult = await registeredCountPromise;
        if (registeredCountResult.error) {
            setRegisteredCount(0);
        } else {
            setRegisteredCount(registeredCountResult.count || 0);
        }

        queueRows = enriched;
        renderMetrics(queueRows);
        renderSectorChart(queueRows);
        renderBarangayChart(queueRows, profileMap);
        applyQueuePagination(true);
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
