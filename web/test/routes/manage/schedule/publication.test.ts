import { describe, expect, it } from "vitest";
import type { Schedule, Slot } from "#/queries/schedule.js";
import { hasUnpublishedChanges } from "#/routes/_user/manage/$editionId/schedule/-utils/publication.ts";

type SlotShape = {
    id?: string;
    stableId?: string;
    from?: string;
    to?: string;
    setup?: number;
    teardown?: number;
    locationId?: string;
    sessionId?: string;
};

const slot = (shape: SlotShape = {}): Slot =>
    ({
        id: shape.id ?? "slot-1",
        stableId: shape.stableId ?? "stable-1",
        startsAt: Temporal.Instant.from(shape.from ?? "2027-06-01T09:00:00Z"),
        endsAt: Temporal.Instant.from(shape.to ?? "2027-06-01T10:00:00Z"),
        setupTime: Temporal.Duration.from({ minutes: shape.setup ?? 0 }),
        teardownTime: Temporal.Duration.from({ minutes: shape.teardown ?? 0 }),
        session: { id: shape.sessionId ?? "session-1", title: "A talk" },
        location: { id: shape.locationId ?? "hall" },
    }) as Slot;

const edition = {
    startDate: Temporal.PlainDate.from("2027-06-01"),
    endDate: Temporal.PlainDate.from("2027-06-02"),
    timeZone: "Europe/Berlin",
};

type ScheduleShape = {
    preliminary?: boolean;
    startDate?: string;
    endDate?: string;
    timeZone?: string;
};

/**
 * Stamps `edition`'s window unless a test passes other dates or a zone.
 */
const schedule = (slots: Slot[], shape: ScheduleShape = {}): Schedule =>
    ({
        id: "schedule",
        slots,
        preliminary: shape.preliminary ?? false,
        startDate: Temporal.PlainDate.from(shape.startDate ?? "2027-06-01"),
        endDate: Temporal.PlainDate.from(shape.endDate ?? "2027-06-02"),
        timeZone: shape.timeZone ?? "Europe/Berlin",
    }) as unknown as Schedule;

describe("hasUnpublishedChanges", () => {
    it("is true when nothing has been published", () => {
        expect(hasUnpublishedChanges(schedule([slot()]), null, edition)).toBe(true);
        expect(hasUnpublishedChanges(schedule([]), null, edition)).toBe(true);
    });

    it("ignores the slot id, which publishing always changes", () => {
        expect(
            hasUnpublishedChanges(
                schedule([slot({ id: "draft-copy" })]),
                schedule([slot({ id: "published-original" })]),
                edition,
            ),
        ).toBe(false);
    });

    it("is false for a draft that matches the publication", () => {
        const both = () => [
            slot({ stableId: "a" }),
            slot({ stableId: "b", from: "2027-06-01T11:00:00Z" }),
        ];

        expect(hasUnpublishedChanges(schedule(both()), schedule(both()), edition)).toBe(false);
    });

    it("is true when a slot was added or taken away", () => {
        expect(
            hasUnpublishedChanges(
                schedule([slot(), slot({ stableId: "b" })]),
                schedule([slot()]),
                edition,
            ),
        ).toBe(true);
        expect(hasUnpublishedChanges(schedule([]), schedule([slot()]), edition)).toBe(true);
    });

    it("is true when a slot moved in time", () => {
        expect(
            hasUnpublishedChanges(
                schedule([slot({ from: "2027-06-01T09:30:00Z" })]),
                schedule([slot()]),
                edition,
            ),
        ).toBe(true);
    });

    it("is true when a slot changed room", () => {
        expect(
            hasUnpublishedChanges(
                schedule([slot({ locationId: "annex" })]),
                schedule([slot()]),
                edition,
            ),
        ).toBe(true);
    });

    // The margins are part of what a room is held for, and the API serves them,
    // so a change to one is a change a consumer would see.
    it("is true when only a margin changed", () => {
        expect(
            hasUnpublishedChanges(schedule([slot({ setup: 15 })]), schedule([slot()]), edition),
        ).toBe(true);
        expect(
            hasUnpublishedChanges(schedule([slot({ teardown: 5 })]), schedule([slot()]), edition),
        ).toBe(true);
    });

    it("is true when the slot holds a different session", () => {
        expect(
            hasUnpublishedChanges(
                schedule([slot({ sessionId: "other" })]),
                schedule([slot()]),
                edition,
            ),
        ).toBe(true);
    });

    // Two slots trading places leaves both sets equal by time alone, so the
    // stableId is what tells them apart.
    it("is true when two slots swapped their stable identities", () => {
        const draft = schedule([
            slot({ stableId: "a", from: "2027-06-01T09:00:00Z" }),
            slot({ stableId: "b", from: "2027-06-01T11:00:00Z" }),
        ]);
        const published = schedule([
            slot({ stableId: "b", from: "2027-06-01T09:00:00Z" }),
            slot({ stableId: "a", from: "2027-06-01T11:00:00Z" }),
        ]);

        expect(hasUnpublishedChanges(draft, published, edition)).toBe(true);
    });
});

describe("promoting a preliminary publication", () => {
    it("is something to announce even when nothing else changed", () => {
        const slots = [slot()];

        expect(
            hasUnpublishedChanges(schedule(slots), schedule(slots, { preliminary: true }), edition),
        ).toBe(true);
    });

    it("is not still pending once a final publication carries the same slots", () => {
        const slots = [slot()];

        expect(hasUnpublishedChanges(schedule(slots), schedule(slots), edition)).toBe(false);
    });
});

describe("a window the publication no longer describes", () => {
    it("is something to announce when the edition grew a day", () => {
        const slots = [slot()];

        expect(
            hasUnpublishedChanges(schedule(slots), schedule(slots, { endDate: "2027-06-03" }), {
                ...edition,
                endDate: Temporal.PlainDate.from("2027-06-03"),
            }),
        ).toBe(false);

        expect(
            hasUnpublishedChanges(schedule(slots), schedule(slots), {
                ...edition,
                endDate: Temporal.PlainDate.from("2027-06-03"),
            }),
        ).toBe(true);
    });

    it("is something to announce when only the zone was renamed", () => {
        const slots = [slot()];

        expect(
            hasUnpublishedChanges(schedule(slots), schedule(slots), {
                ...edition,
                timeZone: "Europe/Paris",
            }),
        ).toBe(true);
    });
});
