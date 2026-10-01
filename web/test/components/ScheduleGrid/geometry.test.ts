import { describe, expect, it } from "vitest";
import {
    axisMinutes,
    buildLayout,
    buildScheduleAxis,
    defaultBusinessHours,
    instantAtMinutes,
    minutesAt,
    minutesAtTop,
    rowHeightFor,
    topAt,
    visibleRows,
} from "#/components/ScheduleGrid/geometry.js";

const berlin = "Europe/Berlin";

type OccupiedRange = {
    from: number;
    to: number;
};

describe("the rows a clock change makes", () => {
    it("gives a day the clocks go back on an extra row", () => {
        // Berlin leaves DST on 2027-10-31, so that day reads 02:00 twice.
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-10-31"),
            Temporal.PlainDate.from("2027-10-31"),
            berlin,
        );

        expect(axis.rows).toHaveLength(25);
    });

    it("gives a day the clocks go forward on one row fewer", () => {
        // Berlin enters DST on 2027-03-28, so 02:00 never happens.
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-03-28"),
            Temporal.PlainDate.from("2027-03-28"),
            berlin,
        );

        expect(axis.rows).toHaveLength(23);
    });

    it("names the repeated hour twice, at different offsets", () => {
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-10-31"),
            Temporal.PlainDate.from("2027-10-31"),
            berlin,
        );
        const twos = axis.rows.filter((row) => row.startsAt.hour === 2);

        expect(twos).toHaveLength(2);
        expect(twos[0].startsAt.offset).not.toEqual(twos[1].startsAt.offset);
    });

    it("marks only the first row of each day", () => {
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-11-01"),
            Temporal.PlainDate.from("2027-11-03"),
            berlin,
        );

        expect(axis.rows.filter((row) => row.startsDay)).toHaveLength(3);
        expect(axis.rows[0].startsDay).toBe(true);
        expect(axis.rows[24].startsDay).toBe(true);
    });
});

describe("position as elapsed time", () => {
    it("round trips an instant through the grid", () => {
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-11-01"),
            Temporal.PlainDate.from("2027-11-03"),
            berlin,
        );
        const instant = Temporal.Instant.from("2027-11-02T09:30:00Z");

        expect(instantAtMinutes(axis, minutesAt(axis, instant)).toString()).toEqual(
            instant.toString(),
        );
    });

    it("counts a day the clocks went back on as 25 hours of grid", () => {
        // The whole point of an axis of real hours: a block spanning the change
        // is as tall as the time it actually takes, not as tall as the clock says.
        const axis = buildScheduleAxis(
            Temporal.PlainDate.from("2027-10-31"),
            Temporal.PlainDate.from("2027-10-31"),
            berlin,
        );

        expect(axisMinutes(axis)).toEqual(25 * 60);
        expect(minutesAt(axis, axis.startsAt.add({ days: 1 }).toInstant())).toEqual(25 * 60);
    });
});

describe("collapsing the hours nothing needs", () => {
    const threeDays = () =>
        buildScheduleAxis(
            Temporal.PlainDate.from("2027-11-01"),
            Temporal.PlainDate.from("2027-11-03"),
            berlin,
        );

    it("keeps business hours, the first row of a day, and nothing else", () => {
        const axis = threeDays();
        const visible = visibleRows({
            axis,
            occupied: [],
            expanded: new Set(),
            businessHours: defaultBusinessHours,
        });

        // Ten business hours a day, plus midnight starting each day.
        expect(visible.size).toEqual(3 * 11);
        expect(visible.has(0)).toBe(true);
        expect(visible.has(3)).toBe(false);
    });

    it("keeps every row a slot touches, however small the hours", () => {
        const axis = threeDays();
        // 03:00 to 04:00 Berlin on the first day, which no business hour covers.
        const visible = visibleRows({
            axis,
            occupied: [{ from: 3 * 60, to: 4 * 60 }],
            expanded: new Set(),
            businessHours: defaultBusinessHours,
        });

        expect(visible.has(3)).toBe(true);
    });

    it("gives a collapsed run one stub", () => {
        const axis = threeDays();
        const visible = visibleRows({
            axis,
            occupied: [],
            expanded: new Set(),
            businessHours: defaultBusinessHours,
        });
        const layout = buildLayout(axis, visible, () => 60, 12);
        const stubs = layout.segments.filter((segment) => segment.kind === "stub");

        // Before nine and after seven on each of three days. The midnight row
        // stays visible, so an evening and the morning after it are two runs
        // rather than one.
        expect(stubs).toHaveLength(6);
        expect(layout.height).toBeLessThan(axis.rows.length * 60);
    });

    it("places a moment inside a kept row and nowhere inside a collapsed one", () => {
        const axis = threeDays();
        const visible = visibleRows({
            axis,
            occupied: [],
            expanded: new Set(),
            businessHours: defaultBusinessHours,
        });
        const layout = buildLayout(axis, visible, () => 60, 12);

        expect(topAt(layout, 9 * 60 + 30)).toEqual((layout.tops.get(9) ?? 0) + 30);
        expect(topAt(layout, 3 * 60)).toBeUndefined();
    });
});

describe("an hour grows to fit the shortest thing in it", () => {
    const base = 36;
    const readable = 22;
    const cap = 240;

    it("leaves an hour alone when nothing in it is short", () => {
        expect(rowHeightFor(base, undefined, readable, cap)).toEqual(base);
        expect(rowHeightFor(base, 60, readable, cap)).toEqual(base);
        expect(rowHeightFor(base, 90, readable, cap)).toEqual(base);
    });

    it("grows an hour until its shortest slot is readable", () => {
        // A thirty minute slot needs the hour to be twice a readable block, so
        // the slot itself lands on exactly that.
        expect(rowHeightFor(base, 30, readable, cap)).toEqual(readable * 2);
        expect(rowHeightFor(base, 15, readable, cap)).toEqual(readable * 4);
    });

    it("stops growing rather than turning one hour into a page", () => {
        // Five minutes would want twelve readable blocks, which is past the cap.
        expect(rowHeightFor(base, 5, readable, cap)).toEqual(cap);
    });

    it("keeps a slot proportional inside the hour it grew", () => {
        const height = rowHeightFor(base, 30, readable, cap);

        expect((30 / 60) * height).toEqual(readable);
    });
});

describe("reading a pixel back as a minute", () => {
    const threeDays = () =>
        buildScheduleAxis(
            Temporal.PlainDate.from("2027-11-01"),
            Temporal.PlainDate.from("2027-11-03"),
            berlin,
        );

    const layoutOf = (rowHeightAt: (index: number) => number, dayRuleHeight = 0) => {
        const axis = threeDays();

        return buildLayout(
            axis,
            visibleRows({
                axis,
                occupied: [],
                expanded: new Set(),
                businessHours: defaultBusinessHours,
            }),
            rowHeightAt,
            12,
            dayRuleHeight,
        );
    };

    it("undoes topAt", () => {
        const layout = layoutOf(() => 60);
        const top = topAt(layout, 9 * 60 + 30);

        expect(top).toBeDefined();
        expect(minutesAtTop(layout, top ?? 0)).toEqual(9 * 60 + 30);
    });

    it("answers nothing over a collapsed run", () => {
        const layout = layoutOf(() => 60);
        const stub = layout.segments.find((segment) => segment.kind === "stub");

        expect(stub).toBeDefined();
        expect(minutesAtTop(layout, (stub?.top ?? 0) + 1)).toBeUndefined();
    });

    it("reads a day rule as the first minute of the day it announces", () => {
        // The second day, because every formula agrees on the first: its index
        // is zero, so a day counted in days rather than in rows also reads nil.
        const layout = layoutOf(() => 60, 26);
        const rule = layout.segments.find(
            (segment) => segment.kind === "day" && segment.index === 24,
        );

        expect(rule).toBeDefined();
        expect(minutesAtTop(layout, (rule?.top ?? 0) + 4)).toEqual(24 * 60);
    });

    it("answers nothing off the end of the grid", () => {
        const layout = layoutOf(() => 60);

        expect(minutesAtTop(layout, layout.height)).toBeUndefined();
        expect(minutesAtTop(layout, -1)).toBeUndefined();
    });

    it("keeps a pixel proportional in an hour that grew", () => {
        // The hour holding a short slot is four rows tall, so a pixel there is
        // worth a quarter of what it is worth anywhere else.
        const layout = layoutOf((index) => (index === 10 ? 240 : 60));
        const top = layout.tops.get(10) ?? 0;

        expect(minutesAtTop(layout, top + 120)).toEqual(10 * 60 + 30);
        expect(minutesAtTop(layout, top + 240)).toEqual(11 * 60);
    });
});

describe("the minute a row ends on", () => {
    const threeDays = () =>
        buildScheduleAxis(
            Temporal.PlainDate.from("2027-11-01"),
            Temporal.PlainDate.from("2027-11-03"),
            berlin,
        );

    const layoutFor = (occupied: OccupiedRange[]) => {
        const axis = threeDays();

        return buildLayout(
            axis,
            visibleRows({
                axis,
                occupied,
                expanded: new Set(),
                businessHours: defaultBusinessHours,
            }),
            () => 60,
            12,
        );
    };

    it("places the end of a slot that finishes as the grid collapses", () => {
        // Business hours stop at nineteen, so an eighteen to nineteen talk ends
        // on the first minute of a row nothing draws.
        const layout = layoutFor([{ from: 18 * 60, to: 19 * 60 }]);

        expect(topAt(layout, 18 * 60)).toBeDefined();
        expect(topAt(layout, 19 * 60)).toEqual((topAt(layout, 18 * 60) ?? 0) + 60);
    });

    it("places the end of a slot that finishes with the edition", () => {
        const axis = threeDays();
        const layout = layoutFor([{ from: axisMinutes(axis) - 60, to: axisMinutes(axis) }]);

        expect(topAt(layout, axisMinutes(axis))).toEqual(layout.height);
    });

    it("still answers nothing part way into a collapsed hour", () => {
        const layout = layoutFor([]);

        expect(topAt(layout, 3 * 60 + 30)).toBeUndefined();
    });
});
