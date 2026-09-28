import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Edition } from "../../src/entity/Edition.js";
import {
    type AvailabilityInterval,
    clampToWindow,
    findIntervalProblem,
    mergeIntervals,
} from "../../src/support/availability.js";
import { editionWindow } from "../../src/support/edition-window.js";

const edition = {
    startDate: Temporal.PlainDate.from("2026-11-21"),
    endDate: Temporal.PlainDate.from("2026-11-23"),
    timeZone: "Europe/Berlin",
} as Edition;

const window = editionWindow(edition);

const interval = (startsAt: string, endsAt: string): AvailabilityInterval => ({
    startsAt: Temporal.Instant.from(startsAt),
    endsAt: Temporal.Instant.from(endsAt),
});

/** 09:00 to 17:00 Berlin on the edition's first day. */
const firstDay = interval("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z");

describe("findIntervalProblem", () => {
    it("takes an interval inside the window", () => {
        assert.equal(findIntervalProblem([firstDay], window), null);
    });

    it("takes intervals that touch", () => {
        const morning = interval("2026-11-21T08:00:00Z", "2026-11-21T11:00:00Z");
        const afternoon = interval("2026-11-21T11:00:00Z", "2026-11-21T16:00:00Z");

        assert.equal(findIntervalProblem([morning, afternoon], window), null);
    });

    it("takes intervals with a gap between them", () => {
        const morning = interval("2026-11-21T08:00:00Z", "2026-11-21T11:00:00Z");
        const afternoon = interval("2026-11-21T12:00:00Z", "2026-11-21T16:00:00Z");

        assert.equal(findIntervalProblem([morning, afternoon], window), null);
    });

    it("refuses an interval carrying seconds", () => {
        const seconds = interval("2026-11-21T08:00:30Z", "2026-11-21T16:00:00Z");

        assert.deepEqual(findIntervalProblem([seconds], window), { type: "sub_minute", index: 0 });
    });

    it("refuses an interval whose end carries seconds", () => {
        const seconds = interval("2026-11-21T08:00:00Z", "2026-11-21T16:00:45Z");

        assert.deepEqual(findIntervalProblem([seconds], window), { type: "sub_minute", index: 0 });
    });

    it("refuses an interval carrying sub-second precision", () => {
        const fractional = interval("2026-11-21T08:00:00.5Z", "2026-11-21T16:00:00Z");

        assert.deepEqual(findIntervalProblem([fractional], window), {
            type: "sub_minute",
            index: 0,
        });
    });

    it("refuses an interval that ends before it starts", () => {
        const reversed = interval("2026-11-21T16:00:00Z", "2026-11-21T08:00:00Z");

        assert.deepEqual(findIntervalProblem([reversed], window), { type: "reversed", index: 0 });
    });

    it("refuses an interval of no length", () => {
        const empty = interval("2026-11-21T08:00:00Z", "2026-11-21T08:00:00Z");

        assert.deepEqual(findIntervalProblem([empty], window), { type: "reversed", index: 0 });
    });

    it("refuses an interval starting before the window", () => {
        const early = interval("2026-11-20T22:00:00Z", "2026-11-21T08:00:00Z");

        assert.deepEqual(findIntervalProblem([early], window), {
            type: "outside_window",
            index: 0,
        });
    });

    it("refuses an interval ending after the window", () => {
        const late = interval("2026-11-23T16:00:00Z", "2026-11-24T00:00:00Z");

        assert.deepEqual(findIntervalProblem([late], window), { type: "outside_window", index: 0 });
    });

    it("takes an interval ending exactly at the window's end", () => {
        const last = interval("2026-11-23T16:00:00Z", "2026-11-23T23:00:00Z");

        assert.equal(findIntervalProblem([last], window), null);
    });

    it("takes overlapping intervals", () => {
        const morning = interval("2026-11-21T08:00:00Z", "2026-11-21T12:00:00Z");
        const overlapping = interval("2026-11-21T11:00:00Z", "2026-11-21T16:00:00Z");

        assert.equal(findIntervalProblem([morning, overlapping], window), null);
    });

    it("reports the position of the interval at fault", () => {
        const early = interval("2026-11-20T22:00:00Z", "2026-11-21T08:00:00Z");

        assert.deepEqual(findIntervalProblem([firstDay, early], window), {
            type: "outside_window",
            index: 1,
        });
    });
});

describe("clampToWindow", () => {
    it("leaves an interval inside the window alone", () => {
        const inside = interval("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z");

        assert.equal(clampToWindow(inside, window), "kept");
        assert.equal(inside.startsAt.toString(), "2026-11-21T08:00:00Z");
    });

    it("drops an interval that ends before the window", () => {
        const before = interval("2026-11-19T08:00:00Z", "2026-11-20T23:00:00Z");

        assert.equal(clampToWindow(before, window), "dropped");
    });

    it("drops an interval that starts after the window", () => {
        const after = interval("2026-11-23T23:00:00Z", "2026-11-24T08:00:00Z");

        assert.equal(clampToWindow(after, window), "dropped");
    });

    it("cuts an interval reaching past the end back to it", () => {
        const straddling = interval("2026-11-23T22:00:00Z", "2026-11-24T01:00:00Z");

        assert.equal(clampToWindow(straddling, window), "clamped");
        assert.equal(straddling.startsAt.toString(), "2026-11-23T22:00:00Z");
        assert.equal(straddling.endsAt.toString(), window.endsAt.toString());
    });

    it("cuts an interval reaching before the start back to it", () => {
        const straddling = interval("2026-11-20T22:00:00Z", "2026-11-21T08:00:00Z");

        assert.equal(clampToWindow(straddling, window), "clamped");
        assert.equal(straddling.startsAt.toString(), window.startsAt.toString());
        assert.equal(straddling.endsAt.toString(), "2026-11-21T08:00:00Z");
    });

    it("leaves what it clamped acceptable to the validator", () => {
        const straddling = interval("2026-11-23T22:00:00Z", "2026-11-24T01:00:00Z");
        clampToWindow(straddling, window);

        assert.equal(findIntervalProblem([straddling], window), null);
    });
});

describe("mergeIntervals", () => {
    it("leaves intervals with a gap between them alone", () => {
        const morning = interval("2026-11-21T08:00:00Z", "2026-11-21T11:00:00Z");
        const afternoon = interval("2026-11-21T12:00:00Z", "2026-11-21T16:00:00Z");

        const outcome = mergeIntervals([morning, afternoon]);

        assert.equal(outcome.kept.length, 2);
        assert.equal(outcome.absorbed.length, 0);
    });

    it("joins two intervals that touch", () => {
        const morning = interval("2026-11-21T08:00:00Z", "2026-11-21T11:00:00Z");
        const afternoon = interval("2026-11-21T11:00:00Z", "2026-11-21T16:00:00Z");

        const outcome = mergeIntervals([morning, afternoon]);

        assert.deepEqual(outcome.kept, [morning]);
        assert.deepEqual(outcome.absorbed, [afternoon]);
        assert.equal(morning.endsAt.toString(), "2026-11-21T16:00:00Z");
    });

    it("joins two intervals that overlap", () => {
        const early = interval("2026-11-21T08:00:00Z", "2026-11-21T12:00:00Z");
        const late = interval("2026-11-21T11:00:00Z", "2026-11-21T16:00:00Z");

        mergeIntervals([early, late]);

        assert.equal(early.endsAt.toString(), "2026-11-21T16:00:00Z");
    });

    it("keeps the longer end when one interval contains another", () => {
        const whole = interval("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z");
        const inside = interval("2026-11-21T10:00:00Z", "2026-11-21T12:00:00Z");

        const outcome = mergeIntervals([whole, inside]);

        assert.deepEqual(outcome.absorbed, [inside]);
        assert.equal(whole.endsAt.toString(), "2026-11-21T16:00:00Z");
    });

    it("carries a merge along a chain", () => {
        const first = interval("2026-11-21T08:00:00Z", "2026-11-21T10:00:00Z");
        const second = interval("2026-11-21T09:00:00Z", "2026-11-21T12:00:00Z");
        const third = interval("2026-11-21T11:00:00Z", "2026-11-21T14:00:00Z");

        const outcome = mergeIntervals([third, first, second]);

        assert.deepEqual(outcome.kept, [first]);
        assert.equal(outcome.absorbed.length, 2);
        assert.equal(first.endsAt.toString(), "2026-11-21T14:00:00Z");
    });
});
