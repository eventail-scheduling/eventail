import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Edition } from "../../src/entity/Edition.js";
import {
    changeDays,
    type EditionDates,
    editionWindow,
    keepsItsLength,
    reanchor,
    reanchorClamped,
    slotFitsWindow,
    startDateRange,
    type WindowChange,
} from "../../src/support/edition-window.js";

const edition = {
    startDate: Temporal.PlainDate.from("2026-11-21"),
    endDate: Temporal.PlainDate.from("2026-11-23"),
    timeZone: "Europe/Berlin",
} as Edition;

const window = editionWindow(edition);

const dates = (startDate: string, endDate: string, timeZone: string): EditionDates => ({
    startDate: Temporal.PlainDate.from(startDate),
    endDate: Temporal.PlainDate.from(endDate),
    timeZone,
});

const berlin = (startDate: string, endDate: string) => dates(startDate, endDate, "Europe/Berlin");

const change = (previous: EditionDates, next: EditionDates, days = 0): WindowChange => ({
    previous,
    next,
    days,
});

describe("editionWindow", () => {
    it("runs from midnight to midnight in the edition's own zone", () => {
        assert.equal(window.startsAt.toString(), "2026-11-20T23:00:00Z");
        assert.equal(window.endsAt.toString(), "2026-11-23T23:00:00Z");
    });
});

describe("changeDays", () => {
    it("counts from the day the edition used to begin to the one chosen", () => {
        const previous = berlin("2026-11-21", "2026-11-23");

        assert.equal(changeDays(previous, Temporal.PlainDate.from("2026-11-28")), 7);
        assert.equal(changeDays(previous, Temporal.PlainDate.from("2026-11-21")), 0);
        assert.equal(changeDays(previous, Temporal.PlainDate.from("2026-11-20")), -1);
    });
});

describe("reanchor", () => {
    it("carries the hour of day across a move", () => {
        const talk = Temporal.Instant.from("2026-11-21T09:00:00Z");
        const moved = reanchor(
            talk,
            change(berlin("2026-11-21", "2026-11-23"), berlin("2026-11-28", "2026-11-30"), 7),
        );

        assert.equal(moved?.toString(), "2026-11-28T09:00:00Z");
    });

    it("holds the hour of day on both sides of a change inside the window", () => {
        const retype = change(
            dates("2027-03-27", "2027-03-29", "UTC"),
            berlin("2027-03-27", "2027-03-29"),
        );
        const first = reanchor(Temporal.Instant.from("2027-03-27T10:00:00Z"), retype);
        const last = reanchor(Temporal.Instant.from("2027-03-29T10:00:00Z"), retype);

        assert.equal(
            first?.toZonedDateTimeISO("Europe/Berlin").toPlainTime().toString(),
            "10:00:00",
        );
        assert.equal(
            last?.toZonedDateTimeISO("Europe/Berlin").toPlainTime().toString(),
            "10:00:00",
        );
    });

    it("gives up on an hour the new zone skips", () => {
        const skipped = reanchor(
            Temporal.Instant.from("2027-03-28T02:30:00Z"),
            change(dates("2027-03-27", "2027-03-29", "UTC"), berlin("2027-03-27", "2027-03-29")),
        );

        assert.equal(skipped, null);
    });

    // An hour the clocks repeat is two real times rather than none, so it
    // survives. Read from UTC it has no pass of its own, so it lands on the
    // first.
    it("keeps an hour the new zone repeats", () => {
        const repeated = reanchor(
            Temporal.Instant.from("2027-10-31T02:30:00Z"),
            change(dates("2027-10-30", "2027-11-01", "UTC"), berlin("2027-10-30", "2027-11-01")),
        );

        assert.equal(repeated?.toString(), "2027-10-31T00:30:00Z");
    });

    it("gives up on a half hour a zone skips", () => {
        const lordHowe = (startDate: string, endDate: string) =>
            dates(startDate, endDate, "Australia/Lord_Howe");
        const crossing = change(
            lordHowe("2027-09-26", "2027-09-26"),
            lordHowe("2027-10-03", "2027-10-03"),
            7,
        );

        assert.equal(reanchor(Temporal.Instant.from("2027-09-25T15:45:00Z"), crossing), null);
        assert.notEqual(reanchor(Temporal.Instant.from("2027-09-25T14:45:00Z"), crossing), null);
    });

    it("gives up on a day a zone never had", () => {
        const apia = (startDate: string, endDate: string) =>
            dates(startDate, endDate, "Pacific/Apia");
        const crossing = change(
            apia("2011-12-29", "2011-12-29"),
            apia("2011-12-30", "2011-12-30"),
            1,
        );

        assert.equal(reanchor(Temporal.Instant.from("2011-12-29T20:00:00Z"), crossing), null);
    });

    // 2026-10-25 and 2027-10-31 are the nights Berlin repeats 02:00 to 03:00.
    // 02:10 in the second pass is 01:10Z, in the first 00:10Z.
    it("leaves a time in the second pass of a repeated hour where it is", () => {
        const secondPass = Temporal.Instant.from("2026-10-25T01:10:00Z");
        const kept = reanchor(
            secondPass,
            change(berlin("2026-10-24", "2026-10-25"), berlin("2026-10-24", "2026-10-25")),
        );

        assert.equal(kept?.toString(), secondPass.toString());
    });

    it("keeps each pass of a repeated hour across a move onto another", () => {
        const ontoNextYear = change(
            berlin("2026-10-24", "2026-10-25"),
            berlin("2027-10-30", "2027-10-31"),
            371,
        );

        assert.equal(
            reanchor(Temporal.Instant.from("2026-10-25T01:10:00Z"), ontoNextYear)?.toString(),
            "2027-10-31T01:10:00Z",
        );
        assert.equal(
            reanchor(Temporal.Instant.from("2026-10-25T00:10:00Z"), ontoNextYear)?.toString(),
            "2027-10-31T00:10:00Z",
        );
    });

    it("leaves everything alone when nothing travels", () => {
        const talk = Temporal.Instant.from("2026-11-22T09:00:00Z");
        const kept = reanchor(
            talk,
            change(berlin("2026-11-21", "2026-11-23"), berlin("2026-11-21", "2026-11-22")),
        );

        assert.equal(kept?.toString(), talk.toString());
    });
});

describe("startDateRange", () => {
    it("reaches back by the span the edition used to have", () => {
        const range = startDateRange(
            berlin("2027-05-01", "2027-05-05"),
            berlin("2027-05-02", "2027-05-05"),
        );

        assert.equal(range.earliest.toString(), "2027-04-28");
        assert.equal(range.latest.toString(), "2027-05-05");
    });

    it("reaches back nothing at all for a single day edition", () => {
        const range = startDateRange(
            berlin("2027-05-01", "2027-05-01"),
            berlin("2027-06-01", "2027-06-03"),
        );

        assert.equal(range.earliest.toString(), "2027-06-01");
        assert.equal(range.latest.toString(), "2027-06-03");
    });
});

describe("keepsItsLength", () => {
    const span = (startsAt: string, endsAt: string) => ({
        startsAt: Temporal.Instant.from(startsAt),
        endsAt: Temporal.Instant.from(endsAt),
    });

    it("holds when the two ends move together", () => {
        assert.equal(
            keepsItsLength(
                span("2027-03-21T00:30:00Z", "2027-03-21T02:30:00Z"),
                span("2027-03-28T00:30:00Z", "2027-03-28T02:30:00Z"),
            ),
            true,
        );
    });

    it("fails a talk the skipped hour cut short", () => {
        assert.equal(
            keepsItsLength(
                span("2027-03-21T00:30:00Z", "2027-03-21T02:30:00Z"),
                span("2027-03-28T00:30:00Z", "2027-03-28T01:30:00Z"),
            ),
            false,
        );
    });

    it("fails a talk the repeated hour stretched", () => {
        assert.equal(
            keepsItsLength(
                span("2027-10-24T00:30:00Z", "2027-10-24T02:30:00Z"),
                span("2027-10-31T00:30:00Z", "2027-10-31T03:30:00Z"),
            ),
            false,
        );
    });

    it("fails one that came out back to front", () => {
        assert.equal(
            keepsItsLength(
                span("2027-10-31T00:50:00Z", "2027-10-31T01:10:00Z"),
                span("2027-11-07T01:50:00Z", "2027-11-07T01:10:00Z"),
            ),
            false,
        );
    });
});

describe("reanchorClamped", () => {
    // Berlin skips 02:00 to 03:00 on this morning, so both readings land on
    // the one instant the clock jumps at.
    const intoTheGap = change(
        berlin("2027-03-21", "2027-03-21"),
        berlin("2027-03-28", "2027-03-28"),
        7,
    );

    it("leaves an hour that exists exactly where it lands", () => {
        const kept = reanchorClamped(Temporal.Instant.from("2027-03-21T00:00:00Z"), intoTheGap);

        assert.equal(kept.clamped, false);
        assert.equal(
            kept.instant.toZonedDateTimeISO("Europe/Berlin").toPlainTime().toString(),
            "01:00:00",
        );
    });

    it("puts an edge with nowhere to stand on the jump itself", () => {
        const clamped = reanchorClamped(Temporal.Instant.from("2027-03-21T01:30:00Z"), intoTheGap);

        assert.equal(clamped.clamped, true);
        assert.equal(clamped.instant.toString(), "2027-03-28T01:00:00Z");
    });

    it("does not overshoot the gap in either direction", () => {
        const clamped = reanchorClamped(Temporal.Instant.from("2027-03-21T01:30:00Z"), intoTheGap);

        assert.notEqual(clamped.instant.toString(), "2027-03-28T00:30:00Z");
        assert.notEqual(clamped.instant.toString(), "2027-03-28T01:30:00Z");
    });

    it("keeps an hour the clocks repeat out of the clamp altogether", () => {
        const overTheRepeat = change(
            berlin("2027-10-24", "2027-10-24"),
            berlin("2027-10-31", "2027-10-31"),
            7,
        );
        const repeated = reanchorClamped(
            Temporal.Instant.from("2027-10-24T00:30:00Z"),
            overTheRepeat,
        );

        assert.equal(repeated.clamped, false);
        assert.equal(repeated.instant.toString(), "2027-10-31T00:30:00Z");
    });
});

describe("slotFitsWindow", () => {
    const window = editionWindow(berlin("2027-11-01", "2027-11-03"));
    const slot = (startsAt: string, endsAt: string, setup = "PT0S", teardown = "PT0S") => ({
        startsAt: Temporal.Instant.from(startsAt),
        endsAt: Temporal.Instant.from(endsAt),
        setupTime: Temporal.Duration.from(setup),
        teardownTime: Temporal.Duration.from(teardown),
    });

    it("takes one sitting inside", () => {
        assert.equal(
            slotFitsWindow(slot("2027-11-02T09:00:00Z", "2027-11-02T10:00:00Z"), window),
            true,
        );
    });

    it("refuses one whose setup reaches back past the first midnight", () => {
        assert.equal(
            slotFitsWindow(slot("2027-10-31T23:10:00Z", "2027-11-01T00:00:00Z", "PT15M"), window),
            false,
        );
    });

    it("refuses one whose teardown reaches past the last midnight", () => {
        assert.equal(
            slotFitsWindow(
                slot("2027-11-03T22:00:00Z", "2027-11-03T22:55:00Z", "PT0S", "PT15M"),
                window,
            ),
            false,
        );
    });

    it("takes one whose margins stop exactly on the edges", () => {
        assert.equal(
            slotFitsWindow(
                slot("2027-10-31T23:15:00Z", "2027-11-03T22:45:00Z", "PT15M", "PT15M"),
                window,
            ),
            true,
        );
    });
});
