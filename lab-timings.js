/* Shared lab-timings engine for the student and teacher dashboards.
   Owns the date maths, the three-colour day classification, the month
   grid, the nine-period list and all Supabase reads/writes. The pages
   supply a clock (so the simulated clock is respected), a mode
   ("teacher" for editing, "student" for read-only) and callbacks.

   Day states:
     open    lab open for at least one period   -> green
     closed  teaching day, no lab               -> yellow
     holiday national holiday                  -> grey
     weekend Saturday or Sunday                -> grey, not shown as a state

   Exposed as window.OtterLab. */

(function () {
    "use strict";

    const PERIOD_COUNT = 9;
    const DAY_OPEN = "open";
    const DAY_CLOSED = "closed";
    const DAY_HOLIDAY = "holiday";
    const DAY_WEEKEND = "weekend";

    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    /* Leading blank days so the grid starts on Monday. */
    const MONTH_PREFIX = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    /* ---------- date maths (all strings are YYYY-MM-DD) ---------- */

    function isoStamp(year, month, day) {
        if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const probe = new Date(Date.UTC(year, month - 1, day));
        if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function splitStamp(stamp) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(stamp || ""));
        if (!match) return null;
        return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    }

    /* Built in UTC on purpose: a bare date has no timezone, and mixing
       local parsing here is how calendars drift by a day. */
    function weekdayOf(stamp) {
        const parts = splitStamp(stamp);
        if (!parts) return null;
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    }

    function isWeekend(stamp) {
        const dow = weekdayOf(stamp);
        return dow === 0 || dow === 6;
    }

    function shiftStamp(stamp, days) {
        const parts = splitStamp(stamp);
        if (!parts) return null;
        const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
        return isoStamp(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
    }

    function firstOfMonth(year, month) { return isoStamp(year, month, 1); }

    function lastOfMonth(year, month) {
        return isoStamp(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
    }

    function formatLong(stamp) {
        const parts = splitStamp(stamp);
        if (!parts) return "";
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
            .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    }

    function formatShort(stamp) {
        const parts = splitStamp(stamp);
        if (!parts) return "";
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
            .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }

    function monthTitle(year, month) { return `${MONTH_NAMES[month - 1]} ${year}`; }

    /* Monday-first cells covering the month. */
    function monthGrid(year, month) {
        const first = firstOfMonth(year, month);
        const lead = (weekdayOf(first) + 6) % 7;
        const total = Number(lastOfMonth(year, month).slice(8));
        const cells = [];
        for (let i = 0; i < lead; i += 1) cells.push(null);
        for (let day = 1; day <= total; day += 1) cells.push(isoStamp(year, month, day));
        while (cells.length % 7 !== 0) cells.push(null);
        return cells;
    }

    /* ---------- time formatting ---------- */

    function formatClock(value) {
        const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
        if (!match) return String(value || "");
        const hours = Number(match[1]);
        const minutes = match[2];
        const suffix = hours >= 12 ? "pm" : "am";
        const hour12 = hours % 12 === 0 ? 12 : hours % 12;
        return `${hour12}:${minutes} ${suffix}`;
    }

    function timeRange(startsAt, endsAt) {
        if (!startsAt || !endsAt) return "";
        return `${formatClock(startsAt)} – ${formatClock(endsAt)}`;
    }

    /* "Period 1 – Period 4" for a contiguous run, "P2, P4, P6" otherwise. */
    function describeOpenPeriods(numbers, periods) {
        if (!numbers.length) return "No lab";
        const sorted = [...numbers].sort((a, b) => a - b);
        const runs = [];
        let start = sorted[0];
        let previous = sorted[0];
        for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i] === previous + 1) { previous = sorted[i]; continue; }
            runs.push([start, previous]);
            start = sorted[i];
            previous = sorted[i];
        }
        runs.push([start, previous]);

        const nameOf = number => {
            const row = periods.find(item => Number(item.period_no) === number);
            return (row && row.label) || `Period ${number}`;
        };

        if (runs.length === 1 && runs[0][0] !== runs[0][1]) return `${nameOf(runs[0][0])} – ${nameOf(runs[0][1])}`;
        return runs.map(([from, to]) => (from === to ? nameOf(from) : `${nameOf(from)} – ${nameOf(to)}`)).join(", ");
    }

    /* ---------- module state ---------- */

    const state = {
        mode: "student",
        supabase: null,
        now: () => new Date(),
        periods: [],
        holidays: new Map(),
        slots: new Map(),
        year: 0,
        month: 0,
        selected: null,
        draft: new Set(),
        holidayDraft: false,
        holidayNameDraft: "",
        dirty: false,
        range: null,
        onRender: null,
        onChange: null,
        onNotice: null
    };

    function todayStamp() {
        const now = state.now();
        return isoStamp(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }

    function slotKey(stamp, periodNo) { return `${stamp}|${Number(periodNo)}`; }

    function openPeriodsFor(stamp) {
        const numbers = [];
        for (let period = 1; period <= PERIOD_COUNT; period += 1) {
            if (state.slots.has(slotKey(stamp, period))) numbers.push(period);
        }
        return numbers;
    }

    /* Holiday is checked before weekend: a national holiday that lands on a
       Saturday is still a named holiday, and the day panel should say so. */
    function classifyDay(stamp) {
        if (!stamp) return DAY_WEEKEND;
        if (state.holidays.has(stamp)) return DAY_HOLIDAY;
        if (isWeekend(stamp)) return DAY_WEEKEND;
        return openPeriodsFor(stamp).length ? DAY_OPEN : DAY_CLOSED;
    }

    /* Nearest teaching day with lab, searching forward from today. */
    function nearestLabDay(fromStamp) {
        let cursor = shiftStamp(fromStamp || todayStamp(), 0);
        for (let step = 0; step < 400; step += 1) {
            if (classifyDay(cursor) === DAY_OPEN) return cursor;
            cursor = shiftStamp(cursor, 1);
        }
        return fromStamp || todayStamp();
    }

    function nextLabDay(fromStamp) {
        let cursor = shiftStamp(fromStamp || todayStamp(), 1);
        for (let step = 0; step < 400; step += 1) {
            if (classifyDay(cursor) === DAY_OPEN) return cursor;
            cursor = shiftStamp(cursor, 1);
        }
        return null;
    }

    function prevLabDay(fromStamp) {
        let cursor = shiftStamp(fromStamp || todayStamp(), -1);
        for (let step = 0; step < 400; step += 1) {
            if (classifyDay(cursor) === DAY_OPEN) return cursor;
            cursor = shiftStamp(cursor, -1);
        }
        return null;
    }

    function anyPublished() {
        return state.slots.size > 0;
    }

    /* ---------- data ---------- */

    /* The three tables have distinct shapes, so each row is routed by the
       columns it actually carries rather than by which query it came from. */
    function indexRows(rows) {
        const all = rows || [];

        state.periods = all
            .filter(row => row && row.period_no != null && row.starts_at != null)
            .sort((a, b) => Number(a.period_no) - Number(b.period_no));

        state.holidays = new Map();
        all.forEach(row => {
            if (row && row.holiday_date) state.holidays.set(String(row.holiday_date), String(row.name || "Holiday"));
        });

        const map = new Map();
        all.forEach(row => {
            if (!row || !row.slot_date) return;
            const key = slotKey(String(row.slot_date), row.period_no);
            if (!map.has(key)) map.set(key, row);
        });
        state.slots = map;
    }

    /* Pulls periods, holidays and open slots in one round trip. The
       window is wide enough that "nearest lab day" never has to guess. */
    async function loadData() {
        if (!state.supabase) return;
        const today = todayStamp();
        const from = state.range ? state.range.from : shiftStamp(today, -62);
        const to = state.range ? state.range.to : shiftStamp(today, 400);

        const [periodsRes, holidaysRes, slotsRes] = await Promise.all([
            state.supabase.from("lab_periods").select("period_no, label, starts_at, ends_at").order("period_no", { ascending: true }),
            state.supabase.from("lab_holidays").select("holiday_date, name"),
            state.supabase.from("lab_open_slots").select("slot_date, period_no, note").gte("slot_date", from).lte("slot_date", to)
        ]);

        const failed = [periodsRes, holidaysRes, slotsRes].find(result => result && result.error);
        if (failed) { state.lastError = failed.error; return; }
        state.lastError = null;

        indexRows([
            ...(periodsRes.data || []),
            ...(holidaysRes.data || []),
            ...(slotsRes.data || [])
        ]);
    }

    async function ensureRange(from, to) {
        if (state.range && from >= state.range.from && to <= state.range.to) return false;
        const today = todayStamp();
        state.range = {
            from: from < shiftStamp(today, -62) ? from : shiftStamp(today, -62),
            to: to > shiftStamp(today, 400) ? to : shiftStamp(today, 400)
        };
        return true;
    }

    /* ---------- rendering ---------- */

    function dayCellHtml(stamp) {
        if (!stamp) return `<div class="lab-day lab-day-blank" aria-hidden="true"></div>`;
        const status = classifyDay(stamp);
        const numbers = status === DAY_OPEN ? openPeriodsFor(stamp) : [];
        const parts = splitStamp(stamp);
        const isToday = stamp === todayStamp();
        const isSelected = stamp === state.selected;
        const title = status === DAY_HOLIDAY ? state.holidays.get(stamp)
            : status === DAY_OPEN ? `Lab open · ${describeOpenPeriods(numbers, state.periods)}`
            : status === DAY_WEEKEND ? "Weekend" : "No lab";

        const classes = ["lab-day", `is-${status}`];
        if (isToday) classes.push("is-today");
        if (isSelected) classes.push("is-selected");

        /* The four states get four distinct marks so the calendar still reads
           in greyscale or with colour vision deficiency: the backgrounds are
           deliberately near-identical in luma. */
        const MARKER = { [DAY_OPEN]: "●", [DAY_HOLIDAY]: "◆", [DAY_CLOSED]: "—" };
        const marker = MARKER[status]
            ? `<i class="lab-day-mark" aria-hidden="true">${MARKER[status]}</i>` : "";

        return `<button class="${classes.join(" ")}" type="button" data-lab-stamp="${stamp}" title="${escapeHtml(title)}" aria-label="${escapeHtml(`${parts.day} ${MONTH_NAMES[parts.month - 1]}, ${title}`)}"${isSelected ? ' aria-current="date"' : ""}>
            <span class="lab-day-num">${parts.day}</span>${marker}
        </button>`;
    }

    function renderCalendar(container) {
        const cells = monthGrid(state.year, state.month);
        container.innerHTML = cells.map(dayCellHtml).join("");
    }

    function periodRowHtml(row, options) {
        const periodNo = Number(row.period_no);
        const isOpen = options.draft.has(periodNo);
        const range = timeRange(row.starts_at, row.ends_at);
        if (options.editable) {
            return `<div class="lab-period ${isOpen ? "is-open" : "is-closed"}">
                <button class="lab-period-toggle" type="button" role="switch" aria-checked="${isOpen}" data-lab-period="${periodNo}">
                    <span class="lab-period-key" aria-hidden="true">${periodNo}</span>
                    <span class="lab-period-body">
                        <strong>${escapeHtml(row.label || `Period ${periodNo}`)}</strong>
                        <small>${escapeHtml(range)}</small>
                    </span>
                    <span class="lab-period-state">${isOpen ? "Lab open" : "No lab"}</span>
                </button>
            </div>`;
        }
        return `<div class="lab-period ${isOpen ? "is-open" : "is-closed"}">
            <div class="lab-period-toggle" role="listitem">
                <span class="lab-period-key" aria-hidden="true">${periodNo}</span>
                <span class="lab-period-body">
                    <strong>${escapeHtml(row.label || `Period ${periodNo}`)}</strong>
                    <small>${escapeHtml(range)}</small>
                </span>
                <span class="lab-period-state">${isOpen ? "Lab open" : "No lab"}</span>
            </div>
        </div>`;
    }

    function renderPeriodList(container, options) {
        if (!state.periods.length) {
            container.innerHTML = `<div class="empty-state"><strong>No timetable yet</strong><p>The nine period slots have not been set up.</p></div>`;
            return;
        }
        container.innerHTML = state.periods.map(row => periodRowHtml(row, options)).join("");
    }

    function renderTimetableGrid(container) {
        if (!state.periods.length) {
            container.innerHTML = `<div class="empty-state"><strong>No timetable yet</strong><p>Add the nine period slots to get started.</p></div>`;
            return;
        }
        container.innerHTML = state.periods.map(row => `
            <div class="lab-tt-row" data-lab-tt="${Number(row.period_no)}">
                <span class="lab-tt-key" aria-hidden="true">${Number(row.period_no)}</span>
                <label class="lab-tt-field">
                    <span>Label</span>
                    <input type="text" data-lab-tt-field="label" value="${escapeHtml(row.label || "")}" autocomplete="off">
                </label>
                <label class="lab-tt-field">
                    <span>Starts</span>
                    <input type="time" data-lab-tt-field="starts_at" value="${escapeHtml(String(row.starts_at || "").slice(0, 5))}">
                </label>
                <label class="lab-tt-field">
                    <span>Ends</span>
                    <input type="time" data-lab-tt-field="ends_at" value="${escapeHtml(String(row.ends_at || "").slice(0, 5))}">
                </label>
            </div>`).join("");
    }

    /* ---------- teacher: selection and drafts ---------- */

    function selectDay(stamp) {
        state.selected = stamp;
        state.draft = new Set(openPeriodsFor(stamp));
        state.holidayDraft = state.holidays.has(stamp);
        state.holidayNameDraft = state.holidays.get(stamp) || "";
        state.dirty = false;
    }

    function togglePeriod(periodNo) {
        if (state.mode !== "teacher") return;
        if (state.draft.has(periodNo)) state.draft.delete(periodNo);
        else state.draft.add(periodNo);
        state.dirty = true;
    }

    function setAllPeriods(value) {
        if (state.mode !== "teacher") return;
        state.draft = new Set();
        if (value) for (let period = 1; period <= PERIOD_COUNT; period += 1) state.draft.add(period);
        state.dirty = true;
    }

    function setHolidayDraft(present, name) {
        if (state.mode !== "teacher") return;
        state.holidayDraft = !!present;
        if (name != null) state.holidayNameDraft = String(name || "");
        state.dirty = true;
    }

    function showMonth(year, month) {
        state.year = year;
        state.month = month;
    }

    function moveMonth(delta) {
        const total = state.year * 12 + (state.month - 1) + delta;
        state.year = Math.floor(total / 12);
        state.month = (total % 12) + 1;
    }

    /* ---------- teacher: writes ---------- */

    function rpcMissing(error) {
        const code = error && (error.code || "");
        const message = String((error && error.message) || "").toLowerCase();
        return code === "42883" || code === "42P01" || message.includes("does not exist") || message.includes("not found");
    }

    async function saveDay() {
        if (state.mode !== "teacher" || !state.selected) return { ok: false };
        const stamp = state.selected;

        const holidayResult = await state.supabase.rpc("teacher_set_lab_holiday", {
            p_date: stamp,
            p_name: state.holidayNameDraft || state.holidays.get(stamp) || "Holiday",
            p_present: state.holidayDraft
        });
        if (holidayResult.error) {
            return { ok: false, error: holidayResult.error, missing: rpcMissing(holidayResult.error) };
        }

        if (state.holidayDraft) {
            state.holidays.set(stamp, state.holidayNameDraft || "Holiday");
        } else {
            state.holidays.delete(stamp);
        }

        const dayResult = await state.supabase.rpc("teacher_set_lab_day", {
            p_date: stamp,
            p_periods: [...state.draft].sort((a, b) => a - b)
        });
        if (dayResult.error) {
            return { ok: false, error: dayResult.error, missing: rpcMissing(dayResult.error) };
        }

        const numbers = [...state.draft];
        for (let period = 1; period <= PERIOD_COUNT; period += 1) {
            const key = slotKey(stamp, period);
            if (numbers.includes(period)) {
                if (!state.slots.has(key)) state.slots.set(key, { slot_date: stamp, period_no: period });
            } else {
                state.slots.delete(key);
            }
        }
        state.dirty = false;
        return { ok: true };
    }

    async function clearDay() {
        if (state.mode !== "teacher" || !state.selected) return { ok: false };
        const stamp = state.selected;

        const holidayResult = await state.supabase.rpc("teacher_set_lab_holiday", { p_date: stamp, p_name: "", p_present: false });
        if (holidayResult.error) return { ok: false, error: holidayResult.error, missing: rpcMissing(holidayResult.error) };
        state.holidays.delete(stamp);

        const dayResult = await state.supabase.rpc("teacher_set_lab_day", { p_date: stamp, p_periods: [] });
        if (dayResult.error) return { ok: false, error: dayResult.error, missing: rpcMissing(dayResult.error) };

        for (let period = 1; period <= PERIOD_COUNT; period += 1) state.slots.delete(slotKey(stamp, period));
        state.draft = new Set();
        state.holidayDraft = false;
        state.holidayNameDraft = "";
        state.dirty = false;
        return { ok: true };
    }

    function readTimetableForm(container) {
        return [...container.querySelectorAll("[data-lab-tt]")].map(row => {
            const field = name => row.querySelector(`[data-lab-tt-field="${name}"]`);
            return {
                period_no: Number(row.dataset.labTt),
                label: (field("label").value || "").trim(),
                starts_at: field("starts_at").value,
                ends_at: field("ends_at").value
            };
        });
    }

    function validateTimetable(rows) {
        if (rows.length !== PERIOD_COUNT) return "All nine periods need a start and an end time.";
        for (const row of rows) {
            if (!row.starts_at || !row.ends_at) return `Period ${row.period_no} is missing a time.`;
            if (row.starts_at >= row.ends_at) return `Period ${row.period_no} ends before it starts.`;
        }
        return null;
    }

    async function savePeriods(container) {
        if (state.mode !== "teacher") return { ok: false };
        const rows = readTimetableForm(container);
        const problem = validateTimetable(rows);
        if (problem) return { ok: false, validation: problem };

        const result = await state.supabase.rpc("teacher_set_lab_periods", { p_rows: rows });
        if (result.error) return { ok: false, error: result.error, missing: rpcMissing(result.error) };

        rows.forEach(row => {
            const existing = state.periods.find(item => Number(item.period_no) === row.period_no);
            if (existing) Object.assign(existing, row);
        });
        return { ok: true };
    }

    /* ---------- realtime ---------- */

    function subscribe(onChange) {
        if (!state.supabase) return;
        state.supabase.channel("lab-timings-feed")
            .on("postgres_changes", { event: "*", schema: "public", table: "lab_open_slots" }, () => onChange())
            .on("postgres_changes", { event: "*", schema: "public", table: "lab_holidays" }, () => onChange())
            .on("postgres_changes", { event: "*", schema: "public", table: "lab_periods" }, () => onChange())
            .subscribe();
    }

    function init(options) {
        state.mode = options.mode === "teacher" ? "teacher" : "student";
        state.supabase = options.supabase;
        if (typeof options.now === "function") state.now = options.now;
        state.onRender = options.onRender || null;
        state.onChange = options.onChange || null;
        state.onNotice = options.onNotice || null;

        const today = todayStamp();
        const parts = splitStamp(today);
        showMonth(parts.year, parts.month);
        return state;
    }

    window.OtterLab = {
        PERIOD_COUNT,
        DAY_OPEN,
        DAY_CLOSED,
        DAY_HOLIDAY,
        DAY_WEEKEND,
        MONTH_NAMES,
        init,
        state,
        escapeHtml,
        isoStamp,
        splitStamp,
        weekdayOf,
        isWeekend,
        shiftStamp,
        firstOfMonth,
        lastOfMonth,
        formatLong,
        formatShort,
        monthTitle,
        monthGrid,
        formatClock,
        timeRange,
        describeOpenPeriods,
        todayStamp,
        slotKey,
        openPeriodsFor,
        classifyDay,
        nearestLabDay,
        nextLabDay,
        prevLabDay,
        anyPublished,
        loadData,
        ensureRange,
        indexRows,
        renderCalendar,
        renderPeriodList,
        renderTimetableGrid,
        selectDay,
        togglePeriod,
        setAllPeriods,
        setHolidayDraft,
        showMonth,
        moveMonth,
        saveDay,
        clearDay,
        savePeriods,
        validateTimetable,
        readTimetableForm,
        subscribe
    };
})();
