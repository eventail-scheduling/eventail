import { describe, expect, it } from "vitest";
import {
    cornerAction,
    type DragSubject,
    newSlotFor,
    type SlotDrag,
} from "#/components/ScheduleGrid/useSlotDrag.ts";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";

type SessionShape = {
    duration: number | null;
    defaultDuration: number;
    setup?: number;
    teardown?: number;
};

const minutes = (value: number | null) =>
    value === null ? null : Temporal.Duration.from({ minutes: value });

const session = ({ duration, defaultDuration, ...margins }: SessionShape): SlottableSession =>
    ({
        id: "session-1",
        title: "A talk",
        duration: minutes(duration),
        setupTime: minutes(margins.setup ?? null),
        teardownTime: minutes(margins.teardown ?? null),
        sessionType: { id: "type-1", defaultDuration: minutes(defaultDuration) },
    }) as SlottableSession;

describe("how long a session arrives on the grid", () => {
    it("takes the length the session asked for", () => {
        expect(newSlotFor(session({ duration: 45, defaultDuration: 30 })).length).toEqual(45);
    });

    it("falls back to the length its type gives", () => {
        // The submission form offers the type's default and lets a speaker
        // leave it, so a session with no length of its own is ordinary.
        expect(newSlotFor(session({ duration: null, defaultDuration: 30 })).length).toEqual(30);
    });

    it("carries the margins the session named", () => {
        expect(
            newSlotFor(session({ duration: 60, defaultDuration: 30, setup: 15, teardown: 10 }))
                .shoulders,
        ).toEqual({ setup: 15, teardown: 10 });
    });

    it("holds the room for no longer than the session where none are named", () => {
        expect(newSlotFor(session({ duration: 60, defaultDuration: 30 })).shoulders).toEqual({
            setup: 0,
            teardown: 0,
        });
    });
});

describe("what the corner target offers", () => {
    const dragOf = (subject: DragSubject, moved: boolean): SlotDrag => ({
        subject,
        at: { clientX: 0, clientY: 0 },
        overCorner: false,
        candidate: null,
        refusal: null,
        moved,
    });

    const slot = { id: "slot-1" } as Slot;

    const creating = (moved: boolean): SlotDrag =>
        dragOf(
            {
                kind: "create",
                session: { id: "s", title: "A talk" } as SlottableSession,
                length: 60,
                shoulders: { setup: 0, teardown: 0 },
            },
            moved,
        );

    it("removes a placed session on the move", () => {
        expect(cornerAction(dragOf({ kind: "move", slot, grabMinutes: 0 }, true))).toBe("remove");
    });

    it("offers nothing until the gesture has left the press that started it", () => {
        expect(cornerAction(dragOf({ kind: "move", slot, grabMinutes: 0 }, false))).toBeNull();
    });

    it("cancels a session that is not on the schedule yet", () => {
        expect(cornerAction(creating(true))).toBe("cancel");
    });

    it("offers to cancel from the moment a new session is picked up", () => {
        expect(cornerAction(creating(false))).toBe("cancel");
    });

    it("offers nothing when nothing is held at all", () => {
        expect(cornerAction(null)).toBeNull();
    });
});
