import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import {
    Box,
    FormControl,
    FormHelperText,
    IconButton,
    InputAdornment,
    InputLabel,
    OutlinedInput,
    Typography,
} from "@mui/material";
import { type ReactNode, type Ref, useId } from "react";
import { useLocale } from "#/components/LocaleProvider";

// Base UI defaults to the browser locale, which is the exact preference the
// regional format setting exists to override, so callers do not get a say.
export type NumberFieldProps = Omit<BaseNumberField.Root.Props, "locale"> & {
    label?: ReactNode;
    helperText?: ReactNode;
    suffix?: ReactNode;
    placeholder?: string;
    error?: boolean;
    fullWidth?: boolean;
    size?: "small" | "medium";
    inputRef?: Ref<HTMLInputElement>;
};

export const NumberField = ({
    id: idProp,
    label,
    helperText,
    suffix,
    placeholder,
    error,
    fullWidth,
    size = "medium",
    inputRef,
    ...rootProps
}: NumberFieldProps): ReactNode => {
    const generatedId = useId();
    const { resolvedLocale } = useLocale();
    const id = idProp ?? generatedId;
    const helperTextId = `${id}-helper-text`;
    const suffixId = `${id}-suffix`;
    const describedByIds = [
        suffix !== undefined ? suffixId : null,
        helperText !== undefined ? helperTextId : null,
    ].filter((value) => value !== null);

    // Base UI renders its visually hidden form submission input as a sibling
    // of the FormControl, so without a positioned wrapper it anchors to some
    // distant ancestor and escapes any scroll clipping in between, stretching
    // a dialog paper into a second scrollbar.
    return (
        <Box
            sx={{
                position: "relative",
                display: "inline-flex",
                flexDirection: "column",
                verticalAlign: "top",
                ...(fullWidth ? { width: "100%" } : {}),
            }}
        >
            <BaseNumberField.Root
                {...rootProps}
                locale={resolvedLocale}
                render={(props, state) => (
                    <FormControl
                        size={size}
                        ref={props.ref}
                        disabled={state.disabled}
                        required={state.required}
                        error={error}
                        fullWidth={fullWidth}
                        variant="outlined"
                    >
                        {props.children}
                    </FormControl>
                )}
            >
                <InputLabel htmlFor={id}>{label}</InputLabel>
                <BaseNumberField.Input
                    id={id}
                    ref={inputRef}
                    placeholder={placeholder}
                    render={(props, state) => (
                        <OutlinedInput
                            aria-describedby={
                                describedByIds.length > 0 ? describedByIds.join(" ") : undefined
                            }
                            label={label}
                            inputRef={props.ref}
                            value={state.inputValue}
                            onBlur={props.onBlur}
                            onChange={props.onChange}
                            onKeyUp={props.onKeyUp}
                            onKeyDown={props.onKeyDown}
                            onFocus={props.onFocus}
                            slotProps={{ input: props }}
                            endAdornment={
                                <>
                                    {suffix !== undefined && (
                                        <InputAdornment position="end" sx={{ mr: 1 }}>
                                            <Typography
                                                id={suffixId}
                                                variant="body2"
                                                color="text.secondary"
                                            >
                                                {suffix}
                                            </Typography>
                                        </InputAdornment>
                                    )}
                                    <InputAdornment
                                        position="end"
                                        sx={{
                                            flexDirection: "column",
                                            maxHeight: "unset",
                                            alignSelf: "stretch",
                                            borderLeft: "1px solid",
                                            borderColor: "divider",
                                            ml: 0,
                                            "& button": { py: 0, flex: 1, borderRadius: 0.5 },
                                        }}
                                    >
                                        <BaseNumberField.Increment
                                            render={
                                                <IconButton size={size} aria-label="Increase" />
                                            }
                                        >
                                            <KeyboardArrowUpIcon
                                                fontSize={size}
                                                sx={{ transform: "translateY(2px)" }}
                                            />
                                        </BaseNumberField.Increment>
                                        <BaseNumberField.Decrement
                                            render={
                                                <IconButton size={size} aria-label="Decrease" />
                                            }
                                        >
                                            <KeyboardArrowDownIcon
                                                fontSize={size}
                                                sx={{ transform: "translateY(-2px)" }}
                                            />
                                        </BaseNumberField.Decrement>
                                    </InputAdornment>
                                </>
                            }
                            sx={{ pr: 0 }}
                        />
                    )}
                />
                {helperText !== undefined && (
                    <FormHelperText id={helperTextId}>{helperText}</FormHelperText>
                )}
            </BaseNumberField.Root>
        </Box>
    );
};
