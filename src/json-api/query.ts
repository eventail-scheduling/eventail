import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import { match } from "ts-pattern";

export type RelationQuery = {
    include?: readonly string[];
    fields?: Partial<SparseFieldSets>;
};

export const isIncluded = (query: RelationQuery, path: string): boolean =>
    (query.include ?? []).some((field) => field === path || field.startsWith(`${path}.`));

type RelationLoadMode = "skip" | "linkage" | "full";

export const relationLoadMode = (
    query: RelationQuery,
    resourceType: string,
    fieldName: string,
    includePath: string,
): RelationLoadMode => {
    const requested = query.fields?.[resourceType];

    if (requested && !requested.includes(fieldName)) {
        return "skip";
    }

    return isIncluded(query, includePath) ? "full" : "linkage";
};

type RelationLoaders = Record<Exclude<RelationLoadMode, "skip">, () => Promise<unknown>>;

export const loadRelation = async (
    load: RelationLoadMode,
    loaders: RelationLoaders,
): Promise<void> => {
    await match(load)
        .with("full", () => loaders.full())
        .with("linkage", () => loaders.linkage())
        .with("skip", () => Promise.resolve())
        .exhaustive();
};
