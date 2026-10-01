import {
    Autocomplete,
    Button,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Link } from "#/components/Link/index.js";
import { useLocale } from "#/components/LocaleProvider/index.js";
import { useQueryOptionsFactory } from "#/queries";
import { defaultJobStates, type JobPageCursor, jobStates, type ListJob } from "#/queries/job.ts";
import { JobStateChip, jobStateLabels } from "../-components/JobStateChip.tsx";

const lastActivity = (job: ListJob): Temporal.Instant =>
    job.finalizedAt ?? job.attemptedAt ?? job.createdAt;

const Root = (): ReactNode => {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const qof = useQueryOptionsFactory();
    const { mediumDateTimeFormatter } = useLocale();
    const states = search.state ?? defaultJobStates;
    const page = useSuspenseQuery(
        qof.job.list(states, { after: search.after, before: search.before }),
    ).data;

    const goTo = (cursor: JobPageCursor) => {
        void navigate({ search: (previous) => ({ ...previous, ...cursor }) });
    };

    return (
        <>
            <Typography variant="h5" sx={{ mb: 2 }}>
                Background jobs
            </Typography>

            <Autocomplete
                multiple
                disableCloseOnSelect
                size="small"
                options={jobStates}
                value={[...states]}
                getOptionLabel={(state) => jobStateLabels[state]}
                onChange={(_event, value) => {
                    void navigate({
                        replace: true,
                        search: (previous) => ({
                            ...previous,
                            state: value,
                            after: undefined,
                            before: undefined,
                        }),
                    });
                }}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label="State"
                        placeholder={states.length === 0 ? "All states" : undefined}
                    />
                )}
                sx={{ mb: 2 }}
            />

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Job</TableCell>
                            <TableCell sx={{ width: 120 }}>State</TableCell>
                            <TableCell sx={{ width: 90 }}>Attempts</TableCell>
                            <TableCell sx={{ width: 280 }}>Last error</TableCell>
                            <TableCell sx={{ width: 200 }}>Last activity</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {page.jobs.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    {page.total > 0
                                        ? "No jobs on this page anymore."
                                        : states.length === 0
                                          ? "There are no jobs."
                                          : "No job is in any of these states."}
                                </TableCell>
                            </TableRow>
                        )}
                        {page.jobs.map((job) => (
                            <TableRow key={job.id}>
                                <TableCell sx={{ p: 0 }}>
                                    <Link
                                        to="/jobs/$jobId"
                                        params={{ jobId: job.id }}
                                        search
                                        sx={{ display: "block", px: 2, py: 2 }}
                                    >
                                        {job.summary}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    <JobStateChip state={job.state} />
                                </TableCell>
                                <TableCell>{job.attempt}</TableCell>
                                <TableCell sx={{ maxWidth: 280 }}>
                                    <Typography
                                        variant="body2"
                                        noWrap
                                        title={job.lastError ?? undefined}
                                        sx={{
                                            color:
                                                job.lastError === null
                                                    ? "text.disabled"
                                                    : "text.primary",
                                        }}
                                    >
                                        {job.lastError ?? "None"}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    {mediumDateTimeFormatter.format(lastActivity(job))}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {page.total > 0 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 2 }}>
                    <Typography variant="body2" sx={{ mr: "auto" }}>
                        {page.total === 1 ? "1 job" : `${page.total.toString()} jobs`}
                    </Typography>
                    <Button
                        disabled={search.after === undefined && search.before === undefined}
                        onClick={() => {
                            goTo({ after: undefined, before: undefined });
                        }}
                    >
                        First
                    </Button>
                    <Button
                        disabled={page.before === null}
                        onClick={() => {
                            goTo({ after: undefined, before: page.before ?? undefined });
                        }}
                    >
                        Previous
                    </Button>
                    <Button
                        disabled={page.after === null}
                        onClick={() => {
                            goTo({ after: page.after ?? undefined, before: undefined });
                        }}
                    >
                        Next
                    </Button>
                </Stack>
            )}

            <Outlet />
        </>
    );
};

export const Route = createFileRoute("/_user/jobs/_list")({
    component: Root,
    loaderDeps: ({ search }) => search,
    loader: async ({ context, deps }) => {
        await context.queryClient.ensureQueryData(
            context.qof.job.list(deps.state ?? defaultJobStates, {
                after: deps.after,
                before: deps.before,
            }),
        );
    },
});
