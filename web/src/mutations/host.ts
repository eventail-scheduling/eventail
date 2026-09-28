import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { deserializeOwnHost, type Host } from "#/queries/host.ts";
import {
    apiUrl,
    flagStaleForm,
    jsonApiHeaders,
    refreshStaleForm,
    StaleFormError,
} from "#/utils/api.ts";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import { buildResponseDocument, type ResponseChanges } from "./session.ts";

/**
 * The patch members are all optional, because the patch is.
 *
 * A member left out keeps what is stored, so a form that only edits a biography
 * sends only that, and one that draws availability need not resend a single
 * answer. The edition is not one of them: it addresses the request.
 */
type UpdateHostValues = {
    editionId: string;
    attributes?: Record<string, unknown>;
    responses?: ResponseChanges;
    availabilities?: readonly AvailabilityInterval[];
};

type IncludedAvailability = {
    type: "host_availability";
    lid: string;
    attributes: { startsAt: string; endsAt: string };
};

const buildAvailabilityDocument = (availabilities: readonly AvailabilityInterval[]) => {
    const included = availabilities.map(
        (interval, index): IncludedAvailability => ({
            type: "host_availability",
            lid: `availability-${index}`,
            attributes: {
                startsAt: interval.startsAt.toString(),
                endsAt: interval.endsAt.toString(),
            },
        }),
    );

    return {
        identifiers: included.map(({ type, lid }) => ({ type, lid })),
        included,
    };
};

const buildHostBody = ({ attributes, responses, availabilities }: UpdateHostValues): string => {
    const answers = responses === undefined ? undefined : buildResponseDocument(responses);
    const times =
        availabilities === undefined ? undefined : buildAvailabilityDocument(availabilities);
    const relationships = {
        ...(answers === undefined ? {} : { responses: { data: answers.identifiers } }),
        ...(times === undefined ? {} : { availabilities: { data: times.identifiers } }),
    };

    return JSON.stringify({
        data: {
            type: "host",
            ...(attributes === undefined ? {} : { attributes }),
            ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
        },
        included: [...(answers?.included ?? []), ...(times?.included ?? [])],
    });
};

export const useUpdateMeHostMutation = (): UseMutationResult<Host, Error, UpdateHostValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(apiUrl(`/editions/${values.editionId}/me/host`), {
                method: "PATCH",
                body: buildHostBody(values),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response).catch(flagStaleForm);

            return deserializeOwnHost(await response.json()).data;
        },
        onError: async (error, { editionId }) => {
            if (error instanceof StaleFormError) {
                await refreshStaleForm(queryClient, error, [
                    ["clock"],
                    ["edition", editionId],
                    ["customFields", editionId],
                    ["me", "host", editionId],
                ]);
            }
        },
        onSuccess: async (_result, { editionId }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["me", "host", editionId] }),
                // The host is embedded in the documents of the sessions they
                // host, which the client cannot tell apart, in the slottable
                // list the schedule shades availability from, and in the
                // organizer's own reads of them.
                queryClient.invalidateQueries({ queryKey: ["session", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["sessions", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["host", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["hosts", editionId] }),
            ]);
        },
    });
};
