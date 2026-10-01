import { Alert, Button, Stack } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
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

/**
 * Keeps a refetch from changing the form under someone filling it.
 *
 * A focus refetch that brings back a changed edition, field set or host
 * rebuilds the resolver and the field list mid-entry. A save or an acceptance
 * refused because the form was out of date refetches those queries on purpose
 * instead.
 */
const heldWhileFilling = { staleTime: Number.POSITIVE_INFINITY };

type CompleteHostProfileProps = {
    editionId: string;
    isAccepting: boolean;
    onSaved: () => void;
};

/**
 * Asks for the profile this edition holds, in place of the accept button.
 *
 * Shown on every acceptance rather than only on a refusal, because the values
 * are a copy taken per edition: a host who has never seen them here has never
 * been given the chance to say how they want to appear at this one.
 *
 * Saving and accepting are two requests rather than one, so an acceptance that
 * fails after the save leaves the profile written. That costs the user nothing:
 * the profile is theirs either way, and the invite stays unspent.
 */
export const CompleteHostProfile = ({
    editionId,
    isAccepting,
    onSaved,
}: CompleteHostProfileProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const { edition, profileFieldSpecs, uploadLimits } = useSuspenseQuery({
        ...qof.edition.get(editionId),
        ...heldWhileFilling,
    }).data;
    const customFields = useSuspenseQuery({
        ...qof.customField.list(editionId),
        ...heldWhileFilling,
    }).data;
    const host = useSuspenseQuery({ ...qof.host.mine(editionId), ...heldWhileFilling }).data;
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
                    // Before handing on: whatever the caller does next may fail
                    // and leave this form mounted, and attaching a file has
                    // consumed the temporary key the values still hold.
                    reseed(updated, submitted);
                    onSaved();
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
            <Stack
                component="form"
                noValidate
                onSubmit={form.handleSubmit(reportingErrors(handleSubmit))}
                spacing={3}
                sx={{ width: "100%" }}
            >
                <Alert severity="info">
                    {`Check how you appear at ${edition.name}. Each event keeps its own copy of these details.`}
                </Alert>

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
                        loading={updateMutation.isPending || isAccepting}
                        disabled={uploading}
                    >
                        Save and accept
                    </Button>
                    <UploadWaitHint uploading={uploading} />
                </Stack>
            </Stack>
        </UploadTrackerContext>
    );
};
