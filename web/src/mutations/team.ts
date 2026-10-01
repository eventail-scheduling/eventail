import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import {
    type QueryKey,
    type UseMutationResult,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";
import type { TeamRole } from "#/queries/team.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type CreateTeamValues = {
    name: string;
    role: TeamRole;
};

export const roleSensitiveKeys: QueryKey[] = [
    ["current-user"],
    ["session"],
    ["sessions"],
    ["hosts"],
    ["host"],
    ["session-types"],
    ["tracks"],
];

export const useCreateTeamMutation = (): UseMutationResult<void, Error, CreateTeamValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(apiUrl("/teams"), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "team",
                        attributes: values,
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ["teams"],
            });
        },
    });
};

type UpdateTeamValues = CreateTeamValues & {
    id: string;
};

export const useUpdateTeamMutation = (): UseMutationResult<void, Error, UpdateTeamValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id, ...values }) => {
            const response = await fetch(apiUrl(`/teams/${id}`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: {
                        id,
                        type: "team",
                        attributes: values,
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_, { id }) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["teams"],
                }),
                // The caller may belong to this team, so their highest role can
                // change, and with it what every role-sensitive read returns.
                ...roleSensitiveKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
                // An invite's preview names the team.
                queryClient.invalidateQueries({ queryKey: ["team-invite"] }),
                queryClient.invalidateQueries({
                    queryKey: ["team", id],
                }),
            ]);
        },
    });
};

type DeleteTeamValues = {
    id: string;
};

export const useDeleteTeamMutation = (): UseMutationResult<void, Error, DeleteTeamValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ id }) => {
            const response = await fetch(apiUrl(`/teams/${id}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_, { id }) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["teams"],
                }),
                // The caller may belong to this team, so their highest role can
                // change, and with it what every role-sensitive read returns.
                ...roleSensitiveKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
                // An invite's preview names the team.
                queryClient.invalidateQueries({ queryKey: ["team-invite"] }),
                queryClient.invalidateQueries({
                    queryKey: ["team", id],
                }),
            ]);
        },
    });
};

type RemoveUserValues = {
    teamId: string;
    userId: string;
};

export const useRemoveUserMutation = (): UseMutationResult<void, Error, RemoveUserValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ teamId, userId }) => {
            const response = await fetch(apiUrl(`/teams/${teamId}/relationships/users`), {
                method: "DELETE",
                body: JSON.stringify({
                    data: [
                        {
                            type: "user",
                            id: userId,
                        },
                    ],
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_, { teamId }) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["teams"],
                }),
                // The caller may belong to this team, so their highest role can
                // change, and with it what every role-sensitive read returns.
                ...roleSensitiveKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
                queryClient.invalidateQueries({
                    queryKey: ["team", teamId],
                }),
            ]);
        },
    });
};

type CreateInviteValues = {
    teamId: string;
    emailAddress: string;
};

export const useCreateInviteMutation = (): UseMutationResult<void, Error, CreateInviteValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ teamId, ...values }) => {
            const response = await fetch(apiUrl(`/teams/${teamId}/invites`), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "team_invite",
                        attributes: values,
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_, { teamId }) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["teams"],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["team", teamId],
                }),
            ]);
        },
    });
};

type DeleteInviteValues = {
    teamId: string;
    inviteId: string;
};

export const useDeleteInviteMutation = (): UseMutationResult<void, Error, DeleteInviteValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ teamId, inviteId }) => {
            const response = await fetch(apiUrl(`/teams/${teamId}/invites/${inviteId}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_, { teamId }) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["teams"],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["team", teamId],
                }),
            ]);
        },
    });
};
