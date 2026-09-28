import { Paper, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocale } from "#/components/LocaleProvider/index.js";
import { sessionStateLabels } from "#/components/SessionStateChip.tsx";
import { useQueryOptionsFactory } from "#/queries";

type TransitionHistoryProps = {
    editionId: string;
    sessionId: string;
};

/**
 * Render only for a host of this session or a manager, who are served the history.
 *
 * Every route that mounts it primes the same query behind the same condition,
 * so this resolves from the cache rather than suspending.
 */
export const TransitionHistory = ({ editionId, sessionId }: TransitionHistoryProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const { mediumDateTimeFormatter } = useLocale();
    const transitions = useSuspenseQuery(qof.session.transitions(editionId, sessionId)).data;

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                History
            </Typography>

            {transitions.length === 0 ? (
                <Typography variant="body2">This session has not been moved yet.</Typography>
            ) : (
                <Stack spacing={2}>
                    {transitions.map((transition) => (
                        <Stack key={transition.id} spacing={0.5}>
                            <Typography variant="body2">
                                {sessionStateLabels[transition.fromState]} to{" "}
                                {sessionStateLabels[transition.toState]}
                                {transition.actor === null
                                    ? ""
                                    : ` by ${transition.actor.displayName}`}
                                , {mediumDateTimeFormatter.format(transition.createdAt)}
                            </Typography>
                            {transition.note !== null && (
                                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                    {transition.note}
                                </Typography>
                            )}
                        </Stack>
                    ))}
                </Stack>
            )}
        </Paper>
    );
};
