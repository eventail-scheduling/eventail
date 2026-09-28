import { isBefore, isBeforeOrEqual } from "temporal-extra";
import { match } from "ts-pattern";

export const SNAP_MINUTES = 30;
const HOURS_IN_A_DAY = 24;
export const MINUTES_PER_DAY = HOURS_IN_A_DAY * 60;
/** How near an edge a gesture has to reach before the grid follows it. */
const SCROLL_EDGE = 50;
/** How fast it follows at the very edge, in pixels a second. */
const SCROLL_MAX_SPEED = 300;
/** A tap lands a block of this length, for anyone not painting one by hand. */
export const TAP_MINUTES = 30;
/** Minutes counted from midnight on the first day, which is what a block is stored as. */
export type AbsoluteRange = {
    from: number;
    to: number;
};

/** Which way a gesture has moved at some point during its life. */
export type EdgesReached = {
    up: boolean;
    down: boolean;
};
export type Drag = { pointerId: number } & (
    | { mode: "create"; dayIndex: number; anchorMinutes: number; minutes: number }
    | {
          mode: "move";
          index: number;
          grabOffset: number;
          dayIndex: number;
          minutes: number;
          moved: boolean;
      }
    | { mode: "resize"; index: number; edge: "start" | "end"; minutes: number; moved: boolean }
);

export const clamp = (value: number, lowest: number, highest: number): number =>
    Math.min(Math.max(value, lowest), highest);

/**
 * Rounds a minute down to the slot that contains it.
 *
 * Paired with {@link slotEnd}, an edge rounds away from the block it belongs
 * to, so a gesture covers every slot it touched rather than only the lines it
 * passed. A press and a drag that never leaves one slot mean the same thing,
 * and dragging into the top of a slot takes the whole of it either way round.
 */
export const slotStart = (minutes: number): number =>
    Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;

export const slotEnd = (minutes: number): number =>
    Math.ceil(minutes / SNAP_MINUTES) * SNAP_MINUTES;

export const dayOf = (minutesPerColumn: number, absolute: number): number =>
    Math.floor(absolute / minutesPerColumn);

/**
 * How far the grid follows a gesture this frame, from how near an edge it came.
 *
 * It gathers pace toward the edge rather than starting at full tilt, and only
 * an edge the gesture has actually traveled toward pulls at all, or a gesture
 * begun near one would bolt the moment it started.
 */
export const edgeScrollDistance = (
    fromTop: number,
    fromBottom: number,
    reached: EdgesReached,
    elapsedSeconds: number,
): number => {
    if (reached.up && fromTop < SCROLL_EDGE) {
        const nearness = clamp((SCROLL_EDGE - fromTop) / SCROLL_EDGE, 0, 1);

        return -nearness * nearness * SCROLL_MAX_SPEED * elapsedSeconds;
    }

    if (reached.down && fromBottom < SCROLL_EDGE) {
        const nearness = clamp((SCROLL_EDGE - fromBottom) / SCROLL_EDGE, 0, 1);

        return nearness * nearness * SCROLL_MAX_SPEED * elapsedSeconds;
    }

    return 0;
};

/** A scroll offset in whole pixels, and the fraction of a pixel owed to the next frame. */
export type CarriedScroll = {
    position: number;
    carry: number;
};

/**
 * Applies a frame's scroll distance in whole pixels, holding back the fraction for the next frame.
 *
 * Chrome snaps each scroll offset it is given to a device pixel, a whole pixel at a pixel ratio of
 * 1, so a slow follow that moves under half of one per frame would otherwise never move at all.
 * The carry starts over whenever there is nothing to follow, or an end stops the move.
 */
export const carryScroll = (
    position: number,
    distance: number,
    carry: number,
    max: number,
): CarriedScroll => {
    if (distance === 0) {
        return { position, carry: 0 };
    }

    const wanted = carry + distance;
    const whole = Math.trunc(wanted);
    const next = clamp(position + whole, 0, max);

    return next === position + whole
        ? { position: next, carry: wanted - whole }
        : { position: next, carry: 0 };
};

/**
 * Finds the column under the pointer by asking each one, or -1 outside them all.
 *
 * The grid starts on a half pixel, so dividing it by count lands a gesture in
 * the neighboring column whenever rounding goes the other way.
 */
export const columnIndexAt = (columns: readonly (HTMLElement | null)[], clientX: number): number =>
    columns.findIndex((column) => {
        if (!column) {
            return false;
        }

        const rect = column.getBoundingClientRect();

        return clientX >= rect.left && clientX < rect.right;
    });

export const plainTimeAt = (minutes: number): Temporal.PlainTime =>
    Temporal.PlainTime.from({
        hour: Math.floor((minutes % MINUTES_PER_DAY) / 60),
        minute: minutes % 60,
    });

/**
 * Reads a position on the axis as a wall clock time.
 *
 * Not arithmetic on the minute: once a day carries an hour twice, two rows an
 * hour apart read the same, and the row is the only thing that says which.
 */
export const wallTimeAt = (axis: Axis, axisMinutes: number): Temporal.PlainTime => {
    if (axisMinutes >= axis.minutesPerColumn) {
        return new Temporal.PlainTime();
    }

    const row = axis.rows[Math.max(Math.floor(axisMinutes / 60), 0)];

    return Temporal.PlainTime.from({ hour: row.hour, minute: axisMinutes % 60 });
};

export const buildDays = (
    startDate: Temporal.PlainDate,
    endDate: Temporal.PlainDate,
): Temporal.PlainDate[] => {
    const days: Temporal.PlainDate[] = [];
    let day = startDate;

    while (isBeforeOrEqual(day, endDate)) {
        days.push(day);
        day = day.add({ days: 1 });
    }

    return days;
};

/**
 * An hour a day reads twice gets a row per offset.
 *
 * Which reading a day means follows from the offset its clocks were keeping.
 */
export type AxisRow = {
    hour: number;
    offset?: string;
};

export type Axis = {
    rows: AxisRow[];
    minutesPerColumn: number;
};

/**
 * Lists the successive hour starts of one day, which are not always 24.
 *
 * A day the clocks move forward on is short an hour, and one they move back on
 * carries an extra, so counting to 24 gets it wrong.
 */
export const hoursOn = (day: Temporal.PlainDate, timeZone: string): Temporal.ZonedDateTime[] => {
    const end = day.add({ days: 1 }).toZonedDateTime(timeZone);
    const found: Temporal.ZonedDateTime[] = [];
    let hourStart = day.toZonedDateTime(timeZone);

    while (isBefore(hourStart, end)) {
        found.push(hourStart);
        hourStart = hourStart.add({ hours: 1 });
    }

    return found;
};

/**
 * Sizes one axis to the day that reads the most hours, so every column can share it.
 *
 * Days that read it fewer times leave those rows empty, which keeps every hour
 * below a clock change lined up across the grid.
 *
 * The order is the order the readings happened, not the order of the clock. A
 * shift of more than an hour repeats two adjacent hours, and sorting those by
 * what the clock said interleaves them against real time, which leaves the row
 * starts out of order for a search that assumes they climb.
 */
export const buildAxis = (days: Temporal.PlainDate[], timeZone: string): Axis => {
    const longest = days
        .map((day) => hoursOn(day, timeZone))
        .reduce((most, readings) => (readings.length > most.length ? readings : most));

    // A floor of a full day, so an hour every day skips still gets a row to be
    // shaded in rather than closing a gap the grid would otherwise show.
    const rows: AxisRow[] =
        longest.length <= HOURS_IN_A_DAY
            ? Array.from({ length: HOURS_IN_A_DAY }, (_unused, hour) => ({ hour }))
            : longest.map((reading) => {
                  const readTwice =
                      longest.filter((other) => other.hour === reading.hour).length > 1;

                  return readTwice
                      ? { hour: reading.hour, offset: reading.offset }
                      : { hour: reading.hour };
              });

    return { rows, minutesPerColumn: rows.length * 60 };
};

/** Nothing where a day lacks that row. */
export type RowStarts = (Temporal.ZonedDateTime | undefined)[][];

export type Grid = {
    days: Temporal.PlainDate[];
    axis: Axis;
    rowStarts: RowStarts;
    timeZone: string;
};

export const buildGrid = (
    startDate: Temporal.PlainDate,
    endDate: Temporal.PlainDate,
    timeZone: string,
): Grid => {
    const days = buildDays(startDate, endDate);
    const axis = buildAxis(days, timeZone);

    const rowStarts = days.map((day) => {
        const readings = hoursOn(day, timeZone);

        return axis.rows.map((row) => {
            const ofThisHour = readings.filter((reading) => reading.hour === row.hour);

            // A day whose clocks never changed reads the hour once, and its
            // offset says which of the paired rows that reading belongs under.
            return row.offset === undefined
                ? ofThisHour[0]
                : ofThisHour.find((reading) => reading.offset === row.offset);
        });
    });

    return { days, axis, rowStarts, timeZone };
};

export const missingRanges = (grid: Grid, dayIndex: number): AbsoluteRange[] => {
    const missing: AbsoluteRange[] = [];
    const starts = grid.rowStarts[dayIndex] ?? [];
    const dayEnd = grid.days[dayIndex]?.add({ days: 1 }).toZonedDateTime(grid.timeZone);

    const shade = (from: number, to: number): void => {
        const last = missing.at(-1);

        if (last?.to === from) {
            last.to = to;
            return;
        }

        missing.push({ from, to });
    };

    starts.forEach((start, rowIndex) => {
        const from = rowIndex * 60;

        if (start === undefined) {
            shade(from, from + 60);
            return;
        }

        // A shift of half an hour leaves the row it lands on holding half of
        // what its height promises, and the rest is time this day never reads.
        const resumes = starts.slice(rowIndex + 1).find((candidate) => candidate !== undefined);
        const held = (resumes ?? dayEnd)?.since(start).total({ unit: "minute" }) ?? 60;

        if (held < 60) {
            shade(from + held, from + 60);
        }
    });

    return missing;
};

const endOfWindow = (grid: Grid): Temporal.Instant =>
    grid.days[grid.days.length - 1].add({ days: 1 }).toZonedDateTime(grid.timeZone).toInstant();

export const toInstant = (grid: Grid, absolute: number): Temporal.Instant => {
    const { minutesPerColumn } = grid.axis;

    if (absolute >= grid.days.length * minutesPerColumn) {
        return endOfWindow(grid);
    }

    const dayIndex = clamp(dayOf(minutesPerColumn, absolute), 0, grid.days.length - 1);
    const withinColumn = clamp(absolute - dayIndex * minutesPerColumn, 0, minutesPerColumn);
    const rowIndex = Math.floor(withinColumn / 60);
    const starts = grid.rowStarts[dayIndex];
    const start = starts[rowIndex];

    if (start !== undefined) {
        return start.add({ minutes: withinColumn % 60 }).toInstant();
    }

    // A row this day does not have is no time at all, so it answers as the
    // moment the day picks up again.
    const resumes = starts.slice(rowIndex).find((candidate) => candidate !== undefined);

    return resumes === undefined
        ? grid.days[dayIndex].add({ days: 1 }).toZonedDateTime(grid.timeZone).toInstant()
        : resumes.toInstant();
};

export const toAbsolute = (grid: Grid, instant: Temporal.Instant): number => {
    const { minutesPerColumn } = grid.axis;
    const zoned = instant.toZonedDateTimeISO(grid.timeZone);
    const date = zoned.toPlainDate();
    const dayIndex = grid.days.findIndex((day) => day.equals(date));

    // The window's exclusive end lands on the day after the last column.
    if (dayIndex === -1) {
        return isBefore(date, grid.days[0]) ? 0 : grid.days.length * minutesPerColumn;
    }

    // The last row already begun is the one this sits in, which tells the two
    // readings of a repeated hour apart without comparing offsets.
    const rowIndex = grid.rowStarts[dayIndex].findLastIndex(
        (start) => start !== undefined && isBeforeOrEqual(start, zoned),
    );

    if (rowIndex === -1) {
        return dayIndex * minutesPerColumn;
    }

    // Measured from where the row began rather than from the clock's own
    // minute, because a shift of half an hour leaves every later row starting
    // at half past, and its first minute would otherwise read as its thirtieth.
    const start = grid.rowStarts[dayIndex][rowIndex] as Temporal.ZonedDateTime;

    return (
        dayIndex * minutesPerColumn + rowIndex * 60 + zoned.since(start).total({ unit: "minute" })
    );
};

/**
 * Cuts a stored interval at every column boundary it crosses.
 *
 * A block belongs to the column it is drawn in, so every gesture stays inside
 * that day. Nothing is lost by it: two blocks meeting at midnight merge into
 * the one interval a single cross-midnight block would have stored.
 */
export const splitByDay = (
    minutesPerColumn: number,
    ranges: readonly AbsoluteRange[],
): AbsoluteRange[] =>
    ranges.flatMap((range) => {
        const pieces: AbsoluteRange[] = [];

        for (
            let day = dayOf(minutesPerColumn, range.from);
            day * minutesPerColumn < range.to;
            day += 1
        ) {
            const dayStart = day * minutesPerColumn;
            pieces.push({
                from: Math.max(range.from, dayStart),
                to: Math.min(range.to, dayStart + minutesPerColumn),
            });
        }

        return pieces;
    });

/** The stretch of a day the clocks skip, if the given minute falls inside one. */
export type GapAt = (dayIndex: number, minutes: number) => AbsoluteRange | undefined;

/**
 * Moves a start inside a skipped hour forward to where time resumes.
 *
 * An edge inside a skipped hour moves away from its own block: a start forward,
 * an end back to where it stopped, which {@link snapEnd} does. Either direction
 * names the same instant, but only this one draws the block the length it
 * actually has.
 */
export const snapStart = (gapAt: GapAt, dayIndex: number, minutes: number): number =>
    gapAt(dayIndex, minutes)?.to ?? minutes;

/**
 * Moves an end inside a skipped hour back to where time stopped.
 *
 * Where the skip begins is a real instant to end on, so only past it needs
 * moving.
 */
export const snapEnd = (gapAt: GapAt, dayIndex: number, minutes: number): number => {
    const gap = gapAt(dayIndex, minutes);

    return gap && minutes > gap.from ? gap.from : minutes;
};

/**
 * Finds a start that keeps a moved block's edges out of a skipped hour at its
 * full length, since a trapped edge cannot free itself.
 *
 * The block goes to whichever side is nearer to where it was dropped. One that
 * covers the skip end to end has both edges clear already and stays where it
 * was dropped, so it holds an hour less real time than its height on the grid,
 * exactly as one drawn there would. Null where neither side fits, which takes a
 * block longer than the day minus the skip.
 */
export const placeOutOfGap = (
    minutesPerColumn: number,
    gapAt: GapAt,
    dayIndex: number,
    wanted: number,
    span: number,
): number | null => {
    const clears = (from: number): boolean =>
        from >= 0 &&
        from + span <= minutesPerColumn &&
        snapStart(gapAt, dayIndex, from) === from &&
        snapEnd(gapAt, dayIndex, from + span) === from + span;

    if (clears(wanted)) {
        return wanted;
    }

    const gap = gapAt(dayIndex, wanted) ?? gapAt(dayIndex, wanted + span);

    if (!gap) {
        return null;
    }

    const options = [gap.to, gap.from - span].filter(clears);

    if (options.length === 0) {
        return null;
    }

    return options.reduce((nearest, option) =>
        Math.abs(option - wanted) < Math.abs(nearest - wanted) ? option : nearest,
    );
};

/**
 * Draws a block ending on a spring forward at the earlier of two readings.
 *
 * The minute a spring forward jumps to and the one it jumps from are one
 * instant, so a block ending on it can be drawn at either. Drawn at the earlier
 * one it is as long on the grid as it is in real time, and it stops where the
 * shading starts rather than running through an hour it does not cover.
 */
export const drawEndWhereTimeStopped = (
    minutesPerColumn: number,
    range: AbsoluteRange,
    missingByDay: AbsoluteRange[][],
): AbsoluteRange => {
    const dayIndex = dayOf(minutesPerColumn, range.from);
    const dayStart = dayIndex * minutesPerColumn;
    const gap = missingByDay[dayIndex]?.find((missing) => dayStart + missing.to === range.to);

    return gap && dayStart + gap.from > range.from
        ? { from: range.from, to: dayStart + gap.from }
        : range;
};

const drawCreate = (
    minutesPerColumn: number,
    ranges: AbsoluteRange[],
    drag: Extract<Drag, { mode: "create" }>,
    gapAt: GapAt,
): AbsoluteRange[] => {
    const dayStart = drag.dayIndex * minutesPerColumn;
    const lower = slotStart(Math.min(drag.anchorMinutes, drag.minutes));
    // At least the slot it began in, and never past the column's own end: a
    // press on the very last line leaves the two equal, which the caller reads
    // as a gesture that painted nothing and turns into a tap.
    const upper = Math.min(
        Math.max(slotEnd(Math.max(drag.anchorMinutes, drag.minutes)), lower + SNAP_MINUTES),
        minutesPerColumn,
    );

    const from = snapStart(gapAt, drag.dayIndex, lower);
    const to = snapEnd(gapAt, drag.dayIndex, upper);

    return [
        ...ranges,
        to > from
            ? { from: dayStart + from, to: dayStart + to }
            : // Wholly inside an hour the clocks skip, where the two edges snap
              // past each other. Reported where it was aimed rather than where
              // snapping left it, so the caller can still see it was aimed at
              // no time at all.
              { from: dayStart + lower, to: dayStart + lower },
    ];
};

const drawMove = (
    minutesPerColumn: number,
    ranges: AbsoluteRange[],
    drag: Extract<Drag, { mode: "move" }>,
    gapAt: GapAt,
): AbsoluteRange[] => {
    // The index was taken when the gesture began, and the list it points into
    // belongs to the caller, who can replace it mid-gesture.
    const range = ranges[drag.index];

    if (!range) {
        return ranges;
    }

    const span = range.to - range.from;
    const dayStart = drag.dayIndex * minutesPerColumn;
    // A move has no edges of its own, only a position, so it takes the slot the
    // pointer is in and keeps the length it already had.
    const wanted = clamp(slotStart(drag.minutes - drag.grabOffset), 0, minutesPerColumn - span);
    const from = placeOutOfGap(minutesPerColumn, gapAt, drag.dayIndex, wanted, span);

    return from === null
        ? ranges
        : ranges.with(drag.index, { from: dayStart + from, to: dayStart + from + span });
};

const drawResize = (
    minutesPerColumn: number,
    ranges: AbsoluteRange[],
    drag: Extract<Drag, { mode: "resize" }>,
    gapAt: GapAt,
): AbsoluteRange[] => {
    const range = ranges[drag.index];

    if (!range) {
        return ranges;
    }

    const dayIndex = dayOf(minutesPerColumn, range.from);
    const dayStart = dayIndex * minutesPerColumn;

    if (drag.edge === "start") {
        return ranges.with(drag.index, {
            from: clamp(
                dayStart + snapStart(gapAt, dayIndex, slotStart(drag.minutes)),
                dayStart,
                range.to - SNAP_MINUTES,
            ),
            to: range.to,
        });
    }

    return ranges.with(drag.index, {
        from: range.from,
        to: clamp(
            dayStart + snapEnd(gapAt, dayIndex, slotEnd(drag.minutes)),
            range.from + SNAP_MINUTES,
            dayStart + minutesPerColumn,
        ),
    });
};

export const applyDrag = (
    minutesPerColumn: number,
    ranges: AbsoluteRange[],
    drag: Drag,
    gapAt: GapAt,
): AbsoluteRange[] =>
    match(drag)
        .with({ mode: "create" }, (create) => drawCreate(minutesPerColumn, ranges, create, gapAt))
        .with({ mode: "move" }, (move) => drawMove(minutesPerColumn, ranges, move, gapAt))
        .with({ mode: "resize" }, (resize) => drawResize(minutesPerColumn, ranges, resize, gapAt))
        .exhaustive();
