import { describe, expect, it } from "vitest";
import {
    type AbsoluteRange,
    buildGrid,
    carryScroll,
    drawEndWhereTimeStopped,
    edgeScrollDistance,
    type GapAt,
    MINUTES_PER_DAY,
    missingRanges,
    placeOutOfGap,
    SNAP_MINUTES,
    snapEnd,
    snapStart,
    splitByDay,
    toAbsolute,
    toInstant,
} from "#/components/AvailabilityField/geometry.ts";

const timeZone = "Europe/Berlin";

// 2027-03-28 is the spring forward: 02:00 never happens, 03:00 follows 01:59.
const springForward = Temporal.PlainDate.from("2027-03-28");
const gap: AbsoluteRange = { from: 120, to: 180 };
const gapAt: GapAt = (_dayIndex, minutes) =>
    minutes >= gap.from && minutes < gap.to ? gap : undefined;

const clockAt = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

describe("the rows a day does not have", () => {
    it("finds the hour a spring forward skips", () => {
        const grid = buildGrid(springForward, springForward, timeZone);

        expect(missingRanges(grid, 0)).toEqual([{ from: 120, to: 180 }]);
    });

    it("finds nothing on an ordinary day", () => {
        const ordinary = Temporal.PlainDate.from("2027-03-27");
        const grid = buildGrid(ordinary, ordinary, timeZone);

        expect(missingRanges(grid, 0)).toEqual([]);
    });

    // The day that reads the hour twice has both rows. Each day around it
    // shades whichever row its own offset is not, so the day still on summer
    // time lacks the later reading and the day on winter time lacks the
    // earlier one.
    it("shades whichever reading each day does not keep", () => {
        const grid = buildGrid(
            Temporal.PlainDate.from("2027-10-30"),
            Temporal.PlainDate.from("2027-11-01"),
            timeZone,
        );

        expect(missingRanges(grid, 1)).toEqual([]);
        expect(missingRanges(grid, 0)).toEqual([{ from: 180, to: 240 }]);
        expect(missingRanges(grid, 2)).toEqual([{ from: 120, to: 180 }]);
    });
});

describe("snapping a single edge out of the skipped hour", () => {
    it("moves a start forward to where time resumes", () => {
        expect(snapStart(gapAt, 0, 120)).toBe(180);
        expect(snapStart(gapAt, 0, 150)).toBe(180);
    });

    // The minute the clocks jump from is a real instant to finish on.
    it("leaves an end on the minute the skip begins", () => {
        expect(snapEnd(gapAt, 0, 120)).toBe(120);
    });

    it("pulls an end back to where time stopped", () => {
        expect(snapEnd(gapAt, 0, 150)).toBe(120);
    });

    it("leaves edges outside the skip alone", () => {
        expect(snapStart(gapAt, 0, 90)).toBe(90);
        expect(snapEnd(gapAt, 0, 210)).toBe(210);
    });
});

describe("placing a moved block clear of the skipped hour", () => {
    const place = (wanted: number, span: number) => {
        const from = placeOutOfGap(MINUTES_PER_DAY, gapAt, 0, wanted, span);

        return from === null ? "refused" : `${clockAt(from)}-${clockAt(from + span)}`;
    };

    it("leaves a block that never meets the skip where it was dropped", () => {
        expect(place(30, 60)).toBe("00:30-01:30");
        expect(place(210, 60)).toBe("03:30-04:30");
    });

    it("ends a block dragged down into the skip where the skip begins", () => {
        expect(place(90, 60)).toBe("01:00-02:00");
    });

    it("starts a block dragged up into the skip where time resumes", () => {
        expect(place(150, 60)).toBe("03:00-04:00");
    });

    it("sends a block shorter than the skip wholly to one side", () => {
        expect(place(120, 30)).toBe("01:30-02:00");
        expect(place(150, 30)).toBe("03:00-03:30");
    });

    it("refuses a block too long to sit either side", () => {
        expect(place(150, MINUTES_PER_DAY - 40)).toBe("refused");
    });

    // The hour a repeated reading adds is as placeable as any other, so the
    // bound has to be the column's own end rather than a day's.
    it("allows the last hour of a taller column", () => {
        expect(placeOutOfGap(1500, gapAt, 0, 1440, 60)).toBe(1440);
        expect(placeOutOfGap(MINUTES_PER_DAY, gapAt, 0, 1440, 60)).toBe(null);
    });
});

describe("drawEndWhereTimeStopped", () => {
    const missingByDay = [[gap]];

    it("draws an end at the resuming minute where time stopped instead", () => {
        expect(
            drawEndWhereTimeStopped(MINUTES_PER_DAY, { from: 60, to: 180 }, missingByDay),
        ).toEqual({
            from: 60,
            to: 120,
        });
    });

    it("leaves a block that runs past the skip alone", () => {
        expect(
            drawEndWhereTimeStopped(MINUTES_PER_DAY, { from: 60, to: 300 }, missingByDay),
        ).toEqual({
            from: 60,
            to: 300,
        });
    });

    it("leaves a block starting where time resumes alone", () => {
        expect(
            drawEndWhereTimeStopped(MINUTES_PER_DAY, { from: 180, to: 240 }, missingByDay),
        ).toEqual({
            from: 180,
            to: 240,
        });
    });

    it("counts the skip from the start of the day the block sits on", () => {
        expect(
            drawEndWhereTimeStopped(MINUTES_PER_DAY, { from: 1500, to: 1620 }, [[], [gap]]),
        ).toEqual({
            from: 1500,
            to: 1560,
        });
    });

    // Minute 1500 is day 1 on a tall column and day 0 on a short one, so a
    // block there is attributed to whichever day the column width says.
    it("counts it from the start of a taller column's day", () => {
        expect(drawEndWhereTimeStopped(1500, { from: 1560, to: 1680 }, [[], [gap]])).toEqual({
            from: 1560,
            to: 1620,
        });
    });

    // Minute 1450 is still the first column when that column is taller, so the
    // skips it answers to are the first day's and the second day's leave it be.
    it("leaves a block past a day's length on the taller column's first day", () => {
        expect(drawEndWhereTimeStopped(1500, { from: 1450, to: 1680 }, [[], [gap]])).toEqual({
            from: 1450,
            to: 1680,
        });
    });

    // Applied to a block whose end already moved, it has to leave it alone:
    // the preview runs it over ranges the committed value already passed
    // through.
    it("leaves a block it has already drawn alone", () => {
        const once = drawEndWhereTimeStopped(MINUTES_PER_DAY, { from: 60, to: 180 }, missingByDay);

        expect(drawEndWhereTimeStopped(MINUTES_PER_DAY, once, missingByDay)).toEqual(once);
    });
});

describe("splitByDay", () => {
    it("leaves a block inside one day whole", () => {
        expect(splitByDay(MINUTES_PER_DAY, [{ from: 600, to: 780 }])).toEqual([
            { from: 600, to: 780 },
        ]);
    });

    it("cuts a block crossing midnight at the boundary", () => {
        expect(splitByDay(MINUTES_PER_DAY, [{ from: 1320, to: 1560 }])).toEqual([
            { from: 1320, to: 1440 },
            { from: 1440, to: 1560 },
        ]);
    });

    it("leaves no gap between the pieces it makes", () => {
        const pieces = splitByDay(MINUTES_PER_DAY, [{ from: 1320, to: 2940 }]);

        expect(pieces[0].from).toBe(1320);
        expect(pieces.at(-1)?.to).toBe(2940);
        expect(
            pieces.every((piece, index) => index === 0 || piece.from === pieces[index - 1].to),
        ).toBe(true);
    });

    it("ends a block finishing exactly at midnight without a further piece", () => {
        expect(splitByDay(MINUTES_PER_DAY, [{ from: 1380, to: 1440 }])).toEqual([
            { from: 1380, to: 1440 },
        ]);
    });

    // A column an hour taller than a day is where a piece cut to 1440 loses the
    // hour past it, and where one lying wholly beyond 1440 comes back inverted
    // for the commit filter to throw away.
    it("cuts a tall column at its own end rather than at a day's", () => {
        expect(splitByDay(1500, [{ from: 1400, to: 1600 }])).toEqual([
            { from: 1400, to: 1500 },
            { from: 1500, to: 1600 },
        ]);
    });

    it("keeps a block held in a tall column's last hour", () => {
        expect(splitByDay(1500, [{ from: 1470, to: 1500 }])).toEqual([{ from: 1470, to: 1500 }]);
    });
});

describe("the round trip through instants", () => {
    const grid = buildGrid(
        Temporal.PlainDate.from("2027-03-25"),
        Temporal.PlainDate.from("2027-04-01"),
        timeZone,
    );
    const { days } = grid;

    const roundTrip = (minutes: number): number => toAbsolute(grid, toInstant(grid, minutes));

    it("keeps a time on an ordinary day", () => {
        expect(roundTrip(600)).toBe(600);
        expect(roundTrip(MINUTES_PER_DAY + 630)).toBe(MINUTES_PER_DAY + 630);
    });

    it("keeps midnight at the end of the last day", () => {
        expect(roundTrip(days.length * MINUTES_PER_DAY)).toBe(days.length * MINUTES_PER_DAY);
    });

    // The skipped hour and the minute it resumes at are one instant, so the
    // grid can only ever show it back as the later of the two.
    it("reads a skipped minute back as the minute time resumes", () => {
        const skipped = 3 * MINUTES_PER_DAY + 120;

        expect(roundTrip(skipped)).toBe(3 * MINUTES_PER_DAY + 180);
    });
});

describe("the shape of the axis", () => {
    it("keeps 24 rows on a day that skips an hour", () => {
        const grid = buildGrid(springForward, springForward, timeZone);

        expect(grid.axis.rows).toHaveLength(24);
        expect(grid.axis.minutesPerColumn).toBe(MINUTES_PER_DAY);
    });

    it("adds a row for the hour a day reads twice", () => {
        const fallBack = Temporal.PlainDate.from("2027-10-31");
        const grid = buildGrid(fallBack, fallBack, timeZone);

        expect(grid.axis.rows).toHaveLength(25);
        expect(grid.axis.rows.filter((row) => row.hour === 2)).toEqual([
            { hour: 2, offset: "+02:00" },
            { hour: 2, offset: "+01:00" },
        ]);
    });
});

describe("the round trip across a repeated hour", () => {
    const grid = buildGrid(
        Temporal.PlainDate.from("2027-10-30"),
        Temporal.PlainDate.from("2027-11-01"),
        timeZone,
    );
    const { minutesPerColumn } = grid.axis;

    it("gives the repeated hour a row of its own", () => {
        expect(minutesPerColumn).toBe(1500);
    });

    // An interval the window no longer covers, which is what a moved edition
    // leaves behind. It collapses onto an end of the grid rather than throwing.
    it("puts an instant outside the window on the nearer end", () => {
        const after = Temporal.PlainDate.from("2027-11-05").toZonedDateTime(timeZone).toInstant();
        const before = Temporal.PlainDate.from("2027-10-20").toZonedDateTime(timeZone).toInstant();

        expect(toAbsolute(grid, after)).toBe(grid.days.length * minutesPerColumn);
        expect(toAbsolute(grid, before)).toBe(0);
    });

    // Every position, not a sample: picking the wrong reading of the repeated
    // hour is an hour's error that still reads as a plausible time, so only
    // walking the whole axis catches it.
    it("holds every position on every day", () => {
        const moved: number[] = [];

        for (
            let minutes = 0;
            minutes < grid.days.length * minutesPerColumn;
            minutes += SNAP_MINUTES
        ) {
            if (toAbsolute(grid, toInstant(grid, minutes)) !== minutes) {
                moved.push(minutes);
            }
        }

        // Which row each day lacks depends on the offset it keeps, so the day
        // before the change lacks the later reading and the day after lacks the
        // earlier one. Those rows are no time at all, so they answer as the row
        // time resumes at.
        expect(moved).toEqual([180, 210, 3120, 3150]);
    });
});

describe("edgeScrollDistance", () => {
    const moved = { up: true, down: true };
    const second = 1;

    it("stays still away from either edge", () => {
        expect(edgeScrollDistance(300, 300, moved, second)).toBe(0);
    });

    it("pulls up near the top and down near the bottom", () => {
        expect(edgeScrollDistance(10, 400, moved, second)).toBeLessThan(0);
        expect(edgeScrollDistance(400, 10, moved, second)).toBeGreaterThan(0);
    });

    it("gathers pace the closer it gets", () => {
        const far = edgeScrollDistance(400, 40, moved, second);
        const near = edgeScrollDistance(400, 5, moved, second);

        expect(near).toBeGreaterThan(far);
    });

    it("ignores an edge the gesture never traveled toward", () => {
        expect(edgeScrollDistance(5, 400, { up: false, down: true }, second)).toBe(0);
        expect(edgeScrollDistance(400, 5, { up: true, down: false }, second)).toBe(0);
    });

    it("goes no faster than its top speed, however far past the edge", () => {
        expect(Math.abs(edgeScrollDistance(-500, 400, moved, second))).toBeLessThanOrEqual(300);
    });

    it("scales with the time the frame took", () => {
        const whole = edgeScrollDistance(400, 5, moved, 1);
        const half = edgeScrollDistance(400, 5, moved, 0.5);

        expect(half).toBeCloseTo(whole / 2);
    });
});

describe("carryScroll", () => {
    it("adds up fractions of a pixel that would each round to nothing", () => {
        let scroll = { position: 0, carry: 0 };

        for (let frame = 0; frame < 20; frame++) {
            scroll = carryScroll(scroll.position, 0.25, scroll.carry, 1000);
        }

        expect(scroll.position).toBe(5);
        expect(scroll.carry).toBeCloseTo(0);
    });

    it("carries upward scrolling the same way", () => {
        let scroll = { position: 100, carry: 0 };

        for (let frame = 0; frame < 10; frame++) {
            scroll = carryScroll(scroll.position, -0.25, scroll.carry, 1000);
        }

        expect(scroll.position).toBe(98);
        expect(scroll.carry).toBeCloseTo(-0.5);
    });

    it("only ever lands on whole pixels", () => {
        expect(carryScroll(10, 2.75, 0, 1000)).toEqual({ position: 12, carry: 0.75 });
    });

    it("starts over when there is nothing to follow", () => {
        expect(carryScroll(10, 0, 0.9, 1000)).toEqual({ position: 10, carry: 0 });
    });

    it("drops the fraction once an end stops it", () => {
        expect(carryScroll(999, 3.5, 0, 1000)).toEqual({ position: 1000, carry: 0 });
        expect(carryScroll(1, -3.5, 0, 1000)).toEqual({ position: 0, carry: 0 });
    });
});
