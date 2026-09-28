import { isTemporal, isTemporalEqual } from "#/utils/api.ts";

/** Marks each changed key with true, or with the changed keys inside it. */
export type ChangedFields = {
    [key: string]: true | ChangedFields;
};

export type Changes = true | ChangedFields | undefined;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype;

const isSameValue = (seeded: unknown, current: unknown): boolean => {
    if (Object.is(seeded, current)) {
        return true;
    }

    if (isTemporal(seeded) || isTemporal(current)) {
        return isTemporal(seeded) && isTemporal(current) && isTemporalEqual(seeded, current);
    }

    if (Array.isArray(seeded) && Array.isArray(current)) {
        return (
            seeded.length === current.length &&
            seeded.every((item, index) => isSameValue(item, current[index]))
        );
    }

    if (isPlainObject(seeded) && isPlainObject(current)) {
        const keys = new Set([...Object.keys(seeded), ...Object.keys(current)]);

        return [...keys].every((key) => isSameValue(seeded[key], current[key]));
    }

    return false;
};

/**
 * Says what a form changed since it was seeded, marking an array as a whole.
 *
 * Measured against the seed rather than read from RHF, whose dirtyFields is
 * empty in a handler of a form that subscribed to neither isDirty nor
 * dirtyFields while rendering, and drops the mark of a changed Temporal value
 * whenever it recomputes the map.
 */
export const changedFields = (
    seeded: Record<string, unknown>,
    current: Record<string, unknown>,
): ChangedFields => {
    const changes: ChangedFields = {};
    const keys = new Set([...Object.keys(seeded), ...Object.keys(current)]);

    for (const key of keys) {
        const seededValue = seeded[key];
        const currentValue = current[key];

        if (isPlainObject(seededValue) && isPlainObject(currentValue)) {
            const nested = changedFields(seededValue, currentValue);

            if (Object.keys(nested).length > 0) {
                changes[key] = nested;
            }

            continue;
        }

        if (!isSameValue(seededValue, currentValue)) {
            changes[key] = true;
        }
    }

    return changes;
};

/**
 * Copies a form's values deeply enough that later edits cannot reach the copy.
 *
 * RHF's getValues copies only the top level and writes a nested field into the
 * object it already holds. Plain objects and arrays are copied; anything else
 * is shared, which holds for the Temporal values a form carries because they
 * never change in place.
 */
export const snapshotValues = <TValues>(values: TValues): TValues => {
    if (Array.isArray(values)) {
        return values.map((item: unknown) => snapshotValues(item)) as TValues;
    }

    if (isPlainObject(values)) {
        return Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, snapshotValues(value)]),
        ) as TValues;
    }

    return values;
};

/** Narrows to the changes under one key, where true means everything under it. */
export const changesWithin = (changes: Changes, key: string): Changes =>
    changes === true ? true : changes?.[key];

/**
 * Takes a fresher seed and puts back every value the user changed since the old one.
 *
 * A changed value is taken whole, so a relationship or a file the user and
 * someone else both changed comes out exactly as the user left it. Only the
 * maps named in `mergedWithin`, such as the answers keyed by question, are
 * merged entry by entry, and an entry the fresh map no longer has, such as an
 * answer to a deleted question, is dropped rather than kept out of sight.
 */
export const rebaseChanges = <TValues extends Record<string, unknown>>(
    seeded: TValues,
    fresh: TValues,
    current: TValues,
    mergedWithin: readonly (keyof TValues & string)[] = [],
): TValues => {
    const result: Record<string, unknown> = { ...fresh };

    for (const [key, change] of Object.entries(changedFields(seeded, current))) {
        const freshMap = fresh[key];
        const currentMap = current[key];

        if (
            change !== true &&
            mergedWithin.includes(key) &&
            isPlainObject(freshMap) &&
            isPlainObject(currentMap)
        ) {
            const merged: Record<string, unknown> = { ...freshMap };

            for (const entry of Object.keys(change)) {
                if (Object.hasOwn(freshMap, entry)) {
                    merged[entry] = currentMap[entry];
                }
            }

            result[key] = merged;
            continue;
        }

        result[key] = currentMap;
    }

    return result as TValues;
};
