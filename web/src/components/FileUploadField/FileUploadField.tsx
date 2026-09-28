import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
    Box,
    Button,
    FormHelperText,
    IconButton,
    LinearProgress,
    Paper,
    Stack,
    Typography,
} from "@mui/material";
import humanFormat from "human-format";
import { type ReactNode, useCallback } from "react";
import {
    type Control,
    type FieldPathByValue,
    type FieldValues,
    useController,
} from "react-hook-form";
import { z } from "zod/mini";
import type { UploadLimits } from "#/queries/edition.js";
import { describeFileConstraints } from "./describe-constraints.js";
import { FieldShell, type PickerProps } from "./FieldShell.js";
import { type UploadedFile, type UploadStatus, useFileUpload } from "./useFileUpload.js";

export const fileUploadSchema = z.object({
    key: z.string(),
    filename: z.string(),
    url: z.optional(z.string()),
    thumbnailUrl: z.optional(z.string()),
});

export type FileUpload = z.output<typeof fileUploadSchema>;

export type FileDescriptorInput = { key: string; filename: string };

/**
 * Names a fresh upload by its temporary key.
 *
 * A stored key cannot be sent back: attaching copies the upload out of the
 * temporary area, and an image is re-pointed again when its derivative job
 * lands. A create holds no stored file, and an update sends a file only when
 * it changed, which leaves a fresh upload or none.
 *
 * @throws {Error} for a file that is already stored
 */
export const toFileDescriptorInput = (value: FileUpload): FileDescriptorInput => {
    if (!value.key.startsWith("temp/")) {
        throw new Error("A stored file cannot be sent back");
    }

    return { key: value.key, filename: value.filename };
};

type InputValue = FileUpload | null | undefined;

type UploadingRowProps = {
    status: UploadStatus;
    describedBy: string;
    onCancel: () => void;
};

const UploadingRow = ({ status, describedBy, onCancel }: UploadingRowProps): ReactNode => {
    const determinate = status.progress.type === "determinate";

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography noWrap>{status.filename}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {status.progress.type === "determinate"
                            ? `${humanFormat.bytes(status.progress.current)} of ${humanFormat.bytes(status.progress.total)}`
                            : "Preparing upload…"}
                    </Typography>
                </Box>

                <Button onClick={onCancel} aria-describedby={describedBy}>
                    Cancel
                </Button>
            </Stack>

            <LinearProgress
                variant={determinate ? "determinate" : "indeterminate"}
                value={
                    status.progress.type === "determinate"
                        ? (status.progress.current / status.progress.total) * 100
                        : undefined
                }
                sx={{ mt: 2 }}
            />
        </Paper>
    );
};

type SelectedFileRowProps = {
    filename: string;
    removable: boolean;
    pickerProps: PickerProps;
    onReplace: () => void;
    onRemove: () => void;
};

const SelectedFileRow = ({
    filename,
    removable,
    pickerProps,
    onReplace,
    onRemove,
}: SelectedFileRowProps): ReactNode => (
    <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ alignItems: { sm: "center" } }}
        >
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", minWidth: 0 }}>
                <InsertDriveFileIcon color="action" />
                <Typography noWrap>{filename}</Typography>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ alignItems: "center", ml: { sm: "auto" } }}>
                <Button {...pickerProps} startIcon={<UploadFileIcon />} onClick={onReplace}>
                    Replace
                </Button>

                {removable && (
                    <IconButton onClick={onRemove} aria-label={`Remove ${filename}`}>
                        <DeleteIcon />
                    </IconButton>
                )}
            </Stack>
        </Stack>
    </Paper>
);

type FileUploadFieldProps<
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, InputValue> = FieldPathByValue<
        TFieldValues,
        InputValue
    >,
    TContext = unknown,
    TTransformedValues = TFieldValues,
> = {
    control: Control<TFieldValues, TContext, TTransformedValues>;
    name: TName;
    label: string;
    helperText?: string;
    uploadLimits: UploadLimits;
    required?: boolean;
};

export const FileUploadField = <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPathByValue<TFieldValues, InputValue> = FieldPathByValue<
        TFieldValues,
        InputValue
    >,
    TContext = unknown,
    TTransformedValues = TFieldValues,
>({
    control,
    name,
    label,
    helperText,
    uploadLimits,
    required,
}: FileUploadFieldProps<TFieldValues, TName, TContext, TTransformedValues>): ReactNode => {
    const { field, fieldState } = useController({ control, name });

    const handleUploaded = useCallback(
        (file: UploadedFile) => {
            field.onChange(file);
        },
        [field.onChange],
    );

    const { status, error, select, cancel, clearError } = useFileUpload({
        maxFileSize: uploadLimits.maxFileSize,
        mimeTypes: uploadLimits.fileContentTypes,
        onUploaded: handleUploaded,
    });

    const handleRemove = useCallback(() => {
        field.onChange(null);
        clearError();
    }, [field.onChange, clearError]);

    const value: FileUpload | null | undefined = field.value;
    const attached = value !== null && value !== undefined;

    return (
        <FieldShell
            label={label}
            required={required}
            helperText={helperText}
            uploadError={error}
            fieldError={fieldState.error?.message}
        >
            {({ pickerProps, constraintId, describedBy }) => (
                <>
                    {status !== null ? (
                        <UploadingRow status={status} describedBy={describedBy} onCancel={cancel} />
                    ) : attached ? (
                        <SelectedFileRow
                            filename={value.filename}
                            removable={required !== true}
                            pickerProps={pickerProps}
                            onReplace={select}
                            onRemove={handleRemove}
                        />
                    ) : (
                        <Button
                            {...pickerProps}
                            variant="outlined"
                            startIcon={<UploadFileIcon />}
                            onClick={select}
                        >
                            Choose file
                        </Button>
                    )}

                    <FormHelperText id={constraintId} error={false} sx={{ mx: 0 }}>
                        {describeFileConstraints(uploadLimits)}
                    </FormHelperText>
                </>
            )}
        </FieldShell>
    );
};
