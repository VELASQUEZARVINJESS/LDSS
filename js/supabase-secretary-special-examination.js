(function () {
    "use strict";

    const SPECIAL_EXAM_RESCHEDULE_API_PATH = "/api/notifications/special-exam-reschedule";
    const SPECIAL_EXAM_RESCHEDULE_TEST_API_PATH = "/api/notifications/special-exam-reschedule/test";
    const DEFAULT_SUBJECT = "LDSP Special Examination Reschedule Notice";
    let authContext = null;
    let recipients = [];

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

    function collapseWhitespace(value) {
        return (value || "").toString().replace(/\s+/g, " ").trim();
    }

    function normalizeEmail(value) {
        return collapseWhitespace(value).toLowerCase();
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
    }

    function statusLabel(status) {
        if (status === "valid") {
            return "Ready";
        }
        if (status === "duplicate") {
            return "Duplicate";
        }
        return "Invalid";
    }

    async function getAccessToken() {
        if (!authContext || !authContext.client || !authContext.client.auth || typeof authContext.client.auth.getSession !== "function") {
            throw new Error("Supabase session is not available.");
        }

        const result = await authContext.client.auth.getSession();
        const session = result && result.data ? result.data.session : null;
        const token = session && session.access_token ? session.access_token : "";
        if (!token) {
            throw new Error("No active access token found. Please sign in again.");
        }
        return token;
    }

    async function requestJson(path, options) {
        const token = await getAccessToken();
        const fetchOptions = Object.assign({ method: "GET" }, options || {});
        const headers = new Headers(fetchOptions.headers || {});
        headers.set("Authorization", "Bearer " + token);
        fetchOptions.headers = headers;

        const response = await fetch(path, fetchOptions);
        const responseText = await response.text();
        let payload = null;

        if (responseText) {
            try {
                payload = JSON.parse(responseText);
            } catch (_error) {
                payload = null;
            }
        }

        if (!response.ok) {
            let fallbackMessage = "Request failed (HTTP " + response.status + ").";
            if (response.status === 404) {
                fallbackMessage = "Special examination email API route was not found. Open the site through the Node server.";
            } else if (response.status === 400) {
                fallbackMessage = "The server rejected the request. Check the schedule fields and recipient list, then try again.";
            } else if (response.status === 401) {
                fallbackMessage = "Your session may have expired. Sign in again, then retry the request.";
            } else if (response.status === 403) {
                fallbackMessage = "Your account does not have permission to use this email action.";
            } else if (response.status === 503) {
                fallbackMessage = "Server email is not configured. Add SMTP settings to the Node app first.";
            } else if (response.status >= 500) {
                fallbackMessage = "The Node email server returned an internal error. Check the latest server upload and restart the Node app.";
            }

            if (!payload && responseText) {
                const compactText = responseText.replace(/\s+/g, " ").trim();
                if (compactText && compactText.charAt(0) === "<") {
                    fallbackMessage += " The server returned an HTML error page instead of the LDSP API response.";
                }
            }

            throw new Error(payload && payload.error ? payload.error : fallbackMessage);
        }

        return payload || {};
    }

    function showStatus(message, type) {
        const box = byId("specialExamStatus");
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

    function parseCsvLine(line) {
        const cells = [];
        let current = "";
        let inQuotes = false;

        for (let index = 0; index < line.length; index += 1) {
            const char = line.charAt(index);
            const nextChar = line.charAt(index + 1);

            if (char === "\"") {
                if (inQuotes && nextChar === "\"") {
                    current += "\"";
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === "," && !inQuotes) {
                cells.push(current);
                current = "";
            } else {
                current += char;
            }
        }

        cells.push(current);
        return cells;
    }

    function firstEmailCell(cells) {
        for (let index = 1; index < cells.length; index += 1) {
            const value = collapseWhitespace(cells[index]);
            if (/@/.test(value) || isValidEmail(value)) {
                return value;
            }
        }
        return collapseWhitespace(cells[1] || "");
    }

    function looksLikeHeader(cells) {
        const first = collapseWhitespace(cells[0] || "").toLowerCase();
        const second = collapseWhitespace(cells[1] || "").toLowerCase();
        return (
            (/full\s*name|name/.test(first) && /email/.test(second)) ||
            (first === "name" && second === "email") ||
            (first === "full name" && second === "email address")
        );
    }

    function parseRecipientsFromText(text) {
        const normalizedText = (text || "").replace(/\r\n?/g, "\n");
        const rawLines = normalizedText.split("\n").map(function (line) {
            return line.trim() ? line : "";
        }).filter(Boolean);

        if (!rawLines.length) {
            return [];
        }

        const parsedLines = rawLines.map(function (line) {
            if (line.indexOf("\t") !== -1) {
                return line.split("\t");
            }
            return parseCsvLine(line);
        });

        const startIndex = looksLikeHeader(parsedLines[0] || []) ? 1 : 0;
        const parsedRecipients = [];

        for (let index = startIndex; index < parsedLines.length; index += 1) {
            const cells = parsedLines[index];
            const fullName = collapseWhitespace(cells[0] || "");
            const email = normalizeEmail(firstEmailCell(cells));
            parsedRecipients.push({
                rowNumber: index + 1,
                fullName: fullName,
                email: email,
                status: "valid",
                note: "Ready to send."
            });
        }

        const seenEmails = new Set();
        const seenPairs = new Set();

        return parsedRecipients.map(function (item) {
            const normalizedName = collapseWhitespace(item.fullName).toLowerCase();
            const pairKey = normalizedName + "|" + item.email;
            const nextItem = Object.assign({}, item);

            if (!nextItem.fullName) {
                nextItem.status = "invalid";
                nextItem.note = "Missing full name.";
                return nextItem;
            }

            if (!nextItem.email) {
                nextItem.status = "invalid";
                nextItem.note = "Missing email address.";
                return nextItem;
            }

            if (!isValidEmail(nextItem.email)) {
                nextItem.status = "invalid";
                nextItem.note = "Invalid email address format.";
                return nextItem;
            }

            if (seenPairs.has(pairKey) || seenEmails.has(nextItem.email)) {
                nextItem.status = "duplicate";
                nextItem.note = "Duplicate recipient email.";
                return nextItem;
            }

            seenPairs.add(pairKey);
            seenEmails.add(nextItem.email);
            return nextItem;
        });
    }

    function summaryCounts() {
        const counts = {
            total: recipients.length,
            valid: 0,
            duplicate: 0,
            invalid: 0
        };

        recipients.forEach(function (item) {
            if (item.status === "valid") {
                counts.valid += 1;
            } else if (item.status === "duplicate") {
                counts.duplicate += 1;
            } else {
                counts.invalid += 1;
            }
        });

        return counts;
    }

    function validRecipients() {
        return recipients.filter(function (item) {
            return item.status === "valid";
        }).map(function (item) {
            return {
                fullName: item.fullName,
                email: item.email
            };
        });
    }

    function renderSummary() {
        const counts = summaryCounts();
        const totalEl = byId("specialExamTotalCount");
        const validEl = byId("specialExamValidCount");
        const duplicateEl = byId("specialExamDuplicateCount");
        const invalidEl = byId("specialExamInvalidCount");
        const summaryEl = byId("specialExamSummaryText");
        const sendBtn = byId("specialExamSendBtn");
        const testBtn = byId("specialExamSendTestBtn");

        if (totalEl) {
            totalEl.textContent = String(counts.total);
        }
        if (validEl) {
            validEl.textContent = String(counts.valid);
        }
        if (duplicateEl) {
            duplicateEl.textContent = String(counts.duplicate);
        }
        if (invalidEl) {
            invalidEl.textContent = String(counts.invalid);
        }
        if (summaryEl) {
            if (!counts.total) {
                summaryEl.textContent = "No recipient list loaded yet.";
            } else {
                summaryEl.textContent =
                    counts.valid + " ready, " +
                    counts.duplicate + " duplicate, and " +
                    counts.invalid + " invalid row(s). Only ready rows will be emailed.";
            }
        }
        if (sendBtn) {
            sendBtn.disabled = counts.valid === 0;
        }
        if (testBtn) {
            testBtn.disabled = counts.valid === 0;
        }
    }

    function renderRecipients() {
        const body = byId("specialExamRecipientTableBody");
        if (!body) {
            return;
        }

        if (!recipients.length) {
            body.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Paste your Google Form list first to preview the recipients.</td></tr>';
            renderSummary();
            return;
        }

        body.innerHTML = recipients.map(function (item, index) {
            return (
                "<tr>" +
                '<td class="text-muted">' + escapeHtml(String(index + 1)) + "</td>" +
                "<td>" +
                '<div class="ldss-special-recipient-name">' + escapeHtml(item.fullName || "-") + "</div>" +
                '<div class="ldss-special-recipient-email mt-1">' + escapeHtml(item.email || "-") + "</div>" +
                "</td>" +
                "<td>" +
                '<span class="ldss-special-status-pill is-' + escapeHtml(item.status) + '">' + escapeHtml(statusLabel(item.status)) + "</span>" +
                "</td>" +
                "<td>" + escapeHtml(item.note || "") + "</td>" +
                "</tr>"
            );
        }).join("");

        renderSummary();
    }

    function readNoticeDetails() {
        const scheduleDate = collapseWhitespace(byId("specialExamDate") ? byId("specialExamDate").value : "");
        const reportingTime = collapseWhitespace(byId("specialExamTime") ? byId("specialExamTime").value : "");
        const venue = collapseWhitespace(byId("specialExamVenue") ? byId("specialExamVenue").value : "");
        const room = collapseWhitespace(byId("specialExamRoom") ? byId("specialExamRoom").value : "");
        const subject = collapseWhitespace(byId("specialExamSubject") ? byId("specialExamSubject").value : "") || DEFAULT_SUBJECT;
        const instructions = ((byId("specialExamMessage") ? byId("specialExamMessage").value : "") || "").toString().trim();

        if (!scheduleDate) {
            throw new Error("Enter the special examination date first.");
        }
        if (!reportingTime) {
            throw new Error("Enter the reporting time first.");
        }
        if (!venue) {
            throw new Error("Enter the venue first.");
        }

        return {
            subject: subject,
            scheduleDate: scheduleDate,
            reportingTime: reportingTime,
            venue: venue,
            room: room,
            instructions: instructions
        };
    }

    function handleLoadRecipients() {
        const input = byId("specialExamRecipientInput");
        const text = input ? input.value : "";
        recipients = parseRecipientsFromText(text);
        renderRecipients();

        const counts = summaryCounts();
        if (!counts.total) {
            showStatus("Paste at least one recipient row first.", "alert-warning");
            return;
        }

        showStatus(
            "Recipient list loaded. " +
            counts.valid + " ready, " +
            counts.duplicate + " duplicate, and " +
            counts.invalid + " invalid row(s).",
            counts.duplicate || counts.invalid ? "alert-warning" : "alert-success"
        );
    }

    function handleClearRecipients() {
        const input = byId("specialExamRecipientInput");
        if (input) {
            input.value = "";
        }
        recipients = [];
        renderRecipients();
        showStatus("", "");
    }

    async function handleSendTestEmail() {
        const validList = validRecipients();
        const button = byId("specialExamSendTestBtn");
        const testEmail = normalizeEmail(byId("specialExamTestEmail") ? byId("specialExamTestEmail").value : "");

        if (!validList.length) {
            showStatus("Load at least one valid recipient first.", "alert-warning");
            return;
        }
        if (!isValidEmail(testEmail)) {
            showStatus("Enter a valid test receiver email first.", "alert-warning");
            return;
        }

        let details;
        try {
            details = readNoticeDetails();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Complete the schedule details first.", "alert-warning");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Sending Test...";
        }

        try {
            const sampleRecipient = validList[0];
            const payload = await requestJson(SPECIAL_EXAM_RESCHEDULE_TEST_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    subject: details.subject,
                    scheduleDate: details.scheduleDate,
                    reportingTime: details.reportingTime,
                    venue: details.venue,
                    room: details.room,
                    instructions: details.instructions,
                    testEmail: testEmail,
                    sampleRecipient: sampleRecipient
                })
            });

            showStatus(
                "Test reschedule email sent to " + (payload.sent_to_email || testEmail) + " using " + (payload.applicant_name || sampleRecipient.fullName) + " as the sample recipient.",
                "alert-success"
            );
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to send the test email.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Send Test Email";
            }
            renderSummary();
        }
    }

    async function handleSendEmails() {
        const validList = validRecipients();
        const button = byId("specialExamSendBtn");
        const counts = summaryCounts();
        let details;

        if (!validList.length) {
            showStatus("Load at least one valid recipient first.", "alert-warning");
            return;
        }

        try {
            details = readNoticeDetails();
        } catch (error) {
            showStatus(error && error.message ? error.message : "Complete the schedule details first.", "alert-warning");
            return;
        }

        if (!window.confirm("Send the special examination reschedule email to " + validList.length + " valid recipient(s)?")) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Sending...";
        }

        try {
            const payload = await requestJson(SPECIAL_EXAM_RESCHEDULE_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    subject: details.subject,
                    scheduleDate: details.scheduleDate,
                    reportingTime: details.reportingTime,
                    venue: details.venue,
                    room: details.room,
                    instructions: details.instructions,
                    recipients: validList
                })
            });

            let message =
                "Special examination reschedule emails processed. " +
                String(payload.sent_count || 0) + " sent";

            if (payload.failed_count) {
                message += ", " + String(payload.failed_count) + " failed";
            }
            if (counts.duplicate || counts.invalid || payload.skipped_count) {
                message += ", " + String((counts.duplicate || 0) + (counts.invalid || 0) + Number(payload.skipped_count || 0)) + " skipped";
            }
            message += ".";

            if (payload.failed_preview && payload.failed_preview.length) {
                const firstFailure = payload.failed_preview[0];
                message += " First error: " + (firstFailure.error || "Email send failed.") + ".";
            }

            showStatus(message, payload.failed_count ? "alert-warning" : "alert-success");
        } catch (error) {
            showStatus(error && error.message ? error.message : "Failed to send the reschedule emails.", "alert-danger");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Send Reschedule Emails";
            }
            renderSummary();
        }
    }

    function bindEvents() {
        const loadBtn = byId("specialExamLoadBtn");
        const clearBtn = byId("specialExamClearBtn");
        const testBtn = byId("specialExamSendTestBtn");
        const sendBtn = byId("specialExamSendBtn");

        if (loadBtn) {
            loadBtn.addEventListener("click", handleLoadRecipients);
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", handleClearRecipients);
        }
        if (testBtn) {
            testBtn.addEventListener("click", handleSendTestEmail);
        }
        if (sendBtn) {
            sendBtn.addEventListener("click", handleSendEmails);
        }
    }

    async function init() {
        authContext = await window.ldssAuthReadyPromise;
        if (!authContext || !authContext.client || !authContext.user) {
            return;
        }

        bindEvents();
        renderRecipients();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
