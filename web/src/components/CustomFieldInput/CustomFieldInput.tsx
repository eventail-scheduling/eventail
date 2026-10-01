import { FormControl, FormControlLabel, FormHelperText } from "@mui/material";
import { RhfAutocomplete, RhfCheckbox, RhfTextField } from "mui-rhf-integration";
import { RhfDatePicker } from "mui-rhf-integration/date-picker";
import { TemporalPlainDateProvider } from "mui-temporal-pickers";
import type { ReactNode } from "react";
import type { Control, FieldPath, FieldPathByValue, FieldValues } from "react-hook-form";
import { useFormState } from "react-hook-form";
import { match, P } from "ts-pattern";
import { type FileUpload, FileUploadField } from "#/components/FileUploadField/index.js";
import { RhfNumberField } from "#/components/NumberField/index.js";
import type { CustomField } from "#/queries/custom-field.js";
import type { UploadLimits } from "#/queries/edition.js";
import { isRequired } from "./schema.js";

type FieldsWithResponses = FieldValues & { responses?: Record<string, unknown> | undefined };

type BooleanFieldProps<
    TFieldValues extends FieldsWithResponses = FieldsWithResponses,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    name: FieldPathByValue<TFieldValues, boolean | null | undefined>;
    label: string;
    helperText: string;
    required: boolean;
};

const BooleanField = <
    TFieldValues extends FieldsWithResponses = FieldsWithResponses,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    name,
    label,
    helperText,
    required,
}: BooleanFieldProps<TFieldValues, TContext, TTransformedValues>): ReactNode => {
    const formState = useFormState({ control, name });
    const { error } = control.getFieldState(name, formState);
    const helperTextId = `${name}-helper-text`;
    const hasHelperText = error !== undefined || helperText !== "";

    return (
        <FormControl error={error !== undefined} variant="standard">
            <FormControlLabel
                label={label}
                required={required}
                control={
                    <RhfCheckbox
                        control={control}
                        name={name}
                        slotProps={{
                            input: {
                                "aria-invalid": error !== undefined,
                                "aria-describedby": hasHelperText ? helperTextId : undefined,
                            },
                        }}
                    />
                }
                slotProps={{ typography: error ? { color: "error" } : undefined }}
            />

            {hasHelperText && (
                <FormHelperText id={helperTextId}>{error?.message ?? helperText}</FormHelperText>
            )}
        </FormControl>
    );
};

type CustomFieldInputProps<
    TFieldValues extends FieldsWithResponses = FieldsWithResponses,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    customField: CustomField;
    uploadLimits: UploadLimits;
    pathPrefix?: string;
};

export const CustomFieldInput = <
    TFieldValues extends FieldsWithResponses = FieldsWithResponses,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    customField,
    uploadLimits,
    pathPrefix = "",
}: CustomFieldInputProps<TFieldValues, TContext, TTransformedValues>): ReactNode => {
    const required = isRequired(customField);

    // Responses are stored as unknown, so each branch asserts the value type its
    // own customField kind guarantees.
    const fieldPath = `${pathPrefix}responses.${customField.id}` as FieldPath<TFieldValues>;
    const textPath = fieldPath as FieldPathByValue<TFieldValues, string | null | undefined>;
    const booleanPath = fieldPath as FieldPathByValue<TFieldValues, boolean | null | undefined>;
    const filePath = fieldPath as FieldPathByValue<TFieldValues, FileUpload | null | undefined>;
    const numberPath = fieldPath as FieldPathByValue<TFieldValues, number | null | undefined>;

    return match(customField.options)
        .with({ type: "number" }, (options) => (
            <RhfNumberField
                control={control}
                name={numberPath}
                label={customField.title}
                helperText={customField.helperText}
                required={required}
                min={options.min}
                max={options.max}
                fullWidth
            />
        ))
        .with({ type: P.union("single_line_text", "multi_line_text") }, (options) => (
            <RhfTextField
                control={control}
                name={textPath}
                label={customField.title}
                helperText={customField.helperText}
                required={required}
                maxCharacters={customField.answerMaxLength ?? undefined}
                multiline={options.type === "multi_line_text"}
                minRows={options.type === "multi_line_text" ? 5 : undefined}
            />
        ))
        .with({ type: "boolean" }, () => (
            <BooleanField
                control={control}
                name={booleanPath}
                label={customField.title}
                helperText={customField.helperText}
                required={required}
            />
        ))
        .with({ type: "date" }, () => (
            <TemporalPlainDateProvider>
                <RhfDatePicker
                    control={control}
                    name={fieldPath}
                    label={customField.title}
                    slotProps={{ textField: { required, helperText: customField.helperText } }}
                />
            </TemporalPlainDateProvider>
        ))
        .with({ type: "file" }, () => (
            <FileUploadField
                control={control}
                name={filePath}
                label={customField.title}
                helperText={customField.helperText}
                uploadLimits={uploadLimits}
                required={required}
            />
        ))
        .with({ type: P.union("single_choice", "multiple_choice") }, (options) => (
            <RhfAutocomplete
                control={control}
                name={fieldPath}
                multiple={options.type === "multiple_choice"}
                slotProps={{
                    textField: {
                        label: customField.title,
                        helperText: customField.helperText,
                        required,
                    },
                }}
                options={options.items}
                getOptionLabel={(item) => item.label}
                getOptionKey={(item) => item.id}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                freeSolo={false}
            />
        ))
        .with({ type: "url" }, () => (
            <RhfTextField
                control={control}
                name={textPath}
                label={customField.title}
                helperText={customField.helperText}
                required={required}
                placeholder="https://"
            />
        ))
        .exhaustive();
};
