import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import { knownResponses } from "#/components/CustomFieldInput/index.js";
import {
    recoverMissingUpload,
    UploadTrackerContext,
    UploadWaitHint,
    useUploadTracker,
} from "#/components/FileUploadField/index.js";
import {
    applicableCustomFields,
    buildSessionChanges,
    createSessionDefaultValues,
    createSessionSchema,
    offerable,
    orderedBuiltInFieldNames,
    SessionBuiltInFields,
    SessionCustomFields,
    type SessionFieldValues,
    type SessionTransformedValues,
    sessionFormSteps,
} from "#/components/SessionFormFields/index.js";
import { useDeadlinePassed } from "#/hooks/useDeadlinePassed.ts";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateSessionMutation } from "#/mutations/session.ts";
import { useQueryOptionsFactory } from "#/queries";
import { hostMayEditIn } from "#/queries/session.ts";
import { defaultMutationErrorHandler, reportingErrors, StaleFormError } from "#/utils/api.ts";
import { changedFields, rebaseChanges } from "#/utils/changed-fields.ts";
import { fulfillsRole } from "#/utils/role.ts";
import { formResolver } from "#/utils/zod.js";

const Root = (): ReactNode => {
    const { editionId, sessionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const navigate = useNavigate();
    const { edition, sessionFieldSpecs, uploadLimits } = useSuspenseQuery(
        qof.edition.get(editionId),
    ).data;
    const session = useSuspenseQuery(qof.session.get(editionId, sessionId)).data;
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const servedSessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const servedTracks = useSuspenseQuery(qof.track.list(editionId)).data;
    const isManager = fulfillsRole(currentUser, "manager");
    const sessionTypes = offerable(servedSessionTypes, isManager);
    const tracks = offerable(servedTracks, isManager);
    const deadlinePassed = useDeadlinePassed(edition);
    const updateMutation = useUpdateSessionMutation();
    const { uploadTracker, uploading } = useUploadTracker();

    const resolver = useCallback<Resolver<SessionFieldValues, unknown, SessionTransformedValues>>(
        (values, context, options) => {
            const schema = createSessionSchema(
                edition,
                applicableCustomFields(customFields, {
                    sessionTypeId: values.sessionType?.id,
                    trackId: values.track?.id,
                }),
            );

            return formResolver(schema)(values, context, options);
        },
        [edition, customFields],
    );

    const queryClient = useQueryClient();
    const [seed, setSeed] = useState(() => ({
        session,
        values: createSessionDefaultValues({ session, customFields }),
    }));
    const form = useForm<SessionFieldValues, unknown, SessionTransformedValues>({
        resolver,
        defaultValues: seed.values,
    });
    const leaveGuard = useLeaveGuard(form);

    const sessionType = useWatch({ control: form.control, name: "sessionType" });
    const track = useWatch({ control: form.control, name: "track" });
    const { open: openCustomFields, frozen: closedCustomFields } = useFreezeSplit(customFields);
    const proposalCustomFields = useMemo(
        () =>
            applicableCustomFields(openCustomFields, {
                sessionTypeId: sessionType?.id,
                trackId: track?.id,
            }),
        [openCustomFields, sessionType, track],
    );
    const frozenCustomFields = useMemo(
        () =>
            applicableCustomFields(closedCustomFields, {
                sessionTypeId: sessionType?.id,
                trackId: track?.id,
                includeFrozen: true,
            }),
        [closedCustomFields, sessionType, track],
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

    // The session this handler closed over may predate the refusal's refetch,
    // so the fresh copy comes from the cache. It is never older than the seed
    // here, since every seed came from that cache and a successful save leaves
    // the page. What the user left alone then follows it, the type and track
    // above all, so the questions the form holds match the ones the API judges.
    // A track the edition stopped asking for goes back to the stored one, as
    // the form can no longer show or send it but would still scope by it.
    const rebaseOntoRefetched = () => {
        const freshSession =
            queryClient.getQueryData(qof.session.get(editionId, sessionId).queryKey) ?? session;
        const freshEdition =
            queryClient.getQueryData(qof.edition.get(editionId).queryKey)?.edition ?? edition;

        const freshValues = createSessionDefaultValues({
            session: freshSession,
            customFields:
                queryClient.getQueryData(qof.customField.list(editionId).queryKey) ?? customFields,
        });
        const rebased = rebaseChanges(seed.values, freshValues, form.getValues(), ["responses"]);
        setSeed({ session: freshSession, values: freshValues });
        form.reset(freshValues);
        form.reset(
            freshEdition.sessionFieldOptions.track === undefined
                ? { ...rebased, track: freshValues.track }
                : rebased,
            { keepDefaultValues: true },
        );
    };

    const handleSubmit = (values: SessionTransformedValues) => {
        const changes = changedFields(seed.values, form.getValues());

        updateMutation.mutate(
            {
                editionId,
                sessionId,
                ...buildSessionChanges({
                    edition,
                    customFields,
                    proposalCustomFields,
                    frozenCustomFields,
                    values,
                    changes,
                    sessionTypes,
                    tracks,
                    storedResponses: knownResponses(session.responses, seed.session.responses),
                }),
            },
            {
                onSuccess: () => {
                    enqueueSnackbar("Your session has been updated", { variant: "success" });
                    leaveGuard.release();
                    void navigate({
                        to: "/editions/$editionId/sessions/$sessionId",
                        params: { editionId, sessionId },
                    });
                },
                onError: (error) => {
                    defaultMutationErrorHandler(error);
                    recoverMissingUpload(form, error);

                    if (error instanceof StaleFormError) {
                        rebaseOntoRefetched();
                    }
                },
            },
        );
    };

    // Two gates rather than one, so the refusal says which of them it is: any
    // team member can read this page, and being told a session is no longer
    // editable when it was never theirs to edit is the wrong answer.
    const mayEdit = isManager || session.$meta.hosting;
    const stateAllowsEditing = hostMayEditIn(session.state, deadlinePassed);

    if (!mayEdit) {
        return (
            <Alert severity="info" sx={{ mt: 2 }}>
                Only a host of this session can edit it.
            </Alert>
        );
    }

    if (!stateAllowsEditing) {
        return (
            <Alert severity="info" sx={{ mt: 2 }}>
                This session can no longer be edited.
            </Alert>
        );
    }

    return (
        <UploadTrackerContext value={uploadTracker}>
            <Box sx={{ mb: 2, mt: 2 }}>
                <Typography variant="h5">Edit {session.title}</Typography>
            </Box>

            <Paper
                component="form"
                noValidate
                onSubmit={form.handleSubmit(reportingErrors(handleSubmit))}
                sx={{ p: 3 }}
            >
                <Stack spacing={3}>
                    <SessionBuiltInFields
                        control={form.control}
                        edition={edition}
                        specs={sessionFieldSpecs}
                        sessionTypes={sessionTypes}
                        tracks={tracks}
                        uploadLimits={uploadLimits}
                        fieldNames={builtInFieldNames}
                        assigned={{ sessionType: session.sessionType, track: session.track }}
                    />

                    {proposalCustomFields.length > 0 && (
                        <SessionCustomFields
                            control={form.control}
                            customFields={proposalCustomFields}
                            uploadLimits={uploadLimits}
                        />
                    )}

                    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                        <Button
                            type="submit"
                            variant="contained"
                            loading={updateMutation.isPending}
                            disabled={!form.formState.isDirty || uploading}
                        >
                            Save changes
                        </Button>
                        <UploadWaitHint uploading={uploading} />
                    </Stack>
                </Stack>
            </Paper>
        </UploadTrackerContext>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId/sessions/$sessionId/edit")(
    {
        component: Root,
        loader: async ({ context, params }) => {
            await context.queryClient.ensureQueryData(
                context.qof.session.get(params.editionId, params.sessionId),
            );
        },
    },
);
