import { Button, Paper, Stack } from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useMemo } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import {
    buildResponseValues,
    createResponseDefaultValues,
} from "#/components/CustomFieldInput/index.js";
import {
    recoverMissingUpload,
    UploadTrackerContext,
    UploadWaitHint,
    useUploadTracker,
} from "#/components/FileUploadField/index.js";
import { ButtonLink } from "#/components/Link/index.js";
import {
    applicableCustomFields,
    buildSessionAttributes,
    createSessionSchema,
    proposalFields,
    SessionBuiltInFields,
    SessionCustomFields,
    type SessionFieldValues,
    type SessionTransformedValues,
} from "#/components/SessionFormFields/index.js";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useCreateSessionMutation } from "#/mutations/session.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import type { Edition, SessionFieldSpec, UploadLimits } from "#/queries/edition.ts";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { defaultMutationErrorHandler, reportingErrors } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";

type SessionCreateFormProps = {
    editionId: string;
    edition: Edition;
    specs: Record<string, SessionFieldSpec>;
    fieldNames: string[];
    sessionTypes: SessionType[];
    tracks: Track[];
    customFields: CustomField[];
    uploadLimits: UploadLimits;
};

/**
 * Files a session that nobody hosts yet.
 *
 * An organizer adding a late keynote has no profile to complete and does not
 * become its speaker, so this sends `selfService: false` and the session
 * arrives with no hosts. Inviting one is the next step, on the session's own
 * page.
 */
export const SessionCreateForm = ({
    editionId,
    edition,
    specs,
    fieldNames,
    sessionTypes,
    tracks,
    customFields,
    uploadLimits,
}: SessionCreateFormProps): ReactNode => {
    const navigate = useNavigate();
    const createMutation = useCreateSessionMutation();
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

    const form = useForm<SessionFieldValues, unknown, SessionTransformedValues>({
        resolver,
        defaultValues: {
            sessionType: sessionTypes.find((sessionType) => sessionType.selectionDefault),
            responses: createResponseDefaultValues(proposalFields(customFields)),
        },
    });
    const leaveGuard = useLeaveGuard(form);

    const sessionType = useWatch({ control: form.control, name: "sessionType" });
    const track = useWatch({ control: form.control, name: "track" });
    const { open: openCustomFields } = useFreezeSplit(customFields);
    const proposalCustomFields = useMemo(
        () =>
            applicableCustomFields(openCustomFields, {
                sessionTypeId: sessionType?.id,
                trackId: track?.id,
            }),
        [openCustomFields, sessionType, track],
    );

    const handleSubmit = (values: SessionTransformedValues) => {
        createMutation.mutate(
            {
                editionId,
                attributes: buildSessionAttributes(edition, values),
                sessionType: values.sessionType,
                track: values.track,
                responses: buildResponseValues(proposalCustomFields, values.responses),
                selfService: false,
            },
            {
                onSuccess: (sessionId) => {
                    enqueueSnackbar("Session has been created", { variant: "success" });
                    leaveGuard.release();
                    void navigate({
                        to: "/manage/$editionId/sessions/$sessionId",
                        params: { editionId, sessionId },
                    });
                },
                onError: (error) => {
                    defaultMutationErrorHandler(error);
                    recoverMissingUpload(form, error);
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
                    />

                    {proposalCustomFields.length > 0 && (
                        <SessionCustomFields
                            control={form.control}
                            customFields={proposalCustomFields}
                            uploadLimits={uploadLimits}
                        />
                    )}

                    <Stack
                        direction="row"
                        spacing={2}
                        sx={{ justifyContent: "flex-end", alignItems: "center" }}
                    >
                        <UploadWaitHint uploading={uploading} action="create" />
                        <ButtonLink to="/manage/$editionId/sessions" params={{ editionId }}>
                            Cancel
                        </ButtonLink>

                        <Button
                            type="submit"
                            variant="contained"
                            loading={createMutation.isPending}
                            disabled={uploading}
                        >
                            Create session
                        </Button>
                    </Stack>
                </Stack>
            </Paper>
        </UploadTrackerContext>
    );
};
