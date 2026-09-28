import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { RhfAutocomplete } from "mui-rhf-integration";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/mini";
import {
    type Locale,
    localeDisplayName,
    locales,
    readSystemLocale,
    resolveLocale,
    useLocale,
} from "#/components/LocaleProvider";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import { formResolver } from "#/utils/zod.js";

const SYSTEM_DEFAULT = "system" as const;

type Option = Locale | typeof SYSTEM_DEFAULT;

const options: Option[] = [SYSTEM_DEFAULT, ...locales];

const schema = z.object({
    locale: z.custom<Option>(),
});

type FieldValues = z.input<typeof schema>;
type TransformedValues = z.output<typeof schema>;

type PreferredLocaleDialogProps = {
    dialogProps: ControlledDialogProps;
};

export const PreferredLocaleDialog = ({ dialogProps }: PreferredLocaleDialogProps): ReactNode => {
    const { preferredLocale, resolvedLocale, changeLocale } = useLocale();

    const form = useForm<FieldValues, unknown, TransformedValues>({
        resolver: formResolver(schema),
        defaultValues: { locale: preferredLocale ?? SYSTEM_DEFAULT },
    });

    const handleSubmit = (data: TransformedValues) => {
        changeLocale(data.locale === SYSTEM_DEFAULT ? null : data.locale);
        dialogProps.onClose();
    };

    const systemLocale = resolveLocale(null, readSystemLocale());

    const optionLabel = (option: Option): string =>
        option === SYSTEM_DEFAULT
            ? `System default (${localeDisplayName(systemLocale, resolvedLocale)})`
            : localeDisplayName(option, resolvedLocale);

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
        >
            <DialogTitle>Change regional format</DialogTitle>
            <DialogContent dividers>
                <RhfAutocomplete
                    control={form.control}
                    name="locale"
                    slotProps={{
                        textField: {
                            label: "Regional format",
                            helperText:
                                "This determines how dates, times and numbers are entered and displayed",
                        },
                    }}
                    getOptionLabel={optionLabel}
                    getOptionKey={(option) => option}
                    options={options}
                    disableClearable
                    freeSolo={false}
                />
            </DialogContent>
            <DialogActions>
                <Button type="submit" loading={form.formState.isSubmitting}>
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};
