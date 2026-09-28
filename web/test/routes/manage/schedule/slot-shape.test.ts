import { describe, expect, it } from "vitest";
import { buildScheduleAxis, type SlotShape } from "#/components/ScheduleGrid/index.js";
import type { Slot } from "#/queries/schedule.js";
import {
    shapedCandidate,
    shapeRefusal,
} from "#/routes/_user/manage/$editionId/schedule/-components/slot-shape.ts";
import { minutesToDuration } from "#/utils/duration.ts";

const berlin = "Europe/Berlin";

// A November edition, so no clock change complicates the arithmetic.
const axis = buildScheduleAxis(
    Temporal.PlainDate.from("2026-11-22"),
    Temporal.PlainDate.from("2026-11-22"),
    berlin,
);

const at = (time: string): Temporal.Instant =>
    Temporal.ZonedDateTime.from(`2026-11-22T${time}[${berlin}]`).toInstant();

type SlotAt = {
    id: string;
    from: string;
    to: string;
    locationId?: string;
    setup?: number;
    teardown?: number;
};

const slotAt = ({ id, from, to, locationId = "room-a", setup = 0, teardown = 0 }: SlotAt): Slot =>
    ({
        id,
        stableId: id,
        startsAt: at(from),
        endsAt: at(to),
        setupTime: minutesToDuration(setup),
        teardownTime: minutesToDuration(teardown),
        session: { id: `session-${id}`, title: id },
        location: { id: locationId },
    }) as Slot;

const shape = (length: number, setup = 0, teardown = 0): SlotShape => ({
    length: minutesToDuration(length),
    setupTime: minutesToDuration(setup),
    teardownTime: minutesToDuration(teardown),
});

const keynote = slotAt({ id: "keynote", from: "10:00", to: "11:00" });

describe("where a reshaped slot would sit", () => {
    it("keeps the start and moves the end", () => {
        expect(shapedCandidate(axis, keynote, shape(90)).span).toEqual({
            from: 10 * 60,
            to: 11 * 60 + 30,
        });
    });

    it("stays in the room it is already in", () => {
        expect(shapedCandidate(axis, keynote, shape(90)).locationId).toEqual("room-a");
    });
});

describe("what refuses a shape", () => {
    it("allows a slot the room it is already holding", () => {
        // Excepted from the rule, or every slot would collide with itself and
        // nothing could ever be saved.
        expect(shapeRefusal(axis, [keynote], keynote, shape(60))).toBeNull();
    });

    it("refuses a length that reaches into the next session", () => {
        const next = slotAt({ id: "panel", from: "11:30", to: "12:30" });
        const refusal = shapeRefusal(axis, [keynote, next], keynote, shape(120));

        expect(refusal?.code).toEqual("already_occupied");
    });

    it("lets the same length through in another room", () => {
        const elsewhere = slotAt({ id: "panel", from: "11:30", to: "12:30", locationId: "room-b" });

        expect(shapeRefusal(axis, [keynote, elsewhere], keynote, shape(120))).toBeNull();
    });

    // The room is held from the setup, so a teardown and a setup that meet in
    // the gap take it twice over even though neither session overlaps.
    it("refuses a margin that reaches into the next session", () => {
        const next = slotAt({ id: "panel", from: "11:30", to: "12:30", setup: 15 });
        const refusal = shapeRefusal(axis, [keynote, next], keynote, shape(60, 0, 30));

        expect(refusal?.code).toEqual("already_occupied");
    });

    it("refuses a length that runs past the edition's last day", () => {
        const refusal = shapeRefusal(axis, [keynote], keynote, shape(20 * 60));

        expect(refusal?.code).toEqual("outside_window");
    });
});
