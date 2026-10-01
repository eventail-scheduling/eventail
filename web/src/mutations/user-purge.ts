import { useOidcFetch } from "@axa-fr/react-oidc";
import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

const deserializePurge = createDeserializer({
    type: "user_purge",
    cardinality: "one",
    attributesSchema: z.object({
        dryRun: z.boolean(),
        displayNames: z.array(z.string()),
        responses: z.int(),
        teamMemberships: z.int(),
        hostedSessions: z.int(),
        teamInvites: z.int(),
        sessionHostInvites: z.int(),
        pendingMails: z.int(),
    }),
});

export type PurgeReport = NonNullable<ReturnType<typeof deserializePurge>["data"]>;

type PurgeValues = {
    emailAddress: string;
    dryRun: boolean;
};

export const usePurgeUserMutation = (): UseMutationResult<PurgeReport, Error, PurgeValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ emailAddress, dryRun }) => {
            const response = await fetch(apiUrl("/user-purges"), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "user_purge",
                        attributes: { emailAddress },
                        meta: { dryRun },
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
            return deserializePurge(await response.json()).data;
        },
        onSuccess: async (_report, { dryRun }) => {
            if (dryRun) {
                return;
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["teams"] }),
                queryClient.invalidateQueries({ queryKey: ["team"] }),
                queryClient.invalidateQueries({ queryKey: ["sessions"] }),
                queryClient.invalidateQueries({ queryKey: ["session"] }),
                queryClient.invalidateQueries({ queryKey: ["hosts"] }),
                queryClient.invalidateQueries({ queryKey: ["host"] }),
                queryClient.invalidateQueries({ queryKey: ["session-host-invites"] }),
                queryClient.invalidateQueries({ queryKey: ["jobs"] }),
                queryClient.invalidateQueries({ queryKey: ["job"] }),
                // Invites to the address go with it.
                queryClient.invalidateQueries({ queryKey: ["team-invite"] }),
                queryClient.invalidateQueries({ queryKey: ["session-host-invite"] }),
            ]);
        },
    });
};
