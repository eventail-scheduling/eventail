import { describe, expect, it } from "vitest";
import { durationToMinutes, formatDurationLabel, minutesToDuration } from "#/utils/duration.ts";

describe("formatDurationLabel", () => {
    it("drops the hour part below an hour", () => {
        expect(formatDurationLabel(Temporal.Duration.from({ minutes: 45 }))).toBe("45m");
    });

    it("drops the minute part on a whole hour", () => {
        expect(formatDurationLabel(Temporal.Duration.from({ minutes: 120 }))).toBe("2h");
    });

    it("keeps both parts otherwise", () => {
        expect(formatDurationLabel(Temporal.Duration.from({ minutes: 90 }))).toBe("1h 30m");
    });

    it("reads an hours-and-minutes duration the same as its minute total", () => {
        const composed = Temporal.Duration.from({ hours: 1, minutes: 30 });

        expect(formatDurationLabel(composed)).toBe("1h 30m");
    });

    it("formats zero", () => {
        expect(formatDurationLabel(Temporal.Duration.from({ minutes: 0 }))).toBe("0m");
    });
});

describe("duration and minutes round-trip", () => {
    it("returns the same minute count it was given", () => {
        for (const minutes of [0, 1, 30, 90, 1439, 1440]) {
            expect(durationToMinutes(minutesToDuration(minutes))).toBe(minutes);
        }
    });

    it("keeps the API's wire format to whole minutes", () => {
        expect(minutesToDuration(90).toString()).toBe("PT90M");
        expect(minutesToDuration(1440).toString()).toBe("PT1440M");
    });

    it("collapses an hours-based duration to its minute total", () => {
        expect(durationToMinutes(Temporal.Duration.from({ hours: 2, minutes: 15 }))).toBe(135);
    });

    it("truncates sub-minute parts rather than rounding up past them", () => {
        expect(durationToMinutes(Temporal.Duration.from({ minutes: 5, seconds: 59 }))).toBe(5);
    });
});
