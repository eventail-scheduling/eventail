import { JsonApiError } from "@jsonapi-serde/client";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Stack,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocale } from "#/components/LocaleProvider/index.js";
import { useGoBack } from "#/hooks/useGoBack.ts";
import { usePollWhileProcessing } from "#/hooks/usePollWhileProcessing.ts";
import { useCancelJobMutation, useRetryJobMutation } from "#/mutations/job.ts";
import { useQueryOptionsFactory } from "#/queries";
import type { JobState } from "#/queries/job.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { JobStateChip } from "../-components/JobStateChip.tsx";

const retryableStates: readonly JobState[] = ["discarded", "canceled"];
const cancelableStates: readonly JobState[] = ["available", "scheduled", "retryable"];

/**
 * The states a worker is about to settle or is settling now.
 *
 * Scheduled and retrying jobs wait on a clock that can run for minutes, so
 * polling them inside the deadline would only cost requests.
 */
const inFlightStates: readonly JobState[] = ["available", "running"];

type TimelineEntry = {
    label: string;
    at: Temporal.Instant | null;
};

const Root = (): ReactNode => {
    const { jobId } = Route.useParams();
    const search = Route.useSearch();
    const [open, setOpen] = useState(true);
    const { goBack } = useGoBack({ to: "/jobs", search });
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const { mediumDateTimeSecondsFormatter } = useLocale();
    const qof = useQueryOptionsFactory();
    const pollWhileProcessing = usePollWhileProcessing();
    const job = useSuspenseQuery({
        ...qof.job.get(jobId),
        refetchInterval: (query) =>
            pollWhileProcessing(
                query.state.data !== undefined && inFlightStates.includes(query.state.data.state),
                jobId,
            ),
    }).data;
    const queryClient = useQueryClient();
    const shownState = useRef(job.state);

    // The mutation refreshes the list once, before the worker has settled
    // anything; the poll after it refetches this job alone.
    useEffect(() => {
        if (shownState.current === job.state) {
            return;
        }

        shownState.current = job.state;
        void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }, [job.state, queryClient]);

    const retryMutation = useRetryJobMutation();
    const cancelMutation = useCancelJobMutation();
    const busy = retryMutation.isPending || cancelMutation.isPending;

    const timeline: TimelineEntry[] = [
        { label: "Created", at: job.createdAt },
        { label: "Scheduled for", at: job.scheduledAt },
        { label: "Last attempted", at: job.attemptedAt },
        { label: "Finished", at: job.finalizedAt },
    ];

    const act = (mutation: typeof retryMutation, done: string) => {
        mutation.mutate(
            { jobId },
            {
                onSuccess: () => {
                    enqueueSnackbar(done, { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Dialog
            open={open}
            fullScreen={fullScreen}
            maxWidth="md"
            fullWidth
            onClose={() => {
                setOpen(false);
            }}
            slotProps={{
                transition: {
                    onExited: () => {
                        goBack();
                    },
                },
            }}
        >
            <DialogTitle>{job.summary}</DialogTitle>
            <DialogContent>
                <Stack spacing={2}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <JobStateChip state={job.state} />
                        <Typography variant="body2" color="text.secondary">
                            {job.attempt === 1 ? "1 attempt" : `${job.attempt.toString()} attempts`}
                        </Typography>
                    </Stack>

                    <Stack component="dl" spacing={0.5} sx={{ m: 0 }}>
                        {timeline.map(({ label, at }) => (
                            <Stack key={label} direction="row" spacing={1}>
                                <Typography
                                    component="dt"
                                    variant="body2"
                                    color="text.secondary"
                                    sx={{ width: 140, flexShrink: 0 }}
                                >
                                    {label}
                                </Typography>
                                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                                    {at === null
                                        ? "Not yet"
                                        : mediumDateTimeSecondsFormatter.format(at)}
                                </Typography>
                            </Stack>
                        ))}
                    </Stack>

                    <div>
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            Last error
                        </Typography>
                        {job.lastError === null ? (
                            <Typography variant="body2" color="text.secondary">
                                It has not failed.
                            </Typography>
                        ) : (
                            <Typography
                                variant="body2"
                                component="pre"
                                sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                            >
                                {job.lastError}
                            </Typography>
                        )}
                    </div>

                    <div>
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            Payload
                        </Typography>
                        <Typography
                            variant="body2"
                            component="pre"
                            sx={{
                                m: 0,
                                p: 1.5,
                                bgcolor: "action.hover",
                                borderRadius: 1,
                                overflowX: "auto",
                                fontFamily: "monospace",
                            }}
                        >
                            {JSON.stringify(job.payload, null, 2)}
                        </Typography>
                    </div>
                </Stack>
            </DialogContent>
            <DialogActions>
                {cancelableStates.includes(job.state) && (
                    <Button
                        color="error"
                        disabled={busy}
                        loading={cancelMutation.isPending}
                        onClick={() => {
                            act(cancelMutation, "Job has been canceled");
                        }}
                    >
                        Cancel job
                    </Button>
                )}
                {retryableStates.includes(job.state) && (
                    <Button
                        disabled={busy}
                        loading={retryMutation.isPending}
                        onClick={() => {
                            act(retryMutation, "Job has been queued again");
                        }}
                    >
                        Retry
                    </Button>
                )}
                <Button
                    onClick={() => {
                        setOpen(false);
                    }}
                >
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export const Route = createFileRoute("/_user/jobs/_list/$jobId")({
    component: Root,
    loader: async ({ context, params }) => {
        try {
            await context.queryClient.ensureQueryData(context.qof.job.get(params.jobId));
        } catch (error) {
            if (error instanceof JsonApiError && error.status === 404) {
                throw notFound();
            }

            throw error;
        }
    },
});
