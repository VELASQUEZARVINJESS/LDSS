(function () {
    "use strict";

    const PROFILE_BATCH_SIZE = 200;
    const SUPABASE_FETCH_LIMIT = 1000;
    const EXAM_SCOPE_STATUSES = ["pending_exam", "exam_scheduled", "exam_completed", "passed_exam", "failed_exam"];
    const LOCKED_RECORD_STATUS = "scheduled";

    let authContext = null;
    let applications = [];
    let batches = [];
    let examRecords = [];
    let selectedApplicationIds = new Set();
    let currentBatchId = "";
    let roomHotfixAvailable = true;
    let returnConfirmModalInstance = null;
    let returnConfirmResolver = null;

    function byId(id) {
        return document.getElementById(id);
    }

    function getReturnConfirmModal() {
        if (!returnConfirmModalInstance) {
            const modalEl = byId("examManagementReturnConfirmModal");
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                returnConfirmModalInstance = new window.bootstrap.Modal(modalEl);
            }
        }
        return returnConfirmModalInstance;
    }

    function workflow() {
        return window.LDSS_WORKFLOW || {
            normalizeStatus: function (status) {
                return (status || "").toString().trim().toLowerCase();
            },
            statusMeta: function (status) {
                return { label: (status || "-").toString(), chipClass: "ldss-chip-neutral" };
            }
        };
    }

    function normalizeStatus(status) {
        return workflow().normalizeStatus(status || "");
    }

    function statusMeta(status) {
        return workflow().statusMeta(status || "");
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
        const box = byId("examManagementStatus");
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
        return parsed.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function formatDateTimeLocalValue(value) {
        if (!value) {
            return "";
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "";
        }
        const offsetMs = parsed.getTimezoneOffset() * 60000;
        return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
    }

    function datetimeLocalToIso(value) {
        const parsed = new Date((value || "").toString().trim());
        return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
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

    function appById(applicationId) {
        for (let index = 0; index < applications.length; index += 1) {
            if (applications[index].id === applicationId) {
                return applications[index];
            }
        }
        return null;
    }

    function batchById(batchId) {
        for (let index = 0; index < batches.length; index += 1) {
            if (batches[index].id === batchId) {
                return batches[index];
            }
        }
        return null;
    }

    function batchRecords(batchId) {
        return (batchId ? examRecords.filter(function (record) { return record.batch_id === batchId; }) : []);
    }

    function batchMembers(batchId) {
        const members = new Set();
        batchRecords(batchId).forEach(function (record) {
            if (record.application_id) {
                members.add(record.application_id);
            }
        });
        return members;
    }

    function roomCountForBatch(batchId) {
        const labels = new Set();
        batchRecords(batchId).forEach(function (record) {
            if (record.room_label) {
                labels.add(record.room_label);
            }
        });
        return labels.size;
    }

    function roomPrefixForBatch(batchId) {
        const rows = batchRecords(batchId);
        for (let index = 0; index < rows.length; index += 1) {
            const label = (rows[index].room_label || "").toString().trim();
            const match = label.match(/^(.*?)(\s+\d+)$/);
            if (match && match[1].trim()) {
                return match[1].trim();
            }
        }
        return "Room";
    }

    function controlStartForBatch(batchId) {
        let min = Number.POSITIVE_INFINITY;
        batchRecords(batchId).forEach(function (record) {
            const numeric = Number((record.exam_control_no || "").toString().trim());
            if (!Number.isNaN(numeric) && numeric < min) {
                min = numeric;
            }
        });
        return Number.isFinite(min) ? min : 1001;
    }

    function selectableRow(row) {
        if (!currentBatchId) {
            return true;
        }
        const record = batchRecords(currentBatchId).find(function (item) {
            return item.application_id === row.id;
        }) || null;
        return !(record && normalizeStatus(record.status) !== LOCKED_RECORD_STATUS);
    }

    function eligibleRows() {
        const search = (byId("examManagementSearchInput") ? byId("examManagementSearchInput").value : "").toLowerCase().trim();
        const currentBatchMembers = batchMembers(currentBatchId);
        return applications.filter(function (row) {
            const normalized = normalizeStatus(row.status);
            const eligible = normalized === "pending_exam" || currentBatchMembers.has(row.id);
            if (!eligible) {
                return false;
            }
            if (!search) {
                return true;
            }
            const haystack = [row.application_no || "", row.applicant_name || "", row.school_name || "", row.email || ""].join(" ").toLowerCase();
            return haystack.includes(search);
        });
    }

    function allSelectableEligibleRows() {
        const currentBatchMembers = batchMembers(currentBatchId);
        return applications.filter(function (row) {
            const normalized = normalizeStatus(row.status);
            const eligible = normalized === "pending_exam" || currentBatchMembers.has(row.id);
            return eligible && selectableRow(row);
        });
    }

    function visibleSelectableRows() {
        return eligibleRows().filter(selectableRow);
    }

    function selectedSelectableRows() {
        return applications.filter(function (row) {
            return selectedApplicationIds.has(row.id) && selectableRow(row);
        });
    }

    function examRecordsForApplications(applicationIds) {
        const wanted = new Set((applicationIds || []).filter(Boolean));
        return examRecords.filter(function (record) {
            return wanted.has(record.application_id);
        });
    }

    function resetSelectionToEligible() {
        selectedApplicationIds = new Set();
        const existingMembers = batchMembers(currentBatchId);
        const selectable = allSelectableEligibleRows();
        const defaultRows = currentBatchId && existingMembers.size
            ? selectable.filter(function (row) { return existingMembers.has(row.id); })
            : selectable;

        defaultRows.forEach(function (row) {
            selectedApplicationIds.add(row.id);
        });
    }

    function writeInput(id, value) {
        const input = byId(id);
        if (input) {
            input.value = value == null ? "" : String(value);
        }
    }

    function applyBatchForm(batchId) {
        const batch = batchById(batchId);
        if (!batch) {
            writeInput("examBatchLabel", "");
            writeInput("examBatchDateTime", "");
            writeInput("examBatchVenue", "");
            writeInput("examBatchNotes", "");
            writeInput("examRoomCount", 1);
            writeInput("examBatchControlStart", 1001);
            writeInput("examRoomPrefix", "Room");
            return;
        }

        writeInput("examBatchLabel", batch.batch_label || "");
        writeInput("examBatchDateTime", formatDateTimeLocalValue(batch.exam_datetime || ""));
        writeInput("examBatchVenue", batch.venue || "");
        writeInput("examBatchNotes", batch.notes || "");
        writeInput("examRoomCount", roomCountForBatch(batch.id) || 1);
        writeInput("examBatchControlStart", controlStartForBatch(batch.id));
        writeInput("examRoomPrefix", roomPrefixForBatch(batch.id));
    }

    function renderBatchSelect() {
        const select = byId("examBatchSelect");
        if (!select) {
            return;
        }
        select.innerHTML = '<option value="">Create new batch</option>';
        batches.forEach(function (batch) {
            const option = document.createElement("option");
            option.value = batch.id;
            option.textContent = batch.batch_label || ("Batch " + batch.id);
            select.appendChild(option);
        });
        select.value = currentBatchId || "";
    }

    function renderMetrics() {
        const pending = applications.filter(function (row) { return normalizeStatus(row.status) === "pending_exam"; }).length;
        const scheduled = applications.filter(function (row) { return normalizeStatus(row.status) === "exam_scheduled"; }).length;
        const pendingEl = byId("examManagementPendingCount");
        const scheduledEl = byId("examManagementScheduledCount");
        const selectedEl = byId("examManagementSelectedCount");
        const roomsEl = byId("examManagementRoomsUsedCount");

        if (pendingEl) {
            pendingEl.textContent = String(pending);
        }
        if (scheduledEl) {
            scheduledEl.textContent = String(scheduled);
        }
        if (selectedEl) {
            selectedEl.textContent = String(selectedApplicationIds.size);
        }
        if (roomsEl) {
            roomsEl.textContent = String(currentBatchId ? roomCountForBatch(currentBatchId) : 0);
        }
    }

    function renderEligibleTable() {
        const tbody = byId("examManagementEligibleTableBody");
        const headerCheckbox = byId("examManagementSelectAllCheckbox");
        const rows = eligibleRows();
        if (!tbody) {
            return;
        }
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No eligible examinees match the current filters.</td></tr>';
            if (headerCheckbox) {
                headerCheckbox.checked = false;
                headerCheckbox.indeterminate = false;
            }
            renderMetrics();
            return;
        }

        tbody.innerHTML = rows.map(function (row) {
            const meta = statusMeta(row.status);
            const disabled = !selectableRow(row);
            const checked = selectedApplicationIds.has(row.id);
            const hint = disabled ? '<div class="small text-muted mt-1">Locked by completed or encoded exam records.</div>' : "";
            return (
                "<tr>" +
                    '<td><input class="form-check-input" type="checkbox" data-application-id="' + escapeHtml(row.id) + '"' + (checked ? ' checked="checked"' : "") + (disabled ? ' disabled="disabled"' : "") + " /></td>" +
                    "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                    "<td><div class=\"fw-700\">" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div><div class=\"small text-muted\">" + escapeHtml(row.email || "-") + "</div></td>" +
                    "<td>" + escapeHtml(row.school_name || "-") + "</td>" +
                    '<td><span class="ldss-chip ' + escapeHtml(meta.chipClass || "ldss-chip-neutral") + '">' + escapeHtml(meta.label || "-") + "</span>" + hint + "</td>" +
                "</tr>"
            );
        }).join("");

        if (headerCheckbox) {
            const selectable = visibleSelectableRows();
            const checkedCount = selectable.filter(function (row) {
                return selectedApplicationIds.has(row.id);
            }).length;
            headerCheckbox.checked = selectable.length > 0 && checkedCount === selectable.length;
            headerCheckbox.indeterminate = checkedCount > 0 && checkedCount < selectable.length;
        }

        renderMetrics();
    }

    function assignedRowsForBatch(batchId) {
        return batchRecords(batchId).map(function (record) {
            const app = appById(record.application_id);
            return {
                application_id: record.application_id,
                application_no: app ? (app.application_no || "") : "",
                applicant_name: app ? app.applicant_name : "Unknown Applicant",
                school_name: app ? (app.school_name || "") : "",
                room_label: record.room_label || "",
                room_seat_no: Number(record.room_seat_no || 0),
                exam_control_no: record.exam_control_no || "",
                scheduled_at: record.scheduled_at || "",
                record_status: record.status || ""
            };
        }).sort(function (left, right) {
            const roomCompare = (left.room_label || "").localeCompare(right.room_label || "");
            if (roomCompare !== 0) {
                return roomCompare;
            }
            return Number(left.room_seat_no || 0) - Number(right.room_seat_no || 0);
        });
    }

    function renderPreview() {
        const shell = byId("examManagementRoomPreview");
        const summary = byId("examManagementPreviewSummary");
        const batch = batchById(currentBatchId);
        const rows = currentBatchId ? assignedRowsForBatch(currentBatchId) : [];

        if (summary) {
            if (!batch) {
                summary.innerHTML = '<span class="ldss-exam-preview-badge">No active batch loaded</span>';
            } else {
                summary.innerHTML = [
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(batch.batch_label || "Batch") + "</span>",
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(formatDateTime(batch.exam_datetime || "")) + "</span>",
                    '<span class="ldss-exam-preview-badge">' + escapeHtml(batch.venue || "-") + "</span>",
                    '<span class="ldss-exam-preview-badge">' + rows.length + " assigned</span>",
                    '<span class="ldss-exam-preview-badge">' + roomCountForBatch(currentBatchId) + " rooms</span>"
                ].join("");
            }
        }

        if (!shell) {
            return;
        }
        if (!currentBatchId) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">Create or load a batch, then generate room assignments to preview the room list here.</div>';
            return;
        }
        if (!roomHotfixAvailable) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">Apply <strong>supabase/exam_room_assignment_hotfix_2026_03_28.sql</strong> first so room names and seat numbers can be saved.</div>';
            return;
        }
        if (!rows.length) {
            shell.innerHTML = '<div class="ldss-exam-empty-state">This batch exists, but it does not have saved room assignments yet.</div>';
            return;
        }

        const grouped = {};
        rows.forEach(function (row) {
            const key = row.room_label || "Unassigned Room";
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(row);
        });

        shell.innerHTML = Object.keys(grouped).sort(function (left, right) {
            return left.localeCompare(right);
        }).map(function (roomLabel) {
            const roomRows = grouped[roomLabel];
            return (
                '<section class="ldss-room-card">' +
                    '<div class="ldss-room-card-head">' +
                        '<div><div class="ldss-room-card-title">' + escapeHtml(roomLabel) + '</div><div class="ldss-room-card-copy">' + roomRows.length + ' applicant(s) assigned</div></div>' +
                    "</div>" +
                    '<div class="table-responsive">' +
                        '<table class="table table-sm">' +
                            "<thead><tr><th>Seat</th><th>Exam Control No.</th><th>LDSP No.</th><th>Applicant</th></tr></thead>" +
                            "<tbody>" +
                                roomRows.map(function (row) {
                                    return (
                                        "<tr>" +
                                            "<td>" + escapeHtml(row.room_seat_no || "-") + "</td>" +
                                            "<td>" + escapeHtml(row.exam_control_no || "-") + "</td>" +
                                            "<td>" + escapeHtml(row.application_no || "-") + "</td>" +
                                            "<td><div class=\"fw-700\">" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</div><div class=\"small text-muted\">" + escapeHtml(row.school_name || "-") + "</div></td>" +
                                        "</tr>"
                                    );
                                }).join("") +
                            "</tbody>" +
                        "</table>" +
                    "</div>" +
                "</section>"
            );
        }).join("");
    }

    function renderBatchDirectory() {
        const tbody = byId("examManagementBatchTableBody");
        if (!tbody) {
            return;
        }
        if (!batches.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No exam batches yet.</td></tr>';
            return;
        }
        tbody.innerHTML = batches.map(function (batch) {
            const assigned = assignedRowsForBatch(batch.id).length;
            return (
                "<tr>" +
                    "<td>" + escapeHtml(batch.batch_label || "-") + "</td>" +
                    "<td>" + escapeHtml(formatDateTime(batch.exam_datetime || "")) + "</td>" +
                    "<td>" + escapeHtml(batch.venue || "-") + "</td>" +
                    "<td>" + assigned + "</td>" +
                    "<td>" + roomCountForBatch(batch.id) + "</td>" +
                "</tr>"
            );
        }).join("");
    }

    function renderAll() {
        renderBatchSelect();
        renderMetrics();
        renderEligibleTable();
        renderPreview();
        renderBatchDirectory();
    }

    async function loadProfilesByIds(applicantIds) {
        const map = {};
        for (let start = 0; start < applicantIds.length; start += PROFILE_BATCH_SIZE) {
            const chunk = applicantIds.slice(start, start + PROFILE_BATCH_SIZE);
            if (!chunk.length) {
                continue;
            }
            const result = await authContext.client
                .from("profiles")
                .select("id, first_name, middle_name, last_name, email, school_name")
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

    async function fetchApplications() {
        const rows = [];
        for (let from = 0; ; from += SUPABASE_FETCH_LIMIT) {
            const result = await authContext.client
                .from("applications")
                .select("id, application_no, applicant_id, status, updated_at")
                .in("status", EXAM_SCOPE_STATUSES)
                .order("updated_at", { ascending: false })
                .range(from, from + SUPABASE_FETCH_LIMIT - 1);

            if (result.error) {
                throw new Error("Failed to load examinee records: " + result.error.message);
            }

            const batch = result.data || [];
            rows.push.apply(rows, batch);
            if (batch.length < SUPABASE_FETCH_LIMIT) {
                break;
            }
        }

        if (!rows.length) {
            return [];
        }

        const profileMap = await loadProfilesByIds(Array.from(new Set(rows.map(function (row) {
            return row.applicant_id;
        }).filter(Boolean))));

        return rows.map(function (row) {
            const profile = profileMap[row.applicant_id] || null;
            return {
                id: row.id,
                applicant_id: row.applicant_id,
                application_no: row.application_no || "",
                status: normalizeStatus(row.status),
                applicant_name: buildApplicantName(profile),
                school_name: profile && profile.school_name ? profile.school_name : "",
                email: profile && profile.email ? profile.email : ""
            };
        });
    }

    async function fetchBatches() {
        const result = await authContext.client
            .from("exam_batches")
            .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
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

    async function fetchExamRecords() {
        roomHotfixAvailable = true;
        const withRooms = await authContext.client
            .from("exam_records")
            .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, result, room_label, room_seat_no, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (!withRooms.error) {
            return withRooms.data || [];
        }

        if (/room_label|room_seat_no/i.test(withRooms.error.message || "")) {
            roomHotfixAvailable = false;
            const fallback = await authContext.client
                .from("exam_records")
                .select("id, application_id, batch_id, exam_control_no, scheduled_at, status, result, created_at, updated_at")
                .order("updated_at", { ascending: false });

            if (fallback.error) {
                throw new Error("Failed to load exam records: " + fallback.error.message);
            }

            return (fallback.data || []).map(function (row) {
                return Object.assign({}, row, { room_label: "", room_seat_no: null });
            });
        }

        if (/does not exist|relation/i.test(withRooms.error.message || "")) {
            showStatus("Exam module tables are not yet deployed. Run the updated SQL bootstrap first.", "alert-warning");
            return [];
        }

        throw new Error("Failed to load exam records: " + withRooms.error.message);
    }

    async function loadData(targetBatchId) {
        const loaded = await Promise.all([fetchApplications(), fetchBatches(), fetchExamRecords()]);
        applications = loaded[0];
        batches = loaded[1];
        examRecords = loaded[2];

        currentBatchId = targetBatchId && batchById(targetBatchId) ? targetBatchId : (batchById(currentBatchId) ? currentBatchId : "");
        applyBatchForm(currentBatchId);
        resetSelectionToEligible();
        renderAll();

        if (!roomHotfixAvailable) {
            showStatus("Room assignment fields are not deployed yet. Apply supabase/exam_room_assignment_hotfix_2026_03_28.sql before saving room assignments.", "alert-warning");
        }
    }

    function readFormValues() {
        const values = {
            batchLabel: (byId("examBatchLabel") ? byId("examBatchLabel").value : "").trim(),
            dateTimeRaw: (byId("examBatchDateTime") ? byId("examBatchDateTime").value : "").trim(),
            venue: (byId("examBatchVenue") ? byId("examBatchVenue").value : "").trim(),
            notes: (byId("examBatchNotes") ? byId("examBatchNotes").value : "").trim(),
            roomCount: Number((byId("examRoomCount") ? byId("examRoomCount").value : "").trim()),
            controlStart: Number((byId("examBatchControlStart") ? byId("examBatchControlStart").value : "").trim()),
            roomPrefix: ((byId("examRoomPrefix") ? byId("examRoomPrefix").value : "").trim() || "Room"),
            scheduledAt: datetimeLocalToIso(byId("examBatchDateTime") ? byId("examBatchDateTime").value : "")
        };

        if (!values.batchLabel) {
            return { error: "Batch label is required." };
        }
        if (!values.scheduledAt) {
            return { error: "Exam date and time are required." };
        }
        if (!values.venue) {
            return { error: "Venue is required." };
        }
        if (Number.isNaN(values.roomCount) || values.roomCount <= 0 || Math.floor(values.roomCount) !== values.roomCount) {
            return { error: "Number of rooms must be a whole number greater than zero." };
        }
        if (Number.isNaN(values.controlStart) || values.controlStart <= 0 || Math.floor(values.controlStart) !== values.controlStart) {
            return { error: "Control number start must be a whole number greater than zero." };
        }
        return values;
    }

    function shuffle(rows) {
        const output = rows.slice();
        for (let index = output.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            const temp = output[index];
            output[index] = output[swapIndex];
            output[swapIndex] = temp;
        }
        return output;
    }

    function buildAssignments(rows, values, batchId) {
        const shuffled = shuffle(rows);
        const base = Math.floor(shuffled.length / values.roomCount);
        const remainder = shuffled.length % values.roomCount;
        const assignments = [];
        let rowIndex = 0;
        let controlNo = values.controlStart;

        for (let roomIndex = 0; roomIndex < values.roomCount; roomIndex += 1) {
            const roomSize = base + (roomIndex < remainder ? 1 : 0);
            const roomLabel = values.roomPrefix + " " + String(roomIndex + 1);

            for (let seatIndex = 0; seatIndex < roomSize; seatIndex += 1) {
                const row = shuffled[rowIndex];
                rowIndex += 1;
                assignments.push({
                    application_id: row.id,
                    batch_id: batchId,
                    exam_control_no: String(controlNo).padStart(4, "0"),
                    scheduled_at: values.scheduledAt,
                    status: LOCKED_RECORD_STATUS,
                    room_label: roomLabel,
                    room_seat_no: seatIndex + 1
                });
                controlNo += 1;
            }
        }

        return assignments;
    }

    async function createOrUpdateBatch(values) {
        const payload = {
            batch_label: values.batchLabel,
            exam_datetime: values.scheduledAt,
            venue: values.venue,
            notes: values.notes || null,
            status: "open"
        };

        if (currentBatchId) {
            const updateResult = await authContext.client
                .from("exam_batches")
                .update(payload)
                .eq("id", currentBatchId)
                .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
                .single();

            if (updateResult.error) {
                throw new Error("Failed to update exam batch: " + updateResult.error.message);
            }
            return updateResult.data;
        }

        const insertResult = await authContext.client
            .from("exam_batches")
            .insert({
                batch_label: payload.batch_label,
                exam_datetime: payload.exam_datetime,
                venue: payload.venue,
                notes: payload.notes,
                status: payload.status,
                created_by: authContext.user.id
            })
            .select("id, batch_label, exam_datetime, venue, capacity, notes, status, created_at, updated_at")
            .single();

        if (insertResult.error) {
            throw new Error("Failed to create exam batch: " + insertResult.error.message);
        }
        return insertResult.data;
    }

    async function updateApplicationStatuses(applicationIds, nextStatus) {
        if (!applicationIds.length) {
            return;
        }
        for (let start = 0; start < applicationIds.length; start += 200) {
            const chunk = applicationIds.slice(start, start + 200);
            const result = await authContext.client
                .from("applications")
                .update({ status: nextStatus })
                .in("id", chunk);

            if (result.error) {
                throw new Error("Failed to update application statuses: " + result.error.message);
            }
        }
    }

    async function deleteExamRecordsForApplications(applicationIds) {
        const removableIds = (applicationIds || []).filter(Boolean);
        if (!removableIds.length) {
            return;
        }

        const records = examRecordsForApplications(removableIds);
        if (!records.length) {
            return;
        }
        if (records.some(function (record) { return normalizeStatus(record.status) !== LOCKED_RECORD_STATUS; })) {
            throw new Error("One or more selected examinees already have completed or encoded exam records and cannot be returned.");
        }

        for (let start = 0; start < removableIds.length; start += 200) {
            const chunk = removableIds.slice(start, start + 200);
            const result = await authContext.client
                .from("exam_records")
                .delete()
                .in("application_id", chunk);

            if (result.error) {
                throw new Error("Failed to clear exam assignments: " + result.error.message);
            }
        }
    }

    function resolveReturnConfirmation(confirmed) {
        if (!returnConfirmResolver) {
            return;
        }
        const resolve = returnConfirmResolver;
        returnConfirmResolver = null;
        resolve(Boolean(confirmed));
    }

    function confirmationDetails(nextStatus, selectedCount, scheduledCount) {
        if (nextStatus === "submitted") {
            return {
                kicker: "Return to Checking",
                title: "Return selected examinees to secretary checking?",
                copy: "This will move the selected examinees out of Room Assignment and send them back to the secretary checking queue for review.",
                target: "Secretary Checking",
                note: scheduledCount > 0
                    ? String(scheduledCount) + " scheduled room assignment(s) will be cleared before the rollback is saved."
                    : "No saved room assignment will be cleared for this selection. The selected records will simply leave Room Assignment and return to checking.",
                confirmLabel: "Return to Checking"
            };
        }

        return {
            kicker: "Back to Pending",
            title: "Move selected examinees back to Pending Exam?",
            copy: "This keeps the selected examinees in Room Assignment but removes them from the current scheduled room assignment so staff can schedule them again later.",
            target: "Pending Exam",
            note: String(scheduledCount) + " scheduled room assignment(s) will be cleared before the rollback is saved.",
            confirmLabel: "Back to Pending"
        };
    }

    function populateReturnConfirmModal(nextStatus, selectedCount, scheduledCount) {
        const details = confirmationDetails(nextStatus, selectedCount, scheduledCount);
        const kicker = byId("examManagementReturnConfirmKicker");
        const title = byId("examManagementReturnConfirmTitle");
        const copy = byId("examManagementReturnConfirmCopy");
        const count = byId("examManagementReturnConfirmCount");
        const target = byId("examManagementReturnConfirmTarget");
        const note = byId("examManagementReturnConfirmNote");
        const proceedBtn = byId("examManagementReturnConfirmProceedBtn");

        if (kicker) {
            kicker.textContent = details.kicker;
        }
        if (title) {
            title.textContent = details.title;
        }
        if (copy) {
            copy.textContent = details.copy;
        }
        if (count) {
            count.textContent = String(selectedCount);
        }
        if (target) {
            target.textContent = details.target;
        }
        if (note) {
            note.textContent = details.note;
        }
        if (proceedBtn) {
            proceedBtn.textContent = details.confirmLabel;
        }
    }

    function requestReturnConfirmation(nextStatus, selectedCount, scheduledCount) {
        const actionCopy = nextStatus === "submitted"
            ? "return the selected examinees to secretary checking"
            : "move the selected examinees back to Pending Exam";
        const modal = getReturnConfirmModal();
        if (!modal) {
            return Promise.resolve(window.confirm("This will " + actionCopy + ". Continue?"));
        }

        populateReturnConfirmModal(nextStatus, selectedCount, scheduledCount);
        return new Promise(function (resolve) {
            returnConfirmResolver = resolve;
            modal.show();
        });
    }

    async function deleteRemovedBatchAssignments(batchId, keepIds) {
        const records = batchRecords(batchId);
        if (!records.length) {
            return;
        }
        if (records.some(function (record) { return normalizeStatus(record.status) !== LOCKED_RECORD_STATUS; })) {
            throw new Error("This batch already has completed or encoded exam records and can no longer be regenerated.");
        }

        const keep = new Set(keepIds);
        const removedIds = records.filter(function (record) {
            return !keep.has(record.application_id);
        }).map(function (record) {
            return record.application_id;
        }).filter(Boolean);

        if (!removedIds.length) {
            return;
        }

        const deleteResult = await authContext.client
            .from("exam_records")
            .delete()
            .eq("batch_id", batchId)
            .in("application_id", removedIds);

        if (deleteResult.error) {
            throw new Error("Failed to clear removed batch assignments: " + deleteResult.error.message);
        }

        await updateApplicationStatuses(removedIds, "pending_exam");
    }

    async function saveAssignments(assignments) {
        for (let start = 0; start < assignments.length; start += 100) {
            const chunk = assignments.slice(start, start + 100);
            const result = await authContext.client
                .from("exam_records")
                .upsert(chunk, { onConflict: "application_id" });

            if (result.error) {
                throw new Error("Failed to save room assignments: " + result.error.message);
            }
        }
    }

    async function handleGenerate() {
        if (!roomHotfixAvailable) {
            showStatus("Apply supabase/exam_room_assignment_hotfix_2026_03_28.sql first so room assignments can be saved.", "alert-warning");
            return;
        }

        const values = readFormValues();
        if (values.error) {
            showStatus(values.error, "alert-warning");
            return;
        }

        const selectedRows = applications.filter(function (row) {
            return selectedApplicationIds.has(row.id) && selectableRow(row);
        });

        if (!selectedRows.length) {
            showStatus("Select at least one eligible applicant before generating the room assignment.", "alert-warning");
            return;
        }
        if (values.roomCount > selectedRows.length) {
            showStatus("Number of rooms cannot exceed the number of selected applicants.", "alert-warning");
            return;
        }

        const button = byId("examGenerateBtn");
        if (button) {
            button.disabled = true;
            button.textContent = "Saving...";
        }

        try {
            const batch = await createOrUpdateBatch(values);
            currentBatchId = batch.id;
            await deleteRemovedBatchAssignments(batch.id, selectedRows.map(function (row) { return row.id; }));

            const assignments = buildAssignments(selectedRows, values, batch.id);
            await saveAssignments(assignments);
            await updateApplicationStatuses(assignments.map(function (row) { return row.application_id; }), "exam_scheduled");

            await loadData(batch.id);
            showStatus("Room assignment saved successfully. " + assignments.length + " applicant(s) distributed across " + values.roomCount + " room(s).", "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to save room assignments.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Generate and Save Room Assignment";
            }
        }
    }

    async function handleReturnSelected(nextStatus, buttonId, loadingText) {
        const selectedRows = selectedSelectableRows();
        if (!selectedRows.length) {
            showStatus("Select at least one eligible examinee first.", "alert-warning");
            return;
        }

        const selectedIds = selectedRows.map(function (row) { return row.id; }).filter(Boolean);
        const scheduledIds = selectedRows.filter(function (row) {
            return normalizeStatus(row.status) === "exam_scheduled";
        }).map(function (row) {
            return row.id;
        }).filter(Boolean);
        const idsNeedingStatusChange = selectedRows.filter(function (row) {
            return normalizeStatus(row.status) !== nextStatus;
        }).map(function (row) {
            return row.id;
        }).filter(Boolean);

        if (nextStatus === "pending_exam" && !scheduledIds.length) {
            showStatus("The selected examinees are already in Pending Exam.", "alert-info");
            return;
        }

        const confirmed = await requestReturnConfirmation(nextStatus, selectedRows.length, scheduledIds.length);
        if (!confirmed) {
            return;
        }

        const button = byId(buttonId);
        if (button) {
            button.disabled = true;
            button.textContent = loadingText;
        }

        try {
            await deleteExamRecordsForApplications(selectedIds);
            if (idsNeedingStatusChange.length) {
                await updateApplicationStatuses(idsNeedingStatusChange, nextStatus);
            }
            await loadData(currentBatchId);

            if (nextStatus === "submitted") {
                showStatus("Selected examinees were returned to secretary checking. Any unlocked exam assignments tied to them were cleared.", "alert-success");
            } else {
                showStatus("Selected examinees were moved back to Pending Exam and removed from their saved room assignment.", "alert-success");
            }
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to reverse the selected examinees.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = nextStatus === "submitted" ? "Return to Checking" : "Back to Pending";
            }
        }
    }

    function buildPrintHtml(mode, batch, rows) {
        const iconHref = new URL("../img/icon.png", window.location.href).href;
        const grouped = {};
        rows.forEach(function (row) {
            const key = row.room_label || "Unassigned Room";
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(row);
        });

        const roomSections = Object.keys(grouped).sort(function (left, right) {
            return left.localeCompare(right);
        }).map(function (roomLabel) {
            const roomRows = grouped[roomLabel];
            return (
                '<section class="room-section"><div class="room-head"><div class="room-title">' + escapeHtml(roomLabel) + '</div><div class="room-copy">' + roomRows.length + ' applicant(s)</div></div>' +
                '<table class="print-table"><thead><tr><th>Seat</th><th>Exam Control No.</th><th>LDSP No.</th><th>Applicant</th></tr></thead><tbody>' +
                roomRows.map(function (row) {
                    return "<tr><td>" + escapeHtml(row.room_seat_no || "-") + "</td><td>" + escapeHtml(row.exam_control_no || "-") + "</td><td>" + escapeHtml(row.application_no || "-") + "</td><td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td></tr>";
                }).join("") +
                "</tbody></table></section>"
            );
        }).join("");

        const masterTable = '<table class="print-table"><thead><tr><th>Room</th><th>Seat</th><th>Exam Control No.</th><th>LDSP No.</th><th>Applicant</th></tr></thead><tbody>' +
            rows.map(function (row) {
                return "<tr><td>" + escapeHtml(row.room_label || "-") + "</td><td>" + escapeHtml(row.room_seat_no || "-") + "</td><td>" + escapeHtml(row.exam_control_no || "-") + "</td><td>" + escapeHtml(row.application_no || "-") + "</td><td>" + escapeHtml(row.applicant_name || "Unknown Applicant") + "</td></tr>";
            }).join("") +
            "</tbody></table>";

        return [
            "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>LDSP Exam Print</title><style>",
            "body{font-family:Arial,sans-serif;margin:24px;color:#0f172a;} .head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #0f172a;padding-bottom:16px;margin-bottom:20px;} .head img{width:56px;height:56px;} .title{font-size:20px;font-weight:700;margin-bottom:4px;} .subtitle{font-size:13px;color:#475569;line-height:1.45;} .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:20px;font-size:13px;} .meta div{padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;} .room-section{margin-bottom:24px;page-break-inside:avoid;} .room-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;} .room-title{font-size:16px;font-weight:700;} .room-copy{font-size:12px;color:#64748b;} .print-table{width:100%;border-collapse:collapse;font-size:12px;} .print-table th,.print-table td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top;} .print-table th{background:#f1f5f9;} @media print{body{margin:0;}}",
            "</style></head><body>",
            '<div class="head"><img src="' + escapeHtml(iconHref) + '" alt="LDSP Icon" /><div><div class="title">LGU Daet Scholarship System</div><div class="subtitle">' + escapeHtml(mode === "rooms" ? "Official Exam Room Lists" : "Official Exam Masterlist") + "</div></div></div>",
            '<div class="meta"><div><strong>Batch:</strong> ' + escapeHtml(batch.batch_label || "-") + '</div><div><strong>Schedule:</strong> ' + escapeHtml(formatDateTime(batch.exam_datetime || "")) + '</div><div><strong>Venue:</strong> ' + escapeHtml(batch.venue || "-") + '</div><div><strong>Total Assigned:</strong> ' + rows.length + "</div></div>",
            mode === "rooms" ? roomSections : masterTable,
            "<script>window.onload=function(){window.print();};<\/script></body></html>"
        ].join("");
    }

    function openPrint(mode) {
        const batch = batchById(currentBatchId);
        const rows = assignedRowsForBatch(currentBatchId);
        if (!batch || !rows.length) {
            showStatus("No saved room assignments are available for printing in the selected batch.", "alert-warning");
            return;
        }
        const popup = window.open("", "_blank", "noopener,noreferrer,width=1080,height=900");
        if (!popup) {
            showStatus("Printing was blocked by the browser. Allow pop-ups for this page and try again.", "alert-warning");
            return;
        }
        popup.document.open();
        popup.document.write(buildPrintHtml(mode, batch, rows));
        popup.document.close();
    }

    function bindEvents() {
        const refreshBtn = byId("examManagementRefreshBtn");
        const batchSelect = byId("examBatchSelect");
        const searchInput = byId("examManagementSearchInput");
        const selectAllBtn = byId("examManagementSelectAllBtn");
        const clearBtn = byId("examManagementClearBtn");
        const backToPendingBtn = byId("examManagementBackToPendingBtn");
        const returnToCheckingBtn = byId("examManagementReturnToCheckingBtn");
        const returnConfirmModalEl = byId("examManagementReturnConfirmModal");
        const returnConfirmCancelBtn = byId("examManagementReturnConfirmCancelBtn");
        const returnConfirmProceedBtn = byId("examManagementReturnConfirmProceedBtn");
        const headerCheckbox = byId("examManagementSelectAllCheckbox");
        const tableBody = byId("examManagementEligibleTableBody");
        const generateBtn = byId("examGenerateBtn");
        const printRoomsBtn = byId("examPrintRoomsBtn");
        const printMasterBtn = byId("examPrintMasterBtn");

        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                loadData(currentBatchId).catch(function (error) {
                    showStatus(error && error.message ? error.message : "Failed to refresh exam data.", "alert-danger");
                });
            });
        }
        if (batchSelect) {
            batchSelect.addEventListener("change", function () {
                currentBatchId = batchSelect.value || "";
                applyBatchForm(currentBatchId);
                resetSelectionToEligible();
                renderAll();
                if (currentBatchId && batchRecords(currentBatchId).some(function (record) { return normalizeStatus(record.status) !== LOCKED_RECORD_STATUS; })) {
                    showStatus("This batch already contains completed or encoded exam records. Printing remains available, but regeneration is locked.", "alert-warning");
                } else {
                    showStatus("");
                }
            });
        }
        if (searchInput) {
            searchInput.addEventListener("input", renderEligibleTable);
        }
        if (selectAllBtn) {
            selectAllBtn.addEventListener("click", function () {
                visibleSelectableRows().forEach(function (row) { selectedApplicationIds.add(row.id); });
                renderEligibleTable();
            });
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                visibleSelectableRows().forEach(function (row) { selectedApplicationIds.delete(row.id); });
                renderEligibleTable();
            });
        }
        if (backToPendingBtn) {
            backToPendingBtn.addEventListener("click", function () {
                handleReturnSelected("pending_exam", "examManagementBackToPendingBtn", "Returning...");
            });
        }
        if (returnToCheckingBtn) {
            returnToCheckingBtn.addEventListener("click", function () {
                handleReturnSelected("submitted", "examManagementReturnToCheckingBtn", "Returning...");
            });
        }
        if (returnConfirmCancelBtn) {
            returnConfirmCancelBtn.addEventListener("click", function () {
                resolveReturnConfirmation(false);
            });
        }
        if (returnConfirmProceedBtn) {
            returnConfirmProceedBtn.addEventListener("click", function () {
                resolveReturnConfirmation(true);
                const modal = getReturnConfirmModal();
                if (modal) {
                    modal.hide();
                }
            });
        }
        if (returnConfirmModalEl) {
            returnConfirmModalEl.addEventListener("hidden.bs.modal", function () {
                resolveReturnConfirmation(false);
            });
        }
        if (headerCheckbox) {
            headerCheckbox.addEventListener("change", function () {
                visibleSelectableRows().forEach(function (row) {
                    if (headerCheckbox.checked) {
                        selectedApplicationIds.add(row.id);
                    } else {
                        selectedApplicationIds.delete(row.id);
                    }
                });
                renderEligibleTable();
            });
        }
        if (tableBody) {
            tableBody.addEventListener("change", function (event) {
                const input = event.target.closest("input[data-application-id]");
                const applicationId = input ? input.getAttribute("data-application-id") : "";
                if (!applicationId) {
                    return;
                }
                if (input.checked) {
                    selectedApplicationIds.add(applicationId);
                } else {
                    selectedApplicationIds.delete(applicationId);
                }
                renderEligibleTable();
            });
        }
        if (generateBtn) {
            generateBtn.addEventListener("click", handleGenerate);
        }
        if (printRoomsBtn) {
            printRoomsBtn.addEventListener("click", function () { openPrint("rooms"); });
        }
        if (printMasterBtn) {
            printMasterBtn.addEventListener("click", function () { openPrint("master"); });
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }
        bindEvents();
        try {
            await loadData("");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to load exam management data.", "alert-danger");
        }
    }

    window.addEventListener("DOMContentLoaded", init);
})();
