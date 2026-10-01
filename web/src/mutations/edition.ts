import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    type OptimisticRollback,
    queuedOptimisticUpdate,
} from "#/mutations/queued-optimistic-update.ts";
import {
    type BuiltInFieldOptions,
    deserializeEdition,
    type Edition,
    type EditionDocument,
    type ListEdition,
} from "#/queries/edition.js";
import type { SettleReport } from "#/queries/settle.js";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

type CreateEditionValues = {
    name: string;
    startDate: Temporal.PlainDate;
    endDate: Temporal.PlainDate;
    timeZone: string;
    submissionDeadline: Temporal.ZonedDateTime | null;
    templateEdition: ListEdition | null;
};

export const useCreateEditionMutation = (): UseMutationResult<
    Edition,
    Error,
    CreateEditionValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ templateEdition, ...attributes }) => {
            const response = await fetch(apiUrl("/editions"), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "edition",
                        attributes: {
                            ...attributes,
                            submissionDeadline: attributes.submissionDeadline?.toInstant() ?? null,
                        },
                        relationships: {
                            templateEdition:
                                templateEdition !== null
                                    ? {
                                          data: {
                                              type: "edition",
                                              id: templateEdition.id,
                                          },
                                      }
                                    : undefined,
                        },
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
            return deserializeEdition(await response.json()).data;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ["editions"],
            });
        },
    });
};

type UpdateEditionResult = {
    settled: SettleReport | null;
    version: number;
};

type UpdateEditionValues = Partial<Omit<CreateEditionValues, "templateEdition">> & {
    version: number;
    startDateBecomes?: Temporal.PlainDate;
};

/**
 * Patches the edition; the API refuses a date move under anything scheduled
 * until the caller answers.
 *
 * Slots or drawn availability are each enough to trigger it. The API answers
 * 409 `start_date_required` carrying `earliest` and `latest`, which a caller
 * catches, puts to the organizer, and sends back. A result that is not null
 * means a settle ran, which may have removed nothing: `anythingWasRemoved` is
 * what says.
 */
export const useUpdateEditionMutation = (
    editionId: string,
): UseMutationResult<UpdateEditionResult, Error, UpdateEditionValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        scope: { id: `edition-${editionId}` },
        mutationFn: async ({ version, startDateBecomes, submissionDeadline, ...attributes }) => {
            const id = editionId;
            const response = await fetch(apiUrl(`/editions/${id}`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: {
                        id,
                        type: "edition",
                        attributes: {
                            ...attributes,
                            ...(submissionDeadline !== undefined && {
                                submissionDeadline: submissionDeadline?.toInstant() ?? null,
                            }),
                        },
                        meta: { version, ...(startDateBecomes ? { startDateBecomes } : {}) },
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);

            const document = deserializeEdition(await response.json());

            return { settled: document.meta.settled ?? null, version: document.data.$meta.version };
        },
        // Moving the days or changing the zone re-anchors and trims every
        // availability, a location's or a host's, and settles every draft
        // slot, so what is cached for any of them answers for a window that no
        // longer exists. Dropped rather than invalidated: this only
        // runs from the settings page, where nothing under those keys is
        // mounted, and invalidating an unobserved query marks it stale without
        // refetching, leaving the route loader free to hand the old answer
        // straight back.
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["editions"] }),
                queryClient.invalidateQueries({ queryKey: ["edition", editionId] }),
                queryClient.removeQueries({ queryKey: ["locations", editionId] }),
                queryClient.removeQueries({ queryKey: ["schedules", editionId, "latest"] }),
                queryClient.removeQueries({ queryKey: ["sessions", editionId, "slottable"] }),
                queryClient.removeQueries({ queryKey: ["me", "host", editionId] }),
            ]);
        },
    });
};

export type FieldOptionsScope = "session" | "profile";

type UpdateFieldOptionsValues = {
    fieldOptions: BuiltInFieldOptions;
};

/**
 * Patches one scope's field options, apart from the general edition update so
 * the payload is nothing else.
 *
 * The optimistic cache write can then assume as much. The settings screen
 * patches dates that would need converting before they could go into the cache.
 */
export const useUpdateFieldOptionsMutation = (
    editionId: string,
    scope: FieldOptionsScope,
): UseMutationResult<
    number,
    Error,
    UpdateFieldOptionsValues,
    OptimisticRollback<EditionDocument>
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();
    const attribute = scope === "session" ? "sessionFieldOptions" : "profileFieldOptions";
    const mutationKey = ["edition", editionId, "fieldOptions"];

    return useMutation({
        mutationKey,
        scope: { id: `edition-${editionId}` },
        ...queuedOptimisticUpdate<number, EditionDocument, UpdateFieldOptionsValues>({
            queryKey: ["edition", editionId],
            mutationKey,
            apply: (previous, { fieldOptions }) => ({
                ...previous,
                edition: { ...previous.edition, [attribute]: fieldOptions },
            }),
            invalidate: () => queryClient.invalidateQueries({ queryKey: ["edition", editionId] }),
        }),
        // Read here rather than at the call, since a queued sibling only learns
        // the version its predecessor produced once that one has answered.
        mutationFn: async ({ fieldOptions }) => {
            const cached = queryClient.getQueryData<EditionDocument>(["edition", editionId]);

            if (!cached) {
                throw new Error("The edition has to be loaded before its form can be changed");
            }

            const response = await fetch(apiUrl(`/editions/${editionId}`), {
                method: "PATCH",
                body: JSON.stringify({
                    data: {
                        id: editionId,
                        type: "edition",
                        attributes: { [attribute]: fieldOptions },
                        meta: { version: cached.edition.$meta.version },
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);

            return deserializeEdition(await response.json()).data.$meta.version;
        },
        onSuccess: (version, _variables, _rollback, context) => {
            context.client.setQueryData<EditionDocument>(["edition", editionId], (current) =>
                current
                    ? {
                          ...current,
                          edition: {
                              ...current.edition,
                              $meta: { ...current.edition.$meta, version },
                          },
                      }
                    : current,
            );
        },
    });
};
