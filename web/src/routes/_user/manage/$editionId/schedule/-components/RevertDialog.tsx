import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Stack,
} from "@mui/material";
import type { ReactNode } from "react";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";

type RevertDialogProps = {
    placed: number;
    /**
     * Whether anything is published, which decides what reverting even means.
     *
     * With a publication the draft is refilled from it. Without one there is
     * nothing to refill from and the API empties the draft instead, which is
     * the same call and a different act, so it is worded as one.
     */
    published: boolean;
    reverting: boolean;
    onRevert: () => void;
    dialogProps: ControlledDialogProps;
};

export const RevertDialog = ({
    placed,
    published,
    reverting,
    onRevert,
    dialogProps,
}: RevertDialogProps): ReactNode => (
    <Dialog
        {...dialogProps}
        onClose={() => {
            if (reverting) {
                return;
            }

            dialogProps.onClose();
        }}
        maxWidth="sm"
        fullWidth
    >
        <DialogTitle>{published ? "Go back to what is published" : "Empty the draft"}</DialogTitle>

        <DialogContent dividers>
            <Stack spacing={2}>
                <DialogContentText variant="body2">
                    {published
                        ? "The draft is replaced by the published schedule. Anything placed, moved or resized since then is gone."
                        : "Nothing is published yet, so there is nothing to go back to. Reverting takes every session off the schedule and leaves the draft empty."}
                </DialogContentText>

                {placed > 0 && (
                    <Alert severity="warning">
                        {placed === 1
                            ? "One session is placed in the draft."
                            : `${placed.toString()} sessions are placed in the draft.`}{" "}
                        This cannot be undone.
                    </Alert>
                )}
            </Stack>
        </DialogContent>

        <DialogActions>
            <Button disabled={reverting} onClick={dialogProps.onClose}>
                Cancel
            </Button>
            <Button
                color="error"
                variant="contained"
                loading={reverting}
                // Wrapped, because React hands onClick the event and the caller
                // takes an optional date in that position.
                onClick={() => {
                    onRevert();
                }}
            >
                {published ? "Go back" : "Empty it"}
            </Button>
        </DialogActions>
    </Dialog>
);
