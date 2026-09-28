import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import {
    type QueryClient,
    type QueryKey,
    type UseMutationResult,
    useMutation,
    useQueryClient,
} from "@tanstack/react-query";

import { deserializeSession, type Session, type SessionState } from "#/queries/session.ts";
import {
    apiUrl,
    flagStaleForm,
    jsonApiHeaders,
    refreshStaleForm,
    StaleFormError,
} from "#/utils/api.ts";

/**
 * Refetches the reads that embed a session's type and track.
 *
 * Session lists in every edition, and this edition's session documents.
 */
export const invalidateSessionReaders = async (
    queryClient: QueryClient,
    editionId: string,
): Promise<void> => {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["session", editionId] }),
        queryClient.invalidateQueries({ queryKey: ["me", "sessions", editionId] }),
    ]);
};

type CreateSessionValues = {
    editionId: string;
    attributes: Record<string, unknown>;
    sessionType: string;
    track: string | null | undefined;
    responses: Record<string, unknown>;

    selfService: boolean;
};

type IncludedResponse = {
    type: "response";
    lid: string;
    attributes: { value: unknown };
    relationships: { customField: { data: { type: "custom_field"; id: string } } };
};

type SessionDocument = {
    data: { id: string };
};

type ResponseIdentifier = { type: "response"; lid: string } | { type: "response"; id: string };

type ResponseDocument = {
    identifiers: ResponseIdentifier[];
    included: IncludedResponse[];
};

/**
 * Answers to send, keyed by the field they answer, and stored ones to keep.
 *
 * A kept answer is named by its id alone, so the API leaves it as whoever wrote
 * it last left it.
 */
export type ResponseChanges = {
    values: Record<string, unknown>;
    keptResponseIds: string[];
};

/**
 * Builds the responses relationship, a sent answer by lid and a kept one by its id.
 *
 * A sent answer cannot go by its id, which would keep the stored value instead.
 */
export const buildResponseDocument = ({
    values,
    keptResponseIds,
}: ResponseChanges): ResponseDocument => {
    const included = Object.entries(values).map(([customFieldId, value]) => ({
        type: "response" as const,
        lid: customFieldId,
        attributes: { value },
        relationships: {
            customField: { data: { type: "custom_field" as const, id: customFieldId } },
        },
    }));

    return {
        identifiers: [
            ...included.map(({ type, lid }) => ({ type, lid })),
            ...keptResponseIds.map((id) => ({ type: "response" as const, id })),
        ],
        included,
    };
};

/** A patch may leave a relationship out; a create may not. */
type SessionBody = Omit<CreateSessionValues, "sessionType" | "selfService" | "responses"> & {
    sessionType: string | undefined;
    responses: ResponseChanges | undefined;
    selfService?: boolean;
};

const buildSessionBody = (
    { attributes, sessionType, track, responses, selfService }: SessionBody,
    sessionId?: string,
) => {
    const answers = responses === undefined ? undefined : buildResponseDocument(responses);

    return {
        data: {
            type: "session",
            // JSON:API 1.1, Updating Resources: a PATCH body must carry the id.
            ...(sessionId === undefined ? {} : { id: sessionId }),
            attributes,
            relationships: {
                ...(sessionType === undefined
                    ? {}
                    : { sessionType: { data: { type: "session_type", id: sessionType } } }),
                // The key is absent rather than null when the edition disables
                // tracks, which the API's strict schema requires.
                ...(track === undefined ? {} : { track: { data: trackIdentifier(track) } }),
                ...(answers === undefined ? {} : { responses: { data: answers.identifiers } }),
            },
            ...(sessionId === undefined ? { meta: { selfService: selfService === true } } : {}),
        },
        included: answers?.included ?? [],
    };
};

const trackIdentifier = (track: string | null) =>
    track === null ? null : { type: "track", id: track };

const sessionFormSources = (editionId: string): QueryKey[] => [
    ["clock"],
    ["edition", editionId],
    ["customFields", editionId],
    ["session-types", editionId],
    ["tracks", editionId],
];

/**
 * Files a session, as the caller's own or on somebody else's behalf.
 *
 * With `selfService` the caller becomes a host, and the API demands their
 * profile be complete, answering `incomplete_profile` with a 422 otherwise, so
 * whatever writes the profile has to land first. Without it the session has no
 * hosts at all, which only a manager may do.
 */
export const useCreateSessionMutation = (): UseMutationResult<
    string,
    Error,
    CreateSessionValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(apiUrl(`/editions/${values.editionId}/sessions`), {
                method: "POST",
                body: JSON.stringify(
                    buildSessionBody({
                        ...values,
                        responses: { values: values.responses, keptResponseIds: [] },
                    }),
                ),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response).catch(flagStaleForm);
            const document = (await response.json()) as SessionDocument;

            return document.data.id;
        },
        onError: async (error, values) => {
            if (error instanceof StaleFormError) {
                await refreshStaleForm(queryClient, error, sessionFormSources(values.editionId));
            }
        },
        onSuccess: async (_sessionId, values) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["sessions", values.editionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "sessions", values.editionId] }),
                // A speaker filing their own becomes its host, which the host
                // rows count.
                ...(values.selfService
                    ? [queryClient.invalidateQueries({ queryKey: ["hosts", values.editionId] })]
                    : []),
            ]);
        },
    });
};

/** A member left undefined stays out of the patch, so the API keeps what it has stored. */
type UpdateSessionValues = Omit<
    CreateSessionValues,
    "sessionType" | "selfService" | "responses"
> & {
    sessionType: string | undefined;
    responses: ResponseChanges | undefined;
    sessionId: string;
};

export const useUpdateSessionMutation = (): UseMutationResult<
    Session,
    Error,
    UpdateSessionValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(
                apiUrl(`/editions/${values.editionId}/sessions/${values.sessionId}`),
                {
                    method: "PATCH",
                    body: JSON.stringify(buildSessionBody(values, values.sessionId)),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response).catch(flagStaleForm);

            return deserializeSession(await response.json()).data;
        },
        onError: async (error, values) => {
            if (error instanceof StaleFormError) {
                await refreshStaleForm(queryClient, error, [
                    ...sessionFormSources(values.editionId),
                    ["session", values.editionId, values.sessionId],
                ]);
            }
        },
        onSuccess: async (_result, values) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["sessions", values.editionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "sessions", values.editionId] }),
                queryClient.invalidateQueries({
                    queryKey: ["session", values.editionId, values.sessionId],
                }),
                // The schedules embed each slot's session, title included.
                queryClient.invalidateQueries({ queryKey: ["schedules", values.editionId] }),
            ]);
        },
    });
};

type TransitionSessionValues = {
    editionId: string;
    sessionId: string;
    state: SessionState;
    /**
     * Never an internal note.
     *
     * The history is served to the session's hosts and to the organizers, and
     * both pages render it, so whichever of the two writes this the other one
     * reads it. An organizer's also reaches the speaker by mail on an
     * acceptance or a rejection.
     */
    note: string | null;
};

export const useTransitionSessionMutation = (): UseMutationResult<
    void,
    Error,
    TransitionSessionValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ editionId, sessionId, state, note }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/sessions/${sessionId}/transitions`),
                {
                    method: "POST",
                    body: JSON.stringify({
                        data: {
                            type: "session_transition",
                            attributes: { state, note },
                        },
                    }),
                    headers: jsonApiHeaders,
                },
            );
            await handleJsonApiError(response);
        },
        // Refetched whatever the outcome: a 409 means the page offered a move
        // from a state the session has since left.
        onSettled: async (_result, _error, { editionId, sessionId }) => {
            await Promise.all([
                // The list carries each session's state and the moves left to
                // it, the history has gained a row, and the schedules embed the
                // state of each slot's session.
                queryClient.invalidateQueries({ queryKey: ["sessions", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["session", editionId, sessionId] }),
                queryClient.invalidateQueries({ queryKey: ["me", "sessions", editionId] }),
                queryClient.invalidateQueries({ queryKey: ["schedules", editionId] }),
            ]);
        },
    });
};
