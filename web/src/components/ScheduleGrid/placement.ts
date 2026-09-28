import type { Slot } from "#/queries/schedule.js";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import { axisMinutes, instantAtMinutes, minutesAt, type ScheduleAxis } from "./geometry.js";

/** What a drag resolves to: minutes on the axis, a slot's body without its margins. */
export type MinuteSpan = {
    from: number;
    to: number;
};

/** How long the room is held either side of the body, in minutes. */
export type Shoulders = {
    setup: number;
    teardown: number;
};

export type Candidate = {
    locationId: string;
    span: MinuteSpan;
    shoulders: Shoulders;
};

/**
 * The steps a gesture can be asked to land on, coarsest first.
 *
 * The same four pretalx offers. Finer than five is expressible, since a slot has
 * no minimum length and no whole minute rule, but not aimable: a minute is half
 * a pixel in an ungrown hour, so it would be free placement wearing the name of
 * a step.
 */
export const minuteSteps = [60, 30, 15, 5] as const;

export type MinuteStep = (typeof minuteSteps)[number];

/**
 * What a gesture lands on for anyone who has not chosen one.
 *
 * The quarter hours a program is written on, and the finest step the grid can
 * draw at an ungrown hour: below it a drag snaps to a lattice nothing shows.
 */
export const defaultMinuteStep: MinuteStep = 15;

export const isMinuteStep = (value: number): value is MinuteStep =>
    minuteSteps.some((step) => step === value);

export const snapToStep = (minutes: number, step: MinuteStep): number =>
    Math.round(minutes / step) * step;

export const slotShoulders = (slot: Slot): Shoulders => ({
    setup: slot.setupTime.total("minutes"),
    teardown: slot.teardownTime.total("minutes"),
});

export const slotSpan = (axis: ScheduleAxis, slot: Slot): MinuteSpan => ({
    from: minutesAt(axis, slot.startsAt),
    to: minutesAt(axis, slot.endsAt),
});

/** Widens a body to the stretch the room is held for, which `already_occupied` reserves. */
export const occupiedRange = (span: MinuteSpan, shoulders: Shoulders): MinuteSpan => ({
    from: span.from - shoulders.setup,
    to: span.to + shoulders.teardown,
});

export const slotOccupies = (axis: ScheduleAxis, slot: Slot): MinuteSpan =>
    occupiedRange(slotSpan(axis, slot), slotShoulders(slot));

export const overlaps = (left: MinuteSpan, right: MinuteSpan): boolean =>
    left.from < right.to && left.to > right.from;

/** Bounds the minutes a body may stand between, once its margins have their room. */
const spanBounds = (axis: ScheduleAxis, shoulders: Shoulders): MinuteSpan => ({
    from: shoulders.setup,
    to: axisMinutes(axis) - shoulders.teardown,
});

/**
 * Slides a span until the room it holds sits inside the edition's days.
 *
 * Length is kept, because a gesture that drags a talk past midnight is asking
 * to move it rather than to shorten it. A span too long for the edition to hold
 * comes back against the first day and is refused on its other end.
 */
export const clampSpan = (
    axis: ScheduleAxis,
    span: MinuteSpan,
    shoulders: Shoulders,
    step: MinuteStep,
): MinuteSpan => {
    const length = span.to - span.from;
    const bounds = spanBounds(axis, shoulders);
    const clamped = Math.max(Math.min(span.from, bounds.to - length), bounds.from);

    // Rounded back down to the step so a drop clamped against the end still
    // lands on a line the grid draws, except where that line would push its
    // setup off the start of the grid; there the clamp's value stands.
    const onStep = Math.floor(clamped / step) * step;
    const from = onStep >= bounds.from ? onStep : clamped;

    return { from, to: from + length };
};

export type Refusal = {
    code: "outside_window" | "already_occupied" | "too_short";
    detail: string;
};

type RefusalInput = {
    axis: ScheduleAxis;
    candidate: Candidate;
    slots: readonly Slot[];
    /** The slot a move is holding, which cannot be in its own way. */
    exceptSlotId?: string;
};

/**
 * Says why the API would refuse this placement, or null where it would take it.
 *
 * The same two rules `createSlot` applies, so a drag can say no before it
 * writes. The API stays the authority: it holds the schedule lock, and this
 * copy is reading a draft that another organizer may have moved on from.
 */
export const refusePlacement = ({
    axis,
    candidate,
    slots,
    exceptSlotId,
}: RefusalInput): Refusal | null => {
    const occupied = occupiedRange(candidate.span, candidate.shoulders);
    const total = axisMinutes(axis);

    if (occupied.from < 0 || occupied.to > total) {
        return {
            code: "outside_window",
            detail:
                candidate.span.from >= 0 && candidate.span.to <= total
                    ? "Setup and teardown reach outside the edition's days."
                    : "This reaches outside the edition's days.",
        };
    }

    const blocker = slots.find(
        (slot) =>
            slot.id !== exceptSlotId &&
            slot.location.id === candidate.locationId &&
            overlaps(occupied, occupiedRange(slotSpan(axis, slot), slotShoulders(slot))),
    );

    if (!blocker) {
        return null;
    }

    return {
        code: "already_occupied",
        detail: overlaps(candidate.span, slotSpan(axis, blocker))
            ? `Overlaps ${blocker.session.title} in this room.`
            : `Too close to ${blocker.session.title}: the setup and teardown overlap.`,
    };
};

export type CandidateTiming = {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant;
    setupTime: Temporal.Duration;
    teardownTime: Temporal.Duration;
};

export const candidateTiming = (axis: ScheduleAxis, candidate: Candidate): CandidateTiming => ({
    startsAt: instantAtMinutes(axis, candidate.span.from),
    endsAt: instantAtMinutes(axis, candidate.span.to),
    setupTime: Temporal.Duration.from({ minutes: candidate.shoulders.setup }),
    teardownTime: Temporal.Duration.from({ minutes: candidate.shoulders.teardown }),
});

/**
 * Lists the stretches of the grid an availability leaves out, merged and in order.
 *
 * Nothing at all for an empty list, which is how the API and the availability
 * editor both read "usable at any time". Intervals may reach outside the
 * edition, and are clamped rather than dropped so a window half inside it still
 * opens the half that counts.
 */
export const closedRanges = (
    axis: ScheduleAxis,
    intervals: readonly AvailabilityInterval[],
): MinuteSpan[] => {
    if (intervals.length === 0) {
        return [];
    }

    const total = axisMinutes(axis);
    const open = intervals
        .map((interval) => ({
            from: Math.max(minutesAt(axis, interval.startsAt), 0),
            to: Math.min(minutesAt(axis, interval.endsAt), total),
        }))
        .filter((span) => span.to > span.from)
        .sort((left, right) => left.from - right.from);

    const closed: MinuteSpan[] = [];
    let edge = 0;

    for (const span of open) {
        if (span.from > edge) {
            closed.push({ from: edge, to: span.from });
        }

        edge = Math.max(edge, span.to);
    }

    if (edge < total) {
        closed.push({ from: edge, to: total });
    }

    return closed;
};
