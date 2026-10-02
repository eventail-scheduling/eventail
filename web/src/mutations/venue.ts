import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    type OptimisticRollback,
    queuedOptimisticUpdate,
} from "#/mutations/queued-optimistic-update.ts";
import type { Venue } from "#/queries/venue.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type VenueAttributes = {
    name: string;
    address: string | null;
    externalKey: string | null;
};

type CreateVenueValues = VenueAttributes & {
    editionId: string;
};

type UpdateVenueValues = CreateVenueValues & {
    id: string;
};

const venueBody = (attributes: VenueAttributes, id?: string): string =>
    JSON.stringify({
        data: {
            ...(id === undefined ? {} : { id }),
            type: "venue",
            attributes,
        },
    });

type VenueReference = {
    editionId: string;
    id: string;
};

const useInvalidateVenues = () => {
    const queryClient = useQueryClient();

    return async (editionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["venues", editionId] }),
            queryClient.invalidateQueries({ queryKey: ["locations", editionId] }),
        ]);
    };
};

export const useCreateVenueMutation = (): UseMutationResult<void, Error, CreateVenueValues> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateVenues();

    return useMutation({
        mutationFn: async ({ editionId, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/venues`), {
                method: "POST",
                body: venueBody(attributes),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useUpdateVenueMutation = (): UseMutationResult<void, Error, UpdateVenueValues> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateVenues();

    return useMutation({
        mutationFn: async ({ editionId, id, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/venues/${id}`), {
                method: "PATCH",
                body: venueBody(attributes, id),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useDeleteVenueMutation = (): UseMutationResult<void, Error, VenueReference> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateVenues();

    return useMutation({
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/venues/${id}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

type ReorderVenuesValues = {
    venueIds: string[];
};

/**
 * Sends the whole set every time.
 *
 * The API renumbers positions from the array it is given and refuses an order
 * that does not name every venue, so a request naming only the rows that moved
 * would be rejected rather than applied to them.
 */
export const useReorderVenuesMutation = (
    editionId: string,
): UseMutationResult<void, Error, ReorderVenuesValues, OptimisticRollback<Venue[]>> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateVenues();
    const mutationKey = ["venues", editionId, "reorder"];

    return useMutation({
        mutationKey,
        scope: { id: `venues-${editionId}` },
        ...queuedOptimisticUpdate<void, Venue[], ReorderVenuesValues>({
            queryKey: ["venues", editionId],
            mutationKey,
            apply: (previous, { venueIds }) => {
                const byId = new Map(previous.map((venue) => [venue.id, venue]));

                return venueIds
                    .map((venueId) => byId.get(venueId))
                    .filter((venue) => venue !== undefined);
            },
            invalidate: () => invalidate(editionId),
        }),
        mutationFn: async ({ venueIds }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/relationships/venues`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: venueIds.map((id) => ({ type: "venue", id })),
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
    });
};
