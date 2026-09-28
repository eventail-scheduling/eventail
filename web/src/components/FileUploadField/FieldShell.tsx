import { Box, FormControl, FormHelperText, FormLabel } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import { type ReactNode, useId } from "react";

export type PickerProps = {
    id: string;
    "aria-labelledby": string;
    "aria-describedby": string;
};

/**
 * What the shell minted, for the body to wire its own parts to.
 *
 * `constraintId` belongs on whatever states the field's rules: where that sits
 * differs between a row of actions and a drop zone, so the body places it.
 */
export type FieldIds = {
    /**
     * Props for whichever button opens the picker.
     *
     * They name the button after the field as well as itself, since "Choose
     * file" or "Replace" repeats wherever a form asks for more than one upload.
     */
    pickerProps: PickerProps;
    constraintId: string;
    describedBy: string;
};

type FieldShellProps = {
    label: string;
    required?: boolean;
    helperText?: string;
    uploadError: string | null;
    fieldError: string | undefined;
    children: (ids: FieldIds) => ReactNode;
};

/**
 * The label, the announcement and the grouping an input would have brought.
 *
 * The body of an upload field is buttons, so the label associates with
 * nothing, `required` reaches no control, and an error has nowhere to be
 * announced from.
 */
export const FieldShell = ({
    label,
    required,
    helperText,
    uploadError,
    fieldError,
    children,
}: FieldShellProps): ReactNode => {
    const labelId = useId();
    const buttonId = useId();
    const messageId = useId();
    const constraintId = useId();

    const message = uploadError ?? fieldError ?? helperText;
    const hasMessage = message !== undefined && message !== "";
    const describedBy = `${hasMessage ? messageId : ""} ${constraintId}`.trim();

    return (
        <FormControl
            error={uploadError !== null || fieldError !== undefined}
            required={required}
            fullWidth
        >
            {/* MUI hides the asterisk from assistive tech, and no input carries
                `required` when the body is buttons, so the word says it. */}
            <FormLabel id={labelId} sx={{ mb: 1 }}>
                {label}
                {required === true && (
                    <Box component="span" sx={visuallyHidden}>
                        (required)
                    </Box>
                )}
            </FormLabel>

            {/* The message is shown below, but after the picker closes focus
                sits on a button rather than on anything the text describes, so
                nothing would read it out. Mounted always, because a region
                inserted together with its text is announced unreliably. */}
            <Box aria-live="assertive" sx={visuallyHidden}>
                {uploadError ?? ""}
            </Box>

            <Box role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
                {children({
                    pickerProps: {
                        id: buttonId,
                        "aria-labelledby": `${buttonId} ${labelId}`,
                        "aria-describedby": describedBy,
                    },
                    constraintId,
                    describedBy,
                })}
            </Box>

            {hasMessage && (
                <FormHelperText id={messageId} sx={{ mx: 0 }}>
                    {message}
                </FormHelperText>
            )}
        </FormControl>
    );
};
