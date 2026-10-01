import type { QueryClient } from "@tanstack/react-query";
import type { QueryOptionsFactory } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";

type ScopeIdentifier = {
    id: string;
};

const lacksAny = (identifiers: ScopeIdentifier[], options: ScopeIdentifier[]): boolean =>
    identifiers.some(({ id }) => !options.some((option) => option.id === id));

/**
 * Refetches a session type or track list the question's scope names a row missing from.
 *
 * The edit form drops a scope entry its list lacks, and a save would then change
 * which session types or tracks the question is asked for.
 */
export const ensureScopeOptions = async (
    queryClient: QueryClient,
    qof: QueryOptionsFactory,
    editionId: string,
    customField: Pick<CustomField, "sessionTypes" | "tracks">,
): Promise<void> => {
    const [sessionTypes, tracks] = await Promise.all([
        queryClient.ensureQueryData(qof.sessionType.list(editionId)),
        queryClient.ensureQueryData(qof.track.list(editionId)),
    ]);

    await Promise.all([
        lacksAny(customField.sessionTypes, sessionTypes)
            ? queryClient.fetchQuery({ ...qof.sessionType.list(editionId), staleTime: 0 })
            : undefined,
        lacksAny(customField.tracks, tracks)
            ? queryClient.fetchQuery({ ...qof.track.list(editionId), staleTime: 0 })
            : undefined,
    ]);
};
