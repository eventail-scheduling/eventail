import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useMemo } from "react";
import {
    recoverMissingUpload,
    UploadTrackerContext,
    UploadWaitHint,
    useUploadTracker,
} from "#/components/FileUploadField/index.js";
import {
    HostProfileFields,
    noAvailability,
    useAvailabilityFollowsWindow,
    useHostProfileForm,
} from "#/components/HostProfileForm/index.js";
import {
    applicableHostFields,
    buildProfileChanges,
    hostFields,
    type ProfileFormTransformedValues,
} from "#/components/SessionFormFields/index.js";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateMeHostMutation } from "#/mutations/host.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler, reportingErrors } from "#/utils/api.ts";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition, profileFieldSpecs, uploadLimits } = useSuspenseQuery(
        qof.edition.get(editionId),
    ).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const host = useSuspenseQuery(qof.host.mine(editionId)).data;
    const updateMutation = useUpdateMeHostMutation();
    const { uploadTracker, uploading } = useUploadTracker();

    const { open: openCustomFields, frozen: closedCustomFields } = useFreezeSplit(customFields);
    const hostCustomFields = useMemo(
        () => applicableHostFields(openCustomFields),
        [openCustomFields],
    );
    const frozenHostCustomFields = useMemo(
        () => hostFields(closedCustomFields),
        [closedCustomFields],
    );
    const {
        form,
        changes,
        storedResponses,
        snapshot,
        reseed,
        seededAvailability,
        settleAvailability,
    } = useHostProfileForm({
        edition,
        customFields,
        hostCustomFields,
        host,
    });
    useLeaveGuard(form);
    const { reportRefusal } = useAvailabilityFollowsWindow({
        edition,
        seededAvailability,
        currentAvailability: () => form.getValues("profile.availability") ?? noAvailability,
        settleAvailability,
    });

    const handleSubmit = ({ profile }: ProfileFormTransformedValues) => {
        const submitted = snapshot();

        updateMutation.mutate(
            {
                editionId,
                ...buildProfileChanges(
                    edition,
                    hostCustomFields,
                    profile,
                    changes(),
                    storedResponses(),
                    frozenHostCustomFields,
                ),
            },
            {
                onSuccess: (updated) => {
                    enqueueSnackbar("Your profile has been saved", { variant: "success" });
                    reseed(updated, submitted);
                },
                onError: (error) => {
                    reportRefusal(error, defaultMutationErrorHandler);
                    recoverMissingUpload(form, error, "profile.");
                },
            },
        );
    };

    return (
        <UploadTrackerContext value={uploadTracker}>
            <Box sx={{ mb: 2, mt: 2 }}>
                <Typography variant="h5">Your profile for {edition.name}</Typography>
                <Typography color="text.secondary">
                    Given once for the edition rather than with each session.
                </Typography>
            </Box>

            <Paper
                component="form"
                noValidate
                onSubmit={form.handleSubmit(reportingErrors(handleSubmit))}
                sx={{ p: 3 }}
            >
                <Stack spacing={3}>
                    <HostProfileFields
                        control={form.control}
                        edition={edition}
                        profileFieldSpecs={profileFieldSpecs}
                        uploadLimits={uploadLimits}
                        hostCustomFields={hostCustomFields}
                    />

                    <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                        <Button
                            type="submit"
                            variant="contained"
                            loading={updateMutation.isPending}
                            disabled={!form.formState.isDirty || uploading}
                        >
                            Save profile
                        </Button>
                        <UploadWaitHint uploading={uploading} />
                    </Stack>
                </Stack>
            </Paper>
        </UploadTrackerContext>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId/profile")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.host.mine(params.editionId));
    },
});
