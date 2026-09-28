import { createDeserializer, handleJsonApiError, type Relationships } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const locationAttributesSchema = z.object({
    name: z.string(),
    externalKey: z.nullable(z.string()),
});

export const locationAvailabilityAttributesSchema = z.object({
    startsAt: zt.instant(),
    endsAt: zt.instant(),
});

/**
 * Absent below manager, where the API drops the include rather than refusing.
 *
 * Nothing shown to such a caller reads it: the published view strips
 * availability from every room before drawing, and the form that edits it sits
 * behind the manager gate. So there is no reading to get wrong, unlike a host's
 * availability, which the grid would take for "free throughout".
 */
const locationRelationships = {
    availabilities: {
        type: "location_availability",
        cardinality: "many",
        optional: true,
        included: {
            attributesSchema: locationAvailabilityAttributesSchema,
        },
    },
} satisfies Relationships;

const deserializeLocations = createDeserializer({
    type: "location",
    cardinality: "many",
    attributesSchema: locationAttributesSchema,
    relationships: locationRelationships,
});
export type Location = ReturnType<typeof deserializeLocations>["data"][number];

const deserializeLocation = createDeserializer({
    type: "location",
    cardinality: "one",
    attributesSchema: locationAttributesSchema,
    relationships: locationRelationships,
});
export type LocationDetail = ReturnType<typeof deserializeLocation>["data"];

export const createLocationQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["locations", editionId],
            queryFn: async ({ signal }) => {
                const url = apiUrl(`/editions/${editionId}/locations`);
                url.searchParams.set("include", "availabilities");

                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeLocations(await response.json()).data;
            },
        }),
    detail: (editionId: string, locationId: string) =>
        queryOptions({
            queryKey: ["locations", editionId, locationId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/locations/${locationId}?include=availabilities`),
                    {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    },
                );
                await handleJsonApiError(response);
                return deserializeLocation(await response.json()).data;
            },
        }),
});
