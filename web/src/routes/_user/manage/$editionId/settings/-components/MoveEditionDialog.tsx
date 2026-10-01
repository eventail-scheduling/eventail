import { Alert, AlertTitle, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useLocale } from "#/components/LocaleProvider";
import { StartDateDialog } from "#/components/StartDateDialog.js";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import type { StartDateQuestion } from "#/queries/edition.js";

type MoveEditionDialogProps = {
    question: StartDateQuestion;
    nextStartDate: Temporal.PlainDate;
    zoneChanges: boolean;
    pending: boolean;
    onConfirm: (startDateBecomes: Temporal.PlainDate) => void;
    dialogProps: ControlledDialogProps;
};

export const MoveEditionDialog = ({
    question,
    nextStartDate,
    zoneChanges,
    pending,
    onConfirm,
    dialogProps,
}: MoveEditionDialogProps): ReactNode => {
    const { dateFormatter } = useLocale();

    return (
        <StartDateDialog
            question={question}
            nextStartDate={nextStartDate}
            zoneChanges={zoneChanges}
            lead={`The new dates on their own do not say how far the schedule should move. This edition begins on ${dateFormatter.format(question.previousStartDate)}. Say what that day becomes, and everything scheduled follows it.`}
            consequences={
                <Alert severity="warning">
                    <AlertTitle>What this will do</AlertTitle>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Every slot in the draft schedule, and all availability given for this
                        edition, moves by the same number of days and keeps the local time it was
                        entered at
                        {zoneChanges ? ", now read in the new timezone." : "."}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Whatever no longer fits afterwards is deleted: a slot that would land
                        outside the new dates, one that a daylight saving change would stretch or
                        shorten, and the later of any two that such a change leaves overlapping in
                        the same room. Availability is cut back to what still fits, or removed when
                        none of it does.
                    </Typography>
                    <Typography variant="body2">
                        Published schedules keep the times they were published with, and the
                        submission deadline does not move. Nothing deleted comes back if you change
                        the dates again.
                    </Typography>
                </Alert>
            }
            confirmLabel="Move the edition"
            pending={pending}
            onConfirm={onConfirm}
            dialogProps={dialogProps}
        />
    );
};
