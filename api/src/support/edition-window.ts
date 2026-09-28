import { isAfter, isBefore } from "temporal-extra";
import type { Edition } from "../entity/Edition.js";
import type { Slot } from "../entity/Slot.js";

export type EditionWindow = {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant;
};

export type EditionDates = Pick<Edition, "startDate" | "endDate" | "timeZone">;

export const editionWindow = (edition: EditionDates): EditionWindow => ({
    startsAt: edition.startDate
        .toZonedDateTime({ timeZone: edition.timeZone, plainTime: new Temporal.PlainTime() })
        .toInstant(),
    endsAt: edition.endDate
        .add({ days: 1 })
        .toZonedDateTime({ timeZone: edition.timeZone, plainTime: new Temporal.PlainTime() })
        .toInstant(),
});

export type StartDateRange = {
    earliest: Temporal.PlainDate;
    latest: Temporal.PlainDate;
};

/**
 * Covers every answer that leaves the old window overlapping the new one.
 *
 * It reaches before the new first day on purpose: dropping a setup day means the
 * old first day stays where it is, which is the whole point of asking.
 */
export const startDateRange = (previous: EditionDates, next: EditionDates): StartDateRange => ({
    earliest: next.startDate.subtract({
        days: previous.startDate.until(previous.endDate).days,
    }),
    latest: next.endDate,
});

export type WindowChange = {
    previous: EditionDates;
    next: EditionDates;
    days: number;
};

/**
 * Anchors the count on the day the edition used to begin.
 *
 * The count then exists whether or not anything is scheduled, and slots and
 * availability travel together.
 */
export const changeDays = (previous: EditionDates, startsOn: Temporal.PlainDate): number =>
    previous.startDate.until(startsOn).days;

/**
 * Moves the local time an instant was entered at by the change in days.
 *
 * Availability answers are read on the wall clock and slots on their length,
 * which is why the same interval settles differently as each. A speaker free
 * from one to four is still free from one to four on a day that gained an
 * hour; a talk booked for three is not a talk booked for four.
 *
 * Every stored instant keeps the local time it was entered at, which one
 * duration added to all of them cannot promise: a window containing a daylight
 * saving change has two offsets, and a single delta holds only the one it was
 * measured at.
 */
const localAfter = (instant: Temporal.Instant, change: WindowChange): Temporal.PlainDateTime =>
    instant
        .toZonedDateTimeISO(change.previous.timeZone)
        .toPlainDateTime()
        .add({ days: change.days });

const readsLater = (instant: Temporal.Instant, timeZone: string): boolean =>
    instant.epochNanoseconds !==
    instant
        .toZonedDateTimeISO(timeZone)
        .toPlainDateTime()
        .toZonedDateTime(timeZone, { disambiguation: "earlier" }).epochNanoseconds;

/**
 * Reads the moved local time back in the new zone, or null where it does not exist there.
 *
 * That is usually the hour a spring forward skips, but half an hour in some
 * zones and a whole day where one has crossed the date line. Reading it back is
 * what tells any of those apart from the hour an autumn repeats, where both
 * readings are real and the instant keeps the one it had: a time in the second
 * pass of a repeated hour stays in the second pass where the new day repeats it
 * too, so an edition that does not move leaves every instant exactly where it
 * was.
 */
export const reanchor = (
    instant: Temporal.Instant,
    change: WindowChange,
): Temporal.Instant | null => {
    const local = localAfter(instant, change);
    const zoned = local.toZonedDateTime(change.next.timeZone, {
        disambiguation: readsLater(instant, change.previous.timeZone) ? "later" : "earlier",
    });

    return zoned.toPlainDateTime().equals(local) ? zoned.toInstant() : null;
};

export type ClampedAnchor = {
    instant: Temporal.Instant;
    /** Whether the edge had to give ground, which shortens what it belongs to. */
    clamped: boolean;
};

/**
 * Moves an edge as {@link reanchor} does, for something trimmed rather than dropped.
 *
 * An edge with nowhere to stand goes to the instant the clock jumps at, which
 * both sides of the gap read onto, so the interval loses only the time that was
 * never there. Asking for either wall reading would overshoot: disambiguation
 * moves a missing time by the whole width of the gap rather than to its edge.
 */
export const reanchorClamped = (instant: Temporal.Instant, change: WindowChange): ClampedAnchor => {
    const exact = reanchor(instant, change);

    if (exact) {
        return { instant: exact, clamped: false };
    }

    const before = localAfter(instant, change).toZonedDateTime(change.next.timeZone, {
        disambiguation: "earlier",
    });

    return {
        instant: (before.getTimeZoneTransition("next") ?? before).toInstant(),
        clamped: true,
    };
};

type Span = Pick<Slot, "startsAt" | "endsAt">;

/**
 * Judges a slot on its length, which is what the booking was for.
 *
 * A length it no longer has is not it, and the wall clock alone cannot say so:
 * an hour a spring forward skips shortens a talk, an hour an autumn repeats
 * stretches it, and one straddling a fall back comes out reversed, all while
 * both ends read exactly as entered.
 */
export const keepsItsLength = (before: Span, after: Span): boolean =>
    Temporal.Duration.compare(
        before.startsAt.until(before.endsAt),
        after.startsAt.until(after.endsAt),
    ) === 0;

type SlotTiming = Pick<Slot, "startsAt" | "endsAt" | "setupTime" | "teardownTime">;

/**
 * Counts a slot's margins as occupied time.
 *
 * A room is occupied while it is being built and struck as much as while it is
 * in use.
 */
export const slotsOverlap = (left: SlotTiming, right: SlotTiming): boolean =>
    isBefore(left.startsAt.subtract(left.setupTime), right.endsAt.add(right.teardownTime)) &&
    isAfter(left.endsAt.add(left.teardownTime), right.startsAt.subtract(right.setupTime));

export const slotFitsWindow = (slot: SlotTiming, window: EditionWindow): boolean => {
    const setupStartsAt = slot.startsAt.subtract(slot.setupTime);
    const teardownEndsAt = slot.endsAt.add(slot.teardownTime);

    return !(isBefore(setupStartsAt, window.startsAt) || isAfter(teardownEndsAt, window.endsAt));
};
