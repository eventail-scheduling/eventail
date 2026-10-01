import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { type SlotsSettleReport, slotsSettleReportSchema } from "#/queries/settle.js";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

type PublishValues = {
    editionId: string;
    scheduleId: string;
    preliminary: boolean;
};

export const usePublishScheduleMutation = (): UseMutationResult<void, Error, PublishValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, scheduleId, preliminary }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/schedules/${scheduleId}/publication`),
                {
                    method: "POST",
                    headers: jsonApiHeaders,
                    body: JSON.stringify({
                        data: { type: "schedule_publication", attributes: { preliminary } },
                    }),
                },
            );
            await handleJsonApiError(response);
        },
        onSettled: async (_result, _error, { editionId }) => {
            await queryClient.invalidateQueries({ queryKey: ["schedules", editionId] });
        },
    });
};

type RevertValues = {
    editionId: string;
    scheduleId: string;
    /**
     * The publication's new first day, asked only when the edition moved since publishing.
     *
     * Absent is a legitimate first attempt: the API answers 409
     * start_date_required with the range it will accept, rather than guessing
     * which way the days went.
     */
    startDateBecomes?: Temporal.PlainDate;
};

/**
 * What a reversion says about the sessions it could not keep.
 *
 * `unreadable` is this client failing to parse the report, which must not be
 * shown as a reversion that kept everything.
 */
export type ReversionOutcome =
    | { kind: "settled"; report: SlotsSettleReport }
    | { kind: "unreadable" };

export const useRevertScheduleMutation = (): UseMutationResult<
    ReversionOutcome,
    Error,
    RevertValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, scheduleId, startDateBecomes }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/schedules/${scheduleId}/reversion`),
                {
                    method: "POST",
                    headers: jsonApiHeaders,
                    body: JSON.stringify({
                        data: {
                            type: "schedule_reversion",
                            attributes: {},
                            meta: startDateBecomes
                                ? { startDateBecomes: startDateBecomes.toString() }
                                : undefined,
                        },
                    }),
                },
            );
            await handleJsonApiError(response);

            // Reverting can drop a session the edition has moved away from, and
            // this is the only place that says which. Parsed rather than
            // probed: a report the client cannot read is indistinguishable
            // from an empty one downstream, and the empty one means nothing
            // was lost.
            const document = (await response.json()) as { meta?: { settled?: unknown } };

            if (document.meta?.settled === undefined) {
                return { kind: "unreadable" };
            }

            const settled = slotsSettleReportSchema.safeParse(document.meta.settled);

            // The reversion itself landed, so this cannot reject: that would
            // leave the draft the server has already replaced on screen and
            // invite a retry. An unreadable report is its own outcome, because
            // treating it as an absent one says nothing was lost.
            return settled.success
                ? { kind: "settled", report: settled.data }
                : { kind: "unreadable" };
        },
        onSettled: async (_result, _error, { editionId }) => {
            await queryClient.invalidateQueries({ queryKey: ["schedules", editionId] });
        },
    });
};
