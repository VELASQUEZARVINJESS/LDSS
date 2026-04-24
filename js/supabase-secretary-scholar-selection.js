(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const LOOKUP_BATCH_SIZE = 200;
    const SETTINGS_STORAGE_KEY = "ldss:secretary-scholar-selection:v1";
    const DEFAULT_POLICY = {
        passing_score: 75,
        exam_total_items: 100
    };
    const MASTERLIST_SECTOR_LIMIT = 76;
    const MASTERLIST_LIKHANG_LIMIT = 50;
    const MASTERLIST_PRINT_ROWS_PER_PAGE = 25;
    const MASTERLIST_PRINT_SCORE_RED_THRESHOLD = 70;
    const CATEGORY_META = {
        regular: {
            label: "Regular Applicant",
            className: "ldss-scholar-category-regular"
        },
        sector: {
            label: "Sector Classification",
            className: "ldss-scholar-category-sector"
        },
        special: {
            label: "Special Consideration",
            className: "ldss-scholar-category-special"
        },
        likhang: {
            label: "Likhang Daeteño Performing Arts",
            className: "ldss-scholar-category-likhang"
        }
    };
    const NONE_SECTOR_LABEL = "None of the above";
    const SPECIAL_TAG_DELIMITER = "::";
    const SPECIAL_TAG_LABELS = {
        internal_review: "Priority Review",
        for_approval: "For Approval",
        reserved_slot_exception: "Special Consideration"
    };

    let context = null;
    let batches = [];
    let rows = [];
    let currentBatchId = "";
    let policy = Object.assign({}, DEFAULT_POLICY);
    let staffFlagsAvailable = true;
    let isLoading = false;

    function byId(id) {
        return document.getElementById(id);
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

    function showStatus(message, type) {
        const box = byId("scholarSelectionStatus");
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

    function setText(id, value) {
        const target = byId(id);
        if (target) {
            target.textContent = String(value);
        }
    }

    function upperText(value) {
        return (value || "").toString().trim().toUpperCase();
    }

    function buildApplicantName(profile) {
        if (!profile) {
            return "UNKNOWN APPLICANT";
        }

        const parts = [profile.first_name, profile.middle_name, profile.last_name]
            .map(function (value) { return upperText(value); })
            .filter(Boolean);
        return parts.length ? parts.join(" ") : upperText(profile.email || "Unknown Applicant");
    }

    function normalizeNumber(value, fallbackValue) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function readWholeNumber(id, fallbackValue) {
        const input = byId(id);
        if (!input) {
            return fallbackValue;
        }
        const raw = (input.value || "").toString().trim();
        if (!raw) {
            return fallbackValue;
        }
        const numeric = Math.floor(Number(raw));
        return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallbackValue;
    }

    function writeInput(id, value) {
        const input = byId(id);
        if (input) {
            input.value = value === null || typeof value === "undefined" ? "" : String(value);
        }
    }

    function writeCheckbox(id, checked) {
        const input = byId(id);
        if (input) {
            input.checked = Boolean(checked);
        }
    }

    function isChecked(id) {
        const input = byId(id);
        return input ? input.checked === true : false;
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

    function compareRoomLabels(left, right) {
        return (left || "").toString().localeCompare((right || "").toString(), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function compareRoomSeatApplication(left, right) {
        const roomCompare = compareRoomLabels(left.room_label || "", right.room_label || "");
        if (roomCompare !== 0) {
            return roomCompare;
        }

        const leftSeat = Number(left.room_seat_no || 0);
        const rightSeat = Number(right.room_seat_no || 0);
        if (leftSeat !== rightSeat) {
            return leftSeat - rightSeat;
        }

        return String(left.application_no || "").localeCompare(String(right.application_no || ""), undefined, {
            numeric: true,
            sensitivity: "base"
        });
    }

    function hasSavedRawScore(rawScore) {
        return rawScore !== null && typeof rawScore !== "undefined" && rawScore !== "" && !Number.isNaN(Number(rawScore));
    }

    function scorePercent(rawScore) {
        if (!hasSavedRawScore(rawScore)) {
            return null;
        }
        const totalItems = Math.max(1, Math.round(normalizeNumber(policy.exam_total_items, DEFAULT_POLICY.exam_total_items)));
        return Number(((Number(rawScore) / totalItems) * 100).toFixed(2));
    }

    function scoreText(row) {
        if (!row || !hasSavedRawScore(row.raw_score)) {
            return "-";
        }
        const raw = Number(row.raw_score);
        const rawLabel = Number.isInteger(raw) ? String(raw) : String(raw);
        const percent = row.score_percent;
        return percent === null || typeof percent === "undefined"
            ? rawLabel
            : (rawLabel + " (" + String(percent).replace(/\.00$/, "") + "%)");
    }

    function masterlistPrintScoreClass(row) {
        const percent = row && row.sourceRow && typeof row.sourceRow.score_percent !== "undefined"
            ? Number(row.sourceRow.score_percent)
            : null;

        if (percent !== null && !Number.isNaN(percent) && percent < MASTERLIST_PRINT_SCORE_RED_THRESHOLD) {
            return "text-center fw-700 ldss-scholar-masterlist-score ldss-scholar-masterlist-score-below";
        }

        return "text-center fw-700 ldss-scholar-masterlist-score";
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

    function normalizeSector(value) {
        const normalized = (value || "").toString().trim().replace(/\s+/g, " ");
        if (!normalized || normalized.toLowerCase() === NONE_SECTOR_LABEL.toLowerCase()) {
            return "";
        }
        return normalized;
    }

    function normalizeSpecialTag(value) {
        return (value || "").toString().trim().replace(/\s+/g, " ");
    }

    function decodeSpecialTag(value) {
        const raw = normalizeSpecialTag(value);
        if (!raw) {
            return {
                level: "",
                label: ""
            };
        }

        const delimiterIndex = raw.indexOf(SPECIAL_TAG_DELIMITER);
        if (delimiterIndex >= 0) {
            return {
                level: normalizeSpecialTag(raw.slice(0, delimiterIndex)),
                label: normalizeSpecialTag(raw.slice(delimiterIndex + SPECIAL_TAG_DELIMITER.length))
            };
        }

        return {
            level: raw,
            label: ""
        };
    }

    function specialTagDisplay(value) {
        const decoded = decodeSpecialTag(value);
        const levelLabel = SPECIAL_TAG_LABELS[decoded.level] || "Special Consideration";
        return decoded.label ? (levelLabel + " - " + decoded.label) : levelLabel;
    }

    function currentSettings() {
        return {
            regularSlots: readWholeNumber("scholarSelectionRegularSlots", 0),
            sectorSlots: readWholeNumber("scholarSelectionSectorSlots", 0),
            likhangSlots: readWholeNumber("scholarSelectionLikhangSlots", MASTERLIST_LIKHANG_LIMIT),
            includeSpecial: isChecked("scholarSelectionIncludeSpecial"),
            printFilter: (byId("scholarSelectionPrintFilter") ? byId("scholarSelectionPrintFilter").value : "all") || "all",
            likhangInput: byId("scholarSelectionLikhangInput") ? byId("scholarSelectionLikhangInput").value : ""
        };
    }

    function saveSettings() {
        const settings = currentSettings();
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        } catch (_error) {
            // Browser storage is only a convenience for this office worksheet.
        }
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return;
            }

            writeInput("scholarSelectionRegularSlots", Math.max(0, Math.floor(Number(parsed.regularSlots || 0))));
            writeInput("scholarSelectionSectorSlots", Math.max(0, Math.floor(Number(parsed.sectorSlots || 0))));
            if (Object.prototype.hasOwnProperty.call(parsed, "likhangSlots")) {
                writeInput("scholarSelectionLikhangSlots", Math.max(0, Math.floor(Number(parsed.likhangSlots))));
            }
            writeCheckbox("scholarSelectionIncludeSpecial", parsed.includeSpecial !== false);
            if (byId("scholarSelectionPrintFilter") && parsed.printFilter) {
                byId("scholarSelectionPrintFilter").value = parsed.printFilter;
            }
            if (byId("scholarSelectionLikhangInput") && typeof parsed.likhangInput === "string") {
                byId("scholarSelectionLikhangInput").value = parsed.likhangInput;
            }
        } catch (_error) {
            // Ignore invalid saved worksheet settings.
        }
    }

    function categoryPill(categoryKey) {
        const meta = CATEGORY_META[categoryKey] || CATEGORY_META.regular;
        return '<span class="ldss-scholar-category-pill ' + escapeHtml(meta.className) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function batchRows(batchId) {
        if (!batchId) {
            return [];
        }
        return rows.filter(function (row) {
            return row.batch_id === batchId;
        });
    }

    function availableBatches() {
        return batches.filter(function (batch) {
            return batchRows(batch.id).length > 0;
        });
    }

    function batchById(batchId) {
        return batches.find(function (batch) {
            return batch.id === batchId;
        }) || null;
    }

    function rankedRowsForBatch(batchId) {
        const scoredRows = [];
        const unscoredRows = [];

        batchRows(batchId).forEach(function (row) {
            if (hasSavedRawScore(row.raw_score)) {
                scoredRows.push(Object.assign({}, row, {
                    raw_score_value: Number(row.raw_score)
                }));
                return;
            }
            unscoredRows.push(Object.assign({}, row, {
                display_rank: null,
                raw_score_value: null
            }));
        });

        const rankedRows = assignDisplayRanks(scoredRows.sort(function (left, right) {
            if (right.raw_score_value !== left.raw_score_value) {
                return right.raw_score_value - left.raw_score_value;
            }
            return compareRoomSeatApplication(left, right);
        }));

        return rankedRows.concat(unscoredRows.sort(compareRoomSeatApplication));
    }

    function limitRows(sourceRows, slotCount) {
        const safeRows = Array.isArray(sourceRows) ? sourceRows : [];
        const safeSlots = Math.max(0, Math.floor(Number(slotCount || 0)));
        return safeSlots > 0 ? safeRows.slice(0, safeSlots) : safeRows.slice();
    }

    function chunkRows(sourceRows, rowsPerPage) {
        const safeRows = Array.isArray(sourceRows) ? sourceRows : [];
        const safeRowsPerPage = Math.max(1, Math.floor(Number(rowsPerPage || 0)) || MASTERLIST_PRINT_ROWS_PER_PAGE);
        const chunks = [];
        for (let index = 0; index < safeRows.length; index += safeRowsPerPage) {
            chunks.push(safeRows.slice(index, index + safeRowsPerPage));
        }
        return chunks;
    }

    function parseLikhangRows() {
        const raw = byId("scholarSelectionLikhangInput") ? byId("scholarSelectionLikhangInput").value : "";
        return raw
            .split(/\r?\n/)
            .map(function (line) {
                return line.trim();
            })
            .filter(Boolean)
            .map(function (line, index) {
                const parts = line.split("|").map(function (part) {
                    return part.trim();
                });
                return {
                    selection_id: "likhang-" + String(index + 1),
                    categoryKey: "likhang",
                    rank: "-",
                    applicantName: parts[0] || "Manual Dummy Record",
                    applicationNo: "-",
                    barangay: parts[1] || "-",
                    school: parts[2] || "-",
                    sector: "Likhang Daeteño Performing Arts",
                    score: "-",
                    basis: parts[3] || "Manual audition-based selection",
                    sourceRow: null
                };
            });
    }

    function toSelectionRow(row, categoryKey, basis) {
        return {
            selection_id: row.application_id || row.id,
            categoryKey: categoryKey,
            rank: row.display_rank ? String(row.display_rank) : "-",
            applicantName: row.applicant_name || "UNKNOWN APPLICANT",
            applicationNo: row.application_no || "-",
            barangay: row.barangay || "-",
            school: row.school_name || "-",
            sector: row.sector_classification || "-",
            score: scoreText(row),
            basis: basis,
            sourceRow: row
        };
    }

    function buildSelection() {
        const settings = currentSettings();
        const rankedRows = rankedRowsForBatch(currentBatchId);
        const selectedApplicationIds = new Set();
        const sectorSlots = settings.sectorSlots > 0
            ? settings.sectorSlots
            : Math.max(0, Math.floor(rankedRows.length * 0.10));

        const regularCandidates = rankedRows.filter(function (row) {
            return row.passed_by_score === true;
        });
        const regular = limitRows(regularCandidates, settings.regularSlots).map(function (row) {
            selectedApplicationIds.add(row.application_id);
            return toSelectionRow(row, "regular", "Passed the configured score policy.");
        });

        const sectorCandidates = rankedRows.filter(function (row) {
            return !selectedApplicationIds.has(row.application_id)
                && row.has_sector_classification === true
                && hasSavedRawScore(row.raw_score)
                && row.passed_by_score !== true
                && !row.special_consideration_tag;
        });
        const sector = sectorSlots > 0
            ? sectorCandidates.slice(0, sectorSlots).map(function (row) {
                selectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "sector", "Sector slot from below-passing-score pool.");
            })
            : [];

        const special = settings.includeSpecial
            ? rankedRows
                .filter(function (row) {
                    return row.special_consideration_tag && !selectedApplicationIds.has(row.application_id);
                })
                .map(function (row) {
                    selectedApplicationIds.add(row.application_id);
                    return toSelectionRow(row, "special", specialTagDisplay(row.special_consideration_tag));
                })
            : [];

        const likhangReservedCount = Math.max(0, Math.floor(Number(settings.likhangSlots || 0)));
        const likhang = limitRows(parseLikhangRows(), likhangReservedCount);
        const combined = regular.concat(special, sector);
        const grandTotalCount = combined.length + likhangReservedCount;

        const masterlistSelectedApplicationIds = new Set();
        const masterRegular = rankedRows
            .filter(function (row) {
                return row.passed_by_score === true;
            })
            .map(function (row) {
                masterlistSelectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "regular", "Passed the configured score policy.");
            });
        const masterSectorCandidates = rankedRows.filter(function (row) {
            return !masterlistSelectedApplicationIds.has(row.application_id)
                && row.has_sector_classification === true
                && hasSavedRawScore(row.raw_score)
                && row.passed_by_score !== true
                && !row.special_consideration_tag;
        });
        const masterSpecial = rankedRows
            .filter(function (row) {
                return row.special_consideration_tag && !masterlistSelectedApplicationIds.has(row.application_id);
            })
            .map(function (row) {
                masterlistSelectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "special", specialTagDisplay(row.special_consideration_tag));
            });
        const masterSector = limitRows(masterSectorCandidates, sectorSlots || MASTERLIST_SECTOR_LIMIT)
            .map(function (row) {
                masterlistSelectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "sector", "Sector Classification from below-passing-score pool.");
            });
        const masterlistCore = masterRegular.concat(masterSpecial, masterSector);
        const masterlist = masterlistCore;

        return {
            regular: regular,
            sector: sector,
            special: special,
            likhang: likhang,
            combined: combined,
            masterlist: masterlist,
            masterlistCore: masterlistCore,
            masterlistCoreCount: masterlistCore.length,
            regularCandidateCount: regularCandidates.length,
            sectorCandidateCount: sectorCandidates.length,
            masterlistRegularCount: masterRegular.length,
            masterlistSectorCount: masterSector.length,
            masterlistSpecialCount: masterSpecial.length,
            rankedCount: rankedRows.length,
            likhangCount: likhangReservedCount,
            likhangActualCount: likhang.length,
            grandTotalCount: grandTotalCount
        };
    }

    function fillBatchFilter() {
        const select = byId("scholarSelectionBatchFilter");
        if (!select) {
            return;
        }

        const current = currentBatchId;
        const selectableBatches = availableBatches();
        select.innerHTML = selectableBatches.length
            ? selectableBatches.map(function (batch) {
                return '<option value="' + escapeHtml(batch.id) + '">' + escapeHtml(batch.batch_label || ("Batch " + batch.id)) + "</option>";
            }).join("")
            : '<option value="">No assigned exam batch found</option>';

        if (current && selectableBatches.some(function (batch) { return batch.id === current; })) {
            select.value = current;
        }
    }

    function resolveSelection(preferredBatchId) {
        const selectableBatches = availableBatches();
        if (!selectableBatches.length) {
            currentBatchId = "";
            return;
        }

        currentBatchId = selectableBatches.some(function (batch) {
            return batch.id === preferredBatchId;
        }) ? preferredBatchId : selectableBatches[0].id;
    }

    function policyLabel() {
        const passingScore = normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score);
        const totalItems = Math.max(1, Math.round(normalizeNumber(policy.exam_total_items, DEFAULT_POLICY.exam_total_items)));
        return String(passingScore).replace(/\.00$/, "") + "% of " + String(totalItems) + " items";
    }

    function renderPolicy() {
        setText("scholarSelectionPolicyLabel", policyLabel());
    }

    function finalRowsForView(selection) {
        const filter = currentSettings().printFilter;
        if (filter === "all") {
            return selection.combined;
        }
        return selection.combined.filter(function (row) {
            return row.categoryKey === filter;
        });
    }

    function renderFinalTable(selection) {
        const tbody = byId("scholarSelectionFinalBody");
        if (!tbody) {
            return;
        }

        if (!currentBatchId && selection.likhang.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="ldss-scholar-empty">No exam batch with assigned examinees is ready yet.</td></tr>';
            return;
        }

        const finalRows = finalRowsForView(selection);
        if (!finalRows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="ldss-scholar-empty">No selected scholars match the current category view.</td></tr>';
            return;
        }

        tbody.innerHTML = finalRows.map(function (row, index) {
            return (
                "<tr>" +
                '<td class="text-center fw-700">' + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" + categoryPill(row.categoryKey) + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(row.rank || "-") + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicantName || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.school || "-") + "</div>" +
                "</td>" +
                '<td class="fw-700">' + escapeHtml(row.applicationNo || "-") + "</td>" +
                "<td>" + escapeHtml(row.barangay || "-") + "</td>" +
                "<td>" + escapeHtml(row.sector || "-") + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(row.score || "-") + "</td>" +
                "<td>" + escapeHtml(row.basis || "-") + "</td>" +
                "</tr>"
            );
            }).join("");
    }

    function renderMasterlistCorePrintTable(selection) {
        const container = byId("scholarSelectionMasterlistPages");
        if (!container) {
            return;
        }

        const masterlistRows = selection.masterlistCore || [];
        if (!currentBatchId && masterlistRows.length === 0) {
            container.innerHTML = '<div class="ldss-scholar-empty">No exam batch with assigned examinees is ready yet.</div>';
            return;
        }

        if (!masterlistRows.length) {
            container.innerHTML = '<div class="ldss-scholar-empty">No score passers or Special Consideration applicants are ready for masterlist printing.</div>';
            return;
        }

        const pageChunks = chunkRows(masterlistRows, MASTERLIST_PRINT_ROWS_PER_PAGE);
        container.innerHTML = pageChunks.map(function (chunk, pageIndex) {
            const startIndex = pageIndex * MASTERLIST_PRINT_ROWS_PER_PAGE;
            const rowsHtml = chunk.map(function (row, index) {
                const displayNo = startIndex + index + 1;
                return (
                    "<tr>" +
                    '<td class="text-center fw-700">' + escapeHtml(String(displayNo)) + "</td>" +
                    '<td class="text-center fw-700">' + escapeHtml(row.rank || "-") + "</td>" +
                    "<td class=\"ldss-scholar-masterlist-applicant\">" +
                    '<div class="fw-700">' + escapeHtml(row.applicantName || "-") + "</div>" +
                    '<div class="ldss-scholar-masterlist-category">' + categoryPill(row.categoryKey) + "</div>" +
                    "</td>" +
                    '<td class="text-center fw-700">' + escapeHtml(row.applicationNo || "-") + "</td>" +
                    '<td class="text-center">' + escapeHtml(row.sector || "-") + "</td>" +
                    '<td class="' + masterlistPrintScoreClass(row) + '">' + escapeHtml(row.score || "-") + "</td>" +
                    "<td class=\"ldss-scholar-masterlist-basis\">" + escapeHtml(row.basis || "-") + "</td>" +
                    "</tr>"
                );
            }).join("");

            return (
                '<div class="ldss-scholar-masterlist-page">' +
                '<div class="ldss-scholar-masterlist-card">' +
                '<div class="table-responsive">' +
                '<table class="table mb-0 ldss-scholar-table">' +
                "<thead>" +
                "<tr>" +
                    '<th class="ldss-scholar-masterlist-table-col-no">No.</th>' +
                    '<th class="ldss-scholar-masterlist-table-col-rank">Rank</th>' +
                    '<th class="ldss-scholar-masterlist-table-col-applicant">Applicant</th>' +
                    '<th class="text-center ldss-scholar-masterlist-table-col-appno">Application No.</th>' +
                    '<th class="text-center ldss-scholar-masterlist-table-col-sector">Sector</th>' +
                    '<th class="text-center ldss-scholar-masterlist-table-col-score">Score</th>' +
                    '<th class="ldss-scholar-masterlist-table-col-basis">Basis / Remarks</th>' +
                "</tr>" +
                "</thead>" +
                "<tbody>" +
                rowsHtml +
                "</tbody>" +
                "</table>" +
                "</div>" +
                "</div>" +
                '<div class="ldss-scholar-print-footer">www.iskolarngdaet.app</div>' +
                "</div>"
            );
        }).join("");
    }

    function renderCompactCategoryTable(targetId, categoryRows, emptyMessage) {
        const tbody = byId(targetId);
        if (!tbody) {
            return;
        }
        if (!categoryRows.length) {
            tbody.innerHTML = '<tr><td class="ldss-scholar-empty">' + escapeHtml(emptyMessage) + "</td></tr>";
            return;
        }

        tbody.innerHTML = categoryRows.map(function (row, index) {
            return (
                "<tr>" +
                '<td style="width: 48px;" class="text-center fw-700">' + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicantName || "-") + "</div>" +
                '<div class="small text-muted">Rank ' + escapeHtml(row.rank || "-") + " | Score " + escapeHtml(row.score || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.basis || "-") + "</div>" +
                "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderSummary(selection) {
        const batch = batchById(currentBatchId);
        const settings = currentSettings();
        const filteredRows = finalRowsForView(selection);
        const passingScore = normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score);
        const derivedSectorSlots = Math.max(0, Math.floor(Number(selection.rankedCount || 0) * 0.10));

        setText("scholarSelectionRegularCount", selection.regular.length);
        setText("scholarSelectionSectorCount", selection.sector.length);
        setText("scholarSelectionSpecialCount", selection.special.length);
        setText("scholarSelectionLikhangCount", selection.likhangCount || 0);
        setText("scholarSelectionFinalCount", selection.grandTotalCount || selection.combined.length);

        const regularSlotLabel = settings.regularSlots > 0
            ? String(settings.regularSlots) + " regular slot(s)"
            : String(passingScore).replace(/\.00$/, "") + "+ passers";
        const sectorSlotLabel = settings.sectorSlots > 0
            ? String(settings.sectorSlots) + " sector slot(s)"
            : String(derivedSectorSlots) + " sector slot(s) (10% of " + String(selection.rankedCount || 0) + ")";
        const batchLabel = batch
            ? ((batch.batch_label || "Selected batch") + " | " + formatDate(batch.exam_datetime) + " | " + (batch.venue || "-"))
            : "No exam batch selected";

        setText(
            "scholarSelectionFinalMeta",
            batchLabel + ". Policy: " + policyLabel() + ". Regular Applicant: " + regularSlotLabel + ". Sector Classification: " + sectorSlotLabel + ". Special Consideration follows the regular passers. Likhang Daeteño Performing Arts reserved: " + String(selection.likhangCount || 0) + " slot(s). Showing " + String(filteredRows.length) + " row(s)."
        );
        setText(
            "scholarSelectionPrintMeta",
            batchLabel + "\nPass " + String(passingScore).replace(/\.00$/, "") + "+"
        );
    }

    function renderCategorySections(selection) {
        renderCompactCategoryTable(
            "scholarSelectionRegularBody",
            selection.regular,
            selection.regularCandidateCount
                ? "No regular rows selected after slot limit."
                : "No applicants passed the configured score policy in this batch."
        );
        renderCompactCategoryTable(
            "scholarSelectionSectorBody",
            selection.sector,
            selection.sectorCandidateCount
                ? "Set Sector Slots above 0 to include sector-classified applicants below the passing score."
                : "No sector-classified below-passing-score applicants found in this batch."
        );
        renderCompactCategoryTable(
            "scholarSelectionSpecialBody",
            selection.special,
            staffFlagsAvailable
                ? "No non-duplicate Special Consideration applicants are selected."
                : "Special Consideration flag table is not available yet."
        );
        renderCompactCategoryTable(
            "scholarSelectionLikhangBody",
            selection.likhang,
            "No manual dummy records yet."
        );
    }

    function renderAll() {
        renderPolicy();
        fillBatchFilter();
        const selection = buildSelection();
        renderSummary(selection);
        renderFinalTable(selection);
        renderMasterlistCorePrintTable(selection);
        renderCategorySections(selection);
    }

    async function loadWorkflowPolicy() {
        policy = Object.assign({}, DEFAULT_POLICY);

        try {
            const result = await context.client.rpc("active_workflow_controls");
            if (!result.error && result.data && typeof result.data === "object") {
                policy = {
                    passing_score: normalizeNumber(result.data.passing_score, DEFAULT_POLICY.passing_score),
                    exam_total_items: Math.max(1, Math.round(normalizeNumber(result.data.exam_total_items, DEFAULT_POLICY.exam_total_items)))
                };
            }
        } catch (_error) {
            policy = Object.assign({}, DEFAULT_POLICY);
        }
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
                    examRows.push.apply(examRows, fallbackPageRows.map(function (row) {
                        return Object.assign({}, row, {
                            room_label: "",
                            room_seat_no: null
                        });
                    }));
                    if (fallbackPageRows.length < SUPABASE_FETCH_LIMIT) {
                        return examRows;
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

            const result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, status, scholarship_type, school_year, sector_classification, submitted_at, created_at")
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to load linked applications: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
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
                .select("id, first_name, middle_name, last_name, email, school_name, barangay")
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

    async function loadStaffFlagsByApplicationIds(applicationIds) {
        const map = {};
        if (!staffFlagsAvailable) {
            return map;
        }

        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));
        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }

            const result = await context.client
                .from("application_staff_flags")
                .select("application_id, special_consideration_tag")
                .in("application_id", chunk);

            if (result.error) {
                if (/does not exist|relation|schema cache/i.test(result.error.message || "")) {
                    staffFlagsAvailable = false;
                    return map;
                }
                throw new Error("Failed to load Special Consideration tags: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = row;
                }
            });
        }

        return map;
    }

    async function fetchData(preferredBatchId) {
        if (isLoading) {
            return;
        }

        isLoading = true;
        showStatus("");
        try {
            await loadWorkflowPolicy();
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
            const flagMap = applicationIds.length ? await loadStaffFlagsByApplicationIds(applicationIds) : {};

            batches = loadedBatches;
            rows = assignedRows.map(function (row) {
                const application = appMap[row.application_id] || null;
                const profile = application ? (profileMap[application.applicant_id] || null) : null;
                const sector = normalizeSector(application ? application.sector_classification : "");
                const percent = scorePercent(row.raw_score);
                return {
                    id: row.id,
                    application_id: row.application_id,
                    applicant_id: application ? application.applicant_id : null,
                    application_no: application ? application.application_no : "-",
                    application_status: application ? application.status : "",
                    scholarship_type: application ? application.scholarship_type : "",
                    school_year: application ? application.school_year : "",
                    applicant_name: buildApplicantName(profile),
                    applicant_email: profile ? (profile.email || "") : "",
                    school_name: profile ? (profile.school_name || "") : "",
                    barangay: profile ? (profile.barangay || "") : "",
                    sector_classification: sector,
                    has_sector_classification: Boolean(sector),
                    special_consideration_tag: flagMap[row.application_id] && flagMap[row.application_id].special_consideration_tag
                        ? normalizeSpecialTag(flagMap[row.application_id].special_consideration_tag)
                        : "",
                    batch_id: row.batch_id || "",
                    exam_control_no: row.exam_control_no || "",
                    scheduled_at: row.scheduled_at || "",
                    room_label: row.room_label || "",
                    room_seat_no: row.room_seat_no == null ? null : Number(row.room_seat_no),
                    raw_score: row.raw_score,
                    percentage_score: row.percentage_score,
                    score_percent: percent,
                    passed_by_score: percent !== null && percent >= normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score),
                    result: row.result || "pending",
                    record_status: row.status || "scheduled",
                    updated_at: row.updated_at || ""
                };
            });

            resolveSelection(preferredBatchId);
            renderAll();

            if (!rows.length) {
                showStatus("No assigned exam records were found yet. Open Room Assignment first, then return here for final scholar selection.", "alert-info");
            }
        } finally {
            isLoading = false;
        }
    }

    function bindEvents() {
        const batchFilter = byId("scholarSelectionBatchFilter");
        const regularInput = byId("scholarSelectionRegularSlots");
        const sectorInput = byId("scholarSelectionSectorSlots");
        const includeSpecial = byId("scholarSelectionIncludeSpecial");
        const printFilter = byId("scholarSelectionPrintFilter");
        const likhangInput = byId("scholarSelectionLikhangInput");
        const refreshButton = byId("scholarSelectionRefreshBtn");
        const printButton = byId("scholarSelectionPrintBtn");

        if (batchFilter) {
            batchFilter.addEventListener("change", function () {
                currentBatchId = batchFilter.value || "";
                renderAll();
            });
        }

        [regularInput, sectorInput, includeSpecial, printFilter, likhangInput].forEach(function (control) {
            if (!control) {
                return;
            }
            const eventName = control.tagName === "TEXTAREA" || control.type === "number" ? "input" : "change";
            control.addEventListener(eventName, function () {
                saveSettings();
                renderAll();
            });
        });

        if (refreshButton) {
            refreshButton.addEventListener("click", function () {
                fetchData(currentBatchId).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh scholar selection data.", "alert-danger");
                });
            });
        }

        if (printButton) {
            printButton.addEventListener("click", function () {
                window.print();
            });
        }
    }

    async function init() {
        context = await window.ldssAuthReadyPromise;
        if (!context || !context.client || !context.user) {
            return;
        }

        loadSettings();
        bindEvents();
        try {
            await fetchData("");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load scholar selection page.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
