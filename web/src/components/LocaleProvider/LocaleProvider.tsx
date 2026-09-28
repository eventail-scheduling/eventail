import { TemporalRootProvider } from "mui-temporal-pickers";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { Locale } from "./locales.js";
import { canonicalizeStoredLocale, readSystemLocale, resolveLocale } from "./resolve.js";

export type LocaleContext = {
    preferredLocale: Locale | null;
    resolvedLocale: string;
    changeLocale: (locale: Locale | null) => void;
    dateFormatter: Intl.DateTimeFormat;
    timeFormatter: Intl.DateTimeFormat;
    weekdayDateTimeFormatter: Intl.DateTimeFormat;
    monthDayFormatter: Intl.DateTimeFormat;
    mediumDateFormatter: Intl.DateTimeFormat;
    mediumDateTimeFormatter: Intl.DateTimeFormat;
    longDateTimeFormatter: Intl.DateTimeFormat;
    mediumDateTimeSecondsFormatter: Intl.DateTimeFormat;
};

export const timeOptions: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export const weekdayDateTimeOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
};

const localeContext = createContext<LocaleContext | null>(null);

const LOCAL_STORAGE_KEY = "preferredLocale";

const readPreferredLocale = (): Locale | null =>
    canonicalizeStoredLocale(window.localStorage.getItem(LOCAL_STORAGE_KEY));

type LocaleProviderProps = {
    children: ReactNode;
};

export const LocaleProvider = ({ children }: LocaleProviderProps): ReactNode => {
    const [preferredLocale, setPreferredLocale] = useState<Locale | null>(readPreferredLocale);

    const changeLocale = useCallback((locale: Locale | null) => {
        setPreferredLocale(locale);

        if (locale === null) {
            window.localStorage.removeItem(LOCAL_STORAGE_KEY);
            return;
        }

        window.localStorage.setItem(LOCAL_STORAGE_KEY, locale);
    }, []);

    const value = useMemo((): LocaleContext => {
        const resolvedLocale = resolveLocale(preferredLocale, readSystemLocale());

        return {
            preferredLocale,
            resolvedLocale,
            changeLocale,
            dateFormatter: new Intl.DateTimeFormat(resolvedLocale),
            timeFormatter: new Intl.DateTimeFormat(resolvedLocale, timeOptions),
            weekdayDateTimeFormatter: new Intl.DateTimeFormat(
                resolvedLocale,
                weekdayDateTimeOptions,
            ),
            monthDayFormatter: new Intl.DateTimeFormat(resolvedLocale, {
                month: "short",
                day: "numeric",
            }),
            mediumDateFormatter: new Intl.DateTimeFormat(resolvedLocale, { dateStyle: "medium" }),
            mediumDateTimeFormatter: new Intl.DateTimeFormat(resolvedLocale, {
                dateStyle: "medium",
                timeStyle: "short",
            }),
            longDateTimeFormatter: new Intl.DateTimeFormat(resolvedLocale, {
                dateStyle: "long",
                timeStyle: "short",
            }),
            mediumDateTimeSecondsFormatter: new Intl.DateTimeFormat(resolvedLocale, {
                dateStyle: "medium",
                timeStyle: "medium",
            }),
        };
    }, [preferredLocale, changeLocale]);

    return (
        <localeContext.Provider value={value}>
            <TemporalRootProvider locale={value.resolvedLocale}>{children}</TemporalRootProvider>
        </localeContext.Provider>
    );
};

export const useLocale = (): LocaleContext => {
    const context = useContext(localeContext);

    if (!context) {
        throw new Error("context used outside LocaleProvider");
    }

    return context;
};
