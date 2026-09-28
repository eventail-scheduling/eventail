import { JsonApiError } from "@jsonapi-serde/server/common";
import { isAfter, isAfterOrEqual, isBefore, isBeforeOrEqual } from "temporal-extra";
import { match } from "ts-pattern";
import type { EditionWindow } from "./edition-window.js";

export type AvailabilityInterval = {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant;
};

export type IntervalProblem =
    | { type: "sub_minute"; index: number }
    | { type: "reversed"; index: number }
    | { type: "outside_window"; index: number };

const NANOSECONDS_PER_MINUTE = 60_000_000_000n;

/**
 * Flags an instant off the minute, which availability refuses.
 *
 * Nothing reads availability finer than that, and an editor rewrites what it
 * cannot show.
 */
const carriesSubMinute = (instant: Temporal.Instant): boolean =>
    instant.epochNanoseconds % NANOSECONDS_PER_MINUTE !== 0n;

/**
 * Refuses only what merging cannot fix.
 *
 * Overlapping and touching go unmentioned on purpose: mergeIntervals joins
 * those rather than anything having to refuse them.
 */
export const findIntervalProblem = (
    intervals: readonly AvailabilityInterval[],
    window: EditionWindow,
): IntervalProblem | null => {
    for (const [index, { startsAt, endsAt }] of intervals.entries()) {
        if (carriesSubMinute(startsAt) || carriesSubMinute(endsAt)) {
            return { type: "sub_minute", index };
        }

        if (isBeforeOrEqual(endsAt, startsAt)) {
            return { type: "reversed", index };
        }

        if (isBefore(startsAt, window.startsAt) || isAfter(endsAt, window.endsAt)) {
            return { type: "outside_window", index };
        }
    }

    return null;
};

/** Builds the 422 for the interval {@link findIntervalProblem} flagged, naming it by its lid. */
export const intervalProblemError = (problem: IntervalProblem, lid: string): JsonApiError =>
    new JsonApiError({
        status: "422",
        ...match(problem.type)
            .with("sub_minute", () => ({
                code: "sub_minute_interval",
                title: "Sub-minute interval",
                detail: "An availability has to start and end on a whole minute",
            }))
            .with("reversed", () => ({
                code: "reversed_interval",
                title: "Reversed interval",
                detail: "An availability has to end after it starts",
            }))
            .with("outside_window", () => ({
                code: "outside_edition",
                title: "Outside the edition",
                detail: "An availability has to lie within the days of the edition",
            }))
            .exhaustive(),
        meta: { lid },
    });

/**
 * The most intervals one owner may send in a write.
 *
 * The editor snaps to half an hour, so a day holds at most 24 that do not
 * touch, and the bound refuses nothing the grid can draw for an edition of up
 * to 20 days. It is there to keep a hand-written request from writing tens of
 * thousands of rows.
 */
export const maxAvailabilities = 500;

export type MergeOutcome<T> = {
    kept: T[];
    absorbed: T[];
};

/**
 * Merges to one answer per stretch of time.
 *
 * Intervals arrive here already belonging together, one owner at a time: the
 * caller groups them, and everything in one call is merged against everything
 * else in it.
 *
 * Touching intervals merge along with overlapping ones, so nothing downstream
 * has to tell a speaker's two adjacent answers from the one they add up to.
 */
export const mergeIntervals = <T extends AvailabilityInterval>(
    intervals: readonly T[],
): MergeOutcome<T> => {
    const kept: T[] = [];
    const absorbed: T[] = [];

    const ordered = [...intervals].sort((left, right) =>
        Temporal.Instant.compare(left.startsAt, right.startsAt),
    );

    for (const interval of ordered) {
        const into = kept.at(-1);

        if (!into || isAfter(interval.startsAt, into.endsAt)) {
            kept.push(interval);
            continue;
        }

        if (isAfter(interval.endsAt, into.endsAt)) {
            into.endsAt = interval.endsAt;
        }

        absorbed.push(interval);
    }

    return { kept, absorbed };
};

/**
 * Trims an answer to the new window, or judges it kept or dropped.
 *
 * What a speaker said about a day that no longer exists is dropped rather than
 * refused, since a preference cannot be allowed to stop an organizer shortening
 * their own event.
 */
export const clampToWindow = (
    interval: AvailabilityInterval,
    window: EditionWindow,
): "kept" | "clamped" | "dropped" => {
    if (isBeforeOrEqual(interval.endsAt, window.startsAt)) {
        return "dropped";
    }

    if (isAfterOrEqual(interval.startsAt, window.endsAt)) {
        return "dropped";
    }

    const startsAt = isBefore(interval.startsAt, window.startsAt)
        ? window.startsAt
        : interval.startsAt;
    const endsAt = isAfter(interval.endsAt, window.endsAt) ? window.endsAt : interval.endsAt;

    if (startsAt.equals(interval.startsAt) && endsAt.equals(interval.endsAt)) {
        return "kept";
    }

    interval.startsAt = startsAt;
    interval.endsAt = endsAt;

    return "clamped";
};
