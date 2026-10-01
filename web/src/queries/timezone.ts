import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

const deserializeTimezones = createDeserializer({
    type: "timezone",
    cardinality: "many",
});
export type Timezone = ReturnType<typeof deserializeTimezones>["data"][number];

export const createTimezoneQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: () =>
        queryOptions({
            queryKey: ["timezones"],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl("/timezones"), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeTimezones(await response.json()).data;
            },
        }),
});
