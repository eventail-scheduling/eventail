import { isAfter } from "temporal-extra";

export type AvailabilityInterval = {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant;
};

/**
 * Mirrors what the API does on write.
 *
 * The editor then shows the set that will be stored rather than the one that
 * was drawn. Touching intervals join along with overlapping ones.
 */
export const mergeIntervals = (
    intervals: readonly AvailabilityInterval[],
): AvailabilityInterval[] => {
    const ordered = [...intervals].sort((left, right) =>
        Temporal.Instant.compare(left.startsAt, right.startsAt),
    );
    const merged: AvailabilityInterval[] = [];

    for (const interval of ordered) {
        const last = merged.at(-1);

        if (!last || isAfter(interval.startsAt, last.endsAt)) {
            merged.push({ ...interval });
            continue;
        }

        if (isAfter(interval.endsAt, last.endsAt)) {
            last.endsAt = interval.endsAt;
        }
    }

    return merged;
};
