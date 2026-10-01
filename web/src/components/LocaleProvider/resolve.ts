import { type Locale, locales } from "./locales.js";

// Stored values predate canonical tags and survive browser updates that
// deprecate a subtag, so a stored "en-gb" or "iw-IL" still has to land on the
// entry it names today.
export const canonicalizeStoredLocale = (stored: string | null): Locale | null => {
    if (stored === null) {
        return null;
    }

    let canonical: string;

    try {
        [canonical] = Intl.getCanonicalLocales(stored);
    } catch {
        return null;
    }

    return locales.find((locale) => locale === canonical) ?? null;
};

export const readSystemLocale = (): string => new Intl.DateTimeFormat().resolvedOptions().locale;

// Deadlines are Gregorian, and a Persian or Buddhist calendar would render one
// as 1404 or 2569 beside a Gregorian year elsewhere in the app.
export const resolveLocale = (preferred: Locale | null, system: string): string =>
    new Intl.Locale(preferred ?? system, { calendar: "gregory" }).toString();
