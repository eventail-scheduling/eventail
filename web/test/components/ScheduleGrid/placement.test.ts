import { describe, expect, it } from "vitest";
import {
    buildScheduleAxis,
    instantAtMinutes,
    type ScheduleAxis,
    subdivisionSpacing,
} from "#/components/ScheduleGrid/geometry.js";
import {
    type Candidate,
    candidateTiming,
    clampSpan,
    closedRanges,
    defaultMinuteStep,
    isMinuteStep,
    refusePlacement,
    snapToStep,
} from "#/components/ScheduleGrid/placement.js";
import type { Slot } from "#/queries/schedule.js";

const berlin = "Europe/Berlin";

// Two days clear of any clock change, so a minute on the axis is a minute of
// the day and a reader can check the arithmetic by hand.
const twoDays = (): ScheduleAxis =>
    buildScheduleAxis(
        Temporal.PlainDate.from("2027-06-01"),
        Temporal.PlainDate.from("2027-06-02"),
        berlin,
    );

type SlotAt = {
    id: string;
    locationId: string;
    from: number;
    to: number;
    setup?: number;
    teardown?: number;
    title?: string;
};

const slotAt = (axis: ScheduleAxis, { id, locationId, from, to, ...rest }: SlotAt): Slot => ({
    id,
    stableId: id,
    startsAt: instantAtMinutes(axis, from),
    endsAt: instantAtMinutes(axis, to),
    setupTime: Temporal.Duration.from({ minutes: rest.setup ?? 0 }),
    teardownTime: Temporal.Duration.from({ minutes: rest.teardown ?? 0 }),
    session: { id: `session-${id}`, title: rest.title ?? "A talk", state: "confirmed" as const },
    location: { id: locationId },
});

const candidateAt = (
    from: number,
    to: number,
    shoulders = { setup: 0, teardown: 0 },
): Candidate => ({
    locationId: "hall",
    span: { from, to },
    shoulders,
});

describe("what the API would refuse", () => {
    it("takes a placement no other slot in the room reaches", () => {
        const axis = twoDays();
        const slots = [slotAt(axis, { id: "a", locationId: "hall", from: 600, to: 660 })];

        expect(refusePlacement({ axis, candidate: candidateAt(660, 720), slots })).toBeNull();
    });

    it("refuses an overlap and names what is in the way", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "a", locationId: "hall", from: 600, to: 660, title: "Keynote" }),
        ];
        const refusal = refusePlacement({ axis, candidate: candidateAt(630, 690), slots });

        expect(refusal?.code).toEqual("already_occupied");
        expect(refusal?.detail).toContain("Keynote");
    });

    it("refuses two slots that clear each other and not their margins", () => {
        // The rule the grid exists to make visible: nothing about the bodies
        // says no, and the room is still held by a teardown when the next
        // setup wants it.
        const axis = twoDays();
        const slots = [
            slotAt(axis, {
                id: "a",
                locationId: "hall",
                from: 600,
                to: 660,
                teardown: 15,
                title: "Keynote",
            }),
        ];
        const refusal = refusePlacement({
            axis,
            candidate: candidateAt(670, 730, { setup: 20, teardown: 0 }),
            slots,
        });

        expect(refusal?.code).toEqual("already_occupied");
        expect(refusal?.detail).toContain("setup and teardown");
    });

    it("lets a slot pass through the place it already holds", () => {
        const axis = twoDays();
        const slots = [slotAt(axis, { id: "a", locationId: "hall", from: 600, to: 660 })];

        expect(
            refusePlacement({
                axis,
                candidate: candidateAt(610, 670),
                slots,
                exceptSlotId: "a",
            }),
        ).toBeNull();
    });

    it("leaves a room alone about what stands in another one", () => {
        const axis = twoDays();
        const slots = [slotAt(axis, { id: "a", locationId: "annex", from: 600, to: 660 })];

        expect(refusePlacement({ axis, candidate: candidateAt(600, 660), slots })).toBeNull();
    });

    it("takes a slot that ends exactly as the edition does", () => {
        // slotFitsWindow allows both edges to touch, and a program often does
        // run to the last minute of the last day.
        const axis = twoDays();

        expect(refusePlacement({ axis, candidate: candidateAt(2820, 2880), slots: [] })).toBeNull();
    });

    it("takes a slot that begins exactly as the edition does", () => {
        const axis = twoDays();

        expect(refusePlacement({ axis, candidate: candidateAt(0, 60), slots: [] })).toBeNull();
    });

    it("takes a slot whose setup begins exactly as the edition does", () => {
        const axis = twoDays();

        expect(
            refusePlacement({
                axis,
                candidate: candidateAt(30, 90, { setup: 30, teardown: 0 }),
                slots: [],
            }),
        ).toBeNull();
    });

    it("refuses what reaches past the last day", () => {
        const axis = twoDays();
        const refusal = refusePlacement({ axis, candidate: candidateAt(2820, 2940), slots: [] });

        expect(refusal?.code).toEqual("outside_window");
        expect(refusal?.detail).toEqual("This reaches outside the edition's days.");
    });

    it("says so when only the margins fall outside", () => {
        const axis = twoDays();
        const refusal = refusePlacement({
            axis,
            candidate: candidateAt(0, 60, { setup: 30, teardown: 0 }),
            slots: [],
        });

        expect(refusal?.code).toEqual("outside_window");
        expect(refusal?.detail).toEqual("Setup and teardown reach outside the edition's days.");
    });
});

describe("keeping a dragged slot on the grid", () => {
    it("holds a span against the end without shortening it", () => {
        const axis = twoDays();

        expect(clampSpan(axis, { from: 2880, to: 2940 }, { setup: 0, teardown: 0 }, 5)).toEqual({
            from: 2820,
            to: 2880,
        });
    });

    it("leaves the setup its room at the start of the edition", () => {
        const axis = twoDays();

        expect(clampSpan(axis, { from: 0, to: 60 }, { setup: 30, teardown: 0 }, 5)).toEqual({
            from: 30,
            to: 90,
        });
    });

    it("leaves a span the edition already holds where it is", () => {
        const axis = twoDays();

        expect(clampSpan(axis, { from: 600, to: 660 }, { setup: 15, teardown: 15 }, 5)).toEqual({
            from: 600,
            to: 660,
        });
    });

    it("parks a span too long for the edition against its first day", () => {
        const axis = twoDays();
        const span = clampSpan(axis, { from: 100, to: 3100 }, { setup: 0, teardown: 0 }, 5);

        expect(span).toEqual({ from: 0, to: 3000 });
        expect(
            refusePlacement({
                axis,
                candidate: { locationId: "hall", span, shoulders: { setup: 0, teardown: 0 } },
                slots: [],
            })?.code,
        ).toEqual("outside_window");
    });

    it("keeps a span held against the end on the step it was asked for", () => {
        // An hour long session with margins cannot reach the edition's last
        // minute, and sliding it there would leave it at a quarter past after
        // the organizer asked for whole hours.
        const axis = twoDays();
        const shoulders = { setup: 30, teardown: 15 };

        expect(clampSpan(axis, { from: 2880, to: 2940 }, shoulders, 60)).toEqual({
            from: 2760,
            to: 2820,
        });
    });

    it("gives up the step rather than the window where nothing fits on it", () => {
        // Snapping down here would leave the first day, so the span keeps the
        // only position it has and refusePlacement answers for the rest.
        const axis = twoDays();

        expect(clampSpan(axis, { from: 0, to: 60 }, { setup: 30, teardown: 0 }, 60)).toEqual({
            from: 30,
            to: 90,
        });
    });

    it("rounds a pointer to whichever step is asked for", () => {
        expect(snapToStep(612, 5)).toEqual(610);
        expect(snapToStep(613, 5)).toEqual(615);
        expect(snapToStep(612, 15)).toEqual(615);
        expect(snapToStep(612, 60)).toEqual(600);
    });
});

describe("the stretches an availability leaves out", () => {
    const at = (axis: ScheduleAxis, minutes: number) => instantAtMinutes(axis, minutes);

    it("closes nothing where nothing was said", () => {
        expect(closedRanges(twoDays(), [])).toEqual([]);
    });

    it("closes everything either side of a single window", () => {
        const axis = twoDays();

        expect(closedRanges(axis, [{ startsAt: at(axis, 540), endsAt: at(axis, 1080) }])).toEqual([
            { from: 0, to: 540 },
            { from: 1080, to: 2880 },
        ]);
    });

    it("leaves the gap between two windows closed", () => {
        const axis = twoDays();

        expect(
            closedRanges(axis, [
                { startsAt: at(axis, 540), endsAt: at(axis, 720) },
                { startsAt: at(axis, 840), endsAt: at(axis, 1080) },
            ]),
        ).toEqual([
            { from: 0, to: 540 },
            { from: 720, to: 840 },
            { from: 1080, to: 2880 },
        ]);
    });

    it("merges windows that touch or overlap rather than closing between them", () => {
        const axis = twoDays();

        expect(
            closedRanges(axis, [
                { startsAt: at(axis, 840), endsAt: at(axis, 1080) },
                { startsAt: at(axis, 540), endsAt: at(axis, 900) },
            ]),
        ).toEqual([
            { from: 0, to: 540 },
            { from: 1080, to: 2880 },
        ]);
    });

    it("keeps the half of a window that falls inside the edition", () => {
        // An availability drawn before an edition moved can start outside it.
        const axis = twoDays();

        expect(closedRanges(axis, [{ startsAt: at(axis, -600), endsAt: at(axis, 540) }])).toEqual([
            { from: 540, to: 2880 },
        ]);
    });

    it("keeps a window that another one swallows from reopening the gap", () => {
        // The running edge only ever moves forward, or a contained window would
        // close the time between its end and the outer window's.
        const axis = twoDays();

        expect(
            closedRanges(axis, [
                { startsAt: at(axis, 540), endsAt: at(axis, 1080) },
                { startsAt: at(axis, 600), endsAt: at(axis, 700) },
            ]),
        ).toEqual([
            { from: 0, to: 540 },
            { from: 1080, to: 2880 },
        ]);
    });

    it("closes the whole grid for a window that lands after the edition", () => {
        // Clamped to the axis rather than taken at face value, or the band
        // would run past the last row the grid has.
        const axis = twoDays();

        expect(closedRanges(axis, [{ startsAt: at(axis, 3000), endsAt: at(axis, 3600) }])).toEqual([
            { from: 0, to: 2880 },
        ]);
    });

    it("closes the whole grid for a window that misses it entirely", () => {
        const axis = twoDays();

        expect(closedRanges(axis, [{ startsAt: at(axis, -600), endsAt: at(axis, -60) }])).toEqual([
            { from: 0, to: 2880 },
        ]);
    });
});

describe("the lines drawn inside an hour", () => {
    it("draws nothing for a step that is the hour itself", () => {
        expect(subdivisionSpacing(36, 60)).toBeUndefined();
    });

    it("draws nothing it would only smear", () => {
        expect(subdivisionSpacing(36, 5)).toBeUndefined();
    });

    it("puts a line exactly where a snapped gesture lands", () => {
        // The same (step / 60) * rowHeight the block geometry uses, so the line
        // and the minute it stands for cannot drift apart.
        expect(subdivisionSpacing(36, 15)).toEqual(9);
        expect(subdivisionSpacing(240, 5)).toEqual(20);
    });

    it("draws the step an organizer gets without choosing one", () => {
        expect(subdivisionSpacing(36, defaultMinuteStep)).toEqual(9);
    });

    it("lets an hour that grew show a finer step than one that did not", () => {
        expect(subdivisionSpacing(36, 5)).toBeUndefined();
        expect(subdivisionSpacing(120, 5)).toEqual(10);
    });
});

describe("which numbers are steps", () => {
    it("refuses what is not one, including the nil a missing setting reads as", () => {
        expect(isMinuteStep(0)).toBe(false);
        expect(isMinuteStep(Number.NaN)).toBe(false);
        expect(isMinuteStep(7)).toBe(false);
        // A stored one has to stop counting, since the control keeps its last
        // answer and cannot know the list moved under it.
        expect(isMinuteStep(1)).toBe(false);
        expect(isMinuteStep(10)).toBe(false);
        expect(isMinuteStep(15)).toBe(true);
    });
});

describe("what a candidate is written to the API as", () => {
    it("carries the margins as durations of hours and minutes", () => {
        const axis = twoDays();
        const timing = candidateTiming(axis, candidateAt(600, 660, { setup: 90, teardown: 15 }));

        // The API refuses days and sub-minute units on either margin.
        expect(timing.setupTime.toString()).toEqual("PT90M");
        expect(timing.teardownTime.toString()).toEqual("PT15M");
        expect(timing.endsAt.since(timing.startsAt).total("minutes")).toEqual(60);
        // Pinned against the axis rather than against each other, or a timing
        // offset by a constant on both ends would read as correct.
        expect(timing.startsAt.toString()).toEqual(instantAtMinutes(axis, 600).toString());
        expect(timing.endsAt.toString()).toEqual(instantAtMinutes(axis, 660).toString());
    });
});
