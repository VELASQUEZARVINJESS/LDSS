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
            chipClass: "ldss-chip-accent",
            nextStep: "Wait for encoded exam score and result."
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
        pending: { label: "Pending", chipClass: "ldss-chip-neutral" },
        passed: { label: "Passed", chipClass: "ldss-chip-success" },
        failed: { label: "Failed", chipClass: "ldss-chip-danger" }
    };

    function activeWorkflowControls() {
        return window.LDSS_ACTIVE_WORKFLOW_CONTROLS || {};
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
                label: "Checking Examination",
                chipClass: "ldss-chip-accent",
                nextStep: "The scholarship office is checking examination scores now. Please wait for the next update."
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

    function examSummaryFromRecord(examRecord) {
        if (!examRecord) {
            return {
                controlNo: "-",
                scoreText: "-",
                percentageText: "-",
                roomLabel: "",
                seatNo: "",
                result: "pending",
                resultLabel: EXAM_RESULT_META.pending.label,
                resultChipClass: EXAM_RESULT_META.pending.chipClass
            };
        }

        const score = examRecord.raw_score;
        const percent = examRecord.percentage_score;
        const result = normalizeExamResult(examRecord.result);
        const resultMeta = examResultMeta(result);
        const roomLabel = (examRecord.room_label || "").toString().trim();
        const rawSeatNo = examRecord.room_seat_no;
        const seatNo = rawSeatNo === null || typeof rawSeatNo === "undefined" || String(rawSeatNo).trim() === ""
            ? ""
            : String(rawSeatNo);

        return {
            controlNo: examRecord.exam_control_no || "-",
            scoreText: score === null || typeof score === "undefined" ? "-" : String(score),
            percentageText: percent === null || typeof percent === "undefined" ? "-" : String(percent) + "%",
            roomLabel: roomLabel,
            seatNo: seatNo,
            result: result,
            resultLabel: resultMeta.label,
            resultChipClass: resultMeta.chipClass
        };
    }

    window.LDSS_WORKFLOW = {
        STATUS_ORDER: STATUS_ORDER.slice(),
        normalizeStatus: normalizeStatus,
        statusMeta: statusMeta,
        nextStepForApplicant: nextStepForApplicant,
        isExamCheckingStage: isExamCheckingStage,
        normalizeExamResult: normalizeExamResult,
        examResultMeta: examResultMeta,
        examSummaryFromRecord: examSummaryFromRecord
    };
})(window);
