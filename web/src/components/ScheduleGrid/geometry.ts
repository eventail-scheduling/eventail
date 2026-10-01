import { isBeforeOrEqual } from "temporal-extra";
import { match } from "ts-pattern";
import { hoursOn } from "#/components/AvailabilityField/geometry.js";
import type { MinuteSpan } from "./placement.js";

export const MINUTES_PER_ROW = 60;

export type ScheduleRow = {
    /** Where this hour begins, which names it: a repeated hour reads twice here. */
    startsAt: Temporal.ZonedDateTime;
    startsDay: boolean;
};

/**
 * Every real hour of the edition in order, rooms being the columns instead of days.
 *
 * Unlike the availability grid there is one axis rather than one per column, so
 * a day a whole-hour clock change falls on contributes 23 or 25 rows rather than
 * reconciling against a longest day. A position is plain elapsed time from the
 * first row, which holds while every day is a whole number of hours long: the
 * change then moves what a row is called and never where it sits.
 *
 * A change that is not a whole hour, as in Australia/Lord_Howe, breaks that. The
 * day runs 23.5 or 24.5 hours in 24 or 25 rows, and from the next midnight on
 * every row is labeled 30 minutes before the time it maps to. Placing rows by
 * wall clock instead is deferred until an edition runs in such a zone.
 */
export type ScheduleAxis = {
    rows: ScheduleRow[];
    startsAt: Temporal.ZonedDateTime;
    timeZone: string;
};

export const buildScheduleAxis = (
    startDate: Temporal.PlainDate,
    endDate: Temporal.PlainDate,
    timeZone: string,
): ScheduleAxis => {
    const rows: ScheduleRow[] = [];
    let day = startDate;

    while (isBeforeOrEqual(day, endDate)) {
        for (const [index, startsAt] of hoursOn(day, timeZone).entries()) {
            rows.push({ startsAt, startsDay: index === 0 });
        }

        day = day.add({ days: 1 });
    }

    return { rows, startsAt: rows[0].startsAt, timeZone };
};

export const axisMinutes = (axis: ScheduleAxis): number => axis.rows.length * MINUTES_PER_ROW;

/** Measures minutes down the grid as elapsed real time from its first row. */
export const minutesAt = (axis: ScheduleAxis, instant: Temporal.Instant): number =>
    instant.since(axis.startsAt.toInstant()).total("minutes");

export const instantAtMinutes = (axis: ScheduleAxis, minutes: number): Temporal.Instant =>
    axis.startsAt.toInstant().add({ minutes: Math.round(minutes) });

export const clamp = (value: number, lowest: number, highest: number): number =>
    Math.min(Math.max(value, lowest), highest);

export const snapTo = (minutes: number, interval: number): number =>
    Math.round(minutes / interval) * interval;

export type BusinessHours = {
    /** Inclusive, in the edition's zone. */
    from: number;
    /** Exclusive. */
    to: number;
};

/**
 * What a schedule looks like when the clock is 24 hours and a conference is not.
 *
 * pretalx hardcodes nine to seven. Kept behind a prop so an evening event could
 * name its own hours, though nothing supplies one yet.
 */
export const defaultBusinessHours: BusinessHours = { from: 9, to: 19 };

type VisibilityInput = {
    axis: ScheduleAxis;
    /** Minute ranges that must stay drawn, a slot with its setup and teardown. */
    occupied: readonly MinuteSpan[];
    expanded: ReadonlySet<number>;
    businessHours: BusinessHours;
};

/**
 * Picks the rows that earn their height, the rest collapsing into a stub.
 *
 * Every row a slot touches is kept, so a block never spans a collapsed run and
 * its edges always have somewhere to sit. Business hours are a guess at what is
 * interesting and nothing more: a slot at three in the morning keeps its row
 * because it is there, not because anyone configured the grid to reach it.
 */
export const visibleRows = ({
    axis,
    occupied,
    expanded,
    businessHours,
}: VisibilityInput): Set<number> => {
    const visible = new Set<number>();

    for (const [index, row] of axis.rows.entries()) {
        const hour = row.startsAt.hour;

        if (
            row.startsDay ||
            expanded.has(index) ||
            (hour >= businessHours.from && hour < businessHours.to)
        ) {
            visible.add(index);
        }
    }

    for (const range of occupied) {
        const first = Math.floor(range.from / MINUTES_PER_ROW);
        const last = Math.ceil(range.to / MINUTES_PER_ROW) - 1;

        for (
            let index = Math.max(first, 0);
            index <= Math.min(last, axis.rows.length - 1);
            ++index
        ) {
            visible.add(index);
        }
    }

    return visible;
};

export type GridSegment =
    | { kind: "row"; index: number; top: number; height: number }
    | { kind: "day"; index: number; top: number; height: number }
    | { kind: "stub"; from: number; to: number; top: number; height: number };

export type GridLayout = {
    segments: GridSegment[];
    tops: Map<number, number>;
    heights: Map<number, number>;
    height: number;
};

/**
 * Grows an hour until its shortest slot reads, or until the cap given stops it.
 *
 * A five minute talk in an hour of 36px is three pixels, and neither a floor on
 * the block nor a denser grid answers it: the first says the hour is taken when
 * it is free, the second pays for one row in every empty one. Growing the hour
 * that holds it keeps the slot proportional inside it.
 */
export const rowHeightFor = (
    baseHeight: number,
    shortestMinutes: number | undefined,
    readableHeight: number,
    maxHeight: number,
): number =>
    shortestMinutes === undefined || shortestMinutes >= MINUTES_PER_ROW
        ? baseHeight
        : Math.min(
              Math.max(baseHeight, (MINUTES_PER_ROW / shortestMinutes) * readableHeight),
              maxHeight,
          );

/**
 * Lays the visible rows out, a day getting a rule where one is tall enough to draw.
 *
 * Its first hour still takes a full row underneath, so the gutter stops mixing
 * dates, counts and clock times in one column.
 */
export const buildLayout = (
    axis: ScheduleAxis,
    visible: ReadonlySet<number>,
    rowHeightAt: (index: number) => number,
    stubHeight: number,
    dayRuleHeight = 0,
): GridLayout => {
    const segments: GridSegment[] = [];
    const tops = new Map<number, number>();
    const heights = new Map<number, number>();
    let top = 0;
    let index = 0;

    while (index < axis.rows.length) {
        if (visible.has(index)) {
            if (axis.rows[index].startsDay && dayRuleHeight > 0) {
                segments.push({ kind: "day", index, top, height: dayRuleHeight });
                top += dayRuleHeight;
            }

            const height = rowHeightAt(index);
            segments.push({ kind: "row", index, top, height });
            tops.set(index, top);
            heights.set(index, height);
            top += height;
            index += 1;
            continue;
        }

        const from = index;

        while (index < axis.rows.length && !visible.has(index)) {
            index += 1;
        }

        segments.push({ kind: "stub", from, to: index - 1, top, height: stubHeight });
        top += stubHeight;
    }

    return { segments, tops, heights, height: top };
};

/**
 * Locates a moment among rows no longer all the same distance apart.
 *
 * Nothing where the row collapsed, which callers avoid by keeping every row a
 * slot touches. The exception is the minute a row ends on, which is also the
 * next row's first: a slot ending at seven has only touched the hour before it,
 * so the row it would otherwise be measured from is not drawn, and neither is
 * the row past the final one.
 */
export const topAt = (layout: GridLayout, minutes: number): number | undefined => {
    const index = Math.floor(minutes / MINUTES_PER_ROW);
    const offset = minutes % MINUTES_PER_ROW;
    const top = layout.tops.get(index);
    const height = layout.heights.get(index);

    if (top !== undefined && height !== undefined) {
        return top + (offset / MINUTES_PER_ROW) * height;
    }

    if (offset !== 0) {
        return undefined;
    }

    const closedTop = layout.tops.get(index - 1);
    const closedHeight = layout.heights.get(index - 1);

    return closedTop === undefined || closedHeight === undefined
        ? undefined
        : closedTop + closedHeight;
};

/**
 * Reads the minute a pixel is on, the inverse of {@link topAt}.
 *
 * Nothing over a collapsed run, because a stub stands for hours a gesture has
 * not asked to see. A day rule reads as the first minute of the day it
 * announces, so the band it takes is not a gap a drag falls into.
 */
export const minutesAtTop = (layout: GridLayout, top: number): number | undefined => {
    const segment = layout.segments.find(
        (candidate) => top >= candidate.top && top < candidate.top + candidate.height,
    );

    if (!segment) {
        return undefined;
    }

    return match(segment)
        .with({ kind: "stub" }, () => undefined)
        .with({ kind: "day" }, (day) => day.index * MINUTES_PER_ROW)
        .with(
            { kind: "row" },
            (row) => row.index * MINUTES_PER_ROW + ((top - row.top) / row.height) * MINUTES_PER_ROW,
        )
        .exhaustive();
};

/**
 * How far apart a subdivision has to be before it is worth drawing.
 *
 * A five minute step is three pixels in an ungrown hour, which reads as a gray
 * band rather than as lines to aim at.
 */
const MIN_SUBDIVISION = 7;

/**
 * Spaces the lines inside an hour, or gives nothing where they would not read.
 *
 * The step still applies where this answers nothing; the grid just stops
 * claiming to show it. An hour has no subdivision of itself, and a row that
 * grew to fit a short slot can show a finer one than an ungrown row can.
 */
export const subdivisionSpacing = (rowHeight: number, step: number): number | undefined => {
    const spacing = (step / MINUTES_PER_ROW) * rowHeight;

    return step >= MINUTES_PER_ROW || spacing < MIN_SUBDIVISION ? undefined : spacing;
};
