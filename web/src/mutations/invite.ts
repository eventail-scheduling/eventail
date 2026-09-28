import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError, JsonApiError } from "@jsonapi-serde/client";
import {
    type QueryClient,
    type QueryKey,
    type UseMutationResult,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import { roleSensitiveKeys } from "#/mutations/team.ts";
import { apiUrl, hasErrorCode, jsonApiAcceptHeaders } from "#/utils/api.ts";

type AcceptInviteValues = {
    code: string;
};

type AcceptSessionHostInviteValues = AcceptInviteValues & {
    editionId: string;
    sessionId: string;
};

/**
 * Reads the invite again after the API refused its acceptance.
 *
 * A refusal may end the offer: the invite expired or was revoked under the page, names another
 * address, or its session stopped taking hosts. It may also leave the offer standing, as an
 * incomplete host profile does. Only the preview read again tells which, so every refusal rereads.
 * A failure with no answer from the API leaves the offer standing to try again.
 */
const refreshRefusedInvite = async (
    queryClient: QueryClient,
    error: Error,
    queryKey: QueryKey,
): Promise<void> => {
    if (error instanceof JsonApiError) {
        await queryClient.invalidateQueries({ queryKey });
    }
};

export const useAcceptTeamInviteMutation = (): UseMutationResult<
    void,
    Error,
    AcceptInviteValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ code }) => {
            const response = await fetch(apiUrl(`/team-invites/${code}/acceptance`), {
                method: "POST",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onError: async (error, { code }) => {
            await refreshRefusedInvite(queryClient, error, ["team-invite", code]);
        },
        onSuccess: async (_result, { code }) => {
            await Promise.all([
                // Acceptance can raise this caller's own highest role, which
                // is what every role gate and role-sensitive read goes by.
                ...roleSensitiveKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
                queryClient.invalidateQueries({ queryKey: ["teams"] }),
                // Spent now; read again, it answers a refusal the page would
                // show on its way out.
                queryClient.invalidateQueries({
                    queryKey: ["team-invite", code],
                    refetchType: "none",
                }),
            ]);
        },
    });
};

export const useAcceptSessionHostInviteMutation = (): UseMutationResult<
    void,
    Error,
    AcceptSessionHostInviteValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ code }) => {
            const response = await fetch(apiUrl(`/session-host-invites/${code}/acceptance`), {
                method: "POST",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onError: async (error, { code, editionId }) => {
            await refreshRefusedInvite(queryClient, error, ["session-host-invite", code]);

            if (hasErrorCode(error, "incomplete_profile")) {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["edition", editionId] }),
                    queryClient.invalidateQueries({ queryKey: ["customFields", editionId] }),
                    queryClient.invalidateQueries({ queryKey: ["me", "host", editionId] }),
                ]);
            }
        },
        onSuccess: async (_result, { code, editionId, sessionId }) => {
            await Promise.all([
                // The page this navigates to reads exactly this document, and
                // does not have it mounted yet, so it has to be refetched
                // rather than flagged: an invalidation reaches active queries
                // alone. Awaited, so the navigate finds the caller hosting it.
                queryClient.refetchQueries({ queryKey: ["session", editionId, sessionId] }),
                // The list rows carry meta.hosting, and the slottable query
                // under the same prefix embeds hosts.
                queryClient.invalidateQueries({ queryKey: ["me", "sessions", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["sessions", editionId] }),
                // The host rows count the sessions each hosts.
                queryClient.invalidateQueries({ queryKey: ["hosts", editionId] }),
                queryClient.invalidateQueries({
                    queryKey: ["session-host-invites", editionId, sessionId],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["session-host-invite", code],
                    refetchType: "none",
                }),
            ]);
        },
    });
};
