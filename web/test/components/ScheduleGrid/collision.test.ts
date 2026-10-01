import { describe, expect, it } from "vitest";
import {
    collidingHostNames,
    collisionCount,
    findCollisions,
} from "#/components/ScheduleGrid/collision.js";
import {
    buildScheduleAxis,
    instantAtMinutes,
    type ScheduleAxis,
} from "#/components/ScheduleGrid/geometry.js";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";

const berlin = "Europe/Berlin";

// Clear of any clock change, so a minute on the axis is a minute of the day.
const twoDays = (): ScheduleAxis =>
    buildScheduleAxis(
        Temporal.PlainDate.from("2027-06-01"),
        Temporal.PlainDate.from("2027-06-02"),
        berlin,
    );

type SlotAt = {
    id: string;
    sessionId: string;
    from: number;
    to: number;
    setup?: number;
    teardown?: number;
};

const slotAt = (axis: ScheduleAxis, { id, sessionId, from, to, ...margins }: SlotAt): Slot => ({
    id,
    stableId: id,
    startsAt: instantAtMinutes(axis, from),
    endsAt: instantAtMinutes(axis, to),
    setupTime: Temporal.Duration.from({ minutes: margins.setup ?? 0 }),
    teardownTime: Temporal.Duration.from({ minutes: margins.teardown ?? 0 }),
    session: { id: sessionId, title: `Session ${sessionId}`, state: "confirmed" as const },
    location: { id: "hall" },
});

const sessionWith = (id: string, hostIds: string[]): SlottableSession =>
    ({
        id,
        title: `Session ${id}`,
        hosts: hostIds.map((hostId) => ({ id: hostId, displayName: hostId.toUpperCase() })),
    }) as SlottableSession;

describe("findCollisions", () => {
    it("marks both ends of a clash", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 690 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
        ]);

        expect(collisions.get("first")?.[0].slot.id).toBe("second");
        expect(collisions.get("second")?.[0].slot.id).toBe("first");
        expect(collisions.get("first")?.[0].hostNames).toEqual(["ADA"]);
    });

    it("leaves overlapping sessions alone when they share nobody", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 690 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["grace"]),
        ]);

        expect(collisions.size).toBe(0);
    });

    it("names only the hosts the two sessions have in common", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 690 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada", "grace"]),
            sessionWith("b", ["grace", "alan"]),
        ]);

        expect(collisions.get("first")?.[0].hostNames).toEqual(["GRACE"]);
    });

    it("clashes a session placed twice against itself", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "a", from: 630, to: 690 }),
        ];

        const collisions = findCollisions(axis, slots, [sessionWith("a", ["ada"])]);

        expect(collisions.size).toBe(2);
    });

    it("counts a clash the margins make and the bodies do not", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660, teardown: 15 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 670, to: 700, setup: 15 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
        ]);

        expect(collisions.size).toBe(2);
        expect(collisions.get("first")?.[0].marginOnly).toBe(true);
    });

    it("calls a clash the bodies make more than a margin", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660, teardown: 15 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 700 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
        ]);

        expect(collisions.get("first")?.[0].marginOnly).toBe(false);
    });

    it("leaves a back to back pair alone", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 660, to: 720 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
        ]);

        expect(collisions.size).toBe(0);
    });

    it("says nothing about a session with no hosts", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 690 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", []),
            sessionWith("b", []),
        ]);

        expect(collisions.size).toBe(0);
    });
});

describe("collidingHostNames", () => {
    it("names a host once however many clashes they are in", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 720 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 610, to: 640 }),
            slotAt(axis, { id: "third", sessionId: "c", from: 650, to: 680 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
            sessionWith("c", ["ada"]),
        ]);

        expect(collisions.get("first")).toHaveLength(2);
        expect(collidingHostNames(collisions.get("first") ?? [])).toEqual(["ADA"]);
    });
});

describe("collisionCount", () => {
    it("counts a clash once rather than once per block", () => {
        const axis = twoDays();
        const slots = [
            slotAt(axis, { id: "first", sessionId: "a", from: 600, to: 660 }),
            slotAt(axis, { id: "second", sessionId: "b", from: 630, to: 690 }),
            slotAt(axis, { id: "third", sessionId: "c", from: 900, to: 960 }),
            slotAt(axis, { id: "fourth", sessionId: "d", from: 930, to: 990 }),
        ];

        const collisions = findCollisions(axis, slots, [
            sessionWith("a", ["ada"]),
            sessionWith("b", ["ada"]),
            sessionWith("c", ["grace"]),
            sessionWith("d", ["grace"]),
        ]);

        expect(collisionCount(collisions)).toBe(2);
    });
});
