import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";

export type SortableListKey = symbol;

export type VerticalEdge = Extract<Edge, "top" | "bottom">;

export type SortableData = {
    itemId: string;
    index: number;
};

export const createSortableListKey = (name: string): SortableListKey => Symbol(name);

export const isSortableData = (
    listKey: SortableListKey,
    data: Record<string | symbol, unknown>,
): data is SortableData & Record<string | symbol, unknown> => data[listKey] === true;
