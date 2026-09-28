import { Button, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import {
    orderedBuiltInFieldNames,
    sessionFormSteps,
} from "#/components/SessionFormFields/index.js";
import { SessionHosts } from "#/components/SessionHosts/index.js";
import { SessionStateChip } from "#/components/SessionStateChip.tsx";
import { TransitionDialog, transitionAction } from "#/components/SessionTransition/index.js";
import { TransitionHistory } from "#/components/TransitionHistory.js";
import { usePollWhileProcessing } from "#/hooks/usePollWhileProcessing.ts";
import { useQueryOptionsFactory } from "#/queries";
import { isInvolvedWith, type SessionState } from "#/queries/session.ts";
import { fulfillsRole } from "#/utils/role.ts";
import { HostAnswers } from "./-components/HostAnswers.tsx";
import { SessionDetails } from "./-components/SessionDetails.tsx";
import { SessionForm } from "./-components/SessionForm.tsx";

const Root = (): ReactNode => {
    const { editionId, sessionId } = Route.useParams();
    const pollWhileProcessing = usePollWhileProcessing();
    const qof = useQueryOptionsFactory();
    const { edition, sessionFieldSpecs, uploadLimits } = useSuspenseQuery(
        qof.edition.get(editionId),
    ).data;
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const isManager = fulfillsRole(currentUser, "manager");
    const session = useSuspenseQuery({
        ...qof.session.get(editionId, sessionId),
        // A manager edits this session through a form, which re-seeds only from
        // what a save answers or, after a refusal saying it was out of date,
        // from the refetch; a derivative arriving on this query otherwise has
        // nothing on screen to land on.
        refetchInterval: (query) =>
            isManager
                ? false
                : pollWhileProcessing(
                      query.state.data?.teaserImage?.processing === true,
                      query.state.data?.teaserImage?.key,
                  ),
    }).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const sessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const tracks = useSuspenseQuery(qof.track.list(editionId)).data;
    const [target, setTarget] = useState<SessionState | null>(null);

    const isInvolved = isInvolvedWith(currentUser, session);

    const customFieldsById = useMemo(
        () => new Map(customFields.map((customField) => [customField.id, customField])),
        [customFields],
    );

    const builtInFieldNames = useMemo(
        () =>
            orderedBuiltInFieldNames(
                edition.sessionFieldOptions,
                sessionFieldSpecs,
                sessionFormSteps[0]?.groups[0]?.fields ?? [],
            ),
        [edition, sessionFieldSpecs],
    );

    return (
        <Stack spacing={3} sx={{ mt: 2 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    {session.title}
                </Typography>
                <SessionStateChip size="small" state={session.state} />
                <ButtonLink to="/manage/$editionId/sessions" params={{ editionId }}>
                    Back to sessions
                </ButtonLink>
            </Stack>

            {session.$meta.managerTransitions.length > 0 && (
                <Paper sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                        {session.$meta.managerTransitions.map((state) => (
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

            {isManager ? (
                <SessionForm
                    editionId={editionId}
                    sessionId={sessionId}
                    session={session}
                    edition={edition}
                    specs={sessionFieldSpecs}
                    fieldNames={builtInFieldNames}
                    sessionTypes={sessionTypes}
                    tracks={tracks}
                    customFields={customFields}
                    uploadLimits={uploadLimits}
                />
            ) : (
                <Paper sx={{ p: 3 }}>
                    <SessionDetails
                        session={session}
                        edition={edition}
                        specs={sessionFieldSpecs}
                        fieldNames={builtInFieldNames}
                        customFields={customFields}
                    />
                </Paper>
            )}

            {/* Manage is read-only to a hosting viewer, so inviting, revoking
                and detaching are the organizer's here. */}
            <SessionHosts
                editionId={editionId}
                sessionId={sessionId}
                hosts={session.hosts}
                canSeeInvites={isInvolved}
                canInvite={isManager}
                canRemoveHosts={isManager}
                canRevokeInvites={isManager}
            />

            <HostAnswers
                editionId={editionId}
                hosts={session.hosts}
                customFieldsById={customFieldsById}
            />

            {isInvolved && <TransitionHistory editionId={editionId} sessionId={sessionId} />}

            {target !== null && (
                <TransitionDialog
                    editionId={editionId}
                    sessionId={sessionId}
                    sessionTitle={session.title}
                    from={session.state}
                    target={target}
                    author="organizer"
                    onClose={() => {
                        setTarget(null);
                    }}
                />
            )}
        </Stack>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/sessions/$sessionId")({
    component: Root,
    loader: async ({ context, params }) => {
        const [session] = await Promise.all([
            context.queryClient.ensureQueryData(
                context.qof.session.get(params.editionId, params.sessionId),
            ),
            context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId)),
        ]);

        if (isInvolvedWith(context.currentUser, session)) {
            await context.queryClient.ensureQueryData(
                context.qof.session.transitions(params.editionId, params.sessionId),
            );
        }
    },
});
