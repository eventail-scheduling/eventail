import { Box, InputAdornment, TextField, type TextFieldProps } from "@mui/material";
import { type ReactNode, type Ref, useId } from "react";

export type ColorFieldProps = Omit<TextFieldProps, "value" | "onChange" | "type" | "select"> & {
    value: string;
    onValueChange: (value: string) => void;
    inputRef?: Ref<HTMLInputElement>;
};

export const ColorField = ({
    id: idProp,
    value,
    onValueChange,
    onBlur,
    inputRef,
    error,
    disabled,
    slotProps,
    ...textFieldProps
}: ColorFieldProps): ReactNode => {
    const generatedId = useId();
    const id = idProp ?? generatedId;

    return (
        <TextField
            {...textFieldProps}
            id={id}
            value={value}
            error={error}
            disabled={disabled}
            slotProps={{
                ...slotProps,
                htmlInput: {
                    ...slotProps?.htmlInput,
                    tabIndex: -1,
                },
                input: {
                    ...slotProps?.input,
                    // Typed input would allow half-written hex the API rejects.
                    readOnly: true,
                    startAdornment: (
                        <InputAdornment position="start">
                            <Box
                                component="input"
                                type="color"
                                value={value}
                                ref={inputRef}
                                disabled={disabled}
                                onChange={(event) => {
                                    onValueChange(event.target.value);
                                }}
                                onBlur={onBlur}
                                aria-labelledby={`${id}-label`}
                                aria-describedby={`${id}-helper-text`}
                                aria-invalid={error}
                                sx={{
                                    width: 28,
                                    height: 28,
                                    padding: 0,
                                    border: "1px solid",
                                    borderColor: "divider",
                                    borderRadius: 1,
                                    background: "none",
                                    cursor: "pointer",
                                    "&:disabled": { cursor: "default", opacity: 0.5 },
                                    "&::-webkit-color-swatch-wrapper": { padding: 0 },
                                    "&::-webkit-color-swatch": { border: "none", borderRadius: 3 },
                                    "&::-moz-color-swatch": { border: "none", borderRadius: 3 },
                                }}
                            />
                        </InputAdornment>
                    ),
                },
            }}
        />
    );
};
