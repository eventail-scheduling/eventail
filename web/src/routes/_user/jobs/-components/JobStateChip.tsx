import { Chip, type ChipProps } from "@mui/material";
import type { ReactNode } from "react";
import type { JobState } from "#/queries/job.ts";

export const jobStateLabels: Record<JobState, string> = {
    available: "Waiting",
    scheduled: "Scheduled",
    running: "Running",
    retryable: "Retrying",
    completed: "Completed",
    canceled: "Canceled",
    discarded: "Failed",
};

const jobStateColors: Record<JobState, ChipProps["color"]> = {
    available: "default",
    scheduled: "default",
    running: "info",
    retryable: "warning",
    completed: "success",
    canceled: "default",
    discarded: "error",
};

type JobStateChipProps = {
    state: JobState;
};

export const JobStateChip = ({ state }: JobStateChipProps): ReactNode => (
    <Chip size="small" label={jobStateLabels[state]} color={jobStateColors[state]} />
);
