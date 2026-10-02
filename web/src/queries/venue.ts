import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const venueAttributesSchema = z.object({
    name: z.string(),
    address: z.nullable(z.string()),
    externalKey: z.nullable(z.string()),
});

const deserializeVenues = createDeserializer({
    type: "venue",
    cardinality: "many",
    attributesSchema: venueAttributesSchema,
});
export type Venue = ReturnType<typeof deserializeVenues>["data"][number];

const deserializeVenue = createDeserializer({
    type: "venue",
    cardinality: "one",
    attributesSchema: venueAttributesSchema,
});
export type VenueDetail = ReturnType<typeof deserializeVenue>["data"];

export const createVenueQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["venues", editionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/editions/${editionId}/venues`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeVenues(await response.json()).data;
            },
        }),
    detail: (editionId: string, venueId: string) =>
        queryOptions({
            queryKey: ["venues", editionId, venueId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/venues/${venueId}`),
                    {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    },
                );
                await handleJsonApiError(response);
                return deserializeVenue(await response.json()).data;
            },
        }),
});
