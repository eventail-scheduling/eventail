import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { IconButton, InputAdornment, TextField, Tooltip } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback } from "react";

type EditionIdFieldProps = {
    editionId: string;
};

/**
 * Shows the edition's ID so it can be copied into an integration's configuration.
 *
 * The field stays readable and selectable whether or not the copy succeeds:
 * `navigator.clipboard` exists only in a secure context, so a deployment still
 * being set up over plain http has to copy by hand.
 */
export const EditionIdField = ({ editionId }: EditionIdFieldProps): ReactNode => {
    const handleCopy = useCallback(() => {
        const failed = () => {
            enqueueSnackbar("Could not copy. Select the ID and copy it yourself.", {
                variant: "error",
            });
        };

        if (navigator.clipboard === undefined) {
            failed();
            return;
        }

        navigator.clipboard.writeText(editionId).then(() => {
            enqueueSnackbar("Edition ID copied", { variant: "success" });
        }, failed);
    }, [editionId]);

    return (
        <TextField
            label="Edition ID"
            value={editionId}
            helperText="An integration reads this edition by its ID."
            fullWidth
            slotProps={{
                input: {
                    readOnly: true,
                    endAdornment: (
                        <InputAdornment position="end">
                            <Tooltip title="Copy edition ID">
                                <IconButton onClick={handleCopy} edge="end">
                                    <ContentCopyIcon />
                                </IconButton>
                            </Tooltip>
                        </InputAdornment>
                    ),
                },
            }}
        />
    );
};
