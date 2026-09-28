import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

const deserializeSessionHostInvites = createDeserializer({
    type: "session_host_invite",
    cardinality: "many",
    attributesSchema: z.object({
        createdAt: zt.instant(),
        emailAddress: z.string(),
    }),
});

export type SessionHostInvite = ReturnType<typeof deserializeSessionHostInvites>["data"][number];

export const createSessionHostInviteQueryOptionsFactory = (authFetch: typeof fetch) => ({
    /**
     * The invites still waiting on a reply, oldest first.
     *
     * The API refuses these with 403 unless the caller `isInvolvedWith` the
     * session, so ask only when that holds.
     */
    list: (editionId: string, sessionId: string) =>
        queryOptions({
            queryKey: ["session-host-invites", editionId, sessionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/sessions/${sessionId}/host-invites`),
                    { signal, headers: jsonApiAcceptHeaders },
                );
                await handleJsonApiError(response);

                return deserializeSessionHostInvites(await response.json()).data;
            },
        }),
});
