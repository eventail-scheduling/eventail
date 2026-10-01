import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";
import { syncServerClock } from "#/utils/server-clock.ts";

const deserializeClock = createDeserializer({
    type: "clock",
    cardinality: "one",
    attributesSchema: z.object({
        time: zt.instant(),
    }),
});

export type Clock = ReturnType<typeof deserializeClock>["data"];

export const createClockQueryOptionsFactory = (authFetch: typeof fetch) => ({
    /**
     * Reads the server's clock and syncs `serverNow` to it.
     *
     * Synced from here rather than from the cached data, so the reading is
     * anchored when it arrives and not when something renders it later.
     */
    get: () =>
        queryOptions({
            queryKey: ["clock"],
            queryFn: async ({ signal }): Promise<Clock> => {
                const sentAt = performance.now();
                const response = await authFetch(apiUrl("/clock/now"), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                const receivedAt = performance.now();
                await handleJsonApiError(response);
                const clock = deserializeClock(await response.json()).data;
                syncServerClock(clock.time, sentAt, receivedAt);

                return clock;
            },
            refetchInterval: 15 * 60 * 1000,
        }),
});
