import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollWindowForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { announce } from "@atlaskit/pragmatic-drag-and-drop-live-region";
import { useEffect, useRef } from "react";
import { isSortableData, type SortableListKey } from "./sortable-data.js";

export type UseSortableListOptions<TItem> = {
    listKey: SortableListKey;
    items: TItem[];
    getItemId: (item: TItem) => string;
    onReorder: (from: number, to: number) => void;
    describeItem: (index: number) => string;
};

export const useSortableList = <TItem>({
    listKey,
    items,
    getItemId,
    onReorder,
    describeItem,
}: UseSortableListOptions<TItem>): void => {
    const callbacks = useRef({ getItemId, onReorder, describeItem });
    callbacks.current = { getItemId, onReorder, describeItem };

    useEffect(
        () =>
            monitorForElements({
                canMonitor: ({ source }) => isSortableData(listKey, source.data),
                onDrop: ({ location, source }) => {
                    const target = location.current.dropTargets[0];

                    if (
                        !(
                            target &&
                            isSortableData(listKey, source.data) &&
                            isSortableData(listKey, target.data)
                        )
                    ) {
                        return;
                    }

                    const startIndex = source.data.index;
                    const targetItemId = target.data.itemId;
                    const indexOfTarget = items.findIndex(
                        (item) => callbacks.current.getItemId(item) === targetItemId,
                    );

                    if (indexOfTarget < 0) {
                        return;
                    }

                    const finishIndex = getReorderDestinationIndex({
                        startIndex,
                        indexOfTarget,
                        closestEdgeOfTarget: extractClosestEdge(target.data),
                        axis: "vertical",
                    });

                    if (finishIndex === startIndex) {
                        return;
                    }

                    callbacks.current.onReorder(startIndex, finishIndex);
                    announce(
                        `${callbacks.current.describeItem(startIndex)} moved to position ${finishIndex + 1} of ${items.length}.`,
                    );
                },
            }),
        [listKey, items],
    );

    useEffect(() => autoScrollWindowForElements(), []);
};
