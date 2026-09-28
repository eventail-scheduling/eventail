import { Button, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { ImagePreview } from "#/components/ImagePreview.js";
import { ButtonLink } from "#/components/Link/index.js";
import { Detail, ResponseValue } from "#/components/ResponseValue/index.js";
import { applicableCustomFields } from "#/components/SessionFormFields/index.js";
import { SessionHosts } from "#/components/SessionHosts/index.js";
import { SessionStateChip } from "#/components/SessionStateChip.tsx";
import { TransitionDialog, transitionAction } from "#/components/SessionTransition/index.js";
import { TransitionHistory } from "#/components/TransitionHistory.js";
import { useDeadlinePassed } from "#/hooks/useDeadlinePassed.ts";
import { usePollWhileProcessing } from "#/hooks/usePollWhileProcessing.ts";
import { useQueryOptionsFactory } from "#/queries";
import type { Session } from "#/queries/session.ts";
import {
    hostManageableStates,
    hostMayEditIn,
    isInvolvedWith,
    type SessionState,
} from "#/queries/session.ts";
import { fulfillsRole } from "#/utils/role.ts";

type SessionSummaryProps = {
    session: Session;
};

const SessionSummary = ({ session }: SessionSummaryProps): ReactNode => (
    <Stack spacing={2}>
        <Detail label="Session type">{session.sessionType.name}</Detail>
        {session.track && <Detail label="Track">{session.track.name}</Detail>}
        {session.duration && (
            <Detail label="Duration">{session.duration.total({ unit: "minutes" })} minutes</Detail>
        )}
        {session.abstract && <Detail label="Abstract">{session.abstract}</Detail>}
        {session.description && <Detail label="Description">{session.description}</Detail>}
        {session.teaserImage !== null && (
            <Detail label="Teaser image">
                <ImagePreview image={session.teaserImage} />
            </Detail>
        )}
    </Stack>
);

const Root = (): ReactNode => {
    const { editionId, sessionId } = Route.useParams();
    const pollWhileProcessing = usePollWhileProcessing();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;
    const session = useSuspenseQuery({
        ...qof.session.get(editionId, sessionId),
        refetchInterval: (query) =>
            pollWhileProcessing(
                query.state.data?.teaserImage?.processing === true,
                query.state.data?.teaserImage?.key,
            ),
    }).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const deadlinePassed = useDeadlinePassed(edition);
    const [target, setTarget] = useState<SessionState | null>(null);

    const isManager = fulfillsRole(currentUser, "manager");
    const hostsThisSession = session.$meta.hosting;
    const isInvolved = isInvolvedWith(currentUser, session);

    // Any team member can read this page, so the state test alone would offer
    // Edit to someone the API refuses on save. Hosting is the other half of what
    // it requires, and only the session can say whether this caller does.
    const editable =
        (isManager || hostsThisSession) && hostMayEditIn(session.state, deadlinePassed);

    const customFieldsById = useMemo(
        () =>
            new Map(
                applicableCustomFields(customFields, {
                    sessionTypeId: session.sessionType.id,
                    trackId: session.track?.id,
                    includeFrozen: true,
                }).map((customField) => [customField.id, customField]),
            ),
        [customFields, session],
    );
    const shownResponses = session.responses.filter((response) =>
        customFieldsById.has(response.customField.id),
    );

    return (
        <Stack spacing={3} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    {session.title}
                </Typography>
                <SessionStateChip state={session.state} />
                {editable && (
                    <ButtonLink
                        variant="outlined"
                        to="/editions/$editionId/sessions/$sessionId/edit"
                        params={{ editionId, sessionId }}
                    >
                        Edit
                    </ButtonLink>
                )}
            </Stack>

            {/* The host's own moves, not every move the caller may make: an
                organizer who submitted this session decides on it from the
                management section, not from here. */}
            {session.$meta.hostTransitions.length > 0 && (
                <Paper sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                        {session.$meta.hostTransitions.map((state) => (
                            <Button
                                key={state}
                                variant="outlined"
                                onClick={() => {
                                    setTarget(state);
                                }}
                            >
                                {transitionAction(session.state, state).label}
                            </Button>
                        ))}
                    </Stack>
                </Paper>
            )}

            <Paper sx={{ p: 3 }}>
                <SessionSummary session={session} />
            </Paper>

            <SessionHosts
                editionId={editionId}
                sessionId={sessionId}
                hosts={session.hosts}
                canSeeInvites={isInvolved}
                canInvite={
                    isManager || (hostsThisSession && hostManageableStates.includes(session.state))
                }
                canRemoveHosts={isManager}
                canRevokeInvites
            />

            {shownResponses.length > 0 && (
                <Paper sx={{ p: 3 }}>
                    <Stack spacing={2}>
                        {shownResponses.map((response) => {
                            const customField = customFieldsById.get(response.customField.id);

                            if (!customField) {
                                return null;
                            }

                            return (
                                <Detail key={response.id} label={customField.title}>
                                    <ResponseValue
                                        customField={customField}
                                        editionId={editionId}
                                        responseId={response.id}
                                        value={response.value}
                                    />
                                </Detail>
                            );
                        })}
                    </Stack>
                </Paper>
            )}

            {isInvolved && <TransitionHistory editionId={editionId} sessionId={sessionId} />}

            {target !== null && (
                <TransitionDialog
                    editionId={editionId}
                    sessionId={sessionId}
                    sessionTitle={session.title}
                    from={session.state}
                    target={target}
                    author="host"
                    onClose={() => {
                        setTarget(null);
                    }}
                />
            )}
        </Stack>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId/sessions/$sessionId/")({
    component: Root,
    loader: async ({ context, params }) => {
        const session = await context.queryClient.ensureQueryData(
            context.qof.session.get(params.editionId, params.sessionId),
        );

        if (isInvolvedWith(context.currentUser, session)) {
            await context.queryClient.ensureQueryData(
                context.qof.session.transitions(params.editionId, params.sessionId),
            );
        }
    },
});
