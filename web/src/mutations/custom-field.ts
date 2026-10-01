import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    type OptimisticRollback,
    queuedOptimisticUpdate,
} from "#/mutations/queued-optimistic-update.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import { apiUrl, jsonApiAcceptHeaders, jsonApiHeaders } from "#/utils/api.ts";

type CustomFieldAttributes = {
    externalKey: string | null;
    target: CustomField["target"];
    requirement: CustomField["requirement"];
    options: CustomField["options"];
    title: string;
    helperText: string;
    deadline: Temporal.ZonedDateTime | null;
    freezeAfter: Temporal.ZonedDateTime | null;
    confidential: boolean;
};

type CustomFieldScope = {
    sessionTypes: string[];
    tracks: string[];
};

type CreateCustomFieldValues = CustomFieldAttributes &
    CustomFieldScope & {
        editionId: string;
    };

type UpdateCustomFieldValues = CreateCustomFieldValues & {
    id: string;
};

type CustomFieldReference = {
    editionId: string;
    id: string;
};

const buildBody = (
    {
        editionId,
        sessionTypes,
        tracks,
        deadline,
        freezeAfter,
        ...attributes
    }: CreateCustomFieldValues,
    id?: string,
) => ({
    data: {
        ...(id === undefined ? {} : { id }),
        type: "custom_field",
        attributes: {
            ...attributes,
            deadline: deadline?.toInstant().toString() ?? null,
            freezeAfter: freezeAfter?.toInstant().toString() ?? null,
        },
        relationships: {
            sessionTypes: {
                data: sessionTypes.map((sessionTypeId) => ({
                    type: "session_type",
                    id: sessionTypeId,
                })),
            },
            tracks: {
                data: tracks.map((trackId) => ({ type: "track", id: trackId })),
            },
        },
    },
});

const useInvalidateCustomFields = () => {
    const queryClient = useQueryClient();

    return async (editionId: string) => {
        await queryClient.invalidateQueries({ queryKey: ["customFields", editionId] });
    };
};

export const useCreateCustomFieldMutation = (): UseMutationResult<
    void,
    Error,
    CreateCustomFieldValues
> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateCustomFields();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(apiUrl(`/editions/${values.editionId}/custom-fields`), {
                method: "POST",
                body: JSON.stringify(buildBody(values)),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await invalidate(editionId);
        },
    });
};

export const useUpdateCustomFieldMutation = (): UseMutationResult<
    void,
    Error,
    UpdateCustomFieldValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();
    const invalidate = useInvalidateCustomFields();

    return useMutation({
        mutationFn: async ({ id, ...values }) => {
            const response = await fetch(
                apiUrl(`/editions/${values.editionId}/custom-fields/${id}`),
                {
                    method: "PATCH",
                    body: JSON.stringify(buildBody(values, id)),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await Promise.all([
                invalidate(editionId),
                // Its confidentiality decides who is served the answers to it.
                queryClient.invalidateQueries({ queryKey: ["session", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["host", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "host", editionId] }),
            ]);
        },
    });
};

export const useDeleteCustomFieldMutation = (): UseMutationResult<
    void,
    Error,
    CustomFieldReference
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();
    const invalidate = useInvalidateCustomFields();

    return useMutation({
        mutationFn: async ({ editionId, id }) => {
            const response = await fetch(apiUrl(`/editions/${editionId}/custom-fields/${id}`), {
                method: "DELETE",
                headers: jsonApiAcceptHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async (_result, { editionId }) => {
            await Promise.all([
                invalidate(editionId),
                // The answers to it go with it, from sessions and hosts alike.
                queryClient.invalidateQueries({ queryKey: ["session", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["host", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "host", editionId] }),
            ]);
        },
    });
};

type ReorderCustomFieldsValues = {
    customFieldIds: string[];
};

const customFieldTargetOrder: CustomField["target"][] = ["per_proposal", "per_host"];

/**
 * Regroups the optimistic list the way the server will serve it back.
 *
 * The server renumbers positions per target and serves the list grouped that
 * way, so without this the rows jump once the refetch lands.
 */
const applyOrder = (customFields: CustomField[], customFieldIds: string[]): CustomField[] => {
    const byId = new Map(customFields.map((customField) => [customField.id, customField]));

    return customFieldIds
        .map((customFieldId) => byId.get(customFieldId))
        .filter((customField) => customField !== undefined)
        .sort(
            (left, right) =>
                customFieldTargetOrder.indexOf(left.target) -
                customFieldTargetOrder.indexOf(right.target),
        );
};

export const useReorderCustomFieldsMutation = (
    editionId: string,
): UseMutationResult<void, Error, ReorderCustomFieldsValues, OptimisticRollback<CustomField[]>> => {
    const { fetch } = useOidcFetch();
    const invalidate = useInvalidateCustomFields();
    const mutationKey = ["customFields", editionId, "reorder"];

    return useMutation({
        mutationKey,
        scope: { id: `custom-fields-${editionId}` },
        ...queuedOptimisticUpdate<void, CustomField[], ReorderCustomFieldsValues>({
            queryKey: ["customFields", editionId],
            mutationKey,
            apply: (previous, { customFieldIds }) => applyOrder(previous, customFieldIds),
            invalidate: () => invalidate(editionId),
        }),
        mutationFn: async ({ customFieldIds }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/relationships/custom-fields`),
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        data: customFieldIds.map((id) => ({ type: "custom_field", id })),
                    }),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
    });
};
