import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateSessionReaders } from "#/mutations/session.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type SessionTypeAttributes = {
    name: string;
    externalKey: string | null;
    defaultDuration: Temporal.Duration;
    internal: boolean;
};

type CreateSessionTypeValues = SessionTypeAttributes & {
    editionId: string;
};

type UpdateSessionTypeValues = CreateSessionTypeValues & {
    id: string;
};

type SessionTypeReference = {
    editionId: string;
    id: string;
};

const serializeAttributes = ({ defaultDuration, ...attributes }: SessionTypeAttributes) => ({
    ...attributes,
    defaultDuration: defaultDuration.toString(),
});

const useInvalidateSessionTypeList = () => {
    const queryClient = useQueryClient();

    return async (editionId: string) => {
        await queryClient.invalidateQueries({ queryKey: ["session-types", editionId] });
    };
};

const useInvalidateSessionTypeReaders = () => {
    const queryClient = useQueryClient();
    const invalidateList = useInvalidateSessionTypeList();

    return async (editionId: string) => {
        await Promise.all([
            invalidateList(editionId),
            invalidateSessionReaders(queryClient, editionId),
        ]);
    };
};

export const useCreateSessionTypeMutation = (): UseMutationResult<
    void,
    Error,
    CreateSessionTypeValues
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateSessionTypeList();

    return useMutation({
        mutationFn: async ({ editionId, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/session-types`), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "session_type",
                        attributes: serializeAttributes(attributes),
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useUpdateSessionTypeMutation = (): UseMutationResult<
    void,
    Error,
    UpdateSessionTypeValues
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateSessionTypeReaders();

    return useMutation({
        mutationFn: async ({ editionId, id, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/session-types/${id}`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: {
                        id,
                        type: "session_type",
                        attributes: serializeAttributes(attributes),
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useDeleteSessionTypeMutation = (): UseMutationResult<
    void,
    Error,
    SessionTypeReference
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();
    const invalidate = useInvalidateSessionTypeReaders();

    return useMutation({
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/session-types/${id}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await Promise.all([
                invalidate(editionId),
                // A custom field scoped to it loses the type from its scope.
                queryClient.invalidateQueries({ queryKey: ["customFields", editionId] }),
            ]);
        },
    });
};

// Concurrent promotions decide the default by arrival, so callers disable
// the action while one is in flight.
export const promoteSessionTypeMutationKey = ["session-type-promotion"];

export const usePromoteSessionTypeToDefaultMutation = (): UseMutationResult<
    void,
    Error,
    SessionTypeReference
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateSessionTypeReaders();

    return useMutation({
        mutationKey: promoteSessionTypeMutationKey,
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/session-types/${id}/default-promotion`),
                {
                    method: "POST",
                    body: JSON.stringify({
                        data: { id, type: "session_type_default_promotion" },
                    }),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};
