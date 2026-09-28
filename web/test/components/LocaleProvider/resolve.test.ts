import { describe, expect, it } from "vitest";
import { canonicalizeStoredLocale, resolveLocale } from "#/components/LocaleProvider/resolve.ts";

describe("canonicalizeStoredLocale", () => {
    it("takes a tag that is already canonical", () => {
        expect(canonicalizeStoredLocale("de-CH")).toBe("de-CH");
    });

    it("canonicalizes the casing the old list stored", () => {
        expect(canonicalizeStoredLocale("en-gb")).toBe("en-GB");
        expect(canonicalizeStoredLocale("zh-cn")).toBe("zh-CN");
    });

    it("falls back to the system default for a tag outside the list", () => {
        expect(canonicalizeStoredLocale("de")).toBeNull();
        expect(canonicalizeStoredLocale("sw-KE")).toBeNull();
    });

    it("falls back to the system default rather than throwing on a malformed tag", () => {
        for (const stored of ["EN_US", "", "not a tag", "!!"]) {
            expect(canonicalizeStoredLocale(stored), `expected ${stored} to fall back`).toBeNull();
        }
    });

    it("treats an absent preference as the system default", () => {
        expect(canonicalizeStoredLocale(null)).toBeNull();
    });
});

describe("resolveLocale", () => {
    it("prefers an explicit choice over the system locale", () => {
        expect(resolveLocale("de-CH", "en-US")).toBe("de-CH-u-ca-gregory");
    });

    it("falls back to the system locale when nothing is stored", () => {
        expect(resolveLocale(null, "en-US")).toBe("en-US-u-ca-gregory");
    });

    it("resolves the system locale on every call rather than snapshotting it", () => {
        expect(resolveLocale(null, "de-DE")).toBe("de-DE-u-ca-gregory");
        expect(resolveLocale(null, "ja-JP")).toBe("ja-JP-u-ca-gregory");
    });

    it("pins the calendar so a deadline never renders in another era", () => {
        for (const system of ["fa-IR", "th-TH", "en-US"]) {
            const resolved = resolveLocale(null, system);

            expect(
                new Intl.DateTimeFormat(resolved).resolvedOptions().calendar,
                `expected ${system} to resolve to the Gregorian calendar`,
            ).toBe("gregory");
        }
    });

    it("overrides a calendar the incoming tag asked for", () => {
        expect(
            new Intl.DateTimeFormat(resolveLocale(null, "th-TH-u-ca-buddhist")).resolvedOptions()
                .calendar,
        ).toBe("gregory");
    });
});
