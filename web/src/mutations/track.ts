import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateSessionReaders } from "#/mutations/session.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type TrackAttributes = {
    name: string;
    externalKey: string | null;
    description: string;
    color: string;
    internal: boolean;
};

type CreateTrackValues = TrackAttributes & {
    editionId: string;
};

type UpdateTrackValues = CreateTrackValues & {
    id: string;
};

type TrackReference = {
    editionId: string;
    id: string;
};

const useInvalidateTrackList = () => {
    const queryClient = useQueryClient();

    return async (editionId: string) => {
        await queryClient.invalidateQueries({ queryKey: ["tracks", editionId] });
    };
};

const useInvalidateTrackReaders = () => {
    const queryClient = useQueryClient();
    const invalidateList = useInvalidateTrackList();

    return async (editionId: string) => {
        await Promise.all([
            invalidateList(editionId),
            invalidateSessionReaders(queryClient, editionId),
        ]);
    };
};

export const useCreateTrackMutation = (): UseMutationResult<void, Error, CreateTrackValues> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateTrackList();

    return useMutation({
        mutationFn: async ({ editionId, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/tracks`), {
                method: "POST",
                body: JSON.stringify({ data: { type: "track", attributes } }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useUpdateTrackMutation = (): UseMutationResult<void, Error, UpdateTrackValues> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateTrackReaders();

    return useMutation({
        mutationFn: async ({ editionId, id, ...attributes }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/tracks/${id}`), {
                method: "PATCH",
                body: JSON.stringify({ data: { id, type: "track", attributes } }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useDeleteTrackMutation = (): UseMutationResult<void, Error, TrackReference> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();
    const invalidate = useInvalidateTrackReaders();

    return useMutation({
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/tracks/${id}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await Promise.all([
                invalidate(editionId),
                // A custom field scoped to it loses the track from its scope.
                queryClient.invalidateQueries({ queryKey: ["customFields", editionId] }),
            ]);
        },
    });
};
