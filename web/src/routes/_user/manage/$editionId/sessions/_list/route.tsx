import {
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
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { useQueryOptionsFactory } from "#/queries";
import type { SessionPageCursor } from "#/queries/session.ts";
import { fulfillsRole } from "#/utils/role.ts";
import { SessionFilters } from "../-components/SessionFilters.tsx";
import { SessionRow } from "../-components/SessionRow.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const qof = useQueryOptionsFactory();
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const page = useSuspenseQuery(
        qof.session.list(
            editionId,
            {
                state: search.state,
                search: search.search,
                sessionType: search.sessionType,
                track: search.track,
            },
            { after: search.after, before: search.before },
        ),
    ).data;

    const goTo = (cursor: SessionPageCursor) => {
        void navigate({ search: (previous) => ({ ...previous, ...cursor }) });
    };

    // `total` counts what the filters matched across every page, so it tells an
    // unfiltered edition from a filter that caught nothing, and neither of those
    // from a page whose rows have moved out from under a cursor.
    const filtered =
        (search.state ?? []).length > 0 ||
        search.search !== undefined ||
        search.sessionType !== undefined ||
        search.track !== undefined;

    const emptyMessage =
        page.total > 0
            ? "No sessions on this page anymore."
            : filtered
              ? "No session matches these filters."
              : "There are no sessions.";

    return (
        <>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    Sessions
                </Typography>

                {fulfillsRole(currentUser, "manager") && (
                    <ButtonLink
                        variant="contained"
                        to="/manage/$editionId/sessions/create"
                        params={{ editionId }}
                    >
                        Add session
                    </ButtonLink>
                )}
            </Stack>

            <SessionFilters />

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            {/* Only the title grows. The rest hold a word or two
                                whatever the edition, so fixing them keeps the
                                columns from shifting as a reader pages. */}
                            <TableCell>Title</TableCell>
                            <TableCell sx={{ width: 140 }}>State</TableCell>
                            <TableCell sx={{ width: 180 }}>Type</TableCell>
                            <TableCell sx={{ width: 180 }}>Track</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {page.sessions.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4}>{emptyMessage}</TableCell>
                            </TableRow>
                        )}
                        {page.sessions.map((session) => (
                            <SessionRow key={session.id} editionId={editionId} session={session} />
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Nothing matched, so the empty message above says it and a count of
                zero beside three dead buttons only repeats it. A page that is
                empty while the match is not still gets these, since First is the
                way back. */}
            {page.total > 0 && (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 2 }}>
                    <Typography variant="body2" sx={{ mr: "auto" }}>
                        {page.total === 1 ? "1 session" : `${page.total} sessions`}
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

export const Route = createFileRoute("/_user/manage/$editionId/sessions/_list")({
    component: Root,
    loaderDeps: ({ search }) => search,
    loader: async ({ context, params, deps }) => {
        await context.queryClient.ensureQueryData(
            context.qof.session.list(
                params.editionId,
                {
                    state: deps.state,
                    search: deps.search,
                    sessionType: deps.sessionType,
                    track: deps.track,
                },
                { after: deps.after, before: deps.before },
            ),
        );
    },
});
