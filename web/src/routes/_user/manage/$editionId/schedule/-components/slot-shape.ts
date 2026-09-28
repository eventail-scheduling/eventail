import {
    type Candidate,
    type Refusal,
    refusePlacement,
    type ScheduleAxis,
    type SlotShape,
    slotSpan,
} from "#/components/ScheduleGrid/index.js";
import type { Slot } from "#/queries/schedule.js";
import { minutesToDuration } from "#/utils/duration.ts";

/**
 * The same three while any of them is still being typed.
 *
 * The field hands back null the moment its text is empty, which is a state a
 * reader passes through on the way to every new number.
 */
export type ShapeValues = {
    length: Temporal.Duration | null;
    setupTime: Temporal.Duration | null;
    teardownTime: Temporal.Duration | null;
};

export const completeShape = (values: ShapeValues): SlotShape | null =>
    values.length === null || values.setupTime === null || values.teardownTime === null
        ? null
        : {
              length: values.length,
              setupTime: values.setupTime,
              teardownTime: values.teardownTime,
          };

export const slotShape = (slot: Slot): SlotShape => ({
    length: minutesToDuration(slot.startsAt.until(slot.endsAt).total("minutes")),
    setupTime: slot.setupTime,
    teardownTime: slot.teardownTime,
});

export const sameShape = (left: SlotShape, right: SlotShape): boolean =>
    Temporal.Duration.compare(left.length, right.length) === 0 &&
    Temporal.Duration.compare(left.setupTime, right.setupTime) === 0 &&
    Temporal.Duration.compare(left.teardownTime, right.teardownTime) === 0;

/**
 * Places the slot with this shape as a candidate, for the rule a drag is judged by.
 *
 * The start stays where it is: this changes how long a slot runs, not when it
 * begins, which is the grid's business and not a number anyone types.
 */
export const shapedCandidate = (axis: ScheduleAxis, slot: Slot, shape: SlotShape): Candidate => {
    const { from } = slotSpan(axis, slot);

    return {
        locationId: slot.location.id,
        span: { from, to: from + shape.length.total("minutes") },
        shoulders: {
            setup: shape.setupTime.total("minutes"),
            teardown: shape.teardownTime.total("minutes"),
        },
    };
};

/**
 * Says why this shape cannot be saved, or nothing where it can.
 *
 * The same rule a drag is refused by, so the two surfaces cannot disagree about
 * what fits.
 */
export const shapeRefusal = (
    axis: ScheduleAxis,
    slots: readonly Slot[],
    slot: Slot,
    shape: SlotShape,
): Refusal | null => {
    // Nothing in a placement rule refuses this: an empty stretch overlaps
    // nothing and reaches outside nothing.
    if (shape.length.total("minutes") <= 0) {
        return { code: "too_short", detail: "A session needs a length." };
    }

    return refusePlacement({
        axis,
        candidate: shapedCandidate(axis, slot, shape),
        slots,
        exceptSlotId: slot.id,
    });
};
