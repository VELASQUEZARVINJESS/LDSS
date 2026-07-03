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
    const MASTERLIST_PRINT_ROWS_PER_PAGE = 25;
    const MASTERLIST_PRINT_SCORE_RED_THRESHOLD = 70;
    const SELECTION_STORAGE_HOTFIX = "supabase/selection_pool_hotfix_2026_06_30.sql";
    const CATEGORY_META = {
        regular: {
            label: "Regular Applicant",
            className: "ldss-scholar-category-regular"
        },
        sector: {
            label: "Selected",
            className: "ldss-scholar-category-sector"
        },
        special: {
            label: "Special Consideration",
            className: "ldss-scholar-category-special"
        },
        final_inclusion: {
            label: "Final List Inclusion",
            className: "ldss-scholar-category-inclusion"
        },
        manual_office_selection: {
            label: "Manual Office Selection",
            className: "ldss-scholar-category-office"
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
    const SELECTION_POOL_CATEGORY_META = {
        passed_exam: {
            label: "Passed Exam",
            className: "ldss-scholar-category-regular"
        },
        sector_classification: {
            label: "Sector Classification",
            className: "ldss-scholar-category-sector"
        },
        manual_office_selection: {
            label: "Manual Office Selection",
            className: "ldss-scholar-category-office"
        }
    };

    let context = null;
    let batches = [];
    let rows = [];
    let currentBatchId = "";
    let policy = Object.assign({}, DEFAULT_POLICY);
    let staffFlagsAvailable = true;
    let selectionPoolAvailable = true;
    let isLoading = false;
    let isSavingSelectionPool = false;
    let isSelectionPoolPdfBusy = false;
    let scholarPrintLogoDataUrlPromise = null;
    let scholarSelectionManualModal = null;
    let selectionPoolPrintFrame = null;

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

    function normalizeSelectionCategory(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(SELECTION_POOL_CATEGORY_META, raw)) {
            return raw;
        }
        return "";
    }

    function selectionPoolCategoryMeta(value) {
        const normalized = normalizeSelectionCategory(value);
        return SELECTION_POOL_CATEGORY_META[normalized] || SELECTION_POOL_CATEGORY_META.manual_office_selection;
    }

    function selectionPoolCategoryLabel(value) {
        return selectionPoolCategoryMeta(value).label;
    }

    function selectionPoolCategoryPill(value) {
        const meta = selectionPoolCategoryMeta(value);
        return '<span class="ldss-scholar-category-pill ' + escapeHtml(meta.className) + '">' + escapeHtml(meta.label) + "</span>";
    }

    function normalizeSelectionNotes(value) {
        return (value || "").toString().replace(/\s+/g, " ").trim();
    }

    function defaultSelectionPoolNotes(category) {
        const normalized = normalizeSelectionCategory(category);
        if (normalized === "passed_exam") {
            return "Included in Selection from the ranking passers.";
        }
        if (normalized === "sector_classification") {
            return "Included in Selection for sector classification review.";
        }
        return "Included in Selection through manual office selection.";
    }

    function selectionStorageWarning() {
        return "Selection storage is not installed yet. Apply " + SELECTION_STORAGE_HOTFIX + " first.";
    }

    function isMissingSelectionColumnError(error) {
        const message = error && error.message ? error.message : "";
        return /selection_included|selection_category|selection_notes|selection_updated_at/i.test(message);
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

    function normalizeFinalListEndorsedBy(value) {
        return (value || "")
            .toString()
            .replace(/\s+/g, " ")
            .trim();
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

    function buildApplicantPrintName(profile) {
        if (!profile) {
            return "UNKNOWN APPLICANT";
        }

        const firstName = upperText(profile.first_name || "");
        const middleName = upperText(profile.middle_name || "");
        const lastName = upperText(profile.last_name || "");
        const trailingNames = [firstName, middleName].filter(Boolean).join(" ");

        if (lastName && trailingNames) {
            return lastName + ", " + trailingNames;
        }

        return lastName || trailingNames || upperText(profile.email || "Unknown Applicant");
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
            if (row && row.special_consideration_tag) {
                return String(Math.max(0, Math.min(100, Math.ceil(normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score)))));
            }
            return "-";
        }
        if (row.special_consideration_tag) {
            return String(Math.max(0, Math.min(100, Math.ceil(normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score)))));
        }
        const raw = Number(row.raw_score);
        const rawLabel = Number.isInteger(raw) ? String(raw) : String(raw);
        const percent = row.score_percent;
        return percent === null || typeof percent === "undefined"
            ? rawLabel
            : (rawLabel + " (" + String(percent).replace(/\.00$/, "") + "%)");
    }

    function effectiveRankScore(row) {
        if (!row) {
            return null;
        }
        if (row.special_consideration_tag) {
            return Math.max(0, Math.min(100, Math.ceil(normalizeNumber(policy.passing_score, DEFAULT_POLICY.passing_score))));
        }
        return hasSavedRawScore(row.raw_score) ? Number(row.raw_score) : null;
    }

    function masterlistPrintScoreClass(row) {
        if (row && row.sourceRow && row.sourceRow.special_consideration_tag) {
            return "text-center fw-700 ldss-scholar-masterlist-score";
        }
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
            const score = row.rank_score_value;
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

    function normalizeSectorSlots(value) {
        return MASTERLIST_SECTOR_LIMIT;
    }

    function currentSettings() {
        return {
            regularSlots: readWholeNumber("scholarSelectionRegularSlots", 0),
            sectorSlots: normalizeSectorSlots(readWholeNumber("scholarSelectionSectorSlots", MASTERLIST_SECTOR_LIMIT)),
            includeSpecial: isChecked("scholarSelectionIncludeSpecial"),
            selectionPoolFilter: (byId("scholarSelectionPoolFilter") ? byId("scholarSelectionPoolFilter").value : "all") || "all",
            selectionPoolPrintOrder: (byId("scholarSelectionPoolPrintOrder") ? byId("scholarSelectionPoolPrintOrder").value : "score") || "score",
            printFilter: (byId("scholarSelectionPrintFilter") ? byId("scholarSelectionPrintFilter").value : "all") || "all",
            scoreRangeFrom: byId("scholarSelectionScoreFrom") ? byId("scholarSelectionScoreFrom").value : "",
            scoreRangeTo: byId("scholarSelectionScoreTo") ? byId("scholarSelectionScoreTo").value : "",
            likhangInput: byId("scholarSelectionLikhangInput") ? byId("scholarSelectionLikhangInput").value : ""
        };
    }

    function currentPrintFilterLabel() {
        const select = byId("scholarSelectionPrintFilter");
        if (!select) {
            return "All Categories";
        }
        const current = (select.value || "all").toString().trim();
        if (current === "score-range") {
            const range = currentPrintScoreRange();
            if (range.hasRange) {
                return "Score Range " + String(range.high) + " to " + String(range.low);
            }
            if (range.incomplete) {
                return "Score Range (set From and To)";
            }
            return "Score Range";
        }
        const option = select.options[select.selectedIndex];
        return option && option.text ? option.text : "All Categories";
    }

    function currentSelectionPoolFilter() {
        const select = byId("scholarSelectionPoolFilter");
        return select ? ((select.value || "all").toString().trim()) : "all";
    }

    function currentSelectionPoolFilterLabel() {
        const select = byId("scholarSelectionPoolFilter");
        if (!select) {
            return "All Sources";
        }
        const option = select.options[select.selectedIndex];
        return option && option.text ? option.text : "All Sources";
    }

    function currentSelectionPoolPrintOrder() {
        const select = byId("scholarSelectionPoolPrintOrder");
        return select ? ((select.value || "score").toString().trim()) : "score";
    }

    function currentSelectionPoolPrintOrderLabel() {
        const select = byId("scholarSelectionPoolPrintOrder");
        if (!select) {
            return "By Score";
        }
        const option = select.options[select.selectedIndex];
        return option && option.text ? option.text : "By Score";
    }

    function currentPrintScoreRange() {
        const settings = currentSettings();
        const maxScore = Math.max(1, Math.round(normalizeNumber(policy.exam_total_items, DEFAULT_POLICY.exam_total_items)));

        function normalizeScoreInput(value) {
            const raw = (value || "").toString().trim();
            if (!raw) {
                return null;
            }

            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) {
                return null;
            }

            return Math.max(1, Math.min(maxScore, Math.trunc(numeric)));
        }

        const from = normalizeScoreInput(settings.scoreRangeFrom);
        const to = normalizeScoreInput(settings.scoreRangeTo);
        const activeFilter = (settings.printFilter || "all").toString().trim();

        if (activeFilter !== "score-range") {
            return {
                from: from,
                to: to,
                low: null,
                high: null,
                hasRange: false,
                incomplete: false
            };
        }

        if (from === null || to === null) {
            return {
                from: from,
                to: to,
                low: null,
                high: null,
                hasRange: false,
                incomplete: true
            };
        }

        return {
            from: from,
            to: to,
            low: Math.min(from, to),
            high: Math.max(from, to),
            hasRange: true,
            incomplete: false
        };
    }

    function selectionRowMatchesScoreRange(row, range) {
        if (!row || !row.sourceRow || !hasSavedRawScore(row.sourceRow.raw_score)) {
            return false;
        }

        const score = Number(row.sourceRow.raw_score);
        return Number.isFinite(score) && score >= range.low && score <= range.high;
    }

    function selectionRowsForView(sourceRows) {
        const rowsForView = Array.isArray(sourceRows) ? sourceRows.slice() : [];
        const filter = currentSettings().printFilter;

        if (filter === "score-range") {
            const range = currentPrintScoreRange();
            if (!range.hasRange) {
                return [];
            }
            return rowsForView.filter(function (row) {
                return selectionRowMatchesScoreRange(row, range);
            });
        }

        if (filter === "all") {
            return rowsForView;
        }

        return rowsForView.filter(function (row) {
            return row.categoryKey === filter;
        });
    }

    function syncPrintFilterVisibility() {
        const wrap = byId("scholarSelectionScoreRangeWrap");
        if (!wrap) {
            return;
        }

        wrap.classList.toggle("d-none", (currentSettings().printFilter || "all") !== "score-range");
    }

    function scholarSelectionLogoUrl() {
        return new URL("../img/daet-lgu.png", window.location.href).href;
    }

    function loadScholarSelectionLogoDataUrl() {
        if (scholarPrintLogoDataUrlPromise) {
            return scholarPrintLogoDataUrlPromise;
        }

        scholarPrintLogoDataUrlPromise = new Promise(function (resolve) {
            const image = new Image();
            image.onload = function () {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = image.naturalWidth || image.width || 1;
                    canvas.height = image.naturalHeight || image.height || 1;
                    const context2d = canvas.getContext("2d");
                    if (!context2d) {
                        resolve("");
                        return;
                    }
                    context2d.drawImage(image, 0, 0);
                    resolve(canvas.toDataURL("image/png"));
                } catch (_error) {
                    resolve("");
                }
            };
            image.onerror = function () {
                resolve("");
            };
            image.src = scholarSelectionLogoUrl();
        });

        return scholarPrintLogoDataUrlPromise;
    }

    function pdfFileSlug(value, fallback) {
        const slug = (value || "")
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return slug || fallback;
    }

    function getPdfGenerator() {
        const jsPdfNamespace = window.jspdf || null;
        if (!jsPdfNamespace || typeof jsPdfNamespace.jsPDF !== "function") {
            return null;
        }
        return jsPdfNamespace.jsPDF;
    }

    function selectionPoolPrintFrameWindow() {
        if (selectionPoolPrintFrame && selectionPoolPrintFrame.contentWindow) {
            return selectionPoolPrintFrame;
        }

        const frame = document.createElement("iframe");
        frame.setAttribute("title", "Selection Pool Print Frame");
        frame.style.position = "fixed";
        frame.style.right = "0";
        frame.style.bottom = "0";
        frame.style.width = "1px";
        frame.style.height = "1px";
        frame.style.border = "0";
        frame.style.opacity = "0";
        frame.style.pointerEvents = "none";
        document.body.appendChild(frame);
        selectionPoolPrintFrame = frame;
        return frame;
    }

    function selectionPoolExportSelection() {
        if (!currentBatchId) {
            return {
                errorMessage: "Select an exam batch first before printing Selection Pool."
            };
        }

        if (!selectionPoolAvailable) {
            return {
                errorMessage: selectionStorageWarning()
            };
        }

        const rowsForExport = selectionPoolRowsForExport(currentBatchId);
        if (!rowsForExport.length) {
            return {
                errorMessage: "No saved applicants are available for the current Selection Pool view."
            };
        }

        return {
            rows: rowsForExport,
            batch: batchById(currentBatchId),
            filterLabel: currentSelectionPoolFilterLabel(),
            orderLabel: currentSelectionPoolPrintOrderLabel()
        };
    }

    function selectionPoolPdfFileName(batchLabel, orderLabel) {
        return "ldss-selection-pool-" +
            pdfFileSlug(orderLabel, "by-score") + "-" +
            pdfFileSlug(batchLabel, "selected-batch") + ".pdf";
    }

    function buildSelectionPoolPrintHtml(exportSelection) {
        const rowsForExport = exportSelection.rows || [];
        const batch = exportSelection.batch || null;
        const filterLabel = exportSelection.filterLabel || "All Sources";
        const orderLabel = exportSelection.orderLabel || "By Score";
        const logoHref = scholarSelectionLogoUrl();
        const batchLabel = batch ? (batch.batch_label || "Selected Batch") : "Selected Batch";
        const batchMeta = batch
            ? (formatDate(batch.exam_datetime) + " | " + (batch.venue || "-"))
            : "No batch details available";
        const generatedAt = new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });

        const tableRows = rowsForExport.map(function (row, index) {
            return (
                "<tr>" +
                "<td>" + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" + escapeHtml(selectionPoolCategoryLabel(row.category)) + "</td>" +
                "<td>" + escapeHtml(row.rank || "-") + "</td>" +
                "<td><strong>" + escapeHtml(row.applicantPrintName || row.applicantName || "UNKNOWN APPLICANT") + "</strong><div class=\"subline\">" + escapeHtml(row.applicationNo || "-") + "</div></td>" +
                "<td>" + escapeHtml(row.applicationNo || "-") + "</td>" +
                "<td>" + escapeHtml(row.score || "-") + "</td>" +
                "<td>" + escapeHtml(row.basis || "-") + "</td>" +
                "</tr>"
            );
        }).join("");

        return [
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>LDSP Selection Pool Print</title><style>",
            "@page{size:8.5in 13in;margin:0.45in;}body{font-family:Arial,sans-serif;margin:0;color:#0f172a;background:#ffffff;} .sheet{max-width:100%;} .print-header{border-bottom:1.5px solid #0f172a;padding-bottom:12px;margin-bottom:14px;} .logo-row{text-align:center;margin-bottom:8px;} .logo-row img{width:58px;height:58px;object-fit:contain;display:block;margin:0 auto 6px;} .logo-row .kicker{font-size:11px;font-weight:800;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;} .logo-row .title{font-size:22px;font-weight:800;line-height:1.2;color:#0f172a;} .logo-row .subtitle{font-size:12px;color:#475569;margin-top:4px;} .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;} .summary-card{border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:10px 12px;} .summary-card .label{font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:4px;} .summary-card .value{font-size:14px;font-weight:700;color:#0f172a;} .filter-note{border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;padding:10px 12px;font-size:11px;line-height:1.5;color:#475569;margin-bottom:14px;} table{width:100%;border-collapse:collapse;font-size:11px;} th,td{border:1px solid #94a3b8;padding:8px 9px;vertical-align:top;text-align:left;} th{background:#e2e8f0;font-size:10px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:#334155;} tbody tr:nth-child(even){background:#f8fafc;} td:first-child{width:44px;text-align:center;font-weight:700;} .subline{font-size:10px;color:#64748b;margin-top:3px;} .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;background:#e5e7eb;color:#374151;} @media print{.sheet{max-width:none;}}",
            "</style></head><body><div class=\"sheet\">",
            "<div class=\"print-header\">",
            "<div class=\"logo-row\">",
            "<img src=\"" + escapeHtml(logoHref) + "\" alt=\"LGU Daet Logo\" />",
            "<div class=\"kicker\">LGU Daet Scholarship System</div>",
            "<div class=\"title\">Selection Pool Report</div>",
            "<div class=\"subtitle\">Saved shortlist before requirements, screening, and final selection</div>",
            "</div>",
            "<div class=\"summary-grid\">",
            "<div class=\"summary-card\"><div class=\"label\">Exam Batch</div><div class=\"value\">" + escapeHtml(batchLabel) + "</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Applicants</div><div class=\"value\">" + escapeHtml(String(rowsForExport.length)) + "</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Source View</div><div class=\"value\">" + escapeHtml(filterLabel) + "</div></div>",
            "<div class=\"summary-card\"><div class=\"label\">Order</div><div class=\"value\">" + escapeHtml(orderLabel) + "</div></div>",
            "</div>",
            "<div class=\"filter-note\"><strong>Batch Details:</strong> " + escapeHtml(batchMeta) + "<br /><strong>Generated:</strong> " + escapeHtml(generatedAt) + "</div>",
            "<table><thead><tr><th>No.</th><th>Selection Source</th><th>Rank</th><th>Applicant</th><th>Application No.</th><th>Score</th><th>Basis / Remarks</th></tr></thead><tbody>",
            tableRows,
            "</tbody></table>",
            "</div></body></html>"
        ].join("");
    }

    function openSelectionPoolPrintReport() {
        const exportSelection = selectionPoolExportSelection();
        if (exportSelection.errorMessage) {
            showStatus(exportSelection.errorMessage, "alert-warning");
            return;
        }

        const frame = selectionPoolPrintFrameWindow();
        const frameWindow = frame.contentWindow;
        const frameDoc = frameWindow ? frameWindow.document : null;
        if (!frameWindow || !frameDoc) {
            showStatus("The print report could not be prepared right now. Refresh the page and try again.", "alert-warning");
            return;
        }

        let printTriggered = false;
        frame.onload = function () {
            if (printTriggered) {
                return;
            }
            printTriggered = true;

            window.setTimeout(function () {
                try {
                    frameWindow.focus();
                    frameWindow.print();
                    showStatus("Selection Pool print dialog opened for " + String(exportSelection.rows.length) + " applicant(s).", "alert-success");
                } catch (_error) {
                    showStatus("The browser could not open the print dialog right now. Try again.", "alert-warning");
                }
            }, 180);
        };

        frameDoc.open();
        frameDoc.write(buildSelectionPoolPrintHtml(exportSelection));
        frameDoc.close();
    }

    async function saveSelectionPoolPdfReport() {
        if (isSelectionPoolPdfBusy) {
            return;
        }

        const exportSelection = selectionPoolExportSelection();
        if (exportSelection.errorMessage) {
            showStatus(exportSelection.errorMessage, "alert-warning");
            return;
        }

        const JsPdf = getPdfGenerator();
        if (!JsPdf) {
            showStatus("The PDF library is not available right now.", "alert-warning");
            return;
        }

        const pdfButton = byId("scholarSelectionPoolPdfBtn");
        isSelectionPoolPdfBusy = true;
        if (pdfButton) {
            pdfButton.disabled = true;
            pdfButton.textContent = "Preparing...";
        }
        showStatus("Preparing Selection Pool PDF...", "alert-info");

        try {
            const doc = new JsPdf({
                orientation: "portrait",
                unit: "pt",
                format: [612, 936]
            });

            if (typeof doc.autoTable !== "function") {
                showStatus("The PDF table helper is not available right now.", "alert-warning");
                return;
            }

            const rowsForExport = exportSelection.rows || [];
            const batch = exportSelection.batch || null;
            const batchLabel = batch ? (batch.batch_label || "Selected Batch") : "Selected Batch";
            const batchMeta = batch
                ? (formatDate(batch.exam_datetime) + " | " + (batch.venue || "-"))
                : "No batch details available";
            const orderLabel = exportSelection.orderLabel || "By Score";
            const filterLabel = exportSelection.filterLabel || "All Sources";
            const printedAt = new Date().toLocaleString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
            const logoDataUrl = await loadScholarSelectionLogoDataUrl();
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const left = 20;
            const titleLeft = left + 52;

            if (logoDataUrl) {
                doc.addImage(logoDataUrl, "PNG", left, 16, 40, 40);
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.text("LGU DAET SCHOLARSHIP SYSTEM", titleLeft, 24);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(15, 23, 42);
            doc.text("Selection Pool Report", titleLeft, 38);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            doc.setTextColor(71, 85, 105);
            doc.text("Saved shortlist before requirements, screening, and final selection", titleLeft, 54);
            doc.text("Generated: " + printedAt, titleLeft, 68);
            doc.text("Batch: " + batchLabel, titleLeft, 81);

            const filterLines = doc.splitTextToSize(
                "Batch Details: " + batchMeta + " | Source View: " + filterLabel + " | Order: " + orderLabel,
                pageWidth - (left * 2)
            );
            doc.text(filterLines, left, 104);

            const summaryY = 104 + (filterLines.length * 11);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9.2);
            doc.setTextColor(15, 23, 42);
            doc.text("Applicants: " + String(rowsForExport.length), left, summaryY);
            doc.setDrawColor(203, 213, 225);
            doc.line(left, summaryY + 8, pageWidth - left, summaryY + 8);

            doc.autoTable({
                startY: summaryY + 16,
                head: [["No.", "Selection Source", "Rank", "Applicant", "Application No.", "Score", "Basis / Remarks"]],
                body: rowsForExport.map(function (row, index) {
                    return [
                        String(index + 1),
                        selectionPoolCategoryLabel(row.category),
                        row.rank || "-",
                        [row.applicantPrintName || row.applicantName || "UNKNOWN APPLICANT", row.applicationNo || "-"].join("\n"),
                        row.applicationNo || "-",
                        row.score || "-",
                        row.basis || "-"
                    ];
                }),
                margin: { left: left, right: left, bottom: 24 },
                styles: {
                    font: "helvetica",
                    fontSize: 8,
                    cellPadding: 4.5,
                    lineColor: [203, 213, 225],
                    lineWidth: 0.45,
                    textColor: [15, 23, 42],
                    overflow: "linebreak",
                    valign: "middle"
                },
                headStyles: {
                    fillColor: [226, 232, 240],
                    textColor: [15, 23, 42],
                    fontStyle: "bold",
                    fontSize: 8.3
                },
                columnStyles: {
                    0: { cellWidth: 28, halign: "center" },
                    1: { cellWidth: 74 },
                    2: { cellWidth: 34, halign: "center" },
                    3: { cellWidth: 138 },
                    4: { cellWidth: 78 },
                    5: { cellWidth: 58, halign: "center" },
                    6: { cellWidth: "auto" }
                },
                didDrawPage: function () {
                    const pageNumber = doc.internal.getNumberOfPages();
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(8.5);
                    doc.setTextColor(100, 116, 139);
                    doc.text("Printed: " + printedAt, left, pageHeight - 12);
                    doc.text("Page " + String(pageNumber), pageWidth - left, pageHeight - 12, { align: "right" });
                }
            });

            doc.save(selectionPoolPdfFileName(batchLabel, orderLabel));
            showStatus("Selection Pool PDF downloaded successfully.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to build the Selection Pool PDF.", "alert-danger");
        } finally {
            isSelectionPoolPdfBusy = false;
            if (pdfButton) {
                pdfButton.disabled = false;
                pdfButton.textContent = "Save PDF";
            }
        }
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
            writeInput("scholarSelectionSectorSlots", normalizeSectorSlots(parsed.sectorSlots));
            writeCheckbox("scholarSelectionIncludeSpecial", parsed.includeSpecial !== false);
            if (byId("scholarSelectionPoolFilter") && parsed.selectionPoolFilter) {
                byId("scholarSelectionPoolFilter").value = parsed.selectionPoolFilter;
            }
            if (byId("scholarSelectionPoolPrintOrder") && parsed.selectionPoolPrintOrder) {
                byId("scholarSelectionPoolPrintOrder").value = parsed.selectionPoolPrintOrder;
            }
            if (byId("scholarSelectionPrintFilter") && parsed.printFilter) {
                byId("scholarSelectionPrintFilter").value = parsed.printFilter;
            }
            writeInput("scholarSelectionScoreFrom", parsed.scoreRangeFrom);
            writeInput("scholarSelectionScoreTo", parsed.scoreRangeTo);
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

    function defaultSelectionCategoryForRow(row) {
        if (row && row.passed_by_score === true) {
            return "passed_exam";
        }
        if (row && row.has_sector_classification === true) {
            return "sector_classification";
        }
        return "manual_office_selection";
    }

    function selectionPoolBasis(row) {
        if (!row) {
            return "-";
        }
        return row.selection_notes || defaultSelectionPoolNotes(row.selection_category || defaultSelectionCategoryForRow(row));
    }

    function selectionPoolRowsForBatch(batchId) {
        return rankedRowsForBatch(batchId)
            .filter(function (row) {
                return row.selection_included === true;
            })
            .map(function (row) {
                return {
                    application_id: row.application_id,
                    category: row.selection_category || defaultSelectionCategoryForRow(row),
                    rank: row.display_rank ? String(row.display_rank) : "-",
                    applicantName: row.applicant_name || "UNKNOWN APPLICANT",
                    applicantPrintName: row.applicant_print_name || row.applicant_name || "UNKNOWN APPLICANT",
                    applicationNo: row.application_no || "-",
                    school: row.school_name || "-",
                    score: scoreText(row),
                    basis: selectionPoolBasis(row),
                    updatedAt: row.selection_updated_at || "",
                    sourceRow: row
                };
            });
    }

    function selectionPoolRowsForView(batchId) {
        const sourceRows = selectionPoolRowsForBatch(batchId);
        const filter = currentSelectionPoolFilter();
        if (filter === "all") {
            return sourceRows;
        }
        return sourceRows.filter(function (row) {
            return normalizeSelectionCategory(row.category) === normalizeSelectionCategory(filter);
        });
    }

    function selectionPoolRowsForExport(batchId) {
        const poolRows = selectionPoolRowsForView(batchId).slice();
        const printOrder = currentSelectionPoolPrintOrder();

        if (printOrder === "alphabetical") {
            return poolRows.sort(function (left, right) {
                const leftName = String(left.applicantPrintName || left.applicantName || "");
                const rightName = String(right.applicantPrintName || right.applicantName || "");
                const nameCompare = leftName.localeCompare(rightName, undefined, {
                    sensitivity: "base",
                    numeric: true
                });
                if (nameCompare !== 0) {
                    return nameCompare;
                }
                return String(left.applicationNo || "").localeCompare(String(right.applicationNo || ""), undefined, {
                    sensitivity: "base",
                    numeric: true
                });
            });
        }

        return poolRows.sort(function (left, right) {
            const leftScore = left && left.sourceRow ? effectiveRankScore(left.sourceRow) : null;
            const rightScore = right && right.sourceRow ? effectiveRankScore(right.sourceRow) : null;
            const safeLeft = leftScore === null || typeof leftScore === "undefined" || Number.isNaN(Number(leftScore)) ? -Infinity : Number(leftScore);
            const safeRight = rightScore === null || typeof rightScore === "undefined" || Number.isNaN(Number(rightScore)) ? -Infinity : Number(rightScore);
            if (safeRight !== safeLeft) {
                return safeRight - safeLeft;
            }

            const leftRank = Number(left && left.sourceRow && left.sourceRow.display_rank ? left.sourceRow.display_rank : Number.MAX_SAFE_INTEGER);
            const rightRank = Number(right && right.sourceRow && right.sourceRow.display_rank ? right.sourceRow.display_rank : Number.MAX_SAFE_INTEGER);
            if (leftRank !== rightRank) {
                return leftRank - rightRank;
            }

            return String(left.applicantPrintName || left.applicantName || "").localeCompare(String(right.applicantPrintName || right.applicantName || ""), undefined, {
                sensitivity: "base",
                numeric: true
            });
        });
    }

    function manualCandidateRowsForBatch(batchId) {
        return rankedRowsForBatch(batchId).filter(function (row) {
            return Boolean(row && row.application_id) && row.selection_included !== true;
        });
    }

    function ensureScholarSelectionManualModal() {
        const modalElement = byId("scholarSelectionManualModal");
        if (!modalElement || !window.bootstrap || !window.bootstrap.Modal) {
            return null;
        }
        if (!scholarSelectionManualModal) {
            scholarSelectionManualModal = new window.bootstrap.Modal(modalElement);
        }
        return scholarSelectionManualModal;
    }

    function fillManualCandidateOptions() {
        const select = byId("scholarSelectionManualCandidateSelect");
        const meta = byId("scholarSelectionManualModalMeta");
        if (!select) {
            return;
        }

        const candidates = manualCandidateRowsForBatch(currentBatchId);
        select.innerHTML = ['<option value="">Select an applicant</option>'].concat(candidates.map(function (row) {
            const parts = [
                row.display_rank ? ("Rank " + String(row.display_rank)) : "Unranked",
                row.applicant_name || "UNKNOWN APPLICANT",
                row.application_no || "-",
                hasSavedRawScore(row.raw_score) ? ("Score " + scoreText(row)) : "No saved score"
            ];
            return '<option value="' + escapeHtml(row.application_id || "") + '">' + escapeHtml(parts.join(" | ")) + "</option>";
        })).join("");

        if (meta) {
            if (!currentBatchId) {
                meta.textContent = "Select an exam batch first before adding a manual candidate.";
            } else if (!selectionPoolAvailable) {
                meta.textContent = selectionStorageWarning();
            } else {
                meta.textContent = String(candidates.length) + " candidate(s) are available from the current batch.";
            }
        }
    }

    async function persistSelectionPoolEntry(row, category, notes, include) {
        if (!selectionPoolAvailable) {
            throw new Error(selectionStorageWarning());
        }
        if (!row || !row.application_id) {
            throw new Error("Select a valid applicant first.");
        }

        const updatedAt = include ? new Date().toISOString() : null;
        const payload = {
            application_id: row.application_id,
            selection_included: include === true,
            selection_category: include === true ? (normalizeSelectionCategory(category) || defaultSelectionCategoryForRow(row)) : null,
            selection_notes: include === true ? (normalizeSelectionNotes(notes) || defaultSelectionPoolNotes(category || defaultSelectionCategoryForRow(row))) : null,
            selection_marked_by: include === true && context && context.user ? context.user.id : null,
            selection_updated_at: updatedAt
        };

        const result = await context.client
            .from("application_staff_flags")
            .upsert(payload, { onConflict: "application_id" });

        if (result.error) {
            if (isMissingSelectionColumnError(result.error) || /does not exist|relation|schema cache/i.test(result.error.message || "")) {
                selectionPoolAvailable = false;
                throw new Error(selectionStorageWarning());
            }
            throw new Error("Failed to save Selection record: " + result.error.message);
        }

        row.selection_included = include === true;
        row.selection_category = include === true ? (normalizeSelectionCategory(category) || defaultSelectionCategoryForRow(row)) : "";
        row.selection_notes = include === true ? (normalizeSelectionNotes(notes) || defaultSelectionPoolNotes(category || defaultSelectionCategoryForRow(row))) : "";
        row.selection_updated_at = updatedAt || "";
    }

    async function saveManualSelectionCandidate() {
        if (!selectionPoolAvailable) {
            showStatus(selectionStorageWarning(), "alert-warning");
            return;
        }

        const select = byId("scholarSelectionManualCandidateSelect");
        const typeSelect = byId("scholarSelectionManualType");
        const notesInput = byId("scholarSelectionManualNotes");
        const applicationId = select ? (select.value || "").trim() : "";
        const row = rows.find(function (entry) {
            return entry.application_id === applicationId && entry.batch_id === currentBatchId;
        }) || null;

        if (!row) {
            showStatus("Select one applicant from the current batch first.", "alert-warning");
            return;
        }

        isSavingSelectionPool = true;
        renderAll();
        showStatus("");

        try {
            await persistSelectionPoolEntry(
                row,
                typeSelect ? typeSelect.value : "manual_office_selection",
                notesInput ? notesInput.value : "",
                true
            );
            const modal = ensureScholarSelectionManualModal();
            if (modal) {
                modal.hide();
            }
            if (notesInput) {
                notesInput.value = "";
            }
            renderAll();
            showStatus((row.applicant_name || "Selected applicant") + " was added to the saved Selection pool.", "alert-success");
        } catch (error) {
            renderAll();
            showStatus(error && error.message ? error.message : "Failed to save the manual selection candidate.", "alert-danger");
        } finally {
            isSavingSelectionPool = false;
            renderAll();
        }
    }

    async function removeSelectionPoolEntry(applicationId) {
        const row = rows.find(function (entry) {
            return entry.application_id === applicationId;
        }) || null;
        if (!row || row.selection_included !== true) {
            showStatus("That selection record is no longer available.", "alert-info");
            return;
        }

        const confirmed = window.confirm(
            "Remove " + (row.applicant_name || "this applicant") + " from the saved Selection pool?"
        );
        if (!confirmed) {
            return;
        }

        isSavingSelectionPool = true;
        renderAll();
        showStatus("");

        try {
            await persistSelectionPoolEntry(row, "", "", false);
            renderAll();
            showStatus((row.applicant_name || "Selected applicant") + " was removed from the saved Selection pool.", "alert-success");
        } catch (error) {
            renderAll();
            showStatus(error && error.message ? error.message : "Failed to remove the saved Selection record.", "alert-danger");
        } finally {
            isSavingSelectionPool = false;
            renderAll();
        }
    }

    function renderSelectionPool() {
        const tbody = byId("scholarSelectionPoolBody");
        const meta = byId("scholarSelectionPoolMeta");
        if (!tbody) {
            return;
        }

        if (!currentBatchId) {
            tbody.innerHTML = '<tr><td colspan="8" class="ldss-scholar-empty">Select an exam batch to review the saved Selection pool.</td></tr>';
            if (meta) {
                meta.textContent = "Select an exam batch to review the saved selection pool.";
            }
            return;
        }

        if (!selectionPoolAvailable) {
            tbody.innerHTML = '<tr><td colspan="8" class="ldss-scholar-empty">' + escapeHtml(selectionStorageWarning()) + "</td></tr>";
            if (meta) {
                meta.textContent = selectionStorageWarning();
            }
            return;
        }

        const allPoolRows = selectionPoolRowsForBatch(currentBatchId);
        const poolRows = selectionPoolRowsForView(currentBatchId);
        const filterLabel = currentSelectionPoolFilterLabel();
        const orderLabel = currentSelectionPoolPrintOrderLabel();
        if (!allPoolRows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="ldss-scholar-empty">No applicants are saved in Selection for this batch yet.</td></tr>';
            if (meta) {
                meta.textContent = "Use Ranking to include passers or add one manual candidate here.";
            }
            return;
        }

        if (!poolRows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="ldss-scholar-empty">No saved applicants match the selected Selection Source.</td></tr>';
            if (meta) {
                meta.textContent = "Showing 0 of " + String(allPoolRows.length) + " saved candidate(s). Source: " + filterLabel + ". Print Order: " + orderLabel + ".";
            }
            return;
        }

        const counts = {
            passed_exam: 0,
            sector_classification: 0,
            manual_office_selection: 0
        };
        allPoolRows.forEach(function (row) {
            const category = normalizeSelectionCategory(row.category) || "manual_office_selection";
            counts[category] += 1;
        });
        if (meta) {
            meta.textContent = "Showing " + String(poolRows.length)
                + " of " + String(allPoolRows.length) + " saved candidate(s). Source: " + filterLabel + ". "
                + "Print Order: " + orderLabel + ". "
                + "Totals: "
                + String(counts.passed_exam) + " passed exam, "
                + String(counts.sector_classification) + " sector classification, "
                + String(counts.manual_office_selection) + " manual office selection.";
        }

        tbody.innerHTML = poolRows.map(function (row, index) {
            const removeDisabled = isSavingSelectionPool ? " disabled" : "";
            return (
                "<tr>" +
                '<td class="text-center fw-700">' + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" + selectionPoolCategoryPill(row.category) + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(row.rank || "-") + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicantPrintName || row.applicantName || "-") + "</div>" +
                '<div class="small">' + escapeHtml(row.applicationNo || "-") + "</div>" +
                "</td>" +
                '<td class="fw-700">' + escapeHtml(row.applicationNo || "-") + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(row.score || "-") + "</td>" +
                "<td>" + escapeHtml(row.basis || "-") + "</td>" +
                '<td class="text-center"><button class="btn btn-outline-danger btn-sm" data-selection-pool-remove="' + escapeHtml(row.application_id || "") + '" type="button"' + removeDisabled + '>Remove</button></td>' +
                "</tr>"
            );
        }).join("");
    }

    function rankedRowsForBatch(batchId) {
        const scoredRows = [];
        const unscoredRows = [];

        batchRows(batchId).forEach(function (row) {
            if (hasSavedRawScore(row.raw_score) || row.special_consideration_tag) {
                scoredRows.push(Object.assign({}, row, {
                    raw_score_value: hasSavedRawScore(row.raw_score) ? Number(row.raw_score) : null,
                    rank_score_value: effectiveRankScore(row)
                }));
                return;
            }
            unscoredRows.push(Object.assign({}, row, {
                display_rank: null,
                raw_score_value: null,
                rank_score_value: effectiveRankScore(row)
            }));
        });

        const rankedRows = assignDisplayRanks(scoredRows.sort(function (left, right) {
            if (right.rank_score_value !== left.rank_score_value) {
                return right.rank_score_value - left.rank_score_value;
            }
            return compareRoomSeatApplication(left, right);
        }));

        return rankedRows.concat(unscoredRows.sort(function (left, right) {
            if (right.rank_score_value !== left.rank_score_value) {
                return right.rank_score_value - left.rank_score_value;
            }
            return compareRoomSeatApplication(left, right);
        }));
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
                    applicantPrintName: parts[0] || "Manual Dummy Record",
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
            applicantPrintName: row.applicant_print_name || row.applicant_name || "UNKNOWN APPLICANT",
            applicationNo: row.application_no || "-",
            barangay: row.barangay || "-",
            school: row.school_name || "-",
            sector: row.sector_classification || "-",
            score: scoreText(row),
            basis: basis,
            sourceRow: row
        };
    }

    function finalInclusionBasis(row) {
        const endorsedBy = normalizeFinalListEndorsedBy(row && row.final_list_inclusion_endorsed_by ? row.final_list_inclusion_endorsed_by : "");
        const parts = ["Included from the System Administrator final list inclusion table."];
        if (endorsedBy) {
            parts.push("Care Of / Endorsed By: " + endorsedBy + ".");
        }
        return parts.join(" ");
    }

    function buildSelection() {
        const settings = currentSettings();
        const rankedRows = rankedRowsForBatch(currentBatchId);
        const selectedApplicationIds = new Set();
        const sectorSlots = normalizeSectorSlots(settings.sectorSlots);

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
        const sector = sectorCandidates.slice(0, sectorSlots).map(function (row) {
            selectedApplicationIds.add(row.application_id);
            return toSelectionRow(row, "sector", "Selected from the 76-slot sector classification pool.");
        });

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
        const finalInclusion = rankedRows
            .filter(function (row) {
                return row.final_list_inclusion === true && !selectedApplicationIds.has(row.application_id);
            })
            .map(function (row) {
                selectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "final_inclusion", finalInclusionBasis(row));
            });

        const likhang = parseLikhangRows();
        const combined = regular.concat(special, sector, finalInclusion);
        const grandTotalCount = combined.length + likhang.length;

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
        const masterSector = limitRows(masterSectorCandidates, MASTERLIST_SECTOR_LIMIT)
            .map(function (row) {
                masterlistSelectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "sector", "Selected from the 76-slot sector classification pool.");
            });
        const masterFinalInclusion = rankedRows
            .filter(function (row) {
                return row.final_list_inclusion === true && !masterlistSelectedApplicationIds.has(row.application_id);
            })
            .map(function (row) {
                masterlistSelectedApplicationIds.add(row.application_id);
                return toSelectionRow(row, "final_inclusion", finalInclusionBasis(row));
            });
        const masterlistCore = masterRegular.concat(masterSpecial, masterSector, masterFinalInclusion);
        const masterlist = masterlistCore;

        return {
            regular: regular,
            sector: sector,
            special: special,
            finalInclusion: finalInclusion,
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
            masterlistFinalInclusionCount: masterFinalInclusion.length,
            rankedCount: rankedRows.length,
            likhangCount: likhang.length,
            likhangActualCount: likhang.length,
            sectorSlots: sectorSlots,
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
        return selectionRowsForView(selection.combined);
    }

    function masterlistRowsForView(selection) {
        return selectionRowsForView(selection.masterlistCore);
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
            tbody.innerHTML = '<tr><td colspan="9" class="ldss-scholar-empty">' + escapeHtml(currentSettings().printFilter === "score-range" && currentPrintScoreRange().incomplete
                ? "Enter both score values to preview the selected score range."
                : "No selected scholars match the current view.") + '</td></tr>';
            return;
        }

        tbody.innerHTML = finalRows.map(function (row, index) {
            return (
                "<tr>" +
                '<td class="text-center fw-700">' + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" + categoryPill(row.categoryKey) + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(row.rank || "-") + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicantPrintName || row.applicantName || "-") + "</div>" +
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

        const masterlistRows = masterlistRowsForView(selection);
        if (!currentBatchId && masterlistRows.length === 0) {
            container.innerHTML = '<div class="ldss-scholar-empty">No exam batch with assigned examinees is ready yet.</div>';
            return;
        }

        if (!masterlistRows.length) {
            container.innerHTML = '<div class="ldss-scholar-empty">' + escapeHtml(currentSettings().printFilter === "score-range" && currentPrintScoreRange().incomplete
                ? "Enter both score values to print the selected score range."
                : "No final-list rows match the current view.") + '</div>';
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
                    '<div class="fw-700">' + escapeHtml(row.applicantPrintName || row.applicantName || "-") + "</div>" +
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

    function renderActionState(selection) {
        const namesPdfButton = byId("scholarSelectionNamesPdfBtn");
        const printButton = byId("scholarSelectionPrintBtn");
        const selectionPoolPrintButton = byId("scholarSelectionPoolPrintBtn");
        const selectionPoolPdfButton = byId("scholarSelectionPoolPdfBtn");
        const manualButton = byId("scholarSelectionManualCandidateBtn");
        const manualSaveButton = byId("scholarSelectionManualSaveBtn");
        const finalRows = finalRowsForView(selection);
        const masterlistRows = masterlistRowsForView(selection);
        const selectionPoolRows = currentBatchId ? selectionPoolRowsForView(currentBatchId) : [];
        const manualCandidates = manualCandidateRowsForBatch(currentBatchId);
        if (namesPdfButton) {
            namesPdfButton.disabled = finalRows.length === 0;
        }
        if (printButton) {
            printButton.disabled = masterlistRows.length === 0;
        }
        if (selectionPoolPrintButton) {
            selectionPoolPrintButton.disabled = selectionPoolRows.length === 0;
        }
        if (selectionPoolPdfButton) {
            selectionPoolPdfButton.disabled = selectionPoolRows.length === 0 || isSelectionPoolPdfBusy;
            selectionPoolPdfButton.textContent = isSelectionPoolPdfBusy ? "Preparing..." : "Save PDF";
        }
        if (manualButton) {
            manualButton.disabled = isLoading || isSavingSelectionPool || !selectionPoolAvailable || !currentBatchId || !manualCandidates.length;
        }
        if (manualSaveButton) {
            manualSaveButton.disabled = isLoading || isSavingSelectionPool || !selectionPoolAvailable;
            manualSaveButton.textContent = isSavingSelectionPool ? "Saving..." : "Save Candidate";
        }
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
        const sectorSlots = normalizeSectorSlots(selection.sectorSlots);

        setText("scholarSelectionRegularCount", selection.regular.length);
        setText("scholarSelectionSectorCount", selection.sector.length);
        setText("scholarSelectionSpecialCount", selection.special.length);
        setText("scholarSelectionFinalInclusionCount", selection.finalInclusion.length);
        setText("scholarSelectionLikhangCount", selection.likhangCount || 0);
        setText("scholarSelectionFinalCount", selection.grandTotalCount || selection.combined.length);

        const regularSlotLabel = settings.regularSlots > 0
            ? String(settings.regularSlots) + " regular slot(s)"
            : String(passingScore).replace(/\.00$/, "") + "+ passers";
        const sectorSlotLabel = String(sectorSlots) + " sector slot(s)";
        const batchLabel = batch
            ? ((batch.batch_label || "Selected batch") + " | " + formatDate(batch.exam_datetime) + " | " + (batch.venue || "-"))
            : "No exam batch selected";
        const viewLabel = currentPrintFilterLabel();

        setText(
            "scholarSelectionFinalMeta",
            batchLabel + ". View: " + viewLabel + ". Policy: " + policyLabel() + ". Regular Applicant: " + regularSlotLabel + ". Sector Classification: " + sectorSlotLabel + ". Special Consideration follows the regular passers. Final List Inclusion adds the System Administrator override list without changing applicant-side score or rank. Likhang Daeteño Performing Arts manual entries: " + String(selection.likhangCount || 0) + ". Showing " + String(filteredRows.length) + " row(s)."
        );
        setText(
            "scholarSelectionPrintMeta",
            batchLabel + "\nView: " + viewLabel + "\nPass " + String(passingScore).replace(/\.00$/, "") + "+"
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
                ? "Sector slots are fixed at 76 and include sector-classified applicants below the passing score."
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
            "scholarSelectionFinalInclusionBody",
            selection.finalInclusion,
            staffFlagsAvailable
                ? "No final list inclusion applicants are selected."
                : "Final list inclusion flag table is not available yet."
        );
        renderCompactCategoryTable(
            "scholarSelectionLikhangBody",
            selection.likhang,
            "No manual entries yet."
        );
    }

    function renderAll() {
        renderPolicy();
        fillBatchFilter();
        syncPrintFilterVisibility();
        renderSelectionPool();
        fillManualCandidateOptions();
        const selection = buildSelection();
        renderSummary(selection);
        renderFinalTable(selection);
        renderMasterlistCorePrintTable(selection);
        renderCategorySections(selection);
        renderActionState(selection);
    }

    function namesOnlySelectionRows(selection) {
        return finalRowsForView(selection)
            .filter(function (row) {
                return Boolean(row && (row.applicantPrintName || row.applicantName));
            })
            .slice()
            .sort(function (left, right) {
                return String(left.applicantPrintName || left.applicantName || "").localeCompare(String(right.applicantPrintName || right.applicantName || ""), undefined, {
                    sensitivity: "base",
                    numeric: true
                });
            });
    }

    async function downloadNamesOnlyPdf() {
        const selection = buildSelection();
        const selectionRows = namesOnlySelectionRows(selection);
        const batch = batchById(currentBatchId);
        const filterLabel = currentPrintFilterLabel();
        const printedAt = new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });

        if (!selectionRows.length) {
            showStatus("No selected scholars are available for the current view yet.", "alert-warning");
            return;
        }

        const JsPdf = getPdfGenerator();
        if (!JsPdf) {
            showStatus("The PDF library is not available right now.", "alert-warning");
            return;
        }

        try {
            const doc = new JsPdf({
                orientation: "portrait",
                unit: "pt",
                format: [612, 936]
            });

            if (typeof doc.autoTable !== "function") {
                showStatus("The PDF table helper is not available right now.", "alert-warning");
                return;
            }

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const left = 24;
            const logoDataUrl = await loadScholarSelectionLogoDataUrl();
            const batchLabel = batch ? (batch.batch_label || "Selected Batch") : "Selected Batch";
            const batchYear = batch && batch.exam_datetime && !Number.isNaN(new Date(batch.exam_datetime).getTime())
                ? String(new Date(batch.exam_datetime).getFullYear())
                : "2026";
            const title = "DAET LGU EXPANDED SCHOLARSHIP PROGRAM";
            const subtitle = batchYear + " QUALIFYING EXAMINATION PASSERS" + (filterLabel === "All Categories" ? "" : " | " + filterLabel);
            const titleLines = doc.splitTextToSize(title, pageWidth - (left * 2) - 52);
            const titleStartY = 28;
            const titleLineHeight = 18;
            const subtitleY = titleStartY + (titleLines.length * titleLineHeight) + 2;

            if (logoDataUrl) {
                doc.addImage(logoDataUrl, "PNG", left, 16, 42, 42);
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(15, 23, 42);
            doc.text(titleLines, left + 52, titleStartY);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.text(subtitle, left + 52, subtitleY);

            doc.autoTable({
                startY: Math.max(82, subtitleY + 14),
                body: selectionRows.map(function (row) {
                    return [row.applicantPrintName || row.applicantName || "-"];
                }),
                showHead: "never",
                margin: { left: left, right: left, bottom: 28 },
                styles: {
                    font: "helvetica",
                    fontSize: 11,
                    cellPadding: 6,
                    lineColor: [203, 213, 225],
                    lineWidth: 0.45,
                    textColor: [15, 23, 42],
                    overflow: "linebreak",
                    valign: "middle"
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: pageWidth - (left * 2), fontStyle: "bold" }
                },
                didDrawPage: function () {
                    const pageNumber = doc.internal.getNumberOfPages();
                    doc.setFont("helvetica", "normal");
                    doc.setFontSize(8.5);
                    doc.setTextColor(100, 116, 139);
                    doc.text("Printed: " + printedAt, left, pageHeight - 12);
                    doc.text("Page " + String(pageNumber), pageWidth - left, pageHeight - 12, { align: "right" });
                }
            });

            doc.save(
                "ldss-scholar-selection-names-" +
                pdfFileSlug(filterLabel, "all-categories") + "-" +
                pdfFileSlug(batchLabel, "selected-batch") + ".pdf"
            );
            showStatus("Names-only PDF downloaded successfully.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to build the names-only PDF.", "alert-danger");
        }
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

            let result = await context.client
                .from("application_staff_flags")
                .select("application_id, special_consideration_tag, final_list_inclusion, final_list_inclusion_updated_at, final_list_inclusion_endorsed_by, selection_included, selection_category, selection_notes, selection_updated_at")
                .in("application_id", chunk);

            if (result.error && isMissingSelectionColumnError(result.error)) {
                selectionPoolAvailable = false;
                result = await context.client
                    .from("application_staff_flags")
                    .select("application_id, special_consideration_tag, final_list_inclusion, final_list_inclusion_updated_at, final_list_inclusion_endorsed_by")
                    .in("application_id", chunk);

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            selection_included: false,
                            selection_category: "",
                            selection_notes: "",
                            selection_updated_at: null
                        });
                    });
                }
            }

            if (result.error && /final_list_inclusion_endorsed_by/i.test(result.error.message || "")) {
                result = await context.client
                    .from("application_staff_flags")
                    .select(selectionPoolAvailable
                        ? "application_id, special_consideration_tag, final_list_inclusion, final_list_inclusion_updated_at, selection_included, selection_category, selection_notes, selection_updated_at"
                        : "application_id, special_consideration_tag, final_list_inclusion, final_list_inclusion_updated_at")
                    .in("application_id", chunk);

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            final_list_inclusion_endorsed_by: ""
                        });
                    });
                }
            }

            if (result.error && isMissingSelectionColumnError(result.error)) {
                selectionPoolAvailable = false;
                result = await context.client
                    .from("application_staff_flags")
                    .select("application_id, special_consideration_tag, final_list_inclusion, final_list_inclusion_updated_at")
                    .in("application_id", chunk);

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            final_list_inclusion_endorsed_by: "",
                            selection_included: false,
                            selection_category: "",
                            selection_notes: "",
                            selection_updated_at: null
                        });
                    });
                }
            }

            if (result.error && /final_list_inclusion/i.test(result.error.message || "")) {
                result = await context.client
                    .from("application_staff_flags")
                    .select(selectionPoolAvailable
                        ? "application_id, special_consideration_tag, selection_included, selection_category, selection_notes, selection_updated_at"
                        : "application_id, special_consideration_tag")
                    .in("application_id", chunk);

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            final_list_inclusion: false,
                            final_list_inclusion_updated_at: null,
                            final_list_inclusion_endorsed_by: ""
                        });
                    });
                }
            }

            if (result.error && isMissingSelectionColumnError(result.error)) {
                selectionPoolAvailable = false;
                result = await context.client
                    .from("application_staff_flags")
                    .select("application_id, special_consideration_tag")
                    .in("application_id", chunk);

                if (!result.error) {
                    result.data = (result.data || []).map(function (row) {
                        return Object.assign({}, row, {
                            final_list_inclusion: false,
                            final_list_inclusion_updated_at: null,
                            final_list_inclusion_endorsed_by: "",
                            selection_included: false,
                            selection_category: "",
                            selection_notes: "",
                            selection_updated_at: null
                        });
                    });
                }
            }

            if (result.error) {
                if (/does not exist|relation|schema cache/i.test(result.error.message || "")) {
                    staffFlagsAvailable = false;
                    selectionPoolAvailable = false;
                    return map;
                }
                throw new Error("Failed to load Special Consideration tags: " + result.error.message);
            }

            (result.data || []).forEach(function (row) {
                if (row && row.application_id) {
                    map[row.application_id] = Object.assign({}, row, {
                        selection_included: Boolean(row.selection_included === true),
                        selection_category: normalizeSelectionCategory(row.selection_category || ""),
                        selection_notes: normalizeSelectionNotes(row.selection_notes || "")
                    });
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
                    applicant_print_name: buildApplicantPrintName(profile),
                    applicant_email: profile ? (profile.email || "") : "",
                    school_name: profile ? (profile.school_name || "") : "",
                    barangay: profile ? (profile.barangay || "") : "",
                    sector_classification: sector,
                    has_sector_classification: Boolean(sector),
                    special_consideration_tag: flagMap[row.application_id] && flagMap[row.application_id].special_consideration_tag
                        ? normalizeSpecialTag(flagMap[row.application_id].special_consideration_tag)
                        : "",
                    final_list_inclusion: Boolean(flagMap[row.application_id] && flagMap[row.application_id].final_list_inclusion === true),
                    final_list_inclusion_endorsed_by: normalizeFinalListEndorsedBy(flagMap[row.application_id] && flagMap[row.application_id].final_list_inclusion_endorsed_by
                        ? flagMap[row.application_id].final_list_inclusion_endorsed_by
                        : ""),
                    selection_included: Boolean(flagMap[row.application_id] && flagMap[row.application_id].selection_included === true),
                    selection_category: normalizeSelectionCategory(flagMap[row.application_id] && flagMap[row.application_id].selection_category
                        ? flagMap[row.application_id].selection_category
                        : ""),
                    selection_notes: normalizeSelectionNotes(flagMap[row.application_id] && flagMap[row.application_id].selection_notes
                        ? flagMap[row.application_id].selection_notes
                        : ""),
                    selection_updated_at: flagMap[row.application_id] && flagMap[row.application_id].selection_updated_at
                        ? flagMap[row.application_id].selection_updated_at
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
        const scoreFromInput = byId("scholarSelectionScoreFrom");
        const scoreToInput = byId("scholarSelectionScoreTo");
        const likhangInput = byId("scholarSelectionLikhangInput");
        const selectionPoolFilter = byId("scholarSelectionPoolFilter");
        const selectionPoolPrintOrder = byId("scholarSelectionPoolPrintOrder");
        const refreshButton = byId("scholarSelectionRefreshBtn");
        const printButton = byId("scholarSelectionPrintBtn");
        const selectionPoolPrintButton = byId("scholarSelectionPoolPrintBtn");
        const selectionPoolPdfButton = byId("scholarSelectionPoolPdfBtn");
        const namesPdfButton = byId("scholarSelectionNamesPdfBtn");
        const manualCandidateButton = byId("scholarSelectionManualCandidateBtn");
        const manualCandidateSaveButton = byId("scholarSelectionManualSaveBtn");
        const manualTypeSelect = byId("scholarSelectionManualType");
        const poolBody = byId("scholarSelectionPoolBody");

        if (batchFilter) {
            batchFilter.addEventListener("change", function () {
                currentBatchId = batchFilter.value || "";
                renderAll();
            });
        }

        [regularInput, sectorInput, includeSpecial, selectionPoolFilter, selectionPoolPrintOrder, printFilter, scoreFromInput, scoreToInput, likhangInput].forEach(function (control) {
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

        if (selectionPoolPrintButton) {
            selectionPoolPrintButton.addEventListener("click", function () {
                openSelectionPoolPrintReport();
            });
        }

        if (selectionPoolPdfButton) {
            selectionPoolPdfButton.addEventListener("click", function () {
                saveSelectionPoolPdfReport();
            });
        }

        if (namesPdfButton) {
            namesPdfButton.addEventListener("click", function () {
                downloadNamesOnlyPdf();
            });
        }

        if (manualCandidateButton) {
            manualCandidateButton.addEventListener("click", function () {
                if (!selectionPoolAvailable) {
                    showStatus(selectionStorageWarning(), "alert-warning");
                    return;
                }
                if (!currentBatchId) {
                    showStatus("Select an exam batch first before adding a manual candidate.", "alert-info");
                    return;
                }
                if (!manualCandidateRowsForBatch(currentBatchId).length) {
                    showStatus("No more ranked applicants are available to add manually in this batch.", "alert-info");
                    return;
                }
                const notesInput = byId("scholarSelectionManualNotes");
                if (notesInput) {
                    notesInput.value = defaultSelectionPoolNotes(manualTypeSelect && manualTypeSelect.value ? manualTypeSelect.value : "manual_office_selection");
                }
                fillManualCandidateOptions();
                const modal = ensureScholarSelectionManualModal();
                if (!modal) {
                    showStatus("The manual candidate modal is not available right now.", "alert-warning");
                    return;
                }
                modal.show();
            });
        }

        if (manualTypeSelect) {
            manualTypeSelect.addEventListener("change", function () {
                const notesInput = byId("scholarSelectionManualNotes");
                if (!notesInput) {
                    return;
                }
                const currentNotes = normalizeSelectionNotes(notesInput.value);
                if (!currentNotes || currentNotes === defaultSelectionPoolNotes("passed_exam") || currentNotes === defaultSelectionPoolNotes("sector_classification") || currentNotes === defaultSelectionPoolNotes("manual_office_selection")) {
                    notesInput.value = defaultSelectionPoolNotes(manualTypeSelect.value);
                }
            });
        }

        if (manualCandidateSaveButton) {
            manualCandidateSaveButton.addEventListener("click", function () {
                saveManualSelectionCandidate();
            });
        }

        if (poolBody) {
            poolBody.addEventListener("click", function (event) {
                const removeButton = event.target.closest("[data-selection-pool-remove]");
                if (!removeButton) {
                    return;
                }
                removeSelectionPoolEntry(removeButton.getAttribute("data-selection-pool-remove") || "");
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
