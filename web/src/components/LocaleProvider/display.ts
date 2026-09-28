// Naming the whole tag gives linguistic names like "Swiss German", which read
// oddly in a list of regional formats. Composing the parts gives the
// "German (Switzerland)" form every operating system uses.
export const localeDisplayName = (locale: string, displayLocale: string): string => {
    const { language, region } = new Intl.Locale(locale);
    const languageName =
        new Intl.DisplayNames([displayLocale], { type: "language" }).of(language) ?? language;

    if (region === undefined) {
        return languageName;
    }

    const regionName = new Intl.DisplayNames([displayLocale], { type: "region" }).of(region);

    return regionName === undefined ? languageName : `${languageName} (${regionName})`;
};
