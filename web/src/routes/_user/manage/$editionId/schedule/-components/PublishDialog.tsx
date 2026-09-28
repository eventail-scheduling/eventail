import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    FormControl,
    FormControlLabel,
    FormLabel,
    Radio,
    RadioGroup,
    Stack,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { type ReactNode, useState } from "react";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";

/**
 * What a publication claims about itself, which the API takes as a boolean.
 *
 * Named rather than passed as `preliminary: true`, because the two readings sit
 * next to each other in the dialog and a boolean at the call site says which
 * only to whoever remembers the parameter's name.
 */
export type PublicationPhase = "preliminary" | "final";

type PublishDialogProps = {
    placed: number;
    clashes: number;
    /**
     * Whether a final publication already exists, which forbids a preliminary one.
     *
     * The API refuses that with `already_final`. Offered as a disabled option
     * with the reason rather than hidden, so an organizer looking for it learns
     * where it went.
     */
    finalPublished: boolean;
    publishing: boolean;
    onPublish: (phase: PublicationPhase) => void;
    dialogProps: ControlledDialogProps;
};

export const PublishDialog = ({
    placed,
    clashes,
    finalPublished,
    publishing,
    onPublish,
    dialogProps,
}: PublishDialogProps): ReactNode => {
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));
    const [phase, setPhase] = useState<PublicationPhase>(finalPublished ? "final" : "preliminary");

    // Read rather than trusted: a final publication can land from another
    // organizer while this dialog is open, and a window focus refetches the list
    // under it. The state would then still say preliminary, an option now drawn
    // disabled, and publishing it would be refused as `already_final`.
    const selected = finalPublished ? "final" : phase;

    return (
        <Dialog
            {...dialogProps}
            // Nothing closes this while the publish is in flight. The backdrop
            // is what keeps the grid inert, and the draft behind it already
            // belongs to the publication in progress: a slot written against it
            // is refused as `already_published`, taking the session with it.
            onClose={() => {
                if (publishing) {
                    return;
                }

                dialogProps.onClose();
            }}
            maxWidth="sm"
            fullWidth
            fullScreen={fullScreen}
        >
            <DialogContent>
                <Stack spacing={2}>
                    <Typography variant="h6">Publish the schedule</Typography>

                    <DialogContentText>
                        {placed === 1
                            ? "One session is placed."
                            : `${placed.toString()} sessions are placed.`}{" "}
                        Publishing announces them and starts a fresh draft from the same slots, so
                        editing carries on afterwards.
                    </DialogContentText>

                    {placed === 0 && (
                        <Alert severity="warning">
                            Nothing is placed, so this would announce an empty schedule.
                        </Alert>
                    )}

                    {clashes > 0 && (
                        <Alert severity="warning">
                            {clashes === 1
                                ? "One speaker clash is unresolved."
                                : `${clashes.toString()} speaker clashes are unresolved.`}{" "}
                            Publishing does not wait for them.
                        </Alert>
                    )}

                    <FormControl>
                        <FormLabel id="publication-phase">How settled is it?</FormLabel>
                        <RadioGroup
                            aria-labelledby="publication-phase"
                            value={selected}
                            onChange={(event) => {
                                setPhase(event.target.value as PublicationPhase);
                            }}
                        >
                            <FormControlLabel
                                value="preliminary"
                                disabled={finalPublished}
                                control={<Radio />}
                                label={
                                    finalPublished
                                        ? "Preliminary, which nothing can be after a final publication"
                                        : "Preliminary, which says it may still change"
                                }
                            />
                            <FormControlLabel
                                value="final"
                                control={<Radio />}
                                label="Final, after which no preliminary one can follow"
                            />
                        </RadioGroup>
                    </FormControl>
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button disabled={publishing} onClick={dialogProps.onClose}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    loading={publishing}
                    onClick={() => {
                        onPublish(selected);
                    }}
                >
                    Publish
                </Button>
            </DialogActions>
        </Dialog>
    );
};
