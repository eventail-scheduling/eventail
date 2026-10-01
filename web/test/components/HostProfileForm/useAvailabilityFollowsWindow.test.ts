import { describe, expect, it } from "vitest";
import { liesOutside } from "#/components/HostProfileForm/useAvailabilityFollowsWindow.ts";
import type { Edition } from "#/queries/edition.ts";

const edition = {
    startDate: Temporal.PlainDate.from("2026-11-21"),
    endDate: Temporal.PlainDate.from("2026-11-22"),
    timeZone: "Europe/Berlin",
} as Edition;

const interval = (startsAt: string, endsAt: string) => ({
    startsAt: Temporal.Instant.from(startsAt),
    endsAt: Temporal.Instant.from(endsAt),
});

describe("liesOutside", () => {
    it("takes a block filling the first to the last day, midnight to midnight", () => {
        expect(
            liesOutside(edition, [interval("2026-11-20T23:00:00Z", "2026-11-22T23:00:00Z")]),
        ).toBe(false);
    });

    it("finds a block on a day the edition no longer has", () => {
        expect(
            liesOutside(edition, [
                interval("2026-11-21T08:00:00Z", "2026-11-21T16:00:00Z"),
                interval("2026-11-23T08:00:00Z", "2026-11-23T16:00:00Z"),
            ]),
        ).toBe(true);
    });

    it("finds a block starting before the first day", () => {
        expect(
            liesOutside(edition, [interval("2026-11-20T22:30:00Z", "2026-11-21T08:00:00Z")]),
        ).toBe(true);
    });
});
