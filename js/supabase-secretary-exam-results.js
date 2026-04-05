(function () {
    "use strict";

    const SUPABASE_FETCH_LIMIT = 1000;
    const LOOKUP_BATCH_SIZE = 200;

    let context = null;
    let rows = [];
    let batches = [];

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
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
                const key = (value || "pending").toString();
                if (key === "passed") {
                    return { label: "Passed", chipClass: "ldss-chip-success" };
                }
                if (key === "failed") {
                    return { label: "Failed", chipClass: "ldss-chip-danger" };
                }
                return { label: "Pending", chipClass: "ldss-chip-neutral" };
            }
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

    function showStatus(message, type) {
        const box = byId("secretaryExamResultStatus");
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

    function formatDateTime(value) {
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

    async function fetchExamRowsPaged() {
        const examRows = [];
        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const examResult = await context.client
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, raw_score, percentage_score, result, status, updated_at")
                .order("scheduled_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (examResult.error) {
                throw new Error("Failed to load exam records: " + examResult.error.message);
            }

            const batch = examResult.data || [];
            examRows.push.apply(examRows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }
        return examRows;
    }

    async function loadApplicationsByIds(applicationIds) {
        const map = {};
        const wantedIds = Array.from(new Set((applicationIds || []).filter(Boolean)));
        for (let start = 0; start < wantedIds.length; start += LOOKUP_BATCH_SIZE) {
            const chunk = wantedIds.slice(start, start + LOOKUP_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }
            const appResult = await context.client
                .from("applications")
                .select("id, application_no, applicant_id, status")
                .in("id", chunk);

            if (appResult.error) {
                throw new Error("Failed to load linked applications: " + appResult.error.message);
            }

            (appResult.data || []).forEach(function (row) {
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
            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email")
                .in("id", chunk);

            if (profileResult.error) {
                throw new Error("Failed to load applicant profiles: " + profileResult.error.message);
            }

            (profileResult.data || []).forEach(function (profile) {
                map[profile.id] = profile;
            });
        }
        return map;
    }

    function fillBatchFilter() {
        const select = byId("examResultBatchFilter");
        if (!select) {
            return;
        }
        const current = select.value;
        select.innerHTML = '<option value="all">All</option>';

        batches.forEach(function (batch) {
            const option = document.createElement("option");
            option.value = batch.id;
            option.textContent = batch.batch_label || ("Batch " + batch.id);
            select.appendChild(option);
        });

        if (current && batches.some(function (batch) { return batch.id === current; })) {
            select.value = current;
        }
    }

    function stateLabel(value) {
        const key = (value || "").toString().toLowerCase();
        if (key === "scheduled") {
            return "Exam Scheduled";
        }
        if (key === "completed") {
            return "Exam Completed";
        }
        if (key === "encoded") {
            return "Encoded";
        }
        return key ? key.replace(/_/g, " ") : "-";
    }

    function filteredRows() {
        const search = (byId("examResultSearchInput") ? byId("examResultSearchInput").value : "").toLowerCase().trim();
        const batch = byId("examResultBatchFilter") ? byId("examResultBatchFilter").value : "all";
        const state = byId("examResultStateFilter") ? byId("examResultStateFilter").value : "all";

        return rows.filter(function (row) {
            const summary = [
                row.application_no || "",
                row.applicant_name || "",
                row.exam_control_no || "",
                row.batch_label || ""
            ].join(" ").toLowerCase();

            const matchesSearch = !search || summary.includes(search);
            const matchesBatch = batch === "all" || row.batch_id === batch;
            const matchesState = state === "all" || (row.record_status || "").toLowerCase() === state;

            return matchesSearch && matchesBatch && matchesState;
        });
    }

    function renderTable() {
        const tbody = byId("examResultTableBody");
        if (!tbody) {
            return;
        }

        const records = filteredRows();
        if (!records.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No exam records found for current filters.</td></tr>';
            return;
        }

        tbody.innerHTML = records.map(function (row) {
            const status = workflow().statusMeta(row.application_status || "");
            const resultMeta = workflow().examResultMeta(workflow().normalizeExamResult(row.result || "pending"));

            return (
                "<tr>" +
                "<td>" +
                '<div class="fw-700">' + escapeHtml(row.application_no || "-") + "</div>" +
                '<div class="small text-muted">' + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div>" +
                '<div class="small mt-1"><span class="ldss-chip ' + status.chipClass + '">' + escapeHtml(status.label) + "</span></div>" +
                "</td>" +
                "<td>" + escapeHtml(row.batch_label || "-") + "<div class=\"small text-muted\">" + escapeHtml(formatDateTime(row.scheduled_at)) + "</div></td>" +
                "<td>" + escapeHtml(row.exam_control_no || "-") + "</td>" +
                '<td><input class="form-control form-control-sm" type="number" min="0" step="0.01" data-field="raw_score" data-record-id="' + escapeHtml(row.id) + '" value="' + escapeHtml(row.raw_score == null ? "" : String(row.raw_score)) + '" /></td>' +
                '<td><input class="form-control form-control-sm" type="number" min="0" max="100" step="0.01" data-field="percentage_score" data-record-id="' + escapeHtml(row.id) + '" value="' + escapeHtml(row.percentage_score == null ? "" : String(row.percentage_score)) + '" /></td>' +
                '<td>' +
                '<select class="form-select form-select-sm" data-field="result" data-record-id="' + escapeHtml(row.id) + '">' +
                '<option value="pending"' + (workflow().normalizeExamResult(row.result) === "pending" ? " selected" : "") + '>Pending</option>' +
                '<option value="passed"' + (workflow().normalizeExamResult(row.result) === "passed" ? " selected" : "") + '>Passed</option>' +
                '<option value="failed"' + (workflow().normalizeExamResult(row.result) === "failed" ? " selected" : "") + '>Failed</option>' +
                "</select>" +
                '<div class="mt-1"><span class="ldss-chip ' + resultMeta.chipClass + '">' + escapeHtml(resultMeta.label) + "</span></div>" +
                "</td>" +
                '<td><button class="btn btn-dark btn-sm" type="button" data-action="save-result" data-record-id="' + escapeHtml(row.id) + '">Save</button>' +
                '<div class="small text-muted mt-1">' + escapeHtml(stateLabel(row.record_status)) + "</div></td>" +
                "</tr>"
            );
        }).join("");
    }

    function getRowByRecordId(recordId) {
        return rows.find(function (row) {
            return row.id === recordId;
        }) || null;
    }

    function getFieldValue(recordId, field) {
        const input = document.querySelector('[data-field="' + field + '"][data-record-id="' + recordId + '"]');
        if (!input) {
            return "";
        }
        return input.value;
    }

    async function fetchData() {
        showStatus("");

        const batchResult = await context.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime")
            .order("exam_datetime", { ascending: false });

        if (batchResult.error) {
            if (/does not exist|relation/i.test(batchResult.error.message || "")) {
                showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                batches = [];
                rows = [];
                fillBatchFilter();
                renderTable();
                return;
            }
            throw new Error("Failed to load exam batches: " + batchResult.error.message);
        }

        batches = batchResult.data || [];

        const examRows = await fetchExamRowsPaged();
        const applicationIds = Array.from(new Set(examRows.map(function (row) { return row.application_id; }).filter(Boolean)));

        const appMap = applicationIds.length ? await loadApplicationsByIds(applicationIds) : {};
        const applicantIds = Array.from(new Set(Object.keys(appMap).map(function (applicationId) {
            const row = appMap[applicationId];
            return row ? row.applicant_id : "";
        }).filter(Boolean)));
        const profileMap = applicantIds.length ? await loadProfilesByIds(applicantIds) : {};

        const batchMap = {};
        batches.forEach(function (batch) {
            batchMap[batch.id] = batch;
        });

        rows = examRows.map(function (row) {
            const app = appMap[row.application_id] || null;
            const profile = app ? (profileMap[app.applicant_id] || null) : null;
            const batch = row.batch_id ? (batchMap[row.batch_id] || null) : null;
            return {
                id: row.id,
                application_id: row.application_id,
                application_no: app ? app.application_no : "-",
                application_status: app ? app.status : "-",
                applicant_id: app ? app.applicant_id : null,
                applicant_name: buildApplicantName(profile),
                batch_id: row.batch_id || null,
                batch_label: batch ? batch.batch_label : "-",
                scheduled_at: row.scheduled_at || (batch ? batch.exam_datetime : null),
                exam_control_no: row.exam_control_no || null,
                raw_score: row.raw_score,
                percentage_score: row.percentage_score,
                result: row.result || "pending",
                record_status: row.status || "scheduled"
            };
        });

        fillBatchFilter();
        renderTable();
    }

    async function saveResult(recordId, button) {
        const row = getRowByRecordId(recordId);
        if (!row) {
            showStatus("Selected exam record was not found.", "alert-warning");
            return;
        }

        const rawRawScore = getFieldValue(recordId, "raw_score").trim();
        const rawPercentage = getFieldValue(recordId, "percentage_score").trim();
        const rawResult = getFieldValue(recordId, "result").trim();

        const rawScore = rawRawScore === "" ? null : Number(rawRawScore);
        const percentage = rawPercentage === "" ? null : Number(rawPercentage);
        const result = workflow().normalizeExamResult(rawResult || "pending");

        if (rawScore !== null && (Number.isNaN(rawScore) || rawScore < 0)) {
            showStatus("Raw score must be a valid non-negative number.", "alert-warning");
            return;
        }

        if (percentage !== null && (Number.isNaN(percentage) || percentage < 0 || percentage > 100)) {
            showStatus("Percentage must be between 0 and 100.", "alert-warning");
            return;
        }

        if (result !== "pending" && (rawScore === null || percentage === null)) {
            showStatus("Raw score and percentage are required before setting Passed/Failed.", "alert-warning");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Saving...";
        }

        try {
            const updatePayload = {
                raw_score: rawScore,
                percentage_score: percentage,
                result: result,
                status: result === "pending" ? "completed" : "encoded",
                encoded_by: context.user.id
            };

            // TODO(Supabase): keep exam_records as source-of-truth for exam outcomes.
            const updateResult = await context.client
                .from("exam_records")
                .update(updatePayload)
                .eq("id", recordId)
                .eq("application_id", row.application_id);

            if (updateResult.error) {
                throw new Error(updateResult.error.message);
            }

            let nextStatus = "exam_completed";
            if (result === "passed") {
                nextStatus = "passed_exam";
            } else if (result === "failed") {
                nextStatus = "failed_exam";
            }

            const appUpdate = await context.client
                .from("applications")
                .update({
                    status: nextStatus,
                    secretary_reviewer_id: context.user.id
                })
                .eq("id", row.application_id);

            if (appUpdate.error) {
                throw new Error("Exam updated but application status update failed: " + appUpdate.error.message);
            }

            if (row.applicant_id) {
                // TODO(Supabase): move notification message templates to system settings.
                await context.client
                    .from("notifications")
                    .insert({
                        recipient_user_id: row.applicant_id,
                        sender_user_id: context.user.id,
                        notification_type: "application",
                        title: "Exam Result Updated",
                        message: result === "pending"
                            ? "Your exam record was updated and is awaiting final result."
                            : ("Your exam result is now available: " + result.toUpperCase() + "."),
                        related_application_id: row.application_id,
                        related_url: "application-detail.html?id=" + encodeURIComponent(row.application_id)
                    });
            }

            await fetchData();
            showStatus("Exam result saved successfully.", "alert-success");
        } catch (error) {
            showStatus("Failed to save exam result: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Save";
            }
        }
    }

    function bindEvents() {
        const applyBtn = byId("examResultApplyFilterBtn");
        const search = byId("examResultSearchInput");
        const batch = byId("examResultBatchFilter");
        const state = byId("examResultStateFilter");
        const table = byId("examResultTableBody");

        if (applyBtn) {
            applyBtn.addEventListener("click", function () {
                renderTable();
            });
        }

        if (search) {
            search.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    renderTable();
                }
            });
        }

        if (batch) {
            batch.addEventListener("change", function () {
                renderTable();
            });
        }

        if (state) {
            state.addEventListener("change", function () {
                renderTable();
            });
        }

        if (table) {
            table.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-action='save-result']");
                if (!trigger) {
                    return;
                }
                const recordId = trigger.getAttribute("data-record-id") || "";
                if (!recordId) {
                    return;
                }
                saveResult(recordId, trigger);
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
            await fetchData();
        } catch (error) {
            showStatus(error.message || "Failed to load exam result encoding page.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
