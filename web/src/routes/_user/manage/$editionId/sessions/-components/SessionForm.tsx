import { Button, Paper, Stack, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
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
    SessionBuiltInFields,
    SessionCustomFields,
    type SessionFieldValues,
    type SessionTransformedValues,
} from "#/components/SessionFormFields/index.js";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateSessionMutation } from "#/mutations/session.ts";
import { useQueryOptionsFactory } from "#/queries";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition, SessionFieldSpec, UploadLimits } from "#/queries/edition.ts";
import type { Session } from "#/queries/session.ts";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { defaultMutationErrorHandler, reportingErrors, StaleFormError } from "#/utils/api.ts";
import { changedFields, rebaseChanges, snapshotValues } from "#/utils/changed-fields.ts";
import { formResolver } from "#/utils/zod.js";
import { SessionAnswers } from "./SessionAnswers.tsx";

type SessionSeed = {
    session: Session;
    values: SessionFieldValues;
};

const seedFrom = (session: Session, customFields: CustomField[]): SessionSeed => ({
    session,
    values: createSessionDefaultValues({ session, customFields }),
});

type SessionFormProps = {
    editionId: string;
    sessionId: string;
    session: Session;
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    fieldNames: string[];
    sessionTypes: SessionType[];
    tracks: Track[];
    customFields: CustomField[];
    uploadLimits: UploadLimits;
};

export const SessionForm = ({
    editionId,
    sessionId,
    session,
    edition,
    specs,
    fieldNames,
    sessionTypes,
    tracks,
    customFields,
    uploadLimits,
}: SessionFormProps): ReactNode => {
    const updateMutation = useUpdateSessionMutation();
    const { uploadTracker, uploading } = useUploadTracker();
    const queryClient = useQueryClient();
    const qof = useQueryOptionsFactory();
    const [seed, setSeed] = useState(() => seedFrom(session, customFields));

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

    const form = useForm<SessionFieldValues, unknown, SessionTransformedValues>({
        resolver,
        defaultValues: seed.values,
    });
    useLeaveGuard(form);

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

    // A track the edition stopped asking for goes back to the stored one, as the
    // form can no longer show or send it but would still scope by it.
    const withStoredTrackIfUnasked = (
        rebased: SessionFieldValues,
        stored: SessionFieldValues,
    ): SessionFieldValues => {
        const freshEdition =
            queryClient.getQueryData(qof.edition.get(editionId).queryKey)?.edition ?? edition;

        return freshEdition.sessionFieldOptions.track === undefined
            ? { ...rebased, track: stored.track }
            : rebased;
    };

    // The props may still hold the session from before the refusal's refetch,
    // so the fresh copy comes from the cache, and only if a copy landed after
    // the save began, which a failed refetch leaves the cache without: an older
    // copy would undo what the last save stored.
    // What the user left alone then follows it, the type and track above all,
    // so the questions the form holds match the ones the API judges.
    const rebaseOntoRefetched = (submittedAt: number) => {
        const sessionKey = qof.session.get(editionId, sessionId).queryKey;
        const refetched = queryClient.getQueryState(sessionKey)?.dataUpdatedAt ?? 0;
        const freshSession = queryClient.getQueryData(sessionKey);

        if (freshSession === undefined || refetched < submittedAt) {
            return;
        }

        const fresh = seedFrom(
            freshSession,
            queryClient.getQueryData(qof.customField.list(editionId).queryKey) ?? customFields,
        );
        const rebased = rebaseChanges(seed.values, fresh.values, form.getValues(), ["responses"]);
        setSeed(fresh);
        form.reset(fresh.values);
        form.reset(withStoredTrackIfUnasked(rebased, fresh.values), { keepDefaultValues: true });
    };

    const handleSubmit = (values: SessionTransformedValues) => {
        const submittedAt = Temporal.Now.instant().epochMilliseconds;
        const submitted = snapshotValues(form.getValues());
        const changes = changedFields(seed.values, submitted);

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
                onSuccess: (updated) => {
                    enqueueSnackbar("The session has been updated", { variant: "success" });
                    // From the answer rather than from what was sent: attaching
                    // a file swaps its temporary key for a stored one, and the
                    // next save is measured against what is stored.
                    const next = seedFrom(
                        updated,
                        queryClient.getQueryData(qof.customField.list(editionId).queryKey) ??
                            customFields,
                    );
                    const rebased = rebaseChanges(submitted, next.values, form.getValues(), [
                        "responses",
                    ]);
                    setSeed(next);
                    form.reset(next.values);
                    form.reset(withStoredTrackIfUnasked(rebased, next.values), {
                        keepDefaultValues: true,
                    });
                },
                onError: (error) => {
                    defaultMutationErrorHandler(error);
                    recoverMissingUpload(form, error);

                    if (error instanceof StaleFormError) {
                        rebaseOntoRefetched(submittedAt);
                    }
                },
            },
        );
    };

    return (
        <UploadTrackerContext value={uploadTracker}>
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
                        specs={specs}
                        sessionTypes={sessionTypes}
                        tracks={tracks}
                        uploadLimits={uploadLimits}
                        fieldNames={fieldNames}
                        assigned={{ sessionType: session.sessionType, track: session.track }}
                    />

                    {proposalCustomFields.length > 0 && (
                        <SessionCustomFields
                            control={form.control}
                            customFields={proposalCustomFields}
                            uploadLimits={uploadLimits}
                        />
                    )}

                    {frozenCustomFields.length > 0 && (
                        <Stack spacing={2}>
                            <Typography variant="h6">Frozen questions</Typography>
                            <SessionAnswers
                                editionId={edition.id}
                                customFields={frozenCustomFields}
                                responses={session.responses}
                            />
                        </Stack>
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
