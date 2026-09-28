import { isBefore } from "temporal-extra";
import { describe, expect, it } from "vitest";
import {
    buildGrid,
    missingRanges,
    SNAP_MINUTES,
    toAbsolute,
    toInstant,
} from "#/components/AvailabilityField/geometry.ts";

const YEARS_AHEAD = 6;

const transitionsIn = (timeZone: string, from: Temporal.PlainDate, to: Temporal.PlainDate) => {
    const found: Temporal.PlainDate[] = [];
    let at = from.toZonedDateTime(timeZone);
    const end = to.toZonedDateTime(timeZone);

    while (isBefore(at, end)) {
        const next = at.add({ days: 1 });

        if (next.offsetNanoseconds !== at.offsetNanoseconds) {
            found.push(at.toPlainDate());
        }

        at = next;
    }

    return found;
};

const realMinutes = (day: Temporal.PlainDate, timeZone: string): number =>
    day
        .add({ days: 1 })
        .toZonedDateTime(timeZone)
        .since(day.toZonedDateTime(timeZone))
        .total({ unit: "minute" });

type Complaint = {
    zone: string;
    day: string;
    what: string;
};

const inspect = (timeZone: string, transition: Temporal.PlainDate): Complaint[] => {
    const grid = buildGrid(transition.subtract({ days: 1 }), transition.add({ days: 1 }), timeZone);
    const { minutesPerColumn } = grid.axis;
    const complaints: Complaint[] = [];

    grid.days.forEach((day, dayIndex) => {
        const shaded = missingRanges(grid, dayIndex);
        const at = { zone: timeZone, day: day.toString() };

        const shadedMinutes = shaded.reduce((total, range) => total + (range.to - range.from), 0);
        const held = realMinutes(day, timeZone);

        if (minutesPerColumn - shadedMinutes !== held) {
            complaints.push({
                ...at,
                what: `shading leaves ${minutesPerColumn - shadedMinutes} of ${held} real minutes`,
            });
        }

        // toAbsolute finds a row by the last one already begun, which is only
        // the right row while the starts climb.
        const starts = grid.rowStarts[dayIndex].filter((start) => start !== undefined);
        const climbs = starts.every(
            (start, index) => index === 0 || isBefore(starts[index - 1], start),
        );

        if (!climbs) {
            complaints.push({ ...at, what: "row starts do not climb" });
        }

        for (let within = 0; within < minutesPerColumn; within += SNAP_MINUTES) {
            if (shaded.some((range) => within >= range.from && within < range.to)) {
                continue;
            }

            const minutes = dayIndex * minutesPerColumn + within;

            if (toAbsolute(grid, toInstant(grid, minutes)) !== minutes) {
                complaints.push({
                    ...at,
                    what: `minute ${within} does not survive the round trip`,
                });
                break;
            }
        }
    });

    return complaints;
};

// Every clock change in every IANA zone for six years is a few seconds of real
// work, which leaves nothing under vitest's 5s default once the suite runs it
// beside everything else. It passes alone at ~4.7s and fails in a full run.
const ZONE_SWEEP_TIMEOUT = 20_000;

/**
 * The tripwire for the day a zone stops fitting the axis.
 *
 * The axis holds a clock change by giving each reading of a repeated hour its
 * own row, which assumes a shift of 30, 60 or 120 minutes that lands on the
 * hour. Every zone in the database keeps to that today. A transition at a minute
 * past midnight, or a shift of three hours, breaks the model rather than any
 * single line of it, and the fix is a different axis rather than a patch.
 *
 * It reads the zones from the platform, so a Node or browser update carrying new
 * rules is what trips it.
 */
describe("every zone the platform knows", () => {
    it(
        "holds its clock changes on an axis of whole hours",
        () => {
            const today = Temporal.Now.plainDateISO();
            const until = today.add({ years: YEARS_AHEAD });
            const complaints: Complaint[] = [];
            let checked = 0;

            for (const timeZone of Intl.supportedValuesOf("timeZone")) {
                for (const transition of transitionsIn(timeZone, today, until)) {
                    complaints.push(...inspect(timeZone, transition));
                    checked += 1;
                }
            }

            // A zone with no clock changes at all would pass this vacuously.
            expect(checked).toBeGreaterThan(500);
            expect(complaints).toEqual([]);
        },
        ZONE_SWEEP_TIMEOUT,
    );
});
