import { useEffect, useEffectEvent, useRef, useState } from "react";
import invariant from "tiny-invariant";

type ListedRow = {
    id: string;
};

/**
 * Holds the row a page edits as it was at mount, and calls `onRemoved` once the list drops it.
 *
 * Throws if `rows` lacks `id` at mount, so the route's loader must have
 * answered for it. Reading the row live would throw the first time the list
 * refetched without it, which is any focus after somebody else deleted it.
 * `onRemoved` runs once, however often the caller renders a fresh one.
 */
export const useRowWhileListed = <TRow extends ListedRow>(
    rows: readonly TRow[],
    id: string,
    onRemoved: () => void,
): TRow => {
    const [row] = useState(() => rows.find((candidate) => candidate.id === id));
    invariant(row);

    const stillListed = rows.some((candidate) => candidate.id === id);
    const handleRemoved = useEffectEvent(onRemoved);
    const left = useRef(false);

    useEffect(() => {
        if (stillListed || left.current) {
            return;
        }

        left.current = true;
        handleRemoved();
    }, [stillListed]);

    return row;
};
