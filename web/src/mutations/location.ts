import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    type OptimisticRollback,
    queuedOptimisticUpdate,
} from "#/mutations/queued-optimistic-update.ts";
import type { Location } from "#/queries/location.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";
import type { AvailabilityInterval } from "#/utils/availability.ts";

type LocationAttributes = {
    name: string;
    externalKey: string | null;
};

type CreateLocationValues = LocationAttributes & {
    editionId: string;
    availabilities: AvailabilityInterval[];
};

type UpdateLocationValues = CreateLocationValues & {
    id: string;
};

type IncludedAvailability = {
    type: "location_availability";
    lid: string;
    attributes: { startsAt: string; endsAt: string };
};

type LocationBody = {
    attributes: LocationAttributes;
    availabilities: readonly AvailabilityInterval[];
    id?: string;
};

const locationBody = ({ attributes, availabilities, id }: LocationBody): string => {
    const included = availabilities.map(
        (interval, index): IncludedAvailability => ({
            type: "location_availability",
            lid: `availability-${index}`,
            attributes: {
                startsAt: interval.startsAt.toString(),
                endsAt: interval.endsAt.toString(),
            },
        }),
    );

    return JSON.stringify({
        data: {
            ...(id === undefined ? {} : { id }),
            type: "location",
            attributes,
            relationships: {
                availabilities: { data: included.map(({ type, lid }) => ({ type, lid })) },
            },
        },
        included,
    });
};

type LocationReference = {
    editionId: string;
    id: string;
};

const useInvalidateLocations = () => {
    const queryClient = useQueryClient();

    return async (editionId: string) => {
        await queryClient.invalidateQueries({ queryKey: ["locations", editionId] });
    };
};

export const useCreateLocationMutation = (): UseMutationResult<
    void,
    Error,
    CreateLocationValues
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateLocations();

    return useMutation({
        mutationFn: async ({ editionId, availabilities, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/locations`), {
                method: "POST",
                body: locationBody({ attributes, availabilities }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useUpdateLocationMutation = (): UseMutationResult<
    void,
    Error,
    UpdateLocationValues
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateLocations();

    return useMutation({
        mutationFn: async ({ editionId, id, availabilities, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/locations/${id}`), {
                method: "PATCH",
                body: locationBody({ attributes, availabilities, id }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useDeleteLocationMutation = (): UseMutationResult<void, Error, LocationReference> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateLocations();

    return useMutation({
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/locations/${id}`), {
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

type ReorderLocationsValues = {
    locationIds: string[];
};

/**
 * Puts the rooms in the order the grid draws its columns in.
 *
 * The whole set goes every time. The API renumbers positions from the array it
 * is given and refuses an order that does not name every location, so a request
 * naming only the rows that moved would be rejected rather than applied to them.
 */
export const useReorderLocationsMutation = (
    editionId: string,
): UseMutationResult<void, Error, ReorderLocationsValues, OptimisticRollback<Location[]>> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateLocations();
    const mutationKey = ["locations", editionId, "reorder"];

    return useMutation({
        mutationKey,
        scope: { id: `locations-${editionId}` },
        ...queuedOptimisticUpdate<void, Location[], ReorderLocationsValues>({
            queryKey: ["locations", editionId],
            mutationKey,
            apply: (previous, { locationIds }) => {
                const byId = new Map(previous.map((location) => [location.id, location]));

                return locationIds
                    .map((locationId) => byId.get(locationId))
                    .filter((location) => location !== undefined);
            },
            invalidate: () => invalidate(editionId),
        }),
        mutationFn: async ({ locationIds }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/relationships/locations`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: locationIds.map((id) => ({ type: "location", id })),
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
    });
};
