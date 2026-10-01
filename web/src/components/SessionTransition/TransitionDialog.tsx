import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
} from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { useTransitionSessionMutation } from "#/mutations/session.ts";
import type { SessionState } from "#/queries/session.ts";
import { defaultMutationErrorHandler, hasErrorCode } from "#/utils/api.ts";
import { announcesTransition, transitionAction } from "./transitions.ts";

type NoteAuthor = "organizer" | "host";

type NoteCopy = {
    label: string;
    helperText: string;
};

const noteCopy = (author: NoteAuthor, from: SessionState, target: SessionState): NoteCopy =>
    author === "organizer"
        ? {
              label: "Message to the speaker",
              helperText: announcesTransition(from, target)
                  ? "Sent to the speaker with the mail announcing this."
                  : "Kept on the session's history, which its speakers can read.",
          }
        : {
              label: "Message to the organizers",
              helperText: "Kept on the session's history, which the organizers can read.",
          };

type TransitionDialogProps = {
    editionId: string;
    sessionId: string;
    sessionTitle: string;
    /** The state the session is in, which decides what the move is called and whether it is mailed. */
    from: SessionState;
    target: SessionState;
    author: NoteAuthor;
    onClose: () => void;
};

export const TransitionDialog = ({
    editionId,
    sessionId,
    sessionTitle,
    from,
    target,
    author,
    onClose,
}: TransitionDialogProps): ReactNode => {
    const [note, setNote] = useState("");
    const transitionMutation = useTransitionSessionMutation();
    const copy = noteCopy(author, from, target);
    const action = transitionAction(from, target);

    // The promise rather than per-call callbacks: the refetch that follows can
    // drop this row from a list filtered by state, and callbacks skip once it
    // has unmounted.
    const handleSubmit = () => {
        transitionMutation
            .mutateAsync({
                editionId,
                sessionId,
                state: target,
                // The API refuses an empty string, and a blank box means the
                // organizer wrote nothing rather than wrote nothing down.
                note: note.trim() === "" ? null : note.trim(),
            })
            .then(
                () => {
                    enqueueSnackbar(`"${sessionTitle}" is now ${target}`, { variant: "success" });
                    onClose();
                },
                (error: unknown) => {
                    if (!hasErrorCode(error, "illegal_transition")) {
                        defaultMutationErrorHandler(error);

                        return;
                    }

                    enqueueSnackbar(
                        `"${sessionTitle}" changed while this was open. The page has been refreshed; check its state before trying again.`,
                        { variant: "warning" },
                    );
                    onClose();
                },
            );
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{action.title}</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    fullWidth
                    multiline
                    minRows={3}
                    margin="dense"
                    label={copy.label}
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                    helperText={copy.helperText}
                    value={note}
                    onChange={(event) => {
                        setNote(event.target.value);
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    loading={transitionMutation.isPending}
                    onClick={handleSubmit}
                >
                    {action.commit}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
