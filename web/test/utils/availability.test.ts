import { describe, expect, it } from "vitest";
import { type AvailabilityInterval, mergeIntervals } from "#/utils/availability.ts";

const interval = (startsAt: string, endsAt: string): AvailabilityInterval => ({
    startsAt: Temporal.Instant.from(startsAt),
    endsAt: Temporal.Instant.from(endsAt),
});

const times = (intervals: AvailabilityInterval[]): [string, string][] =>
    intervals.map((entry) => [entry.startsAt.toString(), entry.endsAt.toString()]);

describe("mergeIntervals", () => {
    it("leaves intervals with a gap between them apart", () => {
        const merged = mergeIntervals([
            interval("2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z"),
            interval("2027-03-25T11:00:00Z", "2027-03-25T12:00:00Z"),
        ]);

        expect(times(merged)).toEqual([
            ["2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z"],
            ["2027-03-25T11:00:00Z", "2027-03-25T12:00:00Z"],
        ]);
    });

    // The rule the whole per-day split rests on: the API joins these too, so a
    // block drawn either side of midnight stores as the one row.
    it("joins intervals that only touch", () => {
        const merged = mergeIntervals([
            interval("2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z"),
            interval("2027-03-25T10:00:00Z", "2027-03-25T11:00:00Z"),
        ]);

        expect(times(merged)).toEqual([["2027-03-25T09:00:00Z", "2027-03-25T11:00:00Z"]]);
    });

    it("joins overlapping intervals", () => {
        const merged = mergeIntervals([
            interval("2027-03-25T09:00:00Z", "2027-03-25T11:00:00Z"),
            interval("2027-03-25T10:00:00Z", "2027-03-25T12:00:00Z"),
        ]);

        expect(times(merged)).toEqual([["2027-03-25T09:00:00Z", "2027-03-25T12:00:00Z"]]);
    });

    it("absorbs an interval contained in another without extending it", () => {
        const merged = mergeIntervals([
            interval("2027-03-25T09:00:00Z", "2027-03-25T17:00:00Z"),
            interval("2027-03-25T11:00:00Z", "2027-03-25T12:00:00Z"),
        ]);

        expect(times(merged)).toEqual([["2027-03-25T09:00:00Z", "2027-03-25T17:00:00Z"]]);
    });

    it("orders the result by start, whatever order it was given", () => {
        const merged = mergeIntervals([
            interval("2027-03-25T15:00:00Z", "2027-03-25T16:00:00Z"),
            interval("2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z"),
        ]);

        expect(times(merged)).toEqual([
            ["2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z"],
            ["2027-03-25T15:00:00Z", "2027-03-25T16:00:00Z"],
        ]);
    });

    it("leaves what it was given alone", () => {
        const given = [interval("2027-03-25T09:00:00Z", "2027-03-25T10:00:00Z")];
        const before = times(given);

        mergeIntervals([...given, interval("2027-03-25T10:00:00Z", "2027-03-25T11:00:00Z")]);

        expect(times(given)).toEqual(before);
    });
});
