import { Container, List, ListItemText, Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ListItemButtonLink } from "#/components/Link/index.js";
import { useLocale } from "#/components/LocaleProvider";
import { useQueryOptionsFactory } from "#/queries";
import { serverNow } from "#/utils/server-clock.ts";
import { groupEditions } from "./-utils/group-editions.js";

const Root = (): ReactNode => {
    const qof = useQueryOptionsFactory();
    const editions = useSuspenseQuery(qof.edition.list()).data;
    const { dateFormatter } = useLocale();
    const groups = groupEditions(editions, serverNow());

    return (
        <Container>
            <Stack spacing={3} sx={{ mt: 2 }}>
                <Typography variant="h5">Editions</Typography>

                {groups.length === 0 ? (
                    <Paper sx={{ p: 3 }}>
                        <Typography color="text.secondary">There are no editions yet.</Typography>
                    </Paper>
                ) : (
                    groups.map((group) => (
                        <Stack key={group.key} spacing={1}>
                            <Typography variant="subtitle2" color="text.secondary">
                                {group.heading}
                            </Typography>
                            <Paper>
                                <List disablePadding>
                                    {group.editions.map((edition) => (
                                        <ListItemButtonLink
                                            key={edition.id}
                                            to="/editions/$editionId/sessions"
                                            params={{ editionId: edition.id }}
                                        >
                                            <ListItemText
                                                primary={edition.name}
                                                secondary={dateFormatter.formatRange(
                                                    edition.startDate,
                                                    edition.endDate,
                                                )}
                                            />
                                        </ListItemButtonLink>
                                    ))}
                                </List>
                            </Paper>
                        </Stack>
                    ))
                )}
            </Stack>
        </Container>
    );
};

export const Route = createFileRoute("/_user/_public/")({
    component: Root,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(context.qof.edition.list());
    },
});
