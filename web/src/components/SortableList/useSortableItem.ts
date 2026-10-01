import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
    draggable,
    dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
    attachClosestEdge,
    extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { type RefObject, useEffect, useRef, useState } from "react";
import invariant from "tiny-invariant";
import {
    isSortableData,
    type SortableData,
    type SortableListKey,
    type VerticalEdge,
} from "./sortable-data.js";

export type UseSortableItemOptions = {
    listKey: SortableListKey;
    itemId: string;
    index: number;
};

export type SortableItem<TRow extends HTMLElement, THandle extends HTMLElement> = {
    rowRef: RefObject<TRow | null>;
    handleRef: RefObject<THandle | null>;
    dragging: boolean;
    closestEdge: VerticalEdge | null;
};

/**
 * Makes a row draggable by its handle and a drop target for its siblings.
 *
 * Whatever `handleRef` lands on has to be `aria-hidden` with `tabIndex={-1}`.
 * The adapter underneath is pointer-only, so a focusable handle would take a
 * tab stop and then do nothing when pressed, which is worse than being absent
 * from the tab order.
 *
 * Reordering is therefore pointer-only wherever this is used. That is an
 * accepted gap rather than an oversight, so the fix is a control beside the
 * handle that calls the list's reorder directly, the way `ChoiceItemsField`
 * does, and never making the handle itself reachable.
 */
export const useSortableItem = <
    TRow extends HTMLElement = HTMLDivElement,
    THandle extends HTMLElement = HTMLButtonElement,
>({
    listKey,
    itemId,
    index,
}: UseSortableItemOptions): SortableItem<TRow, THandle> => {
    const rowRef = useRef<TRow>(null);
    const handleRef = useRef<THandle>(null);
    const [closestEdge, setClosestEdge] = useState<VerticalEdge | null>(null);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const row = rowRef.current;
        const handle = handleRef.current;
        invariant(row, "useSortableItem needs its rowRef attached");
        invariant(handle, "useSortableItem needs its handleRef attached");

        const data: SortableData & Record<symbol, true> = { [listKey]: true, itemId, index };

        return combine(
            draggable({
                element: handle,
                getInitialData: () => data,
                onGenerateDragPreview: ({ location, nativeSetDragImage }) => {
                    const bounds = row.getBoundingClientRect();
                    nativeSetDragImage?.(
                        row,
                        location.initial.input.clientX - bounds.left,
                        location.initial.input.clientY - bounds.top,
                    );
                },
                onDragStart: () => {
                    setDragging(true);
                },
                onDrop: () => {
                    setDragging(false);
                },
            }),
            dropTargetForElements({
                element: row,
                canDrop: ({ source }) => isSortableData(listKey, source.data),
                getData: ({ input }) =>
                    attachClosestEdge(data, {
                        element: row,
                        input,
                        allowedEdges: ["top", "bottom"],
                    }),
                onDrag: ({ source, self }) => {
                    if (source.element === handle || !isSortableData(listKey, source.data)) {
                        setClosestEdge(null);
                        return;
                    }

                    const edge = extractClosestEdge(self.data);

                    if (edge !== "top" && edge !== "bottom") {
                        setClosestEdge(null);
                        return;
                    }

                    const sourceIndex = source.data.index;
                    const settlesWhereItAlreadyIs =
                        (index === sourceIndex - 1 && edge === "bottom") ||
                        (index === sourceIndex + 1 && edge === "top");

                    setClosestEdge(settlesWhereItAlreadyIs ? null : edge);
                },
                onDragLeave: () => {
                    setClosestEdge(null);
                },
                onDrop: () => {
                    setClosestEdge(null);
                },
            }),
        );
    }, [listKey, itemId, index]);

    return { rowRef, handleRef, dragging, closestEdge };
};
