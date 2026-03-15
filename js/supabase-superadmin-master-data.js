(function () {
    "use strict";

    const STORAGE_KEY = "ldss:sector-options:v1";
    const COUNSELOR_OPTIONS_STORAGE_KEY = "ldss:counselor-options:v1";
    const INTERVIEW_SCHEDULE_STORAGE_KEY = "ldss:default-interview-schedule:v1";
    const INTERVIEW_VENUE_STORAGE_KEY = "ldss:default-interview-venue:v1";
    const DEFAULT_OPTIONS = [
        "PWD",
        "Solo Parent",
        "Farmer Household",
        "Fisherfolk Household",
        "4Ps Beneficiary",
        "Indigenous Peoples"
    ];
    const DEFAULT_COUNSELOR_OPTIONS = [];

    let sectorOptions = [];
    let counselorOptions = [];

    function byId(id) {
        return document.getElementById(id);
    }

    function normalizeTag(value) {
        return (value || "")
            .toString()
            .trim()
            .replace(/\s+/g, " ");
    }

    function uniqueTags(values) {
        const out = [];
        const seen = new Set();

        (values || []).forEach(function (value) {
            const clean = normalizeTag(value);
            if (!clean) {
                return;
            }
            const key = clean.toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            out.push(clean);
        });

        return out;
    }

    function showStatus(message, type) {
        const status = byId("masterDataStatus");
        if (!status) {
            return;
        }
        if (!message) {
            status.className = "alert d-none";
            status.textContent = "";
            return;
        }
        status.className = "alert " + (type || "alert-info");
        status.textContent = message;
    }

    function readStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return DEFAULT_OPTIONS.slice();
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return DEFAULT_OPTIONS.slice();
            }
            const options = uniqueTags(parsed).slice(0, 20);
            return options.length > 0 ? options : DEFAULT_OPTIONS.slice();
        } catch (error) {
            return DEFAULT_OPTIONS.slice();
        }
    }

    function writeStorage(values) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(uniqueTags(values).slice(0, 20)));
    }

    function readCounselorOptions() {
        try {
            const raw = localStorage.getItem(COUNSELOR_OPTIONS_STORAGE_KEY);
            if (!raw) {
                return DEFAULT_COUNSELOR_OPTIONS.slice();
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return DEFAULT_COUNSELOR_OPTIONS.slice();
            }
            return uniqueTags(parsed).slice(0, 20);
        } catch (error) {
            return DEFAULT_COUNSELOR_OPTIONS.slice();
        }
    }

    function writeCounselorOptions(values) {
        localStorage.setItem(COUNSELOR_OPTIONS_STORAGE_KEY, JSON.stringify(uniqueTags(values).slice(0, 20)));
    }

    function readInterviewSchedule() {
        try {
            return (localStorage.getItem(INTERVIEW_SCHEDULE_STORAGE_KEY) || "").trim();
        } catch (error) {
            return "";
        }
    }

    function writeInterviewSchedule(value) {
        localStorage.setItem(INTERVIEW_SCHEDULE_STORAGE_KEY, (value || "").toString().trim());
    }

    function readInterviewVenue() {
        try {
            return (localStorage.getItem(INTERVIEW_VENUE_STORAGE_KEY) || "").trim();
        } catch (error) {
            return "";
        }
    }

    function writeInterviewVenue(value) {
        localStorage.setItem(INTERVIEW_VENUE_STORAGE_KEY, (value || "").toString().trim());
    }

    function renderSectorOptions() {
        const list = byId("masterDataSectorList");
        if (!list) {
            return;
        }

        list.innerHTML = "";
        if (!sectorOptions.length) {
            const empty = document.createElement("span");
            empty.className = "small text-muted";
            empty.textContent = "No tags configured yet.";
            list.appendChild(empty);
            return;
        }

        sectorOptions.forEach(function (tag, index) {
            const pill = document.createElement("div");
            pill.className = "d-inline-flex align-items-center gap-2 px-2 py-1 border rounded bg-light";

            const label = document.createElement("span");
            label.className = "small fw-600";
            label.textContent = tag;

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn btn-outline-dark btn-sm py-0 px-2";
            remove.setAttribute("data-remove-sector", String(index));
            remove.textContent = "x";

            pill.appendChild(label);
            pill.appendChild(remove);
            list.appendChild(pill);
        });
    }

    function renderCounselorOptions() {
        const list = byId("masterDataCounselorList");
        if (!list) {
            return;
        }

        list.innerHTML = "";
        if (!counselorOptions.length) {
            const empty = document.createElement("span");
            empty.className = "small text-muted";
            empty.textContent = "No counselors configured yet.";
            list.appendChild(empty);
            return;
        }

        counselorOptions.forEach(function (name, index) {
            const pill = document.createElement("div");
            pill.className = "d-inline-flex align-items-center gap-2 px-2 py-1 border rounded bg-light";

            const label = document.createElement("span");
            label.className = "small fw-600";
            label.textContent = name;

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "btn btn-outline-dark btn-sm py-0 px-2";
            remove.setAttribute("data-remove-counselor", String(index));
            remove.textContent = "x";

            pill.appendChild(label);
            pill.appendChild(remove);
            list.appendChild(pill);
        });
    }

    function addSectorTag() {
        const input = byId("masterDataSectorInput");
        if (!input) {
            return;
        }

        const value = normalizeTag(input.value).slice(0, 40);
        if (!value) {
            showStatus("Enter a sector tag before adding.", "alert-warning");
            return;
        }

        const exists = sectorOptions.some(function (item) {
            return item.toLowerCase() === value.toLowerCase();
        });
        if (exists) {
            showStatus("That sector tag already exists.", "alert-warning");
            return;
        }

        if (sectorOptions.length >= 20) {
            showStatus("Maximum of 20 sector tags reached.", "alert-warning");
            return;
        }

        sectorOptions.push(value);
        input.value = "";
        renderSectorOptions();
        showStatus("Sector tag added. Click Save Changes to apply.", "alert-info");
    }

    function addCounselorOption() {
        const input = byId("masterDataCounselorInput");
        if (!input) {
            return;
        }

        const value = normalizeTag(input.value).slice(0, 60);
        if (!value) {
            showStatus("Enter a counselor name before adding.", "alert-warning");
            return;
        }

        const exists = counselorOptions.some(function (item) {
            return item.toLowerCase() === value.toLowerCase();
        });
        if (exists) {
            showStatus("That counselor name already exists.", "alert-warning");
            return;
        }

        if (counselorOptions.length >= 20) {
            showStatus("Maximum of 20 counselor names reached.", "alert-warning");
            return;
        }

        counselorOptions.push(value);
        input.value = "";
        renderCounselorOptions();
        showStatus("Counselor name added. Click Save Changes to apply.", "alert-info");
    }

    function removeSectorTag(index) {
        if (Number.isNaN(index) || index < 0 || index >= sectorOptions.length) {
            return;
        }
        sectorOptions.splice(index, 1);
        renderSectorOptions();
        showStatus("Sector tag removed. Click Save Changes to apply.", "alert-info");
    }

    function removeCounselorOption(index) {
        if (Number.isNaN(index) || index < 0 || index >= counselorOptions.length) {
            return;
        }
        counselorOptions.splice(index, 1);
        renderCounselorOptions();
        showStatus("Counselor name removed. Click Save Changes to apply.", "alert-info");
    }

    function bindActions() {
        const addBtn = byId("masterDataAddSectorBtn");
        const addCounselorBtn = byId("masterDataAddCounselorBtn");
        const saveBtn = byId("masterDataSaveSectorsBtn");
        const resetBtn = byId("masterDataResetSectorsBtn");
        const list = byId("masterDataSectorList");
        const counselorList = byId("masterDataCounselorList");
        const input = byId("masterDataSectorInput");
        const counselorInput = byId("masterDataCounselorInput");

        if (addBtn) {
            addBtn.addEventListener("click", addSectorTag);
        }

        if (addCounselorBtn) {
            addCounselorBtn.addEventListener("click", addCounselorOption);
        }

        if (input) {
            input.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    addSectorTag();
                }
            });
        }

        if (counselorInput) {
            counselorInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    event.preventDefault();
                    addCounselorOption();
                }
            });
        }

        if (list) {
            list.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-remove-sector]");
                if (!trigger) {
                    return;
                }
                const index = Number(trigger.getAttribute("data-remove-sector"));
                removeSectorTag(index);
            });
        }

        if (counselorList) {
            counselorList.addEventListener("click", function (event) {
                const trigger = event.target.closest("[data-remove-counselor]");
                if (!trigger) {
                    return;
                }
                const index = Number(trigger.getAttribute("data-remove-counselor"));
                removeCounselorOption(index);
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener("click", function () {
                try {
                    // TODO(Supabase): persist sector tags in a shared master_data table instead of localStorage.
                    writeStorage(sectorOptions);
                    writeCounselorOptions(counselorOptions);
                    writeInterviewSchedule(byId("masterDataInterviewSchedule") ? byId("masterDataInterviewSchedule").value : "");
                    writeInterviewVenue(byId("masterDataInterviewVenue") ? byId("masterDataInterviewVenue").value : "");
                    showStatus("Master data saved successfully.", "alert-success");
                } catch (error) {
                    showStatus("Failed to save master data. Check browser storage settings.", "alert-danger");
                }
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener("click", function () {
                sectorOptions = DEFAULT_OPTIONS.slice();
                renderSectorOptions();
                showStatus("Default sector tags loaded. Click Save Changes to apply.", "alert-info");
            });
        }
    }

    function init() {
        sectorOptions = readStorage();
        counselorOptions = readCounselorOptions();
        renderSectorOptions();
        renderCounselorOptions();
        if (byId("masterDataInterviewSchedule")) {
            byId("masterDataInterviewSchedule").value = readInterviewSchedule();
        }
        if (byId("masterDataInterviewVenue")) {
            byId("masterDataInterviewVenue").value = readInterviewVenue();
        }
        bindActions();
    }

    window.addEventListener("DOMContentLoaded", init);
})();
