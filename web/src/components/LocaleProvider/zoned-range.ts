import { useMemo } from "react";
import { timeOptions, useLocale, weekdayDateTimeOptions } from "./LocaleProvider.js";

export type InstantRangeFormatter = {
    formatRange: (startsAt: Temporal.Instant, endsAt: Temporal.Instant) => string;
};

export type ZonedRangeFormatters = {
    timeRangeFormatter: InstantRangeFormatter;
    weekdayDateTimeRangeFormatter: InstantRangeFormatter;
};

/** The wall clock value a formatter's fields read, a time alone or a date with its time. */
type WallReading = (zoned: Temporal.ZonedDateTime) => Temporal.PlainTime | Temporal.PlainDateTime;

const isCollapsed = (parts: Intl.DateTimeRangeFormatPart[]): boolean =>
    !parts.some(({ source }) => source === "endRange");

const joined = (parts: Intl.DateTimeRangeFormatPart[]): string =>
    parts.map(({ value }) => value).join("");

/**
 * Reads the separator the locale puts between two whole date and time values.
 *
 * Two values closer together use a tighter pattern, whose separator can carry a unit: Japanese
 * writes a minute range as 2時15分～2時16分.
 */
const wholeValueSeparator = (locale: string, timeZone: string): string => {
    const formatter = new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone,
    });
    const at = Temporal.Instant.from("2026-01-01T12:00:00Z");
    const parts = formatter.formatRangeToParts(at, at.add({ hours: 24 }));
    const lastOfStart = parts.findLastIndex(({ source }) => source === "startRange");
    const firstOfEnd = parts.findIndex(({ source }) => source === "endRange");

    return joined(parts.slice(lastOfStart + 1, firstOfEnd));
};

/**
 * Writes a range in one zone as its wall clock reads, telling apart ends that would read alike.
 *
 * `formatRange` writes a range whose ends show the same fields as one value. Ends a whole number
 * of days apart then gain their dates. Ends in the hour a zone repeats in autumn gain the zone's
 * name, since `formatRange` never counts the offset among the fields, whatever `timeZoneName`
 * asks for.
 */
export const createInstantRangeFormatter = (
    locale: string,
    options: Intl.DateTimeFormatOptions,
    timeZone: string,
    wallReading: WallReading,
): InstantRangeFormatter => {
    const wall = new Intl.DateTimeFormat(locale, options);
    const zoned = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    const named = new Intl.DateTimeFormat(locale, { ...options, timeZone, timeZoneName: "short" });
    const separator = wholeValueSeparator(locale, timeZone);
    const wallAt = (instant: Temporal.Instant) => wallReading(instant.toZonedDateTimeISO(timeZone));

    return {
        formatRange: (startsAt, endsAt) => {
            const wallParts = wall.formatRangeToParts(wallAt(startsAt), wallAt(endsAt));

            if (!isCollapsed(wallParts) || startsAt.equals(endsAt)) {
                return joined(wallParts);
            }

            const zonedParts = zoned.formatRangeToParts(startsAt, endsAt);

            if (!isCollapsed(zonedParts)) {
                return joined(zonedParts);
            }

            return `${named.format(startsAt)}${separator}${named.format(endsAt)}`;
        },
    };
};

/** Creates range formatters for the locale in effect, writing instants in the given zone. */
export const useZonedRangeFormatters = (timeZone: string): ZonedRangeFormatters => {
    const { resolvedLocale } = useLocale();

    return useMemo(
        () => ({
            timeRangeFormatter: createInstantRangeFormatter(
                resolvedLocale,
                timeOptions,
                timeZone,
                (zoned) => zoned.toPlainTime(),
            ),
            weekdayDateTimeRangeFormatter: createInstantRangeFormatter(
                resolvedLocale,
                weekdayDateTimeOptions,
                timeZone,
                (zoned) => zoned.toPlainDateTime(),
            ),
        }),
        [resolvedLocale, timeZone],
    );
};
