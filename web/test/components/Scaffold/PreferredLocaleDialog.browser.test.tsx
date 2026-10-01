import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
    LocaleProvider,
    localeDisplayName,
    locales,
    readSystemLocale,
    resolveLocale,
} from "#/components/LocaleProvider";
import { PreferredLocaleDialog } from "#/components/Scaffold/PreferredLocaleDialog.tsx";

afterEach(() => {
    window.localStorage.removeItem("preferredLocale");
});

describe("the regional format dialog", () => {
    // With a format chosen, "system default" still has to name what choosing
    // it would switch to, which is the browser's and not the chosen one.
    it("names the system's format in the default option", async () => {
        const systemLocale = resolveLocale(null, readSystemLocale());
        const chosen = locales.find((locale) => locale !== systemLocale) ?? "de-DE";
        window.localStorage.setItem("preferredLocale", chosen);
        const system = localeDisplayName(systemLocale, chosen);
        const screen = await render(
            <LocaleProvider>
                <PreferredLocaleDialog
                    dialogProps={{
                        open: true,
                        onClose: () => undefined,
                        onTransitionExited: () => undefined,
                    }}
                />
            </LocaleProvider>,
        );

        await screen.getByRole("combobox").click();

        await expect
            .element(screen.getByRole("option", { name: `System default (${system})` }))
            .toBeVisible();
    });
});
