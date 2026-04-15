(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const LOOKUP_BATCH_SIZE = 200;
    const SETTINGS_STORAGE_KEY = "ldss:ranking-settings:fallback:v1";
    const RANKING_PRINT_ROWS_PER_PAGE = 30;
    const DEFAULT_SETTINGS = {
        exam_total_items: 100
    };
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
    const PROTECTED_APPLICATION_STATUSES = new Set([
        "special_endorsement_review",
        "for_interview",
        "interview_scheduled",
        "interview_completed",
        "hard_copy_verified",
        "for_approval",
        "approved",
        "waitlisted",
        "rejected",
        "for_release",
        "released"
    ]);

    let context = null;
    let batches = [];
    let rows = [];
    let currentBatchId = "";
    let currentRoomLabel = "";
    let activeSettings = Object.assign({}, DEFAULT_SETTINGS);
    let roomHotfixAvailable = true;
    let isSaving = false;
    let sectorLookup = null;
    let currentRoomSearchQuery = "";
    let currentRankingSearchQuery = "";

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (value) {
                return (value || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral" };
            },
            normalizeExamResult: function (value) {
                const raw = (value || "").toString().trim().toLowerCase();
                if (raw === "passed" || raw === "pass") {
                    return "passed";
                }
                if (raw === "failed" || raw === "fail") {
                    return "failed";
                }
                return "pending";
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
            .replace(/'/g, "&#039;");
    }

    function setText(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function showStatus(message, type) {
        const box = byId("secretaryExamResultStatus");
        if (!box) {
            return;
        }
        if (!message) {
            box.className = "alert d-none ldss-print-hide";
            box.textContent = "";
            return;
        }
        box.className = "alert ldss-print-hide " + (type || "alert-info");
        box.textContent = message;
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
            month: "short",
            day: "numeric"
        });
    }

    function buildApplicantName(profile) {
        if (!profile) {
            return "Unknown Applicant";
        }
        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) { return (value || "").toString().trim(); })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : (profile.email || "Unknown Applicant");
    }

    function compareRoomLabels(left, right) {
        return (left || "").toString().localeCompare((right || "").toString(), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function cleanupLookupKey(value) {
        return (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[.,]/g, "")
            .replace(/\s+/g, " ");
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

    function normalizeNumber(value, fallbackValue) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function normalizeStatus(value) {
        return workflow().normalizeStatus ? workflow().normalizeStatus(value) : (value || "").toString().trim().toLowerCase();
    }

    function normalizeSearchText(value) {
        return (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    }

    function readFallbackSettings() {
        const fallback = Object.assign({}, DEFAULT_SETTINGS);
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return fallback;
            }
            fallback.exam_total_items = normalizeNumber(parsed.exam_total_items, fallback.exam_total_items);
            return fallback;
        } catch (_error) {
            return fallback;
        }
    }

    async function loadActiveSettings() {
        activeSettings = readFallbackSettings();
        if (!context || !context.client) {
            return activeSettings;
        }

        const result = await context.client
            .from("ranking_settings")
            .select("exam_total_items")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(1);

        if (result.error || !result.data || !result.data.length) {
            return activeSettings;
        }

        const record = result.data[0] || {};
        activeSettings = {
            exam_total_items: normalizeNumber(record.exam_total_items, activeSettings.exam_total_items)
        };
        return activeSettings;
    }

    function maxRawScore() {
        const items = Math.round(normalizeNumber(activeSettings.exam_total_items, DEFAULT_SETTINGS.exam_total_items));
        return items > 0 ? items : DEFAULT_SETTINGS.exam_total_items;
    }

    function policyLabel() {
        return "Raw score only";
    }

    function calculatePercentage(rawScore) {
        const score = Number(rawScore);
        const items = maxRawScore();
        return Number(((score / items) * 100).toFixed(2));
    }

    function formatRawScoreInput(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "";
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return String(value);
        }
        return Number.isInteger(numeric) ? String(numeric) : String(numeric);
    }

    function previewMeta(rawValue) {
        if (rawValue === null || typeof rawValue === "undefined" || rawValue === "") {
            return {
                text: "Pending",
                className: "ldss-room-score-preview"
            };
        }

        const numeric = Number(rawValue);
        if (Number.isNaN(numeric)) {
            return {
                text: "Enter a whole number from 1 to " + String(maxRawScore()),
                className: "ldss-room-score-preview"
            };
        }

        if (!Number.isInteger(numeric) || numeric < 1 || numeric > maxRawScore()) {
            return {
                text: "Valid range: 1 to " + String(maxRawScore()),
                className: "ldss-room-score-preview is-error"
            };
        }

        return {
            text: "Accepted raw score",
            className: "ldss-room-score-preview is-valid"
        };
    }

    async function fetchBatches() {
        const result = await context.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue")
            .order("exam_datetime", { ascending: false });

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                return [];
            }
            throw new Error("Failed to load exam batches: " + result.error.message);
        }

        return result.data || [];
    }

    async function fetchExamRowsPaged() {
        roomHotfixAvailable = true;
        const examRows = [];

        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await context.client
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, raw_score, percentage_score, result, status, updated_at, room_label, room_seat_no")
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (!result.error) {
                const pageRows = result.data || [];
                examRows.push.apply(examRows, pageRows);
                if (pageRows.length < SUPABASE_FETCH_LIMIT) {
                    return examRows;
                }
                continue;
            }

            if (/room_label|room_seat_no/i.test(result.error.message || "")) {
                roomHotfixAvailable = false;
                const fallbackRows = [];

                for (let fallbackFrom = 0; ; fallbackFrom += SUPABASE_FETCH_LIMIT) {
                    const fallback = await context.client
                        .from("exam_records")
                        .select("id, application_id, batch_id, exam_control_no, scheduled_at, raw_score, percentage_score, result, status, updated_at")
                        .order("updated_at", { ascending: false })
                        .range(fallbackFrom, fallbackFrom + SUPABASE_FETCH_LIMIT - 1);

                    if (fallback.error) {
                        throw new Error("Failed to load exam records: " + fallback.error.message);
                    }

                    const fallbackPageRows = fallback.data || [];
                    fallbackRows.push.apply(fallbackRows, fallbackPageRows);
                    if (fallbackPageRows.length < SUPABASE_FETCH_LIMIT) {
                        return fallbackRows.map(function (row) {
                            return Object.assign({}, row, {
                                room_label: "",
                                room_seat_no: null
                            });
                        });
                    }
                }
            }

            if (/does not exist|relation/i.test(result.error.message || "")) {
                showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                return [];
            }

            throw new Error("Failed to load exam records: " + result.error.message);
        }
    }

    async function loadApplicationsByIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            let result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, status, scholarship_type, sector_classification")
                .in("id", chunk);

            if (result.error && /sector_classification/i.test(result.error.message || "")) {
                result = await context.client
                    .from("applications")
                    .select("id, application_no, applicant_id, status, scholarship_type")
                    .in("id", chunk);
            }

            if (result.error) {
                throw new Error("Failed to load linked applications: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                if (typeof row.sector_classification === "undefined") {
                    row.sector_classification = "";
                }
                map[row.id] = row;
            });
        }

        return map;
    }

    async function loadProfilesByIds(applicantIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicantIds || []).filter(Boolean)));

        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, school_name, mobile_number")
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to load applicant profiles: " + result.error.message);
            }

            (result.data || []).forEach(function (profile) {
                map[profile.id] = profile;
            });
        }

        return map;
    }

    function batchById(batchId) {
        return batches.find(function (batch) {
            return batch.id === batchId;
        }) || null;
    }

    function batchRows(batchId) {
        if (!batchId) {
            return [];
        }
        return rows.filter(function (row) {
            return row.batch_id === batchId;
        });
    }

    function roomLabelsForBatch(batchId) {
        return Array.from(new Set(batchRows(batchId).map(function (row) {
            return (row.room_label || "").toString().trim();
        }).filter(Boolean))).sort(compareRoomLabels);
    }

    function availableBatches() {
        return batches.filter(function (batch) {
            return batchRows(batch.id).length > 0;
        });
    }

    function currentRoomRows() {
        if (!currentBatchId || !currentRoomLabel) {
            return [];
        }

        return batchRows(currentBatchId)
            .filter(function (row) {
                return row.room_label === currentRoomLabel;
            })
            .sort(function (left, right) {
                const leftSeat = Number(left.room_seat_no || 0);
                const rightSeat = Number(right.room_seat_no || 0);
                if (leftSeat !== rightSeat) {
                    return leftSeat - rightSeat;
                }
                return String(left.exam_control_no || "").localeCompare(String(right.exam_control_no || ""), undefined, {
                    numeric: true,
                    sensitivity: "base"
                });
            });
    }

    function hasSavedRawScore(rawScore) {
        return rawScore !== null && typeof rawScore !== "undefined" && rawScore !== "" && !Number.isNaN(Number(rawScore));
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

    function sortRankingRows(sourceRows) {
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

            return String(left.exam_control_no || "").localeCompare(String(right.exam_control_no || ""), undefined, {
                numeric: true,
                sensitivity: "base"
            });
        });
    }

    function currentBatchRankingRows() {
        if (!currentBatchId) {
            return [];
        }

        const preparedRows = batchRows(currentBatchId)
            .filter(function (row) {
                return hasSavedRawScore(row.raw_score);
            })
            .map(function (row) {
                return Object.assign({}, row, {
                    raw_score_value: Number(row.raw_score)
                });
            });

        return assignDisplayRanks(sortRankingRows(preparedRows));
    }

    function isRankingPage() {
        return Boolean(byId("roomScoreRankingBody"));
    }

    function currentRankingMode() {
        const select = byId("roomScoreRankingPrintMode");
        return select ? ((select.value || "overall").toString().trim().toLowerCase()) : "overall";
    }

    function currentRankingRoomFilter() {
        const select = byId("roomScoreRankingRoomFilter");
        return select ? (select.value || "all").toString().trim() : "all";
    }

    function currentRankingSectorFilter() {
        const select = byId("roomScoreRankingSectorFilter");
        const value = select ? (select.value || "all").toString().trim() : "all";
        return value === "all" ? "all" : normalizeSectorClassification(value);
    }

    function currentRankingTopCount() {
        const select = byId("roomScoreRankingTopFilter");
        if (!select) {
            return 0;
        }
        const raw = (select.value || "10").toString().trim().toLowerCase();
        if (raw === "all") {
            return 0;
        }
        const numeric = Number(raw);
        return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 10;
    }

    function rankingSearchQuery() {
        return normalizeSearchText(currentRankingSearchQuery);
    }

    function rankingModeLabel(mode) {
        if (mode === "room") {
            return "Per Room Ranking";
        }
        if (mode === "sector") {
            return "Sector Classification Ranking";
        }
        if (mode === "top") {
            return "Top Range Ranking";
        }
        return "Overall Ranking";
    }

    function rankingRowsForCurrentView() {
        let filteredRows = currentBatchRankingRows();
        const mode = currentRankingMode();

        if (mode === "room") {
            const roomFilter = currentRankingRoomFilter();
            filteredRows = roomFilter === "all"
                ? []
                : filteredRows.filter(function (row) {
                    return row.room_label === roomFilter;
                });
        } else if (mode === "sector") {
            const sectorFilter = currentRankingSectorFilter();
            filteredRows = sectorFilter === "all"
                ? []
                : filteredRows.filter(function (row) {
                    return normalizeSectorClassification(row.sector_classification || "") === sectorFilter;
                });
        } else if (mode === "top") {
            const topCount = currentRankingTopCount();
            if (topCount > 0) {
                filteredRows = filteredRows.slice(0, topCount);
            }
        }

        return assignDisplayRanks(filteredRows.map(function (row) {
            return Object.assign({}, row);
        }));
    }

    function rankingSectorLabelsForBatch(batchId) {
        return Array.from(new Set(batchRows(batchId).map(function (row) {
            return normalizeSectorClassification(row.sector_classification || "");
        }).filter(Boolean))).sort(function (left, right) {
            return left.localeCompare(right);
        });
    }

    function encodedCount(roomRows) {
        return (roomRows || []).filter(function (row) {
            return row.raw_score !== null && typeof row.raw_score !== "undefined" && row.raw_score !== "";
        }).length;
    }

    function pendingCount(roomRows) {
        return Math.max((roomRows || []).length - encodedCount(roomRows), 0);
    }

    function resolveSelection(preferredBatchId, preferredRoomLabel) {
        const selectableBatches = availableBatches();
        if (!selectableBatches.length) {
            currentBatchId = "";
            currentRoomLabel = "";
            return;
        }

        currentBatchId = selectableBatches.some(function (batch) {
            return batch.id === preferredBatchId;
        }) ? preferredBatchId : selectableBatches[0].id;

        const roomLabels = roomLabelsForBatch(currentBatchId);
        currentRoomLabel = roomLabels.some(function (label) {
            return label === preferredRoomLabel;
        }) ? preferredRoomLabel : (roomLabels[0] || "");
    }

    function fillBatchFilter() {
        const select = byId("roomScoreBatchFilter");
        if (!select) {
            return;
        }

        const current = currentBatchId;
        const selectableBatches = availableBatches();
        select.innerHTML = selectableBatches.length
            ? selectableBatches.map(function (batch) {
                return '<option value="' + escapeHtml(batch.id) + '">' + escapeHtml(batch.batch_label || ("Batch " + batch.id)) + "</option>";
            }).join("")
            : '<option value="">No scheduled room assignments</option>';

        if (current && selectableBatches.some(function (batch) { return batch.id === current; })) {
            select.value = current;
        }
    }

    function fillRoomFilter() {
        const select = byId("roomScoreRoomFilter");
        if (!select) {
            return;
        }

        const labels = roomLabelsForBatch(currentBatchId);
        select.innerHTML = labels.length
            ? labels.map(function (label) {
                return '<option value="' + escapeHtml(label) + '">' + escapeHtml(label.toUpperCase()) + "</option>";
            }).join("")
            : '<option value="">No rooms assigned</option>';

        if (currentRoomLabel && labels.some(function (label) { return label === currentRoomLabel; })) {
            select.value = currentRoomLabel;
        }
    }

    function fillRankingRoomFilter() {
        const select = byId("roomScoreRankingRoomFilter");
        if (!select) {
            return;
        }

        const current = currentRankingRoomFilter();
        const labels = roomLabelsForBatch(currentBatchId);
        select.innerHTML = '<option value="all">All rooms</option>'
            + labels.map(function (label) {
                return '<option value="' + escapeHtml(label) + '">' + escapeHtml(label.toUpperCase()) + "</option>";
            }).join("");

        if (current !== "all" && labels.some(function (label) { return label === current; })) {
            select.value = current;
            return;
        }

        if (currentRankingMode() === "room" && labels.length) {
            select.value = labels[0];
            return;
        }

        select.value = "all";
    }

    function fillRankingSectorFilter() {
        const select = byId("roomScoreRankingSectorFilter");
        if (!select) {
            return;
        }

        const current = currentRankingSectorFilter();
        const sectors = rankingSectorLabelsForBatch(currentBatchId);
        select.innerHTML = '<option value="all">All sector classifications</option>'
            + sectors.map(function (sector) {
                return '<option value="' + escapeHtml(sector) + '">' + escapeHtml(sector) + "</option>";
            }).join("");

        if (current !== "all" && sectors.some(function (sector) { return sector === current; })) {
            select.value = current;
            return;
        }

        if (currentRankingMode() === "sector" && sectors.length) {
            select.value = sectors[0];
            return;
        }

        select.value = "all";
    }

    function syncRankingFilterVisibility() {
        const mode = currentRankingMode();
        const roomWrap = byId("roomScoreRankingRoomWrap");
        const sectorWrap = byId("roomScoreRankingSectorWrap");
        const topWrap = byId("roomScoreRankingTopWrap");

        if (roomWrap) {
            roomWrap.classList.toggle("d-none", mode !== "room");
        }
        if (sectorWrap) {
            sectorWrap.classList.toggle("d-none", mode !== "sector");
        }
        if (topWrap) {
            topWrap.classList.toggle("d-none", mode !== "top");
        }
    }

    function formatBatchLabel(batchId) {
        const batch = batchById(batchId);
        return batch && batch.batch_label ? batch.batch_label : "-";
    }

    function roomPositionMeta(batchId, roomLabel) {
        const labels = roomLabelsForBatch(batchId);
        const roomIndex = labels.indexOf(roomLabel);
        if (roomIndex === -1) {
            return "-";
        }
        return "Room " + String(roomIndex + 1) + " of " + String(labels.length);
    }

    function renderSelectionMeta() {
        const target = byId("roomScoreSelectionMeta");
        if (!target) {
            return;
        }

        if (!currentBatchId) {
            target.textContent = "Select a saved batch with room assignments to open the score sheet.";
            return;
        }

        if (!currentRoomLabel) {
            target.textContent = "This batch does not have saved room labels yet.";
            return;
        }

        target.textContent = formatBatchLabel(currentBatchId) + " | " + currentRoomLabel.toUpperCase() + " | " + roomPositionMeta(currentBatchId, currentRoomLabel);
    }

    function renderKpis() {
        const batch = batchById(currentBatchId);
        const roomRows = currentRoomRows();
        const encoded = encodedCount(roomRows);
        const roomCount = roomLabelsForBatch(currentBatchId).length;

        setText("roomScoreBatchName", batch && batch.batch_label ? batch.batch_label : "-");
        setText("roomScoreBatchMeta", batch ? ("Exam Date: " + formatDate(batch.exam_datetime || "")) : "No batch selected");
        setText("roomScoreCurrentRoomName", currentRoomLabel ? currentRoomLabel.toUpperCase() : "-");
        setText("roomScoreCurrentRoomMeta", currentRoomLabel ? roomPositionMeta(currentBatchId, currentRoomLabel) : "No room selected");
        setText("roomScoreSeatCount", roomRows.length);
        setText("roomScoreEncodedMeta", "Encoded scores: " + String(encoded) + " | Pending: " + String(pendingCount(roomRows)));
        setText("roomScorePolicyValue", "1 to " + String(maxRawScore()));
        setText("roomScorePolicyMeta", "Ranking uses raw score only | Rooms in batch: " + String(roomCount));
    }

    function renderPaperHeader() {
        const batch = batchById(currentBatchId);
        const roomRows = currentRoomRows();

        setText("roomScorePaperBatch", batch && batch.batch_label ? (batch.batch_label + " - LDSP Exam Score Sheet") : "LDSP Exam Score Sheet");
        setText("roomScorePaperRoom", currentRoomLabel
            ? (currentRoomLabel.toUpperCase() + " | " + String(roomRows.length) + " examinee(s)")
            : "Select a saved room assignment to begin encoding.");
        setText("roomScorePaperDate", batch ? formatDate(batch.exam_datetime || "") : "-");
        setText("roomScorePaperVenue", batch && batch.venue ? batch.venue : "-");
        setText("roomScorePaperPolicy", policyLabel());
    }

    function rankingSummaryMeta() {
        const mode = currentRankingMode();
        const rankingRows = rankingRowsForCurrentView();
        const filteredRows = filterRankingRowsBySearch(rankingRows);
        const searchQuery = rankingSearchQuery();
        let summary = "Select a batch to review ranking.";
        let title = "Batch Ranking List";
        let tableMeta = "Applicants with the same score keep the same rank.";

        if (currentBatchId) {
            if (mode === "room") {
                const roomFilter = currentRankingRoomFilter();
                title = roomFilter && roomFilter !== "all"
                    ? ("Room " + roomFilter.toUpperCase() + " Ranking List")
                    : "Per Room Ranking List";
                tableMeta = "Applicants in the selected room are ranked by score only.";
                summary = formatBatchLabel(currentBatchId) + " | " + title + " | Records: " + String(filteredRows.length);
            } else if (mode === "sector") {
                const sectorFilter = currentRankingSectorFilter();
                title = sectorFilter && sectorFilter !== "all"
                    ? (sectorFilter + " Ranking List")
                    : "Sector Classification Ranking List";
                tableMeta = "Applicants in the selected sector classification are ranked by score only.";
                summary = formatBatchLabel(currentBatchId) + " | " + title + " | Records: " + String(filteredRows.length);
            } else if (mode === "top") {
                const topCount = currentRankingTopCount();
                title = topCount > 0 ? ("Top " + String(topCount) + " Ranking List") : "All Ranked Records";
                tableMeta = "Only the selected top range is included in this ranking print view.";
                summary = formatBatchLabel(currentBatchId) + " | " + title + " | Records: " + String(filteredRows.length);
            } else {
                title = "Overall Ranking List";
                tableMeta = "All ranked applicants in the selected batch are ordered by score only.";
                summary = formatBatchLabel(currentBatchId) + " | " + title + " | Records: " + String(filteredRows.length);
            }
        }

        if (searchQuery) {
            summary += " | Search: " + currentRankingSearchQuery.trim();
            tableMeta += " Search keeps the original saved rank visible for each matching applicant.";
        }

        return {
            summary: summary,
            title: title,
            tableMeta: tableMeta
        };
    }

    function filterRankingRowsBySearch(sourceRows) {
        const query = rankingSearchQuery();
        const rowsForSearch = Array.isArray(sourceRows) ? sourceRows : [];
        if (!query) {
            return rowsForSearch.slice();
        }

        return rowsForSearch.filter(function (row) {
            const haystack = normalizeSearchText([
                row.applicant_name || "",
                row.application_no || "",
                row.school_name || "",
                row.scholarship_type || "",
                row.room_label || "",
                row.room_seat_no == null ? "" : String(row.room_seat_no),
                normalizeSectorClassification(row.sector_classification || "")
            ].join(" "));
            return haystack.indexOf(query) !== -1;
        });
    }

    function renderRankingSearchMeta(totalRows, matchRows) {
        const target = byId("roomScoreRankingSearchMeta");
        if (!target) {
            return;
        }

        const query = rankingSearchQuery();
        if (!query) {
            target.textContent = "Search by applicant name or LDSP application number.";
            return;
        }

        if (!matchRows) {
            target.textContent = "No ranked applicants matched that search.";
            return;
        }

        target.textContent = "Showing " + String(matchRows) + " matching ranked applicant(s) out of " + String(totalRows) + ".";
    }

    function renderRankingSummary() {
        const meta = rankingSummaryMeta();

        setText("roomScoreRankingSelectionMeta", meta.summary);
        setText("roomScoreRankingTableTitle", meta.title);
        setText("roomScoreRankingTableMeta", meta.tableMeta);
        setText("roomScoreRankingPrintTitle", "LDSP " + meta.title);
        setText("roomScoreRankingPrintSummary", meta.summary);
    }

    function renderEmptyRoomSheet(message) {
        const tbody = byId("roomScoreSheetBody");
        if (!tbody) {
            return;
        }
        tbody.innerHTML = '<tr><td colspan="5" class="ldss-room-score-empty">' + escapeHtml(message) + "</td></tr>";
        const meta = byId("roomScoreSearchMeta");
        if (meta) {
            meta.textContent = "Search within the current room sheet.";
        }
    }

    function renderEmptyRankingTable(message) {
        const tbody = byId("roomScoreRankingBody");
        if (!tbody) {
            return;
        }
        tbody.innerHTML = '<tr><td colspan="8" class="ldss-room-score-empty">' + escapeHtml(message) + "</td></tr>";
    }

    function renderEmptyRankingCards(message) {
        const container = byId("roomScoreRankingCards");
        if (!container) {
            return;
        }
        container.innerHTML = '<div class="ldss-ranking-card-empty">' + escapeHtml(message) + "</div>";
    }

    function clearRankingPrintPages() {
        const container = byId("roomScoreRankingPrintPages");
        if (!container) {
            return;
        }
        container.innerHTML = "";
    }

    function rankingDatasetForRender() {
        if (!currentBatchId) {
            renderRankingSearchMeta(0, 0);
            return {
                rows: [],
                message: "Select a saved batch to review ranking by score."
            };
        }

        const batchRoomRows = batchRows(currentBatchId);
        if (!batchRoomRows.length) {
            renderRankingSearchMeta(0, 0);
            return {
                rows: [],
                message: "No assigned room records were found for this batch yet."
            };
        }

        const mode = currentRankingMode();
        if (mode === "room" && currentRankingRoomFilter() === "all") {
            renderRankingSearchMeta(0, 0);
            return {
                rows: [],
                message: "Select a room to review or print per-room ranking."
            };
        }
        if (mode === "sector" && currentRankingSectorFilter() === "all") {
            renderRankingSearchMeta(0, 0);
            return {
                rows: [],
                message: "Select a sector classification to review or print sector ranking."
            };
        }

        const rankingRows = rankingRowsForCurrentView();
        const searchedRows = filterRankingRowsBySearch(rankingRows);
        renderRankingSearchMeta(rankingRows.length, searchedRows.length);
        if (!searchedRows.length) {
            return {
                rows: [],
                message: rankingSearchQuery()
                    ? "No ranked applicants matched the current search."
                    : "No saved scores matched the selected ranking option."
            };
        }

        return {
            rows: searchedRows,
            message: ""
        };
    }

    function rankingTableHeadMarkup() {
        return (
            "<thead>" +
            "<tr>" +
            "<th>No.</th>" +
            "<th>Rank</th>" +
            "<th>Examinee</th>" +
            "<th>Application No.</th>" +
            "<th>Room</th>" +
            "<th>Seat</th>" +
            "<th>Sector Classification</th>" +
            "<th>Score</th>" +
            "</tr>" +
            "</thead>"
        );
    }

    function rankingPrintTableHeadMarkup() {
        return (
            "<thead>" +
            "<tr>" +
            "<th>No.</th>" +
            "<th>Rank</th>" +
            "<th>Examinee</th>" +
            "<th>Room</th>" +
            "<th>Seat</th>" +
            "<th>Sector Classification</th>" +
            "<th>Score</th>" +
            "</tr>" +
            "</thead>"
        );
    }

    function compactPrintRoomLabel(value) {
        const raw = (value || "-").toString().trim().toUpperCase();
        if (!raw || raw === "-") {
            return "-";
        }
        return raw.replace(/^ROOM\s+/i, "R");
    }

    function formatPrintWholeNumber(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return "-";
        }
        return String(Math.max(0, Math.trunc(numeric)));
    }

    function rankingTableRowMarkup(row, index) {
        const counter = index + 1;
        return (
            "<tr>" +
            '<td class="text-center fw-700">' + escapeHtml(String(counter)) + "</td>" +
            '<td class="text-center fw-700">' + escapeHtml(String(row.display_rank || "-")) + "</td>" +
            "<td>" +
            '<div class="fw-700">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
            '<div class="small text-muted">' + escapeHtml(row.school_name || (row.scholarship_type || "-")) + "</div>" +
            "</td>" +
            "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
            '<td class="text-center">' + escapeHtml((row.room_label || "-").toString().toUpperCase()) + "</td>" +
            '<td class="text-center">' + escapeHtml(row.room_seat_no == null ? "-" : String(row.room_seat_no)) + "</td>" +
            '<td class="text-center">' + escapeHtml(normalizeSectorClassification(row.sector_classification || "")) + "</td>" +
            '<td class="text-center fw-700">' + escapeHtml(formatRawScoreInput(row.raw_score_value)) + "</td>" +
            "</tr>"
        );
    }

    function rankingPrintTableRowMarkup(row, counter) {
        return (
            "<tr>" +
            '<td class="text-center"><span class="ldss-ranking-print-number">' + escapeHtml(formatPrintWholeNumber(counter)) + "</span></td>" +
            '<td class="text-center fw-700"><span class="ldss-ranking-print-number">' + escapeHtml(formatPrintWholeNumber(row.display_rank)) + "</span></td>" +
            "<td>" +
            '<div class="fw-700 ldss-ranking-print-primary">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
            '<div class="small text-muted ldss-ranking-print-secondary">' + escapeHtml(row.application_no || "-") + "</div>" +
            "</td>" +
            '<td class="text-center"><span class="ldss-ranking-print-value">' + escapeHtml(compactPrintRoomLabel(row.room_label || "-")) + "</span></td>" +
            '<td class="text-center"><span class="ldss-ranking-print-value">' + escapeHtml(row.room_seat_no == null ? "-" : String(row.room_seat_no)) + "</span></td>" +
            '<td class="text-center"><span class="ldss-ranking-print-value">' + escapeHtml(normalizeSectorClassification(row.sector_classification || "")) + "</span></td>" +
            '<td class="text-center fw-700"><span class="ldss-ranking-print-value">' + escapeHtml(formatRawScoreInput(row.raw_score_value)) + "</span></td>" +
            "</tr>"
        );
    }

    function chunkRankingRowsForPrint(rowsForPrint) {
        const chunks = [];
        const pageSize = RANKING_PRINT_ROWS_PER_PAGE > 0 ? RANKING_PRINT_ROWS_PER_PAGE : 30;
        const sourceRows = rowsForPrint || [];

        for (let index = 0; index < sourceRows.length; index += pageSize) {
            chunks.push(sourceRows.slice(index, index + pageSize));
        }

        return chunks;
    }

    function renderRoomSheet() {
        const tbody = byId("roomScoreSheetBody");
        if (!tbody) {
            return;
        }

        if (!currentBatchId) {
            renderEmptyRoomSheet("No room assignments are ready yet. Open Room Assignment first.");
            return;
        }

        if (!currentRoomLabel) {
            renderEmptyRoomSheet("This batch does not have saved room labels yet.");
            return;
        }

        const roomRows = currentRoomRows();
        if (!roomRows.length) {
            renderEmptyRoomSheet("This room does not have assigned examinees yet.");
            return;
        }

        tbody.innerHTML = roomRows.map(function (row) {
            const preview = previewMeta(row.raw_score);
            const searchText = normalizeSearchText([
                row.room_seat_no == null ? "" : String(row.room_seat_no),
                row.exam_control_no || "",
                row.application_no || "",
                row.applicant_name || "",
                row.school_name || "",
                row.scholarship_type || ""
            ].join(" "));

            return (
                '<tr data-room-sheet-row="' + escapeHtml(row.id) + '" data-room-search-text="' + escapeHtml(searchText) + '">' +
                '<td class="ldss-room-score-seat">' + escapeHtml(row.room_seat_no || "-") + "</td>" +
                '<td class="ldss-room-score-control">' + escapeHtml(row.exam_control_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.school_name || (row.scholarship_type || "-")) + "</div>" +
                "</td>" +
                '<td class="ldss-room-score-score">' +
                '<input class="form-control form-control-sm ldss-room-score-input" type="number" min="1" max="' + escapeHtml(String(maxRawScore())) + '" step="1" inputmode="numeric" data-room-raw-score="' + escapeHtml(row.id) + '" value="' + escapeHtml(formatRawScoreInput(row.raw_score)) + '" />' +
                '<div class="' + escapeHtml(preview.className) + '" data-room-preview="' + escapeHtml(row.id) + '">' + escapeHtml(preview.text) + "</div>" +
                "</td>" +
                "</tr>"
            );
        }).join("");

        applyRoomSheetSearch();
    }

    function applyRoomSheetSearch() {
        const tbody = byId("roomScoreSheetBody");
        const meta = byId("roomScoreSearchMeta");
        if (!tbody) {
            return;
        }

        const rowsInDom = Array.from(tbody.querySelectorAll("[data-room-sheet-row]"));
        if (!rowsInDom.length) {
            if (meta) {
                meta.textContent = "Search within the current room sheet.";
            }
            return;
        }

        const query = normalizeSearchText(currentRoomSearchQuery);
        if (!query) {
            rowsInDom.forEach(function (row) {
                row.classList.remove("d-none", "ldss-room-score-search-match");
            });
            if (meta) {
                meta.textContent = "Search within the current room sheet.";
            }
            return;
        }

        let matchCount = 0;
        rowsInDom.forEach(function (row) {
            const haystack = normalizeSearchText(row.getAttribute("data-room-search-text") || row.textContent || "");
            const isMatch = haystack.indexOf(query) !== -1;
            row.classList.toggle("d-none", !isMatch);
            row.classList.toggle("ldss-room-score-search-match", isMatch);
            if (isMatch) {
                matchCount += 1;
            }
        });

        if (meta) {
            meta.textContent = matchCount
                ? ("Showing " + String(matchCount) + " matching examinee(s) in this room.")
                : "No matching examinees were found in this room.";
        }
    }

    function renderRankingTable() {
        const tbody = byId("roomScoreRankingBody");
        if (!tbody) {
            return;
        }

        const rankingState = rankingDatasetForRender();
        if (!rankingState.rows.length) {
            renderEmptyRankingTable(rankingState.message);
            return;
        }

        tbody.innerHTML = rankingState.rows.map(function (row, index) {
            return rankingTableRowMarkup(row, index);
        }).join("");
    }

    function renderRankingCards() {
        const container = byId("roomScoreRankingCards");
        if (!container) {
            return;
        }

        const rankingState = rankingDatasetForRender();
        if (!rankingState.rows.length) {
            renderEmptyRankingCards(rankingState.message);
            return;
        }

        container.innerHTML = rankingState.rows.map(function (row, index) {
            return (
                '<article class="ldss-ranking-card">' +
                '<div class="ldss-ranking-card-header">' +
                '<div class="ldss-ranking-card-badges">' +
                '<div class="ldss-ranking-card-counter">No. ' + escapeHtml(String(index + 1)) + "</div>" +
                '<div class="ldss-ranking-card-rank">Rank ' + escapeHtml(String(row.display_rank || "-")) + "</div>" +
                "</div>" +
                '<div class="ldss-ranking-card-score">' +
                '<div class="ldss-ranking-card-score-label">Score</div>' +
                '<div class="ldss-ranking-card-score-value">' + escapeHtml(formatRawScoreInput(row.raw_score_value)) + "</div>" +
                "</div>" +
                "</div>" +
                '<div class="ldss-ranking-card-name">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="ldss-ranking-card-school">' + escapeHtml(row.school_name || (row.scholarship_type || "-")) + "</div>" +
                '<div class="ldss-ranking-card-grid mt-3">' +
                '<div><div class="ldss-ranking-card-label">Application No.</div><div class="ldss-ranking-card-value">' + escapeHtml(row.application_no || "-") + "</div></div>" +
                '<div><div class="ldss-ranking-card-label">Room</div><div class="ldss-ranking-card-value">' + escapeHtml((row.room_label || "-").toString().toUpperCase()) + "</div></div>" +
                '<div><div class="ldss-ranking-card-label">Seat</div><div class="ldss-ranking-card-value">' + escapeHtml(row.room_seat_no == null ? "-" : String(row.room_seat_no)) + "</div></div>" +
                '<div><div class="ldss-ranking-card-label">Sector</div><div class="ldss-ranking-card-value">' + escapeHtml(normalizeSectorClassification(row.sector_classification || "")) + "</div></div>" +
                "</div>" +
                "</article>"
            );
        }).join("");
    }

    function renderRankingPrintPages() {
        const container = byId("roomScoreRankingPrintPages");
        if (!container) {
            return;
        }

        const rankingState = rankingDatasetForRender();
        if (!rankingState.rows.length) {
            clearRankingPrintPages();
            return;
        }

        const meta = rankingSummaryMeta();
        const rowChunks = chunkRankingRowsForPrint(rankingState.rows);
        const totalPages = rowChunks.length;

        container.innerHTML = rowChunks.map(function (chunk, index) {
            const startCounter = (index * RANKING_PRINT_ROWS_PER_PAGE) + 1;
            return (
                '<section class="ldss-ranking-print-page">' +
                '<div class="ldss-ranking-print-page-header">' +
                '<div class="ldss-ranking-print-brand">' +
                '<img class="ldss-ranking-print-logo" src="../img/daet-lgu.png" alt="LGU Daet Logo" />' +
                '<div class="ldss-ranking-print-brand-copy">' +
                '<div class="ldss-ranking-print-page-title">' + escapeHtml("LDSP " + meta.title) + "</div>" +
                '<div class="ldss-ranking-print-page-meta">' + escapeHtml(meta.summary) + "</div>" +
                '<div class="ldss-ranking-print-page-page">Page ' + escapeHtml(String(index + 1)) + " of " + escapeHtml(String(totalPages)) + " | Rows " + escapeHtml(String(startCounter)) + "-" + escapeHtml(String(startCounter + chunk.length - 1)) + "</div>" +
                "</div>" +
                "</div>" +
                "</div>" +
                '<table class="table mb-0 ldss-ranking-table ldss-ranking-print-table">' +
                rankingPrintTableHeadMarkup() +
                "<tbody>" + chunk.map(function (row, rowIndex) {
                    return rankingPrintTableRowMarkup(row, startCounter + rowIndex);
                }).join("") + "</tbody>" +
                "</table>" +
                "</section>"
            );
        }).join("");
    }

    function availableBatchIds() {
        return availableBatches().map(function (batch) {
            return batch.id;
        });
    }

    function nextSelection() {
        if (!currentBatchId || !currentRoomLabel) {
            return null;
        }

        const roomLabels = roomLabelsForBatch(currentBatchId);
        const roomIndex = roomLabels.indexOf(currentRoomLabel);
        if (roomIndex !== -1 && roomIndex < roomLabels.length - 1) {
            return {
                batchId: currentBatchId,
                roomLabel: roomLabels[roomIndex + 1]
            };
        }

        const batchIds = availableBatchIds();
        const batchIndex = batchIds.indexOf(currentBatchId);
        for (let index = batchIndex + 1; index < batchIds.length; index += 1) {
            const nextRoomLabels = roomLabelsForBatch(batchIds[index]);
            if (nextRoomLabels.length) {
                return {
                    batchId: batchIds[index],
                    roomLabel: nextRoomLabels[0]
                };
            }
        }

        return null;
    }

    function previousSelection() {
        if (!currentBatchId || !currentRoomLabel) {
            return null;
        }

        const roomLabels = roomLabelsForBatch(currentBatchId);
        const roomIndex = roomLabels.indexOf(currentRoomLabel);
        if (roomIndex > 0) {
            return {
                batchId: currentBatchId,
                roomLabel: roomLabels[roomIndex - 1]
            };
        }

        const batchIds = availableBatchIds();
        const batchIndex = batchIds.indexOf(currentBatchId);
        for (let index = batchIndex - 1; index >= 0; index -= 1) {
            const previousRoomLabels = roomLabelsForBatch(batchIds[index]);
            if (previousRoomLabels.length) {
                return {
                    batchId: batchIds[index],
                    roomLabel: previousRoomLabels[previousRoomLabels.length - 1]
                };
            }
        }

        return null;
    }

    function syncActionButtons() {
        const roomRows = currentRoomRows();
        const rankingState = rankingDatasetForRender();
        const saveBtn = byId("roomScoreSaveBtn");
        const saveNextBtn = byId("roomScoreSaveNextBtn");
        const prevBtn = byId("roomScorePrevRoomBtn");
        const nextBtn = byId("roomScoreNextRoomBtn");
        const printBtn = byId("roomScorePrintBtn");
        const searchBtn = byId("roomScoreSearchBtn");
        const clearSearchBtn = byId("roomScoreSearchClearBtn");

        if (saveBtn) {
            saveBtn.disabled = isSaving || !roomRows.length;
            saveBtn.textContent = isSaving ? "Saving..." : "Save This Room";
        }
        if (saveNextBtn) {
            saveNextBtn.disabled = isSaving || !roomRows.length;
            saveNextBtn.textContent = isSaving ? "Saving..." : "Save and Open Next Room";
        }
        if (prevBtn) {
            prevBtn.disabled = isSaving || !previousSelection();
        }
        if (nextBtn) {
            nextBtn.disabled = isSaving || !nextSelection();
        }
        if (printBtn) {
            printBtn.disabled = isSaving || (isRankingPage() ? !rankingState.rows.length : !roomRows.length);
        }
        if (searchBtn) {
            searchBtn.disabled = isSaving || !roomRows.length;
        }
        if (clearSearchBtn) {
            clearSearchBtn.disabled = isSaving || !roomRows.length;
        }
    }

    function renderAll() {
        fillBatchFilter();
        fillRoomFilter();
        fillRankingRoomFilter();
        fillRankingSectorFilter();
        syncRankingFilterVisibility();
        renderSelectionMeta();
        renderKpis();
        renderPaperHeader();
        renderRoomSheet();
        renderRankingSummary();
        renderRankingTable();
        renderRankingCards();
        renderRankingPrintPages();
        syncActionButtons();
    }

    async function fetchData(preferredBatchId, preferredRoomLabel) {
        showStatus("");
        await loadActiveSettings();

        const loadedBatches = await fetchBatches();
        const examRows = await fetchExamRowsPaged();
        const assignedRows = examRows.filter(function (row) {
            return Boolean(row.batch_id);
        });
        const applicationIds = Array.from(new Set(assignedRows.map(function (row) {
            return row.application_id;
        }).filter(Boolean)));
        const appMap = applicationIds.length ? await loadApplicationsByIds(applicationIds) : {};
        const applicantIds = Array.from(new Set(applicationIds.map(function (applicationId) {
            const application = appMap[applicationId];
            return application ? application.applicant_id : "";
        }).filter(Boolean)));
        const profileMap = applicantIds.length ? await loadProfilesByIds(applicantIds) : {};

        batches = loadedBatches;
        rows = assignedRows.map(function (row) {
            const application = appMap[row.application_id] || null;
            const profile = application ? (profileMap[application.applicant_id] || null) : null;
            return {
                id: row.id,
                application_id: row.application_id,
                applicant_id: application ? application.applicant_id : null,
                application_no: application ? application.application_no : "-",
                application_status: application ? application.status : "-",
                scholarship_type: application ? application.scholarship_type : "",
                sector_classification: application ? normalizeSectorClassification(application.sector_classification || "") : "Unspecified",
                applicant_name: buildApplicantName(profile),
                applicant_contact: profile ? (profile.mobile_number || profile.email || "-") : "-",
                school_name: profile && profile.school_name ? profile.school_name : "",
                batch_id: row.batch_id || "",
                exam_control_no: row.exam_control_no || "",
                scheduled_at: row.scheduled_at || "",
                room_label: row.room_label || "",
                room_seat_no: row.room_seat_no == null ? null : Number(row.room_seat_no),
                raw_score: row.raw_score,
                percentage_score: row.percentage_score,
                result: row.result || "pending",
                record_status: row.status || "scheduled"
            };
        });

        resolveSelection(preferredBatchId, preferredRoomLabel);
        renderAll();

        if (!roomHotfixAvailable) {
            showStatus("Room assignment fields are not deployed yet. Run supabase/exam_room_assignment_hotfix_2026_03_28.sql before using room-based scoring and ranking.", "alert-warning");
            return;
        }

        if (!rows.length) {
            showStatus("No assigned exam rooms were found yet. Open Room Assignment first, then return here to encode raw scores or review ranking.", "alert-info");
        }
    }

    function updatePreview(recordId, rawValue) {
        const previewTarget = document.querySelector('[data-room-preview="' + recordId + '"]');
        if (!previewTarget) {
            return;
        }
        const preview = previewMeta(rawValue);
        previewTarget.className = preview.className;
        previewTarget.textContent = preview.text;
    }

    function inputValueForRow(row) {
        const input = document.querySelector('[data-room-raw-score="' + row.id + '"]');
        return input ? input.value.trim() : "";
    }

    function buildSaveEntries() {
        const roomRows = currentRoomRows();
        if (!roomRows.length) {
            throw new Error("Open a room sheet first before saving scores.");
        }

        const entries = [];
        roomRows.forEach(function (row) {
            const rawValue = inputValueForRow(row);

            if (!rawValue) {
                if (row.raw_score !== null && typeof row.raw_score !== "undefined" && row.raw_score !== "") {
                    throw new Error("Seat " + String(row.room_seat_no || "-") + " cannot be blank because it already has a saved score.");
                }
                return;
            }

            const rawScore = Number(rawValue);
            if (Number.isNaN(rawScore) || !Number.isInteger(rawScore) || rawScore < 1 || rawScore > maxRawScore()) {
                throw new Error("Seat " + String(row.room_seat_no || "-") + " must use a whole-number raw score from 1 to " + String(maxRawScore()) + ".");
            }

            const percentage = calculatePercentage(rawScore);
            const existingScore = row.raw_score === null || typeof row.raw_score === "undefined" ? null : Number(row.raw_score);
            const existingPercentage = row.percentage_score === null || typeof row.percentage_score === "undefined" ? null : Number(row.percentage_score);
            const existingResult = workflow().normalizeExamResult(row.result || "pending");
            const changed = existingScore !== rawScore
                || existingPercentage !== percentage
                || existingResult !== "pending"
                || normalizeStatus(row.record_status) !== "encoded";

            if (!changed) {
                return;
            }

            entries.push({
                row: row,
                payload: {
                    raw_score: rawScore,
                    percentage_score: percentage,
                    result: "pending",
                    status: "encoded",
                    encoded_by: context.user.id
                }
            });
        });

        return entries;
    }

    function deriveApplicationStatus(row) {
        const current = normalizeStatus(row.application_status || "");
        if (PROTECTED_APPLICATION_STATUSES.has(current)) {
            return current;
        }
        return "exam_completed";
    }

    async function syncApplicationStatus(row) {
        const nextStatus = deriveApplicationStatus(row);
        if (!nextStatus || normalizeStatus(row.application_status || "") === normalizeStatus(nextStatus)) {
            return;
        }

        const result = await context.client
            .from("applications")
            .update({
                status: nextStatus,
                secretary_reviewer_id: context.user.id
            })
            .eq("id", row.application_id);

        if (result.error) {
            throw new Error("Raw score saved for seat " + String(row.room_seat_no || "-") + " but application status update failed: " + result.error.message);
        }
    }

    async function notifyApplicant(row) {
        if (!row.applicant_id) {
            return;
        }

        const result = await context.client
            .from("notifications")
            .insert({
                recipient_user_id: row.applicant_id,
                sender_user_id: context.user.id,
                notification_type: "application",
                title: "Exam Score Recorded",
                message: "Your exam score has been recorded. Please monitor your application for the next update.",
                related_application_id: row.application_id,
                related_url: "application-detail.html?id=" + encodeURIComponent(row.application_id)
            });

        if (result.error) {
            throw new Error(result.error.message || "Notification insert failed.");
        }
    }

    function setSavingState(saving) {
        isSaving = Boolean(saving);
        syncActionButtons();
    }

    function selectionLabel(selection) {
        if (!selection) {
            return "";
        }
        const batch = batchById(selection.batchId);
        return (batch && batch.batch_label ? batch.batch_label + " | " : "") + selection.roomLabel.toUpperCase();
    }

    async function saveCurrentRoom(openNextRoom) {
        const currentSelection = {
            batchId: currentBatchId,
            roomLabel: currentRoomLabel
        };
        const targetSelection = openNextRoom ? nextSelection() : currentSelection;

        try {
            const entries = buildSaveEntries();
            if (!entries.length) {
                if (openNextRoom && targetSelection) {
                    currentBatchId = targetSelection.batchId;
                    currentRoomLabel = targetSelection.roomLabel;
                    renderAll();
                    showStatus("No new raw scores to save. Opened " + selectionLabel(targetSelection) + ".", "alert-info");
                } else {
                    showStatus("No new raw scores to save for " + currentRoomLabel.toUpperCase() + ".", "alert-info");
                }
                return;
            }

            setSavingState(true);
            let notificationFailures = 0;

            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index];
                const updateResult = await context.client
                    .from("exam_records")
                    .update(entry.payload)
                    .eq("id", entry.row.id)
                    .eq("application_id", entry.row.application_id);

                if (updateResult.error) {
                    throw new Error("Failed to save seat " + String(entry.row.room_seat_no || "-") + ": " + updateResult.error.message);
                }

                await syncApplicationStatus(entry.row);

                try {
                    await notifyApplicant(entry.row);
                } catch (_notificationError) {
                    notificationFailures += 1;
                }
            }

            await fetchData(targetSelection ? targetSelection.batchId : currentSelection.batchId, targetSelection ? targetSelection.roomLabel : currentSelection.roomLabel);

            let successMessage = String(entries.length) + " raw score(s) saved for " + currentSelection.roomLabel.toUpperCase() + ".";
            if (openNextRoom && targetSelection && (targetSelection.batchId !== currentSelection.batchId || targetSelection.roomLabel !== currentSelection.roomLabel)) {
                successMessage += " Opened " + selectionLabel(targetSelection) + ".";
            } else if (openNextRoom && !targetSelection) {
                successMessage += " This was the last room in the available queue.";
            }
            if (notificationFailures) {
                successMessage += " " + String(notificationFailures) + " notification(s) were skipped.";
            }

            showStatus(successMessage, notificationFailures ? "alert-warning" : "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to save room scores.", "alert-danger");
        } finally {
            setSavingState(false);
        }
    }

    function moveSelection(selection) {
        if (!selection) {
            return;
        }
        currentBatchId = selection.batchId;
        currentRoomLabel = selection.roomLabel;
        renderAll();
    }

    function bindEvents() {
        const batchFilter = byId("roomScoreBatchFilter");
        const roomFilter = byId("roomScoreRoomFilter");
        const rankingModeFilter = byId("roomScoreRankingPrintMode");
        const rankingRoomFilter = byId("roomScoreRankingRoomFilter");
        const rankingSectorFilter = byId("roomScoreRankingSectorFilter");
        const rankingTopFilter = byId("roomScoreRankingTopFilter");
        const rankingSearchInput = byId("roomScoreRankingSearchInput");
        const rankingSearchClearBtn = byId("roomScoreRankingSearchClearBtn");
        const refreshBtn = byId("roomScoreRefreshBtn");
        const prevBtn = byId("roomScorePrevRoomBtn");
        const nextBtn = byId("roomScoreNextRoomBtn");
        const printBtn = byId("roomScorePrintBtn");
        const searchInput = byId("roomScoreSearchInput");
        const searchBtn = byId("roomScoreSearchBtn");
        const clearSearchBtn = byId("roomScoreSearchClearBtn");
        const saveBtn = byId("roomScoreSaveBtn");
        const saveNextBtn = byId("roomScoreSaveNextBtn");
        const tableBody = byId("roomScoreSheetBody");

        if (batchFilter) {
            batchFilter.addEventListener("change", function () {
                currentBatchId = batchFilter.value || "";
                currentRoomLabel = roomLabelsForBatch(currentBatchId)[0] || "";
                renderAll();
            });
        }

        if (roomFilter) {
            roomFilter.addEventListener("change", function () {
                currentRoomLabel = roomFilter.value || "";
                renderAll();
            });
        }

        if (rankingModeFilter) {
            rankingModeFilter.addEventListener("change", function () {
                renderAll();
            });
        }

        if (rankingRoomFilter) {
            rankingRoomFilter.addEventListener("change", function () {
                renderAll();
            });
        }

        if (rankingSectorFilter) {
            rankingSectorFilter.addEventListener("change", function () {
                renderAll();
            });
        }

        if (rankingTopFilter) {
            rankingTopFilter.addEventListener("change", function () {
                renderAll();
            });
        }

        if (rankingSearchInput) {
            rankingSearchInput.addEventListener("input", function () {
                currentRankingSearchQuery = rankingSearchInput.value.trim();
                renderAll();
            });

            rankingSearchInput.addEventListener("keydown", function (event) {
                if (event.key !== "Enter") {
                    return;
                }
                event.preventDefault();
                currentRankingSearchQuery = rankingSearchInput.value.trim();
                renderAll();
            });
        }

        if (rankingSearchClearBtn) {
            rankingSearchClearBtn.addEventListener("click", function () {
                currentRankingSearchQuery = "";
                if (rankingSearchInput) {
                    rankingSearchInput.value = "";
                    rankingSearchInput.focus();
                }
                renderAll();
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener("click", async function () {
                try {
                    await fetchData(currentBatchId, currentRoomLabel);
                    showStatus("Ranking data refreshed without reloading the page.", "alert-success");
                } catch (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh ranking data.", "alert-danger");
                }
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener("click", function () {
                moveSelection(previousSelection());
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener("click", function () {
                moveSelection(nextSelection());
            });
        }

        if (printBtn) {
            printBtn.addEventListener("click", function () {
                window.print();
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener("click", function () {
                currentRoomSearchQuery = searchInput ? searchInput.value.trim() : "";
                applyRoomSheetSearch();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener("click", function () {
                currentRoomSearchQuery = "";
                if (searchInput) {
                    searchInput.value = "";
                }
                applyRoomSheetSearch();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key !== "Enter") {
                    return;
                }
                event.preventDefault();
                currentRoomSearchQuery = searchInput.value.trim();
                applyRoomSheetSearch();
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                saveCurrentRoom(false);
            });
        }

        if (saveNextBtn) {
            saveNextBtn.addEventListener("click", function () {
                saveCurrentRoom(true);
            });
        }

        if (tableBody) {
            tableBody.addEventListener("input", function (event) {
                const input = event.target.closest("[data-room-raw-score]");
                if (!input) {
                    return;
                }
                updatePreview(input.getAttribute("data-room-raw-score") || "", input.value.trim());
            });

            tableBody.addEventListener("keydown", function (event) {
                const input = event.target.closest("[data-room-raw-score]");
                if (!input || event.key !== "Enter") {
                    return;
                }

                event.preventDefault();
                const inputs = Array.from(document.querySelectorAll("[data-room-raw-score]"));
                const currentIndex = inputs.indexOf(input);
                if (currentIndex !== -1 && currentIndex < inputs.length - 1) {
                    inputs[currentIndex + 1].focus();
                    inputs[currentIndex + 1].select();
                } else if (saveBtn && !saveBtn.disabled) {
                    saveBtn.focus();
                }
            });
        }
    }

    async function init() {
        context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        bindEvents();
        try {
            await fetchData("", "");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load room score encoding page.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
