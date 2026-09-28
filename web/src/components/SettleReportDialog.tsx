import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    List,
    ListItem,
    ListItemText,
    ListSubheader,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import type { ReactNode } from "react";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import type { SettledSession, SettleReport, SlotsSettleReport } from "#/queries/settle.js";

const sessionDetail = ({ slotsRemoved, slotsLeft }: SettledSession): string => {
    if (slotsLeft > 0) {
        const removed = slotsRemoved === 1 ? "was removed" : "were removed";
        const left = slotsLeft === 1 ? "is" : "are";

        return `${slotsRemoved} of its ${slotsRemoved + slotsLeft} slots ${removed}, and ${slotsLeft} ${left} still in the draft schedule.`;
    }

    return slotsRemoved === 1
        ? "Its slot was removed, and it is no longer in the draft schedule."
        : `All ${slotsRemoved} of its slots were removed, and it is no longer in the draft schedule.`;
};

const periods = (count: number): string => (count === 1 ? "period" : "periods");

type SettleReportDialogProps = {
    /**
     * A reversion's report carries sessions alone, an edition move's also availability.
     *
     * Both are read here rather than widened at the call site, since a reversion
     * genuinely does not touch availability and giving it zeroes would be a
     * claim rather than an absence.
     */
    report: SettleReport | SlotsSettleReport;
    /** What the organizer did, since the lists alone do not say. */
    lead: string;
    dialogProps: ControlledDialogProps;
};

/**
 * The only account anyone gets of what a change cost.
 *
 * Escape and a stray click outside are ignored: both are the paths where it is
 * closed unread.
 */
export const SettleReportDialog = ({
    report,
    lead,
    dialogProps,
}: SettleReportDialogProps): ReactNode => {
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const { sessions } = report;
    const trimmedAvailability = "trimmedAvailability" in report ? report.trimmedAvailability : 0;
    const droppedAvailability = "droppedAvailability" in report ? report.droppedAvailability : 0;

    return (
        <Dialog
            {...dialogProps}
            onClose={(_event, reason) => {
                if (reason === "backdropClick" || reason === "escapeKeyDown") {
                    return;
                }

                dialogProps.onClose();
            }}
            maxWidth="sm"
            fullWidth
            fullScreen={fullScreen}
        >
            <DialogTitle>What no longer fits</DialogTitle>
            <DialogContent dividers>
                <DialogContentText variant="body2">{lead}</DialogContentText>

                {sessions.length > 0 && (
                    <List dense subheader={<ListSubheader disableGutters>Sessions</ListSubheader>}>
                        {sessions.map((session) => (
                            <ListItem key={session.id} disableGutters>
                                <ListItemText
                                    primary={session.title}
                                    secondary={sessionDetail(session)}
                                />
                            </ListItem>
                        ))}
                    </List>
                )}

                {(trimmedAvailability > 0 || droppedAvailability > 0) && (
                    <List
                        dense
                        subheader={<ListSubheader disableGutters>Availability</ListSubheader>}
                    >
                        {trimmedAvailability > 0 && (
                            <ListItem disableGutters>
                                <ListItemText
                                    primary={`${trimmedAvailability} ${periods(trimmedAvailability)} shortened`}
                                    secondary="They now cover only the time that still fits."
                                />
                            </ListItem>
                        )}

                        {droppedAvailability > 0 && (
                            <ListItem disableGutters>
                                <ListItemText
                                    primary={`${droppedAvailability} ${periods(droppedAvailability)} removed`}
                                    secondary="Nothing was left of them inside the new dates."
                                />
                            </ListItem>
                        )}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={dialogProps.onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
