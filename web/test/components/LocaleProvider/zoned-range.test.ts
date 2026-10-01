import { describe, expect, it } from "vitest";
import {
    timeOptions,
    weekdayDateTimeOptions,
} from "#/components/LocaleProvider/LocaleProvider.tsx";
import { createInstantRangeFormatter } from "#/components/LocaleProvider/zoned-range.ts";

const berlin = "Europe/Berlin";

const timeRange = (locale: string) =>
    createInstantRangeFormatter(locale, timeOptions, berlin, (zoned) => zoned.toPlainTime());

const weekdayRange = (locale: string) =>
    createInstantRangeFormatter(locale, weekdayDateTimeOptions, berlin, (zoned) =>
        zoned.toPlainDateTime(),
    );

// 02:15 in summer time, and the same wall clock an hour later, once the clocks went back.
const firstReading = Temporal.Instant.from("2026-10-25T02:15+02:00");
const secondReading = Temporal.Instant.from("2026-10-25T02:15+01:00");

describe("createInstantRangeFormatter", () => {
    it("writes an ordinary range as the wall clock reads", () => {
        expect(
            timeRange("en-GB").formatRange(
                Temporal.Instant.from("2026-11-21T09:00:00Z"),
                Temporal.Instant.from("2026-11-21T10:30:00Z"),
            ),
        ).toBe("10:00–11:30");
    });

    it("keeps a range across midnight to its times", () => {
        expect(
            timeRange("en-GB").formatRange(
                Temporal.Instant.from("2026-11-21T22:00:00Z"),
                Temporal.Instant.from("2026-11-21T23:00:00Z"),
            ),
        ).toBe("23:00–00:00");
    });

    it("names the zone at both ends across the hour the clocks repeat", () => {
        expect(timeRange("en-GB").formatRange(firstReading, secondReading)).toBe(
            "02:15 CEST\u2009–\u200902:15 CET",
        );
        expect(weekdayRange("en-GB").formatRange(firstReading, secondReading)).toBe(
            "Sun 25 Oct, 02:15 CEST\u2009–\u2009Sun 25 Oct, 02:15 CET",
        );
    });

    // The locale's tighter minute-range pattern would glue its unit to the
    // separator here, giving 分～.
    it("separates the named ends as the locale separates two whole values", () => {
        expect(timeRange("ja-JP").formatRange(firstReading, secondReading)).toBe(
            "2:15 GMT+2～2:15 GMT+1",
        );
    });

    it("shows both days of a range that ends at the same time a day later", () => {
        expect(
            timeRange("en-GB").formatRange(
                Temporal.Instant.from("2026-11-21T09:00:00Z"),
                Temporal.Instant.from("2026-11-22T09:00:00Z"),
            ),
        ).toBe("21/11/2026, 10:00\u2009–\u200922/11/2026, 10:00");
    });

    it("writes a range that starts where it ends as one time", () => {
        const at = Temporal.Instant.from("2026-11-21T09:00:00Z");

        expect(timeRange("en-GB").formatRange(at, at)).toBe("10:00");
    });
});
