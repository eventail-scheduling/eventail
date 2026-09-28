import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DefaultValues, type Resolver, useForm, useWatch } from "react-hook-form";
import {
    buildResponseValues,
    createResponseDefaultValues,
    knownResponses,
} from "#/components/CustomFieldInput/index.js";
import {
    recoverMissingUpload,
    UploadTrackerContext,
    UploadWaitHint,
    useUploadTracker,
} from "#/components/FileUploadField/index.js";
import {
    noAvailability,
    useAvailabilityFollowsWindow,
} from "#/components/HostProfileForm/index.js";
import {
    applicableCustomFields,
    applicableHostFields,
    buildProfileChanges,
    buildSessionAttributes,
    buildSessionFormSteps,
    createProfileDefaultValues,
    createSessionSchema,
    firstInvalidStep,
    followingStepIndex,
    hostFields,
    offerable,
    ProfileBuiltInFields,
    proposalFields,
    SessionBuiltInFields,
    SessionCustomFields,
    type SessionFieldValues,
    type SessionTransformedValues,
    stepFieldNames,
} from "#/components/SessionFormFields/index.js";
import { useDeadlinePassed } from "#/hooks/useDeadlinePassed.ts";
import { useFreezeSplit } from "#/hooks/useFreezeSplit.ts";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";
import { useUpdateMeHostMutation } from "#/mutations/host.ts";
import { useCreateSessionMutation } from "#/mutations/session.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler, reportingErrors, StaleFormError } from "#/utils/api.ts";
import type { AvailabilityInterval } from "#/utils/availability.js";
import { changedFields, changesWithin } from "#/utils/changed-fields.ts";
import { fulfillsRole } from "#/utils/role.ts";
import { formResolver } from "#/utils/zod.js";
import { SessionStepper } from "./-components/SessionStepper.js";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const navigate = useNavigate();
    const { edition, sessionFieldSpecs, profileFieldSpecs, uploadLimits } = useSuspenseQuery(
        qof.edition.get(editionId),
    ).data;
    const customFields = useSuspenseQuery(qof.customField.list(editionId)).data;
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const servedSessionTypes = useSuspenseQuery(qof.sessionType.list(editionId)).data;
    const servedTracks = useSuspenseQuery(qof.track.list(editionId)).data;
    const isManager = fulfillsRole(currentUser, "manager");
    const sessionTypes = offerable(servedSessionTypes, isManager);
    const tracks = offerable(servedTracks, isManager);
    const host = useSuspenseQuery(qof.host.mine(editionId)).data;
    const deadlinePassed = useDeadlinePassed(edition);
    const createMutation = useCreateSessionMutation();
    const updateHostMutation = useUpdateMeHostMutation();
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

    const resolver = useCallback<Resolver<SessionFieldValues, unknown, SessionTransformedValues>>(
        (values, context, options) => {
            const schema = createSessionSchema(
                edition,
                applicableCustomFields(customFields, {
                    sessionTypeId: values.sessionType?.id,
                    trackId: values.track?.id,
                }),
                hostCustomFields,
            );

            return formResolver(schema)(values, context, options);
        },
        [edition, customFields, hostCustomFields],
    );

    const [seededHost, setSeededHost] = useState(host);
    const [seed, setSeed] = useState<DefaultValues<SessionFieldValues>>(() => ({
        sessionType: sessionTypes.find((sessionType) => sessionType.selectionDefault),
        responses: createResponseDefaultValues(proposalFields(customFields)),
        profile: createProfileDefaultValues({ host, hostCustomFields: hostFields(customFields) }),
    }));
    const form = useForm<SessionFieldValues, unknown, SessionTransformedValues>({
        resolver,
        defaultValues: seed,
    });
    const leaveGuard = useLeaveGuard(form);
    const latestSeed = useRef(seed);
    latestSeed.current = seed;
    const followsWindow = useAvailabilityFollowsWindow({
        edition,
        seededAvailability: () =>
            (latestSeed.current.profile?.availability ?? noAvailability) as AvailabilityInterval[],
        currentAvailability: () => form.getValues("profile.availability") ?? noAvailability,
        settleAvailability: (intervals) => {
            latestSeed.current = {
                ...latestSeed.current,
                profile: { ...latestSeed.current.profile, availability: intervals },
            };
            setSeed(latestSeed.current);
            form.resetField("profile.availability", { defaultValue: intervals });
            // resetField does nothing for a field not yet registered, and this
            // one registers only once the speaker reaches the profile step.
            form.setValue("profile.availability", intervals);
        },
    });

    const sessionType = useWatch({ control: form.control, name: "sessionType" });
    const track = useWatch({ control: form.control, name: "track" });
    const proposalCustomFields = useMemo(
        () =>
            applicableCustomFields(openCustomFields, {
                sessionTypeId: sessionType?.id,
                trackId: track?.id,
            }),
        [openCustomFields, sessionType, track],
    );

    const steps = useMemo(
        () =>
            buildSessionFormSteps({
                edition,
                specs: sessionFieldSpecs,
                profileSpecs: profileFieldSpecs,
                customFields: proposalCustomFields,
                hostCustomFields,
            }),
        [edition, sessionFieldSpecs, profileFieldSpecs, proposalCustomFields, hostCustomFields],
    );

    // Held by path, since a refetch can insert a step ahead of the speaker and
    // shift what every later position shows. A refetch or a freeze can also
    // take away the step they stand on; they move on to the one that followed
    // it, and the path moves with them so the step coming back does not pull
    // them back.
    const [requestedPath, setRequestedPath] = useState<string | undefined>(undefined);
    const requestedIndex =
        requestedPath === undefined ? 0 : steps.findIndex((step) => step.path === requestedPath);
    const activeStep =
        requestedIndex === -1 ? followingStepIndex(steps, requestedPath) : requestedIndex;

    if (requestedIndex === -1) {
        setRequestedPath(steps[activeStep]?.path);
    }

    const currentStep = steps[activeStep];
    const isLastStep = activeStep === steps.length - 1;

    const goToStep = (step: number) => {
        setRequestedPath(steps[step]?.path ?? requestedPath);
        window.scrollTo({ top: 0 });
    };

    // Submit renders only on the last step, so a field that fails elsewhere
    // would otherwise leave it doing nothing with no sign of why. The step the
    // user submitted from stays put when it is still the one on screen:
    // scrolling to its top would move away from a field that cannot take
    // focus, such as the availability grid. A refresh can insert a step and
    // change what the same position shows, so the step is told by its path.
    const submittedFrom = useRef<string | undefined>(undefined);
    const goToFirstInvalidStep = () => {
        const index = firstInvalidStep(
            steps,
            (name) => form.getFieldState(name as Parameters<typeof form.getFieldState>[0]).invalid,
        );

        if (index === -1) {
            return;
        }

        if (index !== activeStep || steps[index]?.path !== submittedFrom.current) {
            goToStep(index);
        }
    };

    // A refusal's refetch, when it lands, has reached the cache by the time it
    // is reported, but the resolver and the steps only pick it up on the next
    // render, so validating right away would still check the old questions.
    const [revalidating, setRevalidating] = useState(false);

    useEffect(() => {
        if (!revalidating) {
            return;
        }

        setRevalidating(false);
        void form.trigger().then((valid) => {
            if (!valid) {
                goToFirstInvalidStep();
            }
        });
    });

    const reportRefusal = (error: unknown, pathPrefix: string) => {
        defaultMutationErrorHandler(error);

        if (error instanceof StaleFormError) {
            setRevalidating(true);
        }

        if (recoverMissingUpload(form, error, pathPrefix)) {
            goToFirstInvalidStep();
        }
    };

    const handleNext = async () => {
        if (!currentStep || uploading) {
            return;
        }

        const valid = await form.trigger(
            stepFieldNames(currentStep) as Parameters<typeof form.trigger>[0],
            {
                shouldFocus: true,
            },
        );

        if (valid) {
            goToStep(activeStep + 1);
        }
    };

    // The profile goes first because the API refuses the session until it is
    // there.
    const handleSubmit = async ({ profile, ...values }: SessionTransformedValues) => {
        submittedFrom.current = currentStep?.path;

        try {
            if (profile) {
                const updatedHost = await updateHostMutation.mutateAsync({
                    editionId,
                    ...buildProfileChanges(
                        edition,
                        hostCustomFields,
                        profile,
                        changesWithin(changedFields(seed, form.getValues()), "profile"),
                        knownResponses(host.responses, seededHost.responses),
                        frozenHostCustomFields,
                    ),
                });
                // The write consumed any fresh upload, so if the create below
                // fails, the retry has to measure the profile against what the
                // write stored, or it sends the consumed key again.
                const profileSeed = createProfileDefaultValues({
                    host: updatedHost,
                    hostCustomFields: hostFields(customFields),
                });
                latestSeed.current = { ...latestSeed.current, profile: profileSeed };
                setSeed(latestSeed.current);
                setSeededHost(updatedHost);
                form.resetField("profile", { defaultValue: profileSeed });
            }
        } catch (error) {
            followsWindow.reportRefusal(error, (refused) => reportRefusal(refused, "profile."));

            return;
        }

        createMutation.mutate(
            {
                editionId,
                attributes: buildSessionAttributes(edition, values),
                sessionType: values.sessionType,
                track: values.track,
                responses: buildResponseValues(proposalCustomFields, values.responses),
                selfService: true,
            },
            {
                onSuccess: (sessionId) => {
                    enqueueSnackbar("Your session has been submitted", { variant: "success" });
                    leaveGuard.release();
                    void navigate({
                        to: "/editions/$editionId/sessions/$sessionId",
                        params: { editionId, sessionId },
                    });
                },
                onError: (error) => reportRefusal(error, ""),
            },
        );
    };

    if (deadlinePassed) {
        return (
            <Alert severity="info" sx={{ mt: 2 }}>
                Submissions for {edition.name} have closed.
            </Alert>
        );
    }

    return (
        <UploadTrackerContext value={uploadTracker}>
            <Box sx={{ mb: 2, mt: 2 }}>
                <Typography variant="h5">Submit a session</Typography>
            </Box>

            <Paper
                component="form"
                noValidate
                onSubmit={(event) => {
                    // Enter in a step's only text input submits the form, which
                    // would write the profile and file the session from a step
                    // before the profile. It moves on instead, as Next does.
                    if (!isLastStep) {
                        event.preventDefault();
                        void handleNext();
                        return;
                    }

                    void form.handleSubmit(reportingErrors(handleSubmit), () => {
                        submittedFrom.current = currentStep?.path;
                        goToFirstInvalidStep();
                    })(event);
                }}
                sx={{ p: 3 }}
            >
                <SessionStepper steps={steps} activeStep={activeStep} />

                <Stack spacing={3}>
                    {currentStep?.scope === "session" && (
                        <SessionBuiltInFields
                            control={form.control}
                            edition={edition}
                            specs={sessionFieldSpecs}
                            sessionTypes={sessionTypes}
                            tracks={tracks}
                            uploadLimits={uploadLimits}
                            fieldNames={stepFieldNames(currentStep)}
                        />
                    )}

                    {currentStep?.scope === "customFields" &&
                        currentStep.groups.map((group) => (
                            <Stack key={group.target} spacing={2}>
                                <Typography variant="h6">{group.heading}</Typography>

                                {group.target === "per_host" && (
                                    <Typography variant="body2" color="text.secondary">
                                        Answered once for {edition.name}, not for this session.
                                    </Typography>
                                )}

                                <SessionCustomFields
                                    control={form.control}
                                    customFields={
                                        group.target === "per_host"
                                            ? hostCustomFields
                                            : proposalCustomFields
                                    }
                                    uploadLimits={uploadLimits}
                                    pathPrefix={group.target === "per_host" ? "profile." : ""}
                                />
                            </Stack>
                        ))}

                    {currentStep?.scope === "profile" && (
                        <Box inert={updateHostMutation.isPending}>
                            <ProfileBuiltInFields
                                control={form.control}
                                edition={edition}
                                specs={profileFieldSpecs}
                                uploadLimits={uploadLimits}
                                fieldNames={stepFieldNames(currentStep)}
                            />
                        </Box>
                    )}

                    <Stack
                        direction="row"
                        spacing={2}
                        sx={{ justifyContent: "flex-end", alignItems: "center" }}
                    >
                        <UploadWaitHint
                            uploading={uploading}
                            action={isLastStep ? "submit" : "change steps"}
                        />
                        <Button
                            onClick={() => {
                                goToStep(activeStep - 1);
                            }}
                            disabled={activeStep === 0 || updateHostMutation.isPending || uploading}
                        >
                            Back
                        </Button>

                        {/*
                         * Keyed apart so React replaces the element rather
                         * than reusing it. Advancing onto the last step turns
                         * this button into a submit while the click that
                         * advanced is still propagating, and a reused node
                         * would receive it as one.
                         */}
                        {isLastStep ? (
                            <Button
                                key="submit"
                                type="submit"
                                variant="contained"
                                loading={createMutation.isPending || updateHostMutation.isPending}
                                disabled={uploading}
                            >
                                Submit session
                            </Button>
                        ) : (
                            <Button
                                key="next"
                                variant="contained"
                                onClick={() => void handleNext()}
                                disabled={uploading}
                            >
                                Next
                            </Button>
                        )}
                    </Stack>
                </Stack>
            </Paper>
        </UploadTrackerContext>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId/sessions/create")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.host.mine(params.editionId));
    },
});
