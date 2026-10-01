import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const sessionTypeAttributesSchema = z.object({
    name: z.string(),
    externalKey: z.nullable(z.string()),
    defaultDuration: zt.duration(),
    internal: z.boolean(),
    selectionDefault: z.boolean(),
});

const deserializeSessionTypes = createDeserializer({
    type: "session_type",
    cardinality: "many",
    attributesSchema: sessionTypeAttributesSchema,
});
export type SessionType = ReturnType<typeof deserializeSessionTypes>["data"][number];

export const createSessionTypeQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["session-types", editionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/editions/${editionId}/session-types`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeSessionTypes(await response.json()).data;
            },
        }),
});
