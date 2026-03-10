(function () {
    "use strict";

    const ASSIGNABLE_STATUSES = ["submitted", "pending_exam", "exam_scheduled", "exam_completed"];

    let context = null;
    let applications = [];
    let batches = [];
    let examRecordByApplication = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) { return (status || "").toString().trim().toLowerCase(); },
            statusMeta: function (status) { return { label: status || "-", chipClass: "ldss-chip-neutral" }; }
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
        const box = byId("secretaryExamBatchStatus");
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

    function normalizeApplicationStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
    }

    function latestByApplication(rows) {
        const map = {};
        (rows || []).forEach(function (row) {
            const appId = row.application_id;
            if (!appId) {
                return;
            }
            const existing = map[appId];
            if (!existing) {
                map[appId] = row;
                return;
            }
            const a = new Date(existing.updated_at || existing.created_at || 0).getTime();
            const b = new Date(row.updated_at || row.created_at || 0).getTime();
            if (b > a) {
                map[appId] = row;
            }
        });
        return map;
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

    function renderKpis() {
        const pending = applications.filter(function (row) {
            const normalized = normalizeApplicationStatus(row.status);
            return normalized === "submitted" || normalized === "pending_exam";
        }).length;

        const scheduled = applications.filter(function (row) {
            return normalizeApplicationStatus(row.status) === "exam_scheduled";
        }).length;

        const completed = applications.filter(function (row) {
            return normalizeApplicationStatus(row.status) === "exam_completed";
        }).length;

        const encoded = applications.filter(function (row) {
            const normalized = normalizeApplicationStatus(row.status);
            return normalized === "passed_exam" || normalized === "failed_exam";
        }).length;

        const pendingEl = byId("examKpiPending");
        const scheduledEl = byId("examKpiScheduled");
        const completedEl = byId("examKpiCompleted");
        const encodedEl = byId("examKpiEncoded");

        if (pendingEl) {
            pendingEl.textContent = String(pending);
        }
        if (scheduledEl) {
            scheduledEl.textContent = String(scheduled);
        }
        if (completedEl) {
            completedEl.textContent = String(completed);
        }
        if (encodedEl) {
            encodedEl.textContent = String(encoded);
        }
    }

    function renderBatchSelect() {
        const select = byId("examBatchAssignSelect");
        if (!select) {
            return;
        }

        const current = select.value;
        select.innerHTML = '<option value="">Select batch</option>';

        batches.forEach(function (batch) {
            const option = document.createElement("option");
            option.value = batch.id;
            option.textContent = batch.batch_label || ("Batch " + batch.id);
            select.appendChild(option);
        });

        if (current && batches.some(function (row) { return row.id === current; })) {
            select.value = current;
        }
    }

    function renderBatchTable() {
        const tbody = byId("examBatchTableBody");
        if (!tbody) {
            return;
        }

        if (!batches.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No exam batches yet.</td></tr>';
            return;
        }

        tbody.innerHTML = batches.map(function (batch) {
            const batchStatus = (batch.status || "open").toString().replace(/_/g, " ");
            return (
                "<tr>" +
                "<td>" + escapeHtml(batch.batch_label || "-") + "</td>" +
                "<td>" + escapeHtml(formatDateTime(batch.exam_datetime)) + "</td>" +
                "<td>" + escapeHtml(batch.venue || "-") + "</td>" +
                "<td>" + escapeHtml(batchStatus) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function filteredAssignableRows() {
        const search = (byId("examBatchSearchInput") ? byId("examBatchSearchInput").value : "").toLowerCase().trim();

        return applications
            .filter(function (row) {
                return ASSIGNABLE_STATUSES.includes(normalizeApplicationStatus(row.status));
            })
            .filter(function (row) {
                if (!search) {
                    return true;
                }
                const summary = [
                    row.application_no || "",
                    row.applicant_name || "",
                    row.contact || "",
                    row.school_year || "",
                    row.scholarship_type || ""
                ].join(" ").toLowerCase();
                return summary.includes(search);
            });
    }

    function renderAssignableTable() {
        const tbody = byId("examAssignApplicantsBody");
        if (!tbody) {
            return;
        }

        const rows = filteredAssignableRows();
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No applicants match current criteria.</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const normalized = normalizeApplicationStatus(row.status);
            const meta = statusMeta(normalized);
            const examRecord = examRecordByApplication[row.id] || null;
            return (
                "<tr>" +
                '<td><input type="checkbox" data-assign-app="' + escapeHtml(row.id) + '" /></td>' +
                "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                "<td>" + escapeHtml(row.applicant_name || "Unknown") + "</td>" +
                '<td><span class="ldss-chip ' + meta.chipClass + '">' + escapeHtml(meta.label) + "</span></td>" +
                "<td>" + escapeHtml((examRecord && examRecord.exam_control_no) || "-") + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    async function fetchExamBatches() {
        const result = await context.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at")
            .order("exam_datetime", { ascending: false });

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                showStatus("Exam batches table is not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
                return [];
            }
            throw new Error("Failed to load exam batches: " + result.error.message);
        }

        return result.data || [];
    }

    async function fetchApplicationsWithProfiles() {
        const appResult = await context.client
            .from("applications")
            .select("id, application_no, applicant_id, scholarship_type, school_year, status, submitted_at, created_at, updated_at")
            .neq("status", "draft")
            .order("updated_at", { ascending: false });

        if (appResult.error) {
            throw new Error("Failed to load applications: " + appResult.error.message);
        }

        const rows = appResult.data || [];
        const applicantIds = Array.from(new Set(rows.map(function (row) { return row.applicant_id; }).filter(Boolean)));
        const profileMap = {};

        if (applicantIds.length > 0) {
            const profileResult = await context.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, mobile_number")
                .in("id", applicantIds);

            if (!profileResult.error && profileResult.data) {
                profileResult.data.forEach(function (profile) {
                    profileMap[profile.id] = profile;
                });
            }
        }

        return rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return Object.assign({}, row, {
                applicant_name: buildApplicantName(profile),
                contact: profile ? (profile.mobile_number || profile.email || "-") : "-"
            });
        });
    }

    async function fetchExamRecords(applicationIds) {
        if (!applicationIds.length) {
            return {};
        }

        const result = await context.client
            .from("exam_records")
            .select("id, application_id, batch_id, exam_control_no, raw_score, percentage_score, result, status, created_at, updated_at")
            .in("application_id", applicationIds);

        if (result.error) {
            if (/does not exist|relation/i.test(result.error.message || "")) {
                return {};
            }
            throw new Error("Failed to load exam records: " + result.error.message);
        }

        return latestByApplication(result.data || []);
    }

    async function loadPageData() {
        showStatus("");

        const loaded = await Promise.all([
            fetchExamBatches(),
            fetchApplicationsWithProfiles()
        ]);

        batches = loaded[0];
        applications = loaded[1];

        const appIds = applications.map(function (row) { return row.id; }).filter(Boolean);
        examRecordByApplication = await fetchExamRecords(appIds);

        renderKpis();
        renderBatchTable();
        renderBatchSelect();
        renderAssignableTable();
    }

    async function createBatch() {
        const label = byId("examBatchLabel") ? byId("examBatchLabel").value.trim() : "";
        const dateTimeRaw = byId("examBatchDateTime") ? byId("examBatchDateTime").value : "";
        const venue = byId("examBatchVenue") ? byId("examBatchVenue").value.trim() : "";
        const capacityRaw = byId("examBatchCapacity") ? byId("examBatchCapacity").value.trim() : "";
        const notes = byId("examBatchNotes") ? byId("examBatchNotes").value.trim() : "";

        if (!label) {
            showStatus("Batch label is required.", "alert-warning");
            return;
        }
        if (!dateTimeRaw) {
            showStatus("Exam schedule date/time is required.", "alert-warning");
            return;
        }
        if (!venue) {
            showStatus("Venue is required.", "alert-warning");
            return;
        }

        const dateTime = new Date(dateTimeRaw);
        if (Number.isNaN(dateTime.getTime())) {
            showStatus("Exam schedule date/time is invalid.", "alert-warning");
            return;
        }

        const capacity = capacityRaw ? Number(capacityRaw) : null;
        if (capacity !== null && (Number.isNaN(capacity) || capacity <= 0)) {
            showStatus("Capacity must be a positive number.", "alert-warning");
            return;
        }

        const createBtn = byId("examBatchCreateBtn");
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = "Creating...";
        }

        try {
            const payload = {
                batch_label: label,
                exam_datetime: dateTime.toISOString(),
                venue: venue,
                capacity: capacity,
                notes: notes || null,
                status: "open",
                created_by: context.user.id
            };

            // TODO(Supabase): add staff ownership + audit fields if needed by policy.
            const result = await context.client
                .from("exam_batches")
                .insert(payload);

            if (result.error) {
                throw new Error(result.error.message);
            }

            showStatus("Exam batch created successfully.", "alert-success");
            await loadPageData();

            if (byId("examBatchLabel")) {
                byId("examBatchLabel").value = "";
            }
            if (byId("examBatchDateTime")) {
                byId("examBatchDateTime").value = "";
            }
            if (byId("examBatchVenue")) {
                byId("examBatchVenue").value = "";
            }
            if (byId("examBatchCapacity")) {
                byId("examBatchCapacity").value = "";
            }
            if (byId("examBatchNotes")) {
                byId("examBatchNotes").value = "";
            }
        } catch (error) {
            showStatus("Failed to create exam batch: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = "Create Batch";
            }
        }
    }

    function selectedApplicantIds() {
        return Array.from(document.querySelectorAll("#examAssignApplicantsBody [data-assign-app]:checked"))
            .map(function (el) { return el.getAttribute("data-assign-app") || ""; })
            .filter(Boolean);
    }

    async function assignSelectedApplicants() {
        const selectedBatchId = byId("examBatchAssignSelect") ? byId("examBatchAssignSelect").value : "";
        const seedRaw = byId("examBatchControlSeed") ? byId("examBatchControlSeed").value.trim() : "";
        const selectedAppIds = selectedApplicantIds();

        if (!selectedBatchId) {
            showStatus("Select a target batch first.", "alert-warning");
            return;
        }
        if (!selectedAppIds.length) {
            showStatus("Select at least one applicant record.", "alert-warning");
            return;
        }

        let seed = seedRaw ? Number(seedRaw) : null;
        if (seedRaw && (Number.isNaN(seed) || seed <= 0)) {
            showStatus("Control number start must be a positive number.", "alert-warning");
            return;
        }

        const selectedBatch = batches.find(function (row) { return row.id === selectedBatchId; }) || null;
        if (!selectedBatch) {
            showStatus("Selected batch was not found. Refresh and try again.", "alert-warning");
            return;
        }

        const assignBtn = byId("examBatchAssignBtn");
        if (assignBtn) {
            assignBtn.disabled = true;
            assignBtn.textContent = "Assigning...";
        }

        let successCount = 0;
        let failCount = 0;

        try {
            for (let i = 0; i < selectedAppIds.length; i += 1) {
                const appId = selectedAppIds[i];
                const existing = examRecordByApplication[appId] || null;

                let controlNo = existing && existing.exam_control_no ? existing.exam_control_no : null;
                if (!controlNo && seed !== null) {
                    controlNo = "EX-" + String(seed);
                    seed += 1;
                }

                const examPayload = {
                    application_id: appId,
                    batch_id: selectedBatch.id,
                    exam_control_no: controlNo,
                    scheduled_at: selectedBatch.exam_datetime,
                    status: "scheduled",
                    encoded_by: context.user.id
                };

                const upsertResult = await context.client
                    .from("exam_records")
                    .upsert(examPayload, { onConflict: "application_id" });

                if (upsertResult.error) {
                    failCount += 1;
                    continue;
                }

                const appUpdate = await context.client
                    .from("applications")
                    .update({
                        status: "exam_scheduled",
                        secretary_reviewer_id: context.user.id
                    })
                    .eq("id", appId);

                if (appUpdate.error) {
                    failCount += 1;
                    continue;
                }

                // TODO(Supabase): add richer notification templates.
                await context.client
                    .from("notifications")
                    .insert({
                        recipient_user_id: applications.find(function (row) { return row.id === appId; }).applicant_id,
                        sender_user_id: context.user.id,
                        notification_type: "application",
                        title: "Exam Scheduled",
                        message: "Your scholarship exam has been scheduled. Please check your application tracking page.",
                        related_application_id: appId,
                        related_url: "application-detail.html?id=" + encodeURIComponent(appId)
                    });

                successCount += 1;
            }

            await loadPageData();
            if (failCount > 0) {
                showStatus("Assigned " + successCount + " applicant(s). " + failCount + " record(s) failed.", "alert-warning");
            } else {
                showStatus("Assigned " + successCount + " applicant(s) to exam batch.", "alert-success");
            }
        } catch (error) {
            showStatus("Failed to assign applicants: " + (error.message || "Unknown error"), "alert-danger");
        } finally {
            if (assignBtn) {
                assignBtn.disabled = false;
                assignBtn.textContent = "Assign Selected to Batch";
            }
        }
    }

    function bindEvents() {
        const createBtn = byId("examBatchCreateBtn");
        const assignBtn = byId("examBatchAssignBtn");
        const searchInput = byId("examBatchSearchInput");
        const toggleAll = byId("examAssignToggleAll");

        if (createBtn) {
            createBtn.addEventListener("click", function () {
                createBatch();
            });
        }

        if (assignBtn) {
            assignBtn.addEventListener("click", function () {
                assignSelectedApplicants();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", function () {
                renderAssignableTable();
            });
        }

        if (toggleAll) {
            toggleAll.addEventListener("change", function () {
                const checked = !!toggleAll.checked;
                document.querySelectorAll("#examAssignApplicantsBody [data-assign-app]").forEach(function (checkbox) {
                    checkbox.checked = checked;
                });
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
            await loadPageData();
        } catch (error) {
            showStatus(error.message || "Failed to load exam management page.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
