(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const LOOKUP_BATCH_SIZE = 200;
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
    let currentSearchQuery = "";
    let resultDrafts = {};
    let isSaving = false;

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
            },
            examResultMeta: function (value) {
                const normalized = this.normalizeExamResult ? this.normalizeExamResult(value) : "pending";
                if (normalized === "passed") {
                    return { label: "Passed", chipClass: "ldss-chip-success" };
                }
                if (normalized === "failed") {
                    return { label: "Failed", chipClass: "ldss-chip-danger" };
                }
                return { label: "Score Consolidation", chipClass: "ldss-chip-accent" };
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
        const box = byId("secretaryAllPassedStatus");
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

    function formatBatchDate(value) {
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

    function formatRawScore(value) {
        if (value === null || typeof value === "undefined" || value === "") {
            return "-";
        }
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return String(value);
        }
        return Number.isInteger(numeric) ? String(numeric) : String(numeric);
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

    function normalizeStatus(value) {
        if (workflow() && typeof workflow().normalizeStatus === "function") {
            return workflow().normalizeStatus(value || "");
        }
        return (value || "").toString().trim().toLowerCase();
    }

    function statusMeta(value) {
        if (workflow() && typeof workflow().statusMeta === "function") {
            return workflow().statusMeta(value || "");
        }
        return { label: (value || "-").toString(), chipClass: "ldss-chip-neutral" };
    }

    function normalizeExamResult(value) {
        if (workflow() && typeof workflow().normalizeExamResult === "function") {
            return workflow().normalizeExamResult(value || "pending");
        }
        const raw = (value || "").toString().trim().toLowerCase();
        if (raw === "passed" || raw === "pass") {
            return "passed";
        }
        if (raw === "failed" || raw === "fail") {
            return "failed";
        }
        return "pending";
    }

    function examResultMeta(value) {
        if (workflow() && typeof workflow().examResultMeta === "function") {
            return workflow().examResultMeta(value || "pending");
        }
        const normalized = normalizeExamResult(value || "pending");
        if (normalized === "passed") {
            return { label: "Passed", chipClass: "ldss-chip-success" };
        }
        if (normalized === "failed") {
            return { label: "Failed", chipClass: "ldss-chip-danger" };
        }
        return { label: "Score Consolidation", chipClass: "ldss-chip-accent" };
    }

    function normalizeSearchText(value) {
        let normalized = (value || "")
            .toString()
            .trim()
            .toLowerCase();

        if (typeof normalized.normalize === "function") {
            normalized = normalized
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "");
        }

        return normalized
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function compactSearchText(value) {
        return normalizeSearchText(value).replace(/\s+/g, "");
    }

    function searchTokens(value) {
        const normalized = normalizeSearchText(value);
        return normalized ? normalized.split(" ").filter(Boolean) : [];
    }

    function currentResultFilter() {
        const select = byId("secretaryAllPassedResultFilter");
        return select ? (select.value || "all").toString().trim().toLowerCase() : "all";
    }

    function currentSearchValue() {
        return normalizeSearchText(currentSearchQuery);
    }

    function fetchBatches() {
        return context.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue")
            .order("exam_datetime", { ascending: false })
            .then(function (result) {
                if (result.error) {
                    if (/does not exist|relation/i.test(result.error.message || "")) {
                        showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                        return [];
                    }
                    throw new Error("Failed to load exam batches: " + result.error.message);
                }
                return result.data || [];
            });
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

            let result = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, status, scholarship_type")
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

    function availableBatches() {
        return batches.filter(function (batch) {
            return batchRows(batch.id).length > 0;
        });
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

    function fillBatchFilter() {
        const select = byId("secretaryAllPassedBatchFilter");
        if (!select) {
            return;
        }

        const current = currentBatchId;
        const selectableBatches = availableBatches();
        select.innerHTML = selectableBatches.length
            ? selectableBatches.map(function (batch) {
                return '<option value="' + escapeHtml(batch.id) + '">' + escapeHtml(batch.batch_label || ("Batch " + batch.id)) + "</option>";
            }).join("")
            : '<option value="">No exam batches found</option>';

        if (current && selectableBatches.some(function (batch) { return batch.id === current; })) {
            select.value = current;
        }
    }

    function rowDraftValue(recordId) {
        return Object.prototype.hasOwnProperty.call(resultDrafts, recordId)
            ? normalizeExamResult(resultDrafts[recordId])
            : null;
    }

    function displayedResultValueForRow(row) {
        const draftValue = row && row.id ? rowDraftValue(row.id) : null;
        if (draftValue !== null) {
            return draftValue;
        }
        return normalizeExamResult(row && row.result ? row.result : "pending");
    }

    function setResultDraft(recordId, value) {
        resultDrafts[recordId] = normalizeExamResult(value || "pending");
    }

    function clearResultDraft(recordId) {
        delete resultDrafts[recordId];
    }

    function matchesApplicantSearch(row, query) {
        const normalizedQuery = normalizeSearchText(query);
        if (!normalizedQuery) {
            return true;
        }

        const applicantName = normalizeSearchText(row && row.applicant_name ? row.applicant_name : "");
        const applicationNo = normalizeSearchText(row && row.application_no ? row.application_no : "");
        const email = normalizeSearchText(row && row.applicant_email ? row.applicant_email : "");
        const compactQuery = compactSearchText(normalizedQuery);

        if (applicationNo && (applicationNo.indexOf(normalizedQuery) !== -1 || compactSearchText(applicationNo).indexOf(compactQuery) !== -1)) {
            return true;
        }

        if (email && email.indexOf(normalizedQuery) !== -1) {
            return true;
        }

        if (!applicantName) {
            return false;
        }

        if (applicantName.indexOf(normalizedQuery) !== -1 || compactSearchText(applicantName).indexOf(compactQuery) !== -1) {
            return true;
        }

        const queryTokens = searchTokens(normalizedQuery);
        const applicantNameTokens = searchTokens(applicantName);
        if (!queryTokens.length || !applicantNameTokens.length) {
            return false;
        }

        return queryTokens.every(function (token) {
            return applicantNameTokens.some(function (word) {
                return word.indexOf(token) === 0 || (token.length >= 3 && word.indexOf(token) !== -1);
            });
        });
    }

    function rowsForCurrentView() {
        const wantedResult = currentResultFilter();

        return rankedRowsForBatch(currentBatchId)
            .filter(function (row) {
                if (wantedResult === "all") {
                    return true;
                }
                return displayedResultValueForRow(row) === wantedResult;
            })
            .filter(function (row) {
                return matchesApplicantSearch(row, currentSearchValue());
            });
    }

    function currentBatchSnapshot() {
        return batchRows(currentBatchId).reduce(function (snapshot, row) {
            const result = displayedResultValueForRow(row);
            snapshot.total += 1;
            if (result === "passed") {
                snapshot.passed += 1;
            } else if (result === "failed") {
                snapshot.failed += 1;
            } else {
                snapshot.pending += 1;
            }
            return snapshot;
        }, {
            total: 0,
            passed: 0,
            failed: 0,
            pending: 0
        });
    }

    function pendingChangeCount() {
        return batchRows(currentBatchId).reduce(function (count, row) {
            const savedValue = normalizeExamResult(row.result || "pending");
            return displayedResultValueForRow(row) !== savedValue ? count + 1 : count;
        }, 0);
    }

    function resultOptionsMarkup(selectedValue) {
        const normalized = normalizeExamResult(selectedValue || "pending");
        return [
            '<option value="pending"' + (normalized === "pending" ? " selected" : "") + ">Pending</option>",
            '<option value="passed"' + (normalized === "passed" ? " selected" : "") + ">Passed</option>",
            '<option value="failed"' + (normalized === "failed" ? " selected" : "") + ">Fail</option>"
        ].join("");
    }

    function renderHeaderMeta() {
        const batch = batchById(currentBatchId);
        const snapshot = currentBatchSnapshot();
        const changes = pendingChangeCount();

        setText("secretaryAllPassedBatchName", batch && batch.batch_label ? batch.batch_label : "No batch selected");
        setText(
            "secretaryAllPassedBatchMeta",
            batch
                ? ("Exam Date: " + formatBatchDate(batch.exam_datetime) + " | Venue: " + (batch.venue || "-"))
                : "Select an exam batch with assigned examinees."
        );
        setText("secretaryAllPassedTableMeta", changes
            ? (String(changes) + " unsaved change(s) in this batch.")
            : "Manual passed list is ordered by raw-score rank. Unscored examinees appear after ranked rows.");
    }

    function renderTable() {
        const tbody = byId("secretaryAllPassedTableBody");
        if (!tbody) {
            return;
        }

        if (!currentBatchId) {
            tbody.innerHTML = '<tr><td colspan="9" class="ldss-pass-empty">No exam batch with assigned examinees is ready yet.</td></tr>';
            return;
        }

        const viewRows = rowsForCurrentView();
        if (!viewRows.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="ldss-pass-empty">No examinees matched the selected batch, result view, or search text.</td></tr>';
            return;
        }

        tbody.innerHTML = viewRows.map(function (row, index) {
            const savedResultMeta = normalizeExamResult(row.result || "pending") === "failed" && !hasSavedRawScore(row.raw_score)
                ? { label: "Failed to Take Exam", chipClass: "ldss-chip-danger" }
                : examResultMeta(row.result || "pending");
            const applicationMeta = statusMeta(row.application_status || "");
            const displayedResult = displayedResultValueForRow(row);
            const rankLabel = row.display_rank ? String(row.display_rank) : "-";
            return (
                "<tr>" +
                '<td class="text-center fw-700">' + escapeHtml(rankLabel) + "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.applicant_name || "UNKNOWN APPLICANT") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_email || "-") + "</div>" +
                "</td>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.application_no || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.scholarship_type || "-") + "</div>" +
                "</td>" +
                '<td class="text-center">' + escapeHtml((row.room_label || "-").toString().toUpperCase()) + "</td>" +
                '<td class="text-center">' + escapeHtml(row.room_seat_no == null ? "-" : String(row.room_seat_no)) + "</td>" +
                '<td class="text-center fw-700">' + escapeHtml(formatRawScore(row.raw_score)) + "</td>" +
                '<td class="text-center"><span class="ldss-chip ' + escapeHtml(savedResultMeta.chipClass || "ldss-chip-neutral") + '">' + escapeHtml(savedResultMeta.label || "Pending") + "</span></td>" +
                '<td class="text-center"><span class="ldss-chip ' + escapeHtml(applicationMeta.chipClass || "ldss-chip-neutral") + '">' + escapeHtml(applicationMeta.label || "-") + "</span></td>" +
                '<td><select class="form-select form-select-sm ldss-pass-select" data-all-passed-result="' + escapeHtml(row.id) + '">' + resultOptionsMarkup(displayedResult) + "</select></td>" +
                "</tr>"
            );
        }).join("");
    }

    function syncActionButtons() {
        const saveButton = byId("secretaryAllPassedSaveBtn");
        const refreshButton = byId("secretaryAllPassedRefreshBtn");
        const changes = pendingChangeCount();

        if (saveButton) {
            saveButton.disabled = isSaving || !currentBatchId || changes === 0;
            saveButton.textContent = isSaving ? "Saving..." : "Save Manual Results";
        }
        if (refreshButton) {
            refreshButton.disabled = isSaving;
        }
    }

    function renderAll() {
        fillBatchFilter();
        renderHeaderMeta();
        renderTable();
        syncActionButtons();
    }

    function manualResultChanges() {
        return batchRows(currentBatchId).reduce(function (entries, row) {
            const nextResult = displayedResultValueForRow(row);
            const savedResult = normalizeExamResult(row.result || "pending");
            if (nextResult !== savedResult) {
                entries.push({
                    row: row,
                    result: nextResult
                });
            }
            return entries;
        }, []);
    }

    function deriveApplicationStatusForManualResult(row, resultValue) {
        const current = normalizeStatus(row && row.application_status ? row.application_status : "");
        if (PROTECTED_APPLICATION_STATUSES.has(current)) {
            return current;
        }
        const normalizedResult = normalizeExamResult(resultValue || "pending");
        if (normalizedResult === "passed") {
            return "passed_exam";
        }
        if (normalizedResult === "failed") {
            return "failed_exam";
        }
        return "exam_completed";
    }

    async function saveManualResults() {
        const changes = manualResultChanges();
        if (!changes.length) {
            showStatus("No manual result changes to save.", "alert-info");
            return;
        }

        isSaving = true;
        syncActionButtons();
        showStatus("");

        try {
            for (let index = 0; index < changes.length; index += 1) {
                const entry = changes[index];

                const examResult = await context.client
                    .from("exam_records")
                    .update({ result: entry.result })
                    .eq("id", entry.row.id)
                    .eq("application_id", entry.row.application_id);

                if (examResult.error) {
                    throw new Error("Failed to save manual result for " + (entry.row.application_no || "selected applicant") + ": " + examResult.error.message);
                }

                const targetStatus = deriveApplicationStatusForManualResult(entry.row, entry.result);
                if (normalizeStatus(entry.row.application_status || "") !== normalizeStatus(targetStatus)) {
                    const applicationResult = await context.client
                        .from("applications")
                        .update({
                            status: targetStatus,
                            secretary_reviewer_id: context.user.id
                        })
                        .eq("id", entry.row.application_id);

                    if (applicationResult.error) {
                        throw new Error("Saved manual result for " + (entry.row.application_no || "selected applicant") + " but application status update failed: " + applicationResult.error.message);
                    }
                }
            }

            resultDrafts = {};
            await fetchData(currentBatchId);
            showStatus(String(changes.length) + " manual result(s) saved successfully.", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to save manual results.", "alert-danger");
        } finally {
            isSaving = false;
            syncActionButtons();
        }
    }

    async function fetchData(preferredBatchId) {
        showStatus("");

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
                application_status: application ? application.status : "",
                scholarship_type: application ? application.scholarship_type : "",
                applicant_name: buildApplicantName(profile),
                applicant_email: profile ? (profile.email || "") : "",
                applicant_contact: profile ? (profile.mobile_number || "") : "",
                school_name: profile ? (profile.school_name || "") : "",
                batch_id: row.batch_id || "",
                exam_control_no: row.exam_control_no || "",
                scheduled_at: row.scheduled_at || "",
                room_label: row.room_label || "",
                room_seat_no: row.room_seat_no == null ? null : Number(row.room_seat_no),
                raw_score: row.raw_score,
                percentage_score: row.percentage_score,
                result: row.result || "pending",
                record_status: row.status || "scheduled",
                updated_at: row.updated_at || ""
            };
        });
        resultDrafts = {};

        resolveSelection(preferredBatchId);
        renderAll();

        if (!rows.length) {
            showStatus("No assigned exam records were found yet. Open Room Assignment first, then return here to mark passed applicants manually.", "alert-info");
        }
    }

    function bindEvents() {
        const batchFilter = byId("secretaryAllPassedBatchFilter");
        const resultFilter = byId("secretaryAllPassedResultFilter");
        const searchInput = byId("secretaryAllPassedSearchInput");
        const searchClearButton = byId("secretaryAllPassedSearchClearBtn");
        const refreshButton = byId("secretaryAllPassedRefreshBtn");
        const saveButton = byId("secretaryAllPassedSaveBtn");
        const tableBody = byId("secretaryAllPassedTableBody");

        if (batchFilter) {
            batchFilter.addEventListener("change", function () {
                currentBatchId = batchFilter.value || "";
                renderAll();
            });
        }

        if (resultFilter) {
            resultFilter.addEventListener("change", function () {
                renderAll();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", function () {
                currentSearchQuery = searchInput.value || "";
                renderTable();
            });
        }

        if (searchClearButton) {
            searchClearButton.addEventListener("click", function () {
                currentSearchQuery = "";
                if (searchInput) {
                    searchInput.value = "";
                    searchInput.focus();
                }
                renderTable();
            });
        }

        if (refreshButton) {
            refreshButton.addEventListener("click", function () {
                fetchData(currentBatchId).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh manual passed data.", "alert-danger");
                });
            });
        }

        if (saveButton) {
            saveButton.addEventListener("click", function () {
                saveManualResults();
            });
        }

        if (tableBody) {
            tableBody.addEventListener("change", function (event) {
                const select = event.target.closest("[data-all-passed-result]");
                if (!select) {
                    return;
                }
                const recordId = select.getAttribute("data-all-passed-result") || "";
                const row = rows.find(function (entry) {
                    return entry.id === recordId;
                });
                const nextValue = normalizeExamResult(select.value || "pending");
                const savedValue = normalizeExamResult(row && row.result ? row.result : "pending");
                if (!recordId) {
                    return;
                }
                if (nextValue === savedValue) {
                    clearResultDraft(recordId);
                } else {
                    setResultDraft(recordId, nextValue);
                }
                renderAll();
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
            await fetchData("");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load manual passed page.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
