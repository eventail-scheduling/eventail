import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type SessionRef = {
    editionId: string;
    sessionId: string;
};

const invalidateSession = async (
    queryClient: ReturnType<typeof useQueryClient>,
    { editionId, sessionId }: SessionRef,
): Promise<void> => {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: ["session-host-invites", editionId, sessionId],
        }),
        queryClient.invalidateQueries({ queryKey: ["session", editionId, sessionId] }),
    ]);
};

type CreateInviteValues = SessionRef & {
    emailAddress: string;
};

/**
 * Invites someone to host the session, by mail.
 *
 * An address whose earlier invite has expired is invited again and the old one
 * replaced; one still pending is refused with `invite_exists`, so re-sending a
 * lost mail means revoking that invite first.
 */
export const useCreateSessionHostInviteMutation = (): UseMutationResult<
    void,
    Error,
    CreateInviteValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, sessionId, emailAddress }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/sessions/${sessionId}/host-invites`),
                {
                    method: "POST",
                    body: JSON.stringify({
                        data: {
                            type: "session_host_invite",
                            attributes: { emailAddress },
                        },
                    }),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
        onSuccess: async (_, values) => {
            await invalidateSession(queryClient, values);
        },
    });
};

type DeleteInviteValues = SessionRef & {
    inviteId: string;
};

export const useDeleteSessionHostInviteMutation = (): UseMutationResult<
    void,
    Error,
    DeleteInviteValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, sessionId, inviteId }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/sessions/${sessionId}/host-invites/${inviteId}`),
                { method: "DELETE", headers: jsonApiAcceptHeaders },
            );
            await handleJsonApiError(response);
        },
        onSuccess: async (_, values) => {
            await invalidateSession(queryClient, values);
        },
    });
};

type RemoveHostValues = SessionRef & {
    hostId: string;
};

/**
 * Detaches one host from the session.
 *
 * The removal travels as a document on a DELETE to the relationship URL
 * (JSON:API 1.1, "Updating To-Many Relationships").
 */
export const useRemoveSessionHostMutation = (): UseMutationResult<
    void,
    Error,
    RemoveHostValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, sessionId, hostId }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/sessions/${sessionId}/relationships/hosts`),
                {
                    method: "DELETE",
                    body: JSON.stringify({ data: [{ type: "host", id: hostId }] }),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
        onSuccess: async (_, values) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["session", values.editionId, values.sessionId],
                }),
                // The host rows count the sessions each hosts, the slottable
                // list embeds each session's hosts, and the host removed may be
                // the caller, whose own list and hosting flag then change.
                queryClient.invalidateQueries({ queryKey: ["hosts", values.editionId] }),
                queryClient.invalidateQueries({ queryKey: ["sessions", values.editionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "sessions", values.editionId] }),
            ]);
        },
    });
};
