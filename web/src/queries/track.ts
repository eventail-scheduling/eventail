import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const trackAttributesSchema = z.object({
    name: z.string(),
    externalKey: z.nullable(z.string()),
    description: z.string(),
    color: z.string(),
    internal: z.boolean(),
});

const deserializeTracks = createDeserializer({
    type: "track",
    cardinality: "many",
    attributesSchema: trackAttributesSchema,
});
export type Track = ReturnType<typeof deserializeTracks>["data"][number];

export const createTrackQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["tracks", editionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/editions/${editionId}/tracks`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeTracks(await response.json()).data;
            },
        }),
});
