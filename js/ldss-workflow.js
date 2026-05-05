(function (window) {
    "use strict";

    const STATUS_ORDER = [
        "draft",
        "submitted",
        "pending_exam",
        "exam_scheduled",
        "exam_completed",
        "passed_exam",
        "failed_exam",
        "selected",
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
    ];

    const LEGACY_STATUS_MAP = {
        under_secretary_review: "pending_exam",
        recommended: "for_approval",
        for_admin_approval: "for_approval",
        certification_ready: "approved",
        release_scheduled: "for_release"
    };

    const STATUS_META = {
        draft: {
            label: "Draft",
            chipClass: "ldss-chip-neutral",
            nextStep: "Complete your form and submit your application."
        },
        submitted: {
            label: "Submitted",
            chipClass: "ldss-chip-info",
            nextStep: "Wait for secretary checking for correction, screening, and exam scheduling."
        },
        pending_exam: {
            label: "Pending Exam",
            chipClass: "ldss-chip-accent",
            nextStep: "Wait for your exam schedule and control number."
        },
        exam_scheduled: {
            label: "Exam Scheduled",
            chipClass: "ldss-chip-accent",
            nextStep: "Attend the scheduled exam and bring required documents."
        },
        exam_completed: {
            label: "Exam Completed",
            chipClass: "ldss-chip-success",
            nextStep: "The scholarship office is collecting and consolidating exam scores before posting the final result."
        },
        passed_exam: {
            label: "Passed Exam",
            chipClass: "ldss-chip-success",
            nextStep: "Wait for your interview schedule."
        },
        failed_exam: {
            label: "Failed Exam",
            chipClass: "ldss-chip-danger",
            nextStep: "Wait for official decision or possible Special Endorsement review."
        },
        selected: {
            label: "Selected",
            chipClass: "ldss-chip-success",
            nextStep: "Your sector classification has been selected."
        },
        special_endorsement_review: {
            label: "Special Endorsement Review",
            chipClass: "ldss-chip-accent",
            nextStep: "Your application is under internal endorsement review."
        },
        for_interview: {
            label: "For Interview",
            chipClass: "ldss-chip-accent",
            nextStep: "Wait for interview date, time, and venue."
        },
        interview_scheduled: {
            label: "Interview Scheduled",
            chipClass: "ldss-chip-accent",
            nextStep: "Attend interview and bring complete hard-copy requirements."
        },
        interview_completed: {
            label: "Interview Completed",
            chipClass: "ldss-chip-accent",
            nextStep: "Secretary is finalizing hard-copy verification."
        },
        hard_copy_verified: {
            label: "Hard Copy Verified",
            chipClass: "ldss-chip-success",
            nextStep: "Your record will be forwarded for final approval."
        },
        for_approval: {
            label: "For Approval",
            chipClass: "ldss-chip-accent",
            nextStep: "Admin is reviewing ranking, slots, and requirements."
        },
        approved: {
            label: "Approved",
            chipClass: "ldss-chip-success",
            nextStep: "Wait for release instructions."
        },
        waitlisted: {
            label: "Waitlisted",
            chipClass: "ldss-chip-accent",
            nextStep: "You are qualified but currently waiting for available slots."
        },
        rejected: {
            label: "Rejected",
            chipClass: "ldss-chip-danger",
            nextStep: "Application process is closed for this cycle."
        },
        for_release: {
            label: "For Release",
            chipClass: "ldss-chip-accent",
            nextStep: "Wait for release schedule and claiming instructions."
        },
        released: {
            label: "Released",
            chipClass: "ldss-chip-success",
            nextStep: "Scholarship release has been completed."
        },
        returned_for_correction: {
            label: "Returned for Correction",
            chipClass: "ldss-chip-danger",
            nextStep: "Update your submission based on secretary remarks."
        }
    };

    const EXAM_RESULT_META = {
        pending: { label: "Score Consolidation", chipClass: "ldss-chip-accent" },
        passed: { label: "Passed", chipClass: "ldss-chip-success" },
        failed: { label: "Failed", chipClass: "ldss-chip-danger" }
    };

    const EXAM_RECORD_STATUS_META = {
        pending: { label: "Pending", chipClass: "ldss-chip-neutral" },
        scheduled: { label: "Scheduled", chipClass: "ldss-chip-accent" },
        completed: { label: "Completed", chipClass: "ldss-chip-success" },
        absent: { label: "Absent", chipClass: "ldss-chip-danger" }
    };
    const DEFAULT_RANKING_SETTINGS = {
        exam_total_items: 100,
        passing_score: 75
    };

    function activeWorkflowControls() {
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS || {};
    }

    function normalizeNumber(value, fallbackValue) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallbackValue;
    }

    function activeRankingSettings() {
        const settings = window.LDSS_ACTIVE_RANKING_SETTINGS;
        if (!settings || typeof settings !== "object" || settings.available !== true) {
            return null;
        }

        return {
            exam_total_items: Math.max(1, Math.round(normalizeNumber(
                settings.exam_total_items,
                DEFAULT_RANKING_SETTINGS.exam_total_items
            ))),
            passing_score: Math.min(100, Math.max(0, normalizeNumber(
                settings.passing_score,
                DEFAULT_RANKING_SETTINGS.passing_score
            )))
        };
    }

    function specialConsiderationDisplayScore() {
        const settings = activeRankingSettings();
        if (settings && typeof settings.passing_score === "number" && !Number.isNaN(settings.passing_score)) {
            return String(Math.max(0, Math.min(100, Math.ceil(settings.passing_score))));
        }
        return "70";
    }

    function formatSectorClassificationDisplay(value) {
        const cleaned = (value || "").toString().trim();
        if (!cleaned) {
            return "Sector Classification";
        }
        if (cleaned.toLowerCase() === "none of the above") {
            return "Sector Classification";
        }
        return cleaned.replace(/\bPwd\b/g, "PWD");
    }

    function isSectorSelectedStatus(status) {
        const normalized = normalizeStatus(status || "");
        return ["approved", "waitlisted", "for_release", "released"].indexOf(normalized) !== -1;
    }

    function deriveExamScorePolicyMeta(examRecord) {
        if (!examRecord) {
            return null;
        }

        if (examRecord.raw_score === null || typeof examRecord.raw_score === "undefined" || examRecord.raw_score === "") {
            return null;
        }

        const settings = activeRankingSettings();
        const rawScore = Number(examRecord.raw_score);
        if (!settings || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > settings.exam_total_items) {
            return null;
        }

        const percentage = Number(((rawScore / settings.exam_total_items) * 100).toFixed(2));
        return {
            percentage: percentage,
            result: percentage >= settings.passing_score ? "passed" : "failed"
        };
    }

    function normalizeStatus(status) {
        const key = (status || "").toString().trim().toLowerCase();
        if (!key) {
            return "";
        }
        return LEGACY_STATUS_MAP[key] || key;
    }

    function toTitleCase(value) {
        return (value || "")
            .toString()
            .replace(/_/g, " ")
            .replace(/\b\w/g, function (char) {
                return char.toUpperCase();
            });
    }

    function statusMeta(status) {
        const normalized = normalizeStatus(status);
        if (normalized === "exam_completed" && activeWorkflowControls().exam_checking_in_progress === true) {
            return {
                label: "Exam Completed",
                chipClass: "ldss-chip-success",
                nextStep: "The scholarship office is collecting and consolidating exam scores now. Please wait for the final exam result."
            };
        }
        if (STATUS_META[normalized]) {
            return STATUS_META[normalized];
        }
        if (STATUS_META[status]) {
            return STATUS_META[status];
        }
        return {
            label: toTitleCase(normalized || status || "-"),
            chipClass: "ldss-chip-neutral",
            nextStep: "Wait for an update from the scholarship office."
        };
    }

    function applicantExamResultsVisible() {
        return activeWorkflowControls().show_applicant_exam_scores !== false;
    }

    function applicantStatusMeta(status) {
        const normalized = normalizeStatus(status);
        if (!applicantExamResultsVisible() && ["exam_completed", "passed_exam", "failed_exam"].indexOf(normalized) !== -1) {
            return {
                label: "Score Consolidation",
                chipClass: EXAM_RESULT_META.pending.chipClass,
                nextStep: "The scholarship office is consolidating your exam scores before posting the final result."
            };
        }

        const meta = statusMeta(status);
        if (normalized === "passed_exam") {
            return Object.assign({}, meta, { label: "PASSED" });
        }
        return meta;
    }

    function nextStepForApplicant(status) {
        return statusMeta(status).nextStep;
    }

    function isExamCheckingStage(status) {
        return normalizeStatus(status) === "exam_completed" && activeWorkflowControls().exam_checking_in_progress === true;
    }

    function normalizeExamResult(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (!raw) {
            return "pending";
        }
        if (raw === "passed" || raw === "pass") {
            return "passed";
        }
        if (raw === "failed" || raw === "fail") {
            return "failed";
        }
        return "pending";
    }

    function examResultMeta(value) {
        const key = normalizeExamResult(value);
        return EXAM_RESULT_META[key] || EXAM_RESULT_META.pending;
    }

    function normalizeExamRecordStatus(value) {
        const raw = (value || "").toString().trim().toLowerCase();
        if (!raw) {
            return "pending";
        }
        if (raw === "absent") {
            return "absent";
        }
        if (raw === "completed" || raw === "encoded") {
            return "completed";
        }
        if (raw === "scheduled" || raw === "exam_scheduled") {
            return "scheduled";
        }
        return "pending";
    }

    function examRecordStatusMeta(value) {
        const key = normalizeExamRecordStatus(value);
        return EXAM_RECORD_STATUS_META[key] || EXAM_RECORD_STATUS_META.pending;
    }

    function examSummaryFromRecord(examRecord) {
        if (!examRecord) {
            const recordMeta = EXAM_RECORD_STATUS_META.pending;
            return {
                controlNo: "-",
                scoreText: "-",
                percentageText: "-",
                roomLabel: "",
                seatNo: "",
                status: "pending",
                statusLabel: recordMeta.label,
                statusChipClass: recordMeta.chipClass,
                result: "pending",
                resultLabel: EXAM_RESULT_META.pending.label,
                resultChipClass: EXAM_RESULT_META.pending.chipClass
            };
        }

        const score = examRecord.raw_score;
        const hasScore = !(score === null || typeof score === "undefined" || score === "");
        const derivedPolicyMeta = deriveExamScorePolicyMeta(examRecord);
        const percent = derivedPolicyMeta ? derivedPolicyMeta.percentage : examRecord.percentage_score;
        const recordStatus = normalizeExamRecordStatus(examRecord.status);
        const recordStatusMeta = examRecordStatusMeta(recordStatus);
        const result = normalizeExamResult(derivedPolicyMeta ? derivedPolicyMeta.result : examRecord.result);
        const resultMeta = examResultMeta(result);
        const failedToTakeExam = result === "failed" && !hasScore;
        const roomLabel = (examRecord.room_label || "").toString().trim();
        const rawSeatNo = examRecord.room_seat_no;
        const seatNo = rawSeatNo === null || typeof rawSeatNo === "undefined" || String(rawSeatNo).trim() === ""
            ? ""
            : String(rawSeatNo);

        return {
            controlNo: examRecord.exam_control_no || "-",
            scoreText: hasScore ? String(score) : "-",
            percentageText: percent === null || typeof percent === "undefined" ? "-" : String(percent) + "%",
            roomLabel: roomLabel,
            seatNo: seatNo,
            status: recordStatus,
            statusLabel: recordStatusMeta.label,
            statusChipClass: recordStatusMeta.chipClass,
            result: result,
            resultLabel: failedToTakeExam ? "Failed to Take Exam" : resultMeta.label,
            resultChipClass: resultMeta.chipClass
        };
    }

    function applicantVisibleStatus(status, specialConsideration, sectorSelected) {
        const normalized = normalizeStatus(status);
        if (specialConsideration === true && ["exam_completed", "passed_exam", "failed_exam"].indexOf(normalized) !== -1) {
            return "passed_exam";
        }
        if (sectorSelected === true && ["exam_completed", "passed_exam", "failed_exam"].indexOf(normalized) !== -1) {
            return "selected";
        }
        if (["exam_completed", "passed_exam", "failed_exam"].indexOf(normalized) !== -1) {
            if (!applicantExamResultsVisible()) {
                return "exam_completed";
            }
        }
        return normalized;
    }

    function applicantExamDisplayMeta(examSummary, options) {
        const summary = examSummary || {};
        const specialConsideration = Boolean(options && options.specialConsideration);
        const sectorSelected = Boolean(options && options.sectorSelected);
        const showFailedScore = options && Object.prototype.hasOwnProperty.call(options, "showFailedScore")
            ? options.showFailedScore !== false
            : true;
        const recordStatus = normalizeExamRecordStatus(summary.status);
        const normalizedResult = normalizeExamResult(summary.result || "pending");
        const scoreText = summary.scoreText === null || typeof summary.scoreText === "undefined" || summary.scoreText === ""
            ? "-"
            : String(summary.scoreText);
        const hasScore = scoreText !== "-";
        const specialPass = specialConsideration === true;

        if (specialPass) {
            const specialScoreText = specialConsiderationDisplayScore();
            return {
                result: "passed",
                scoreText: showFailedScore ? specialScoreText : "-",
                hasScore: showFailedScore,
                displayText: showFailedScore ? (specialScoreText + " | PASSED") : "PASSED",
                displayLabel: "PASSED",
                chipLabel: "PASSED",
                chipClass: EXAM_RESULT_META.passed.chipClass,
                textClass: "text-success"
            };
        }

        if (sectorSelected === true) {
            const sectorClassificationText = formatSectorClassificationDisplay(options && options.sectorClassification);
            return {
                result: "selected",
                scoreText: showFailedScore ? scoreText : "-",
                hasScore: showFailedScore && hasScore,
                displayText: showFailedScore && hasScore
                    ? (scoreText + " | SELECTED")
                    : "SELECTED",
                displayLabel: "SELECTED",
                chipLabel: "Selected",
                chipClass: "ldss-chip-success",
                textClass: "text-success",
                sectorClassificationText: sectorClassificationText
            };
        }

        if (!showFailedScore) {
            return {
                result: "pending",
                scoreText: "-",
                hasScore: false,
                displayText: "Scores are being consolidated",
                displayLabel: "Score Consolidation",
                chipLabel: "Score Consolidation",
                chipClass: EXAM_RESULT_META.pending.chipClass,
                textClass: "text-warning"
            };
        }

        if (recordStatus === "absent") {
            return {
                result: "absent",
                scoreText: "-",
                hasScore: false,
                displayText: summary.resultLabel || "No Result",
                displayLabel: summary.resultLabel || "No Result",
                chipLabel: "No Result",
                chipClass: EXAM_RECORD_STATUS_META.absent.chipClass,
                textClass: "text-muted"
            };
        }

        if (normalizedResult === "passed") {
            return {
                result: "passed",
                scoreText: "-",
                hasScore: false,
                displayText: "PASSED",
                displayLabel: "PASSED",
                chipLabel: "PASSED",
                chipClass: EXAM_RESULT_META.passed.chipClass,
                textClass: "text-success"
            };
        }

        if (normalizedResult === "failed") {
            const displayText = showFailedScore && hasScore ? (scoreText + " | FAIL") : "FAIL";
            return {
                result: "failed",
                scoreText: scoreText,
                hasScore: showFailedScore && hasScore,
                displayText: displayText,
                displayLabel: "FAIL",
                chipLabel: "FAIL",
                chipClass: EXAM_RESULT_META.failed.chipClass,
                textClass: "text-danger"
            };
        }

        const consolidationLabel = summary.resultLabel || EXAM_RESULT_META.pending.label;
        return {
            result: normalizedResult,
            scoreText: "-",
            hasScore: false,
            displayText: consolidationLabel,
            displayLabel: consolidationLabel,
            chipLabel: consolidationLabel,
            chipClass: summary.resultChipClass || EXAM_RESULT_META.pending.chipClass,
            textClass: "text-muted"
        };
    }

    window.LDSS_WORKFLOW = {
        STATUS_ORDER: STATUS_ORDER.slice(),
        normalizeStatus: normalizeStatus,
        statusMeta: statusMeta,
        applicantStatusMeta: applicantStatusMeta,
        nextStepForApplicant: nextStepForApplicant,
        isExamCheckingStage: isExamCheckingStage,
        normalizeExamResult: normalizeExamResult,
        examResultMeta: examResultMeta,
        normalizeExamRecordStatus: normalizeExamRecordStatus,
        examRecordStatusMeta: examRecordStatusMeta,
        examSummaryFromRecord: examSummaryFromRecord,
        applicantVisibleStatus: applicantVisibleStatus,
        applicantExamDisplayMeta: applicantExamDisplayMeta,
        specialConsiderationDisplayScore: specialConsiderationDisplayScore,
        formatSectorClassificationDisplay: formatSectorClassificationDisplay,
        isSectorSelectedStatus: isSectorSelectedStatus
    };
})(window);
