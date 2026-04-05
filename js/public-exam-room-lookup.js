(function () {
    "use strict";

    const LOOKUP_API_PATH = "/api/public/exam-room-lookup";
    const SUPPORT_FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61583672829501";

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

    function setStatus(message, type) {
        const box = byId("publicExamLookupStatus");
        if (!box) {
            return;
        }
        if (!message) {
            box.className = "alert d-none mb-3";
            box.textContent = "";
            return;
        }
        box.className = "alert mb-3 " + (type || "alert-info");
        box.textContent = message;
    }

    function setBusy(isBusy) {
        const submitBtn = byId("publicExamLookupSubmitBtn");
        const clearBtn = byId("publicExamLookupClearBtn");
        const fullName = byId("publicExamLookupFullName");
        const applicationNo = byId("publicExamLookupApplicationNo");

        [fullName, applicationNo].forEach(function (input) {
            if (input) {
                input.disabled = isBusy;
            }
        });
        if (submitBtn) {
            submitBtn.disabled = isBusy;
            submitBtn.textContent = isBusy ? "Checking..." : "Check Assignment";
        }
        if (clearBtn) {
            clearBtn.disabled = isBusy;
        }
    }

    function uppercaseValue(value) {
        return (value || "")
            .toString()
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    function normalizeTypingInput(value) {
        return (value || "")
            .toString()
            .replace(/\s+/g, " ")
            .toUpperCase();
    }

    function normalizeApplicationNoTyping(value) {
        return (value || "")
            .toString()
            .replace(/\s+/g, "")
            .toUpperCase();
    }

    async function requestJson(path, options) {
        const response = await fetch(path, Object.assign({ method: "GET" }, options || {}));
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
            throw new Error(payload && payload.error ? payload.error : "Request failed.");
        }

        return payload || {};
    }

    function showEmptyState() {
        const empty = byId("publicExamLookupResultEmpty");
        const card = byId("publicExamLookupResultCard");
        if (empty) {
            empty.classList.remove("d-none");
        }
        if (card) {
            card.classList.add("d-none");
        }
    }

    function showResultCard() {
        const empty = byId("publicExamLookupResultEmpty");
        const card = byId("publicExamLookupResultCard");
        if (empty) {
            empty.classList.add("d-none");
        }
        if (card) {
            card.classList.remove("d-none");
        }
    }

    function setText(id, value) {
        const node = byId(id);
        if (node) {
            node.textContent = value == null || value === "" ? "-" : String(value);
        }
    }

    function renderResult(payload) {
        const application = payload && payload.application ? payload.application : {};
        const exam = payload && payload.exam ? payload.exam : {};
        const posted = payload && payload.assignment_ready === true;

        showResultCard();
        setText("publicExamLookupApplicantName", application.applicant_name || "Applicant");
        setText("publicExamLookupApplicationMeta", application.application_no || "LDSP Application");
        setText("publicExamLookupBatchBadge", exam.batch_label || "Exam Batch");
        setText("publicExamLookupStatusBadge", posted ? "Assignment Posted" : "Pending Posting");
        setText("publicExamLookupSchedule", exam.schedule_label || "To be announced");
        setText("publicExamLookupVenue", exam.venue || "To be announced");
        setText("publicExamLookupRoom", exam.room_label || "Not posted yet");
        setText("publicExamLookupSeat", exam.seat_no || "Not posted yet");

        const note = byId("publicExamLookupResultNote");
        if (note) {
            note.innerHTML = posted
                ? (
                    "Please keep a copy of your <strong>" + escapeHtml(application.application_no || "LDSP Application") +
                    "</strong> and arrive early at <strong>" + escapeHtml(exam.venue || "the exam venue") +
                    "</strong> on the scheduled date."
                )
                : (
                    "Your record was found, but the scholarship office has not posted the room assignment yet. Please check again later. " +
                    'If you still cannot see your room assignment, please contact the LDSP Support Facebook Page: <a href="' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(SUPPORT_FACEBOOK_PAGE_URL) + "</a>."
                );
        }
    }

    function clearForm() {
        ["publicExamLookupFullName", "publicExamLookupApplicationNo"].forEach(function (id) {
            const input = byId(id);
            if (input) {
                input.value = "";
            }
        });
        setStatus("");
        showEmptyState();
        if (byId("publicExamLookupFullName")) {
            byId("publicExamLookupFullName").focus();
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        const fullName = uppercaseValue(byId("publicExamLookupFullName") ? byId("publicExamLookupFullName").value : "");
        const applicationNo = normalizeApplicationNoTyping(byId("publicExamLookupApplicationNo") ? byId("publicExamLookupApplicationNo").value : "");

        if (!fullName) {
            setStatus("Enter the applicant full name.", "alert-warning");
            showEmptyState();
            return;
        }
        if (!applicationNo) {
            setStatus("Enter the LDSP application number.", "alert-warning");
            showEmptyState();
            return;
        }

        setBusy(true);
        setStatus("");

        try {
            const payload = await requestJson(LOOKUP_API_PATH, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fullName: fullName,
                    applicationNo: applicationNo
                })
            });

            renderResult(payload);
            setStatus(payload && payload.message ? payload.message : "Exam assignment found.", payload && payload.assignment_ready ? "alert-success" : "alert-warning");
        } catch (error) {
            showEmptyState();
            setStatus(error && error.message ? error.message : "Exam room lookup failed.", "alert-danger");
        } finally {
            setBusy(false);
        }
    }

    function bindInputNormalization(id) {
        const input = byId(id);
        if (!input) {
            return;
        }
        input.addEventListener("input", function () {
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = normalizeTypingInput(input.value);
            if (typeof start === "number" && typeof end === "number") {
                input.setSelectionRange(start, end);
            }
        });
    }

    function init() {
        const form = byId("publicExamLookupForm");
        const clearBtn = byId("publicExamLookupClearBtn");
        const applicationNoInput = byId("publicExamLookupApplicationNo");

        if (!form) {
            return;
        }

        showEmptyState();
        bindInputNormalization("publicExamLookupFullName");

        if (applicationNoInput) {
            applicationNoInput.addEventListener("input", function () {
                const start = applicationNoInput.selectionStart;
                const end = applicationNoInput.selectionEnd;
                applicationNoInput.value = normalizeApplicationNoTyping(applicationNoInput.value);
                if (typeof start === "number" && typeof end === "number") {
                    applicationNoInput.setSelectionRange(start, end);
                }
            });
        }

        form.addEventListener("submit", function (event) {
            handleSubmit(event);
        });

        if (clearBtn) {
            clearBtn.addEventListener("click", function () {
                clearForm();
            });
        }

        if (window.feather && typeof window.feather.replace === "function") {
            window.feather.replace();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
