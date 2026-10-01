import { describe, expect, it } from "vitest";
import { locales } from "#/components/LocaleProvider/locales.ts";

describe("locales", () => {
    it("holds only canonical tags", () => {
        for (const locale of locales) {
            expect(Intl.getCanonicalLocales(locale)[0], `${locale} is not canonical`).toBe(locale);
        }
    });

    it("holds no duplicates", () => {
        expect(new Set(locales).size).toBe(locales.length);
    });

    it("names a region on every entry", () => {
        for (const locale of locales) {
            expect(new Intl.Locale(locale).region, `${locale} has no region`).toBeDefined();
        }
    });

    it("stays sorted so additions land in a predictable place", () => {
        expect([...locales]).toStrictEqual([...locales].sort());
    });

    // Sampled through the formatters the app actually renders with, since a
    // difference the user never sees does not earn an entry its place. Compared
    // only within a language: two languages formatting alike is expected.
    it("holds no regional variant that formats like another of its language", () => {
        const dateTime = Temporal.PlainDateTime.from("2026-01-31T14:05");
        const start = Temporal.PlainDate.from("2027-06-01");
        const end = Temporal.PlainDate.from("2027-06-03");
        const formatted = new Map<string, string[]>();

        for (const locale of locales) {
            const { language } = new Intl.Locale(locale);
            const dateFormatter = new Intl.DateTimeFormat(locale);
            const output = [
                language,
                dateFormatter.format(dateTime),
                dateFormatter.formatRange(start, end),
                dateTime.toLocaleString(locale, { timeStyle: "short" }),
                new Intl.NumberFormat(locale).format(1234567.89),
                // The pickers start their calendar grid on the locale's first
                // day, so two entries can differ nowhere else and still look
                // different every time a date is picked.
                new Intl.Locale(locale).getWeekInfo().firstDay,
            ].join(" ");

            formatted.set(output, [...(formatted.get(output) ?? []), locale]);
        }

        const redundant = [...formatted.values()].filter((group) => group.length > 1);

        expect(redundant, "these entries are indistinguishable to the user").toStrictEqual([]);
    });
});
