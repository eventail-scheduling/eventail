import { Alert, AlertTitle, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useLocale } from "#/components/LocaleProvider";
import { StartDateDialog } from "#/components/StartDateDialog.js";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import type { StartDateQuestion } from "#/queries/edition.js";

type RevertStartDateDialogProps = {
    question: StartDateQuestion;
    nextStartDate: Temporal.PlainDate;
    zoneChanges: boolean;
    pending: boolean;
    onConfirm: (startDateBecomes: Temporal.PlainDate) => void;
    dialogProps: ControlledDialogProps;
};

/**
 * The reversion's wording, needed when the edition has moved since publishing.
 *
 * A publication keeps the window it was announced for, so its slots have to be
 * fitted into the edition's current one, and how far they travel is a question
 * only the organizer can answer.
 */
export const RevertStartDateDialog = ({
    question,
    nextStartDate,
    zoneChanges,
    pending,
    onConfirm,
    dialogProps,
}: RevertStartDateDialogProps): ReactNode => {
    const { dateFormatter } = useLocale();

    return (
        <StartDateDialog
            question={question}
            nextStartDate={nextStartDate}
            zoneChanges={zoneChanges}
            lead={`The edition has moved since this was published. The publication begins on ${dateFormatter.format(question.previousStartDate)}. Say what that day becomes, and everything it holds follows.`}
            consequences={
                <Alert severity="warning">
                    <AlertTitle>What this will do</AlertTitle>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Every slot in the publication is copied into the draft, moved by the same
                        number of days, keeping the local time it was published at
                        {zoneChanges ? ", now read in the new timezone." : "."}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Whatever no longer fits is left out: a slot that would land outside the
                        edition's dates, one that a daylight saving change would stretch or shorten,
                        and the later of any two that such a change leaves overlapping in the same
                        room. You will be told which sessions those were.
                    </Typography>
                    <Typography variant="body2">
                        Availability is not touched, and the publication itself is left exactly as
                        it was. Whatever is in the draft now is replaced.
                    </Typography>
                </Alert>
            }
            confirmLabel="Go back"
            pending={pending}
            onConfirm={onConfirm}
            dialogProps={dialogProps}
        />
    );
};
