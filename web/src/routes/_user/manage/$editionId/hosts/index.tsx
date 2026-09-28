import {
    Box,
    Button,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/mini";
import { DebouncedTextField } from "#/components/DebouncedTextField.js";
import { Link } from "#/components/Link/index.js";
import { useQueryOptionsFactory } from "#/queries";
import type { HostPageCursor } from "#/queries/host.ts";
import { fulfillsRole } from "#/utils/role.ts";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const qof = useQueryOptionsFactory();
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const page = useSuspenseQuery(
        qof.host.list(editionId, search.search, { after: search.after, before: search.before }),
    ).data;

    // Absent rather than empty for anyone below manager, so the column would be
    // a blank strip rather than an empty value.
    const showsEmail = fulfillsRole(currentUser, "manager");

    const goTo = (cursor: HostPageCursor) => {
        void navigate({ search: (previous) => ({ ...previous, ...cursor }) });
    };

    return (
        <>
            <Typography variant="h5" sx={{ mb: 2 }}>
                Hosts
            </Typography>

            <Box sx={{ mb: 2 }}>
                <DebouncedTextField
                    size="small"
                    label="Search hosts"
                    value={search.search}
                    onCommit={(value) => {
                        void navigate({
                            replace: true,
                            search: (previous) => ({
                                ...previous,
                                search: value,
                                after: undefined,
                                before: undefined,
                            }),
                        });
                    }}
                />
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            {showsEmail && <TableCell sx={{ width: 280 }}>Email</TableCell>}
                            <TableCell sx={{ width: 120 }}>Sessions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {page.hosts.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={showsEmail ? 3 : 2}>
                                    {page.total > 0
                                        ? "No hosts on this page anymore."
                                        : search.search === undefined
                                          ? "Nobody has a host record in this edition yet."
                                          : "No host matches that search."}
                                </TableCell>
                            </TableRow>
                        )}
                        {page.hosts.map((host) => (
                            <TableRow key={host.id}>
                                <TableCell sx={{ p: 0 }}>
                                    <Link
                                        to="/manage/$editionId/hosts/$hostId"
                                        params={{ editionId, hostId: host.id }}
                                        sx={{ display: "block", px: 2, py: 2 }}
                                    >
                                        {host.displayName}
                                    </Link>
                                </TableCell>
                                {showsEmail && <TableCell>{host.emailAddress}</TableCell>}
                                <TableCell>{host.$meta.sessionCount}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {page.total > 0 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 2 }}>
                    <Typography variant="body2" sx={{ mr: "auto" }}>
                        {page.total === 1 ? "1 host" : `${page.total.toString()} hosts`}
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
        </>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/hosts/")({
    component: Root,
    validateSearch: z.object({
        search: z.optional(z.string()),
        after: z.optional(z.string()),
        before: z.optional(z.string()),
    }),
    loaderDeps: ({ search }) => search,
    loader: async ({ context, params, deps }) => {
        await context.queryClient.ensureQueryData(
            context.qof.host.list(params.editionId, deps.search, {
                after: deps.after,
                before: deps.before,
            }),
        );
    },
});
