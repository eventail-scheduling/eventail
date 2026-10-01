import AddIcon from "@mui/icons-material/Add";
import { List, ListItemText, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ButtonLink, ListItemButtonLink } from "#/components/Link/index.js";
import { SessionStateChip } from "#/components/SessionStateChip.tsx";
import { useDeadlinePassed } from "#/hooks/useDeadlinePassed.ts";
import { useQueryOptionsFactory } from "#/queries";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;
    const deadlinePassed = useDeadlinePassed(edition);
    const sessions = useSuspenseQuery(qof.session.mine(editionId)).data;

    return (
        <Stack spacing={2} sx={{ mt: 2 }}>
            {/* A phone has no room for the heading and both actions on one
                line: all three wrap mid-word. The actions keep their own row
                and move under the heading instead. */}
            <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ alignItems: { sm: "center" } }}
            >
                <Typography variant="h5" sx={{ mr: { sm: "auto" } }}>
                    Your sessions
                </Typography>

                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                    <ButtonLink to="/editions/$editionId/profile" params={{ editionId }}>
                        Your profile
                    </ButtonLink>

                    {!deadlinePassed && (
                        <ButtonLink
                            variant="contained"
                            startIcon={<AddIcon />}
                            to="/editions/$editionId/sessions/create"
                            params={{ editionId }}
                        >
                            Submit a session
                        </ButtonLink>
                    )}
                </Stack>
            </Stack>

            {sessions.length === 0 ? (
                <Paper sx={{ p: 3 }}>
                    <Typography color="text.secondary">
                        {deadlinePassed
                            ? `Submissions for ${edition.name} have closed.`
                            : `You have not submitted anything to ${edition.name} yet.`}
                    </Typography>
                </Paper>
            ) : (
                <Paper>
                    <List disablePadding>
                        {sessions.map((session) => (
                            <ListItemButtonLink
                                key={session.id}
                                to="/editions/$editionId/sessions/$sessionId"
                                params={{ editionId, sessionId: session.id }}
                                sx={{ gap: 2 }}
                            >
                                <ListItemText
                                    primary={session.title}
                                    secondary={session.sessionType.name}
                                />
                                <SessionStateChip size="small" state={session.state} />
                            </ListItemButtonLink>
                        ))}
                    </List>
                </Paper>
            )}
        </Stack>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId/sessions/")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.session.mine(params.editionId));
    },
});
