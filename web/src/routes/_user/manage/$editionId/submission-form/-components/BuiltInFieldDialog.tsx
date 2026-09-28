import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Stack,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useMemo } from "react";
import { useForm } from "react-hook-form";
import { RhfNumberField } from "#/components/NumberField/index.js";
import type { ControlledDialogProps } from "#/hooks/useDialogController.tsx";
import { type FieldOptionsScope, useUpdateFieldOptionsMutation } from "#/mutations/edition.js";
import type { BuiltInFieldOptions, SessionFieldSpec } from "#/queries/edition.js";
import { defaultMutationErrorHandler } from "#/utils/api.js";
import { formResolver } from "#/utils/zod.js";
import {
    type BuiltInFieldTransformedValues,
    type BuiltInFieldValues,
    buildBuiltInFieldOption,
    buildBuiltInFieldSchema,
    createBuiltInFieldDefaultValues,
    maxImageDimension,
} from "./schema.ts";

type BuiltInFieldDialogProps = {
    dialogProps: ControlledDialogProps;
    editionId: string;
    scope: FieldOptionsScope;
    fieldName: string;
    spec: SessionFieldSpec;
    fieldOptions: BuiltInFieldOptions;
};

export const BuiltInFieldDialog = ({
    dialogProps,
    editionId,
    scope,
    fieldName,
    spec,
    fieldOptions,
}: BuiltInFieldDialogProps): ReactNode => {
    const updateFieldOptionsMutation = useUpdateFieldOptionsMutation(editionId, scope);
    const options = fieldOptions[fieldName];
    const takesLength = spec.type === "string";
    const imageDefaults = spec.imageDefaults;
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));

    const schema = useMemo(() => buildBuiltInFieldSchema(spec), [spec]);
    const form = useForm<BuiltInFieldValues, unknown, BuiltInFieldTransformedValues>({
        resolver: formResolver(schema),
        defaultValues: createBuiltInFieldDefaultValues(options),
    });

    const handleSubmit = (values: BuiltInFieldTransformedValues) => {
        const next = buildBuiltInFieldOption(spec, options, values);

        updateFieldOptionsMutation.mutate(
            { fieldOptions: { ...fieldOptions, [fieldName]: next } },
            {
                onSuccess: () => {
                    enqueueSnackbar(`${spec.label} has been updated`, { variant: "success" });
                    dialogProps.onClose();
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Dialog
            {...dialogProps}
            slotProps={{
                paper: {
                    component: "form",
                    onSubmit: form.handleSubmit(handleSubmit),
                    noValidate: true,
                },
            }}
            maxWidth="xs"
            fullWidth
            fullScreen={fullScreen}
        >
            <DialogTitle>Configure {spec.label}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <RhfTextField
                        control={form.control}
                        name="label"
                        label="Label"
                        placeholder={spec.label}
                        helperText="Leave empty to keep the built-in wording"
                        fullWidth
                    />

                    <RhfTextField
                        control={form.control}
                        name="helperText"
                        label="Helper text"
                        placeholder={spec.helperText ?? ""}
                        helperText="Shown beneath the field to explain what you are asking for"
                        multiline
                        fullWidth
                    />

                    {!spec.forceRequired && (
                        <RhfTextField
                            control={form.control}
                            name="requirement"
                            label="Requirement"
                            select
                            fullWidth
                        >
                            <MenuItem value="optional">Optional</MenuItem>
                            <MenuItem value="required">Required</MenuItem>
                        </RhfTextField>
                    )}

                    {takesLength && (
                        <Stack direction="row" spacing={2}>
                            <RhfNumberField
                                control={form.control}
                                name="minLength"
                                label="Minimum length"
                                min={1}
                                fullWidth
                            />
                            <RhfNumberField
                                control={form.control}
                                name="maxLength"
                                label="Maximum length"
                                min={1}
                                fullWidth
                            />
                        </Stack>
                    )}

                    {imageDefaults && (
                        <>
                            <Stack direction="row" spacing={2}>
                                <RhfNumberField
                                    control={form.control}
                                    name="minWidth"
                                    label="Minimum width"
                                    placeholder={String(imageDefaults.minWidth)}
                                    min={1}
                                    max={maxImageDimension}
                                    fullWidth
                                />
                                <RhfNumberField
                                    control={form.control}
                                    name="maxWidth"
                                    label="Maximum width"
                                    placeholder={String(imageDefaults.maxWidth)}
                                    min={1}
                                    max={maxImageDimension}
                                    fullWidth
                                />
                            </Stack>

                            <Stack direction="row" spacing={2}>
                                <RhfNumberField
                                    control={form.control}
                                    name="minHeight"
                                    label="Minimum height"
                                    placeholder={String(imageDefaults.minHeight)}
                                    min={1}
                                    max={maxImageDimension}
                                    fullWidth
                                />
                                <RhfNumberField
                                    control={form.control}
                                    name="maxHeight"
                                    label="Maximum height"
                                    placeholder={String(imageDefaults.maxHeight)}
                                    min={1}
                                    max={maxImageDimension}
                                    fullWidth
                                />
                            </Stack>

                            <Alert severity="info">
                                An aspect ratio forces a crop, e.g. 16:9. Leave both fields empty to
                                allow any shape.
                            </Alert>

                            <Stack direction="row" spacing={2}>
                                <RhfNumberField
                                    control={form.control}
                                    name="aspectRatioWidth"
                                    label="Ratio width"
                                    min={1}
                                    fullWidth
                                />
                                <RhfNumberField
                                    control={form.control}
                                    name="aspectRatioHeight"
                                    label="Ratio height"
                                    min={1}
                                    fullWidth
                                />
                            </Stack>
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={dialogProps.onClose}>Cancel</Button>
                <Button type="submit" loading={updateFieldOptionsMutation.isPending}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};
