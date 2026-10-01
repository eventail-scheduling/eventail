import { Divider, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { PurgeReport } from "#/mutations/user-purge.ts";

/**
 * Both forms spelled out, because these do not all pluralize by adding an s.
 *
 * The kept line carries a verb that has to agree as well.
 */
type Line = {
    count: number;
    one: string;
    other: string;
};

const removedLines = (report: PurgeReport): Line[] => [
    {
        count: report.responses,
        one: "response to a profile custom field",
        other: "responses to profile custom fields",
    },
    { count: report.teamMemberships, one: "team membership", other: "team memberships" },
    { count: report.teamInvites, one: "pending team invite", other: "pending team invites" },
    {
        count: report.sessionHostInvites,
        one: "pending session host invite",
        other: "pending session host invites",
    },
    { count: report.pendingMails, one: "unsent email", other: "unsent emails" },
];

type CountListProps = {
    lines: Line[];
};

const CountList = ({ lines }: CountListProps): ReactNode => (
    <List dense disablePadding>
        {lines.map(({ count, one, other }) => (
            <ListItem key={other} disableGutters disablePadding>
                <ListItemText primary={`${count} ${count === 1 ? one : other}`} />
            </ListItem>
        ))}
    </List>
);

type PurgeReportCardProps = {
    emailAddress: string;
    report: PurgeReport;
    /** The same report describes a plan before the erase and a record after it. */
    erased: boolean;
};

export const PurgeReportCard = ({
    emailAddress,
    report,
    erased,
}: PurgeReportCardProps): ReactNode => (
    <Stack spacing={2} divider={<Divider />}>
        <div>
            <Typography variant="subtitle1">{emailAddress}</Typography>
            <Typography variant="body2">
                {report.displayNames.length === 0
                    ? "No account holds this address."
                    : `${report.displayNames.length} ${
                          report.displayNames.length === 1 ? "account" : "accounts"
                      }: ${report.displayNames.join(", ")}`}
            </Typography>
        </div>

        <div>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {erased ? "Removed" : "Will be removed"}
            </Typography>
            <CountList lines={removedLines(report)} />
        </div>

        <div>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {erased ? "Kept, without them" : "Will be kept, without them"}
            </Typography>
            <CountList
                lines={[
                    {
                        count: report.hostedSessions,
                        one: erased
                            ? "session, which lost the host"
                            : "session, which loses the host",
                        other: erased
                            ? "sessions, which lost the host"
                            : "sessions, which lose the host",
                    },
                ]}
            />
            <Typography variant="body2" sx={{ mt: 1 }}>
                Status changes keep their record and forget who made them.
            </Typography>
        </div>
    </Stack>
);
