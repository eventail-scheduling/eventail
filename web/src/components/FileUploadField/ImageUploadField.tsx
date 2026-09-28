import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import ImageIcon from "@mui/icons-material/Image";
import {
    Box,
    Button,
    CircularProgress,
    FormHelperText,
    LinearProgress,
    Stack,
    Typography,
} from "@mui/material";
import {
    type DragEvent,
    type MouseEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {
    type Control,
    type FieldPathByValue,
    type FieldValues,
    useController,
} from "react-hook-form";
import type { AspectRatio, ImageConstraints, UploadLimits } from "#/queries/edition.js";
import { CropDialog } from "./CropDialog.js";
import { describeImageConstraints } from "./describe-constraints.js";
import { FieldShell, type PickerProps } from "./FieldShell.js";
import type { FileUpload } from "./FileUploadField.js";
import { cropToRatio, decodeImage, maxCropZoom, type Rect, renderImage } from "./prepare-image.js";
import {
    type PreparedFile,
    type UploadedFile,
    type UploadStatus,
    useFileUpload,
} from "./useFileUpload.js";

type InputValue = FileUpload | null | undefined;

type Shape = "rectangle" | "circle";

type LocalPreview = {
    url: string;
    key: string;
};

type PreviewedUpload = {
    file: File;
    key: string;
};

type CropRequest = {
    src: string;
    maxZoom: number;
};

/** Caps the preview so a wide teaser does not dominate the zone it sits in. */
const previewMaxWidth: Record<Shape, number> = {
    rectangle: 280,
    circle: 112,
};

type PreviewProps = {
    aspectRatio: AspectRatio;
    /** Null where the organizer forced no shape, so the whole image was kept. */
    forcedRatio: AspectRatio | null;
    shape: Shape;
    src: string | undefined;
    filename: string | undefined;
    uploading: boolean;
};

const Preview = ({
    aspectRatio,
    forcedRatio,
    shape,
    src,
    filename,
    uploading,
}: PreviewProps): ReactNode => (
    <Box
        sx={{
            width: "100%",
            maxWidth: previewMaxWidth[shape],
            flexShrink: 0,
            aspectRatio: `${aspectRatio.width.toString()} / ${aspectRatio.height.toString()}`,
            borderRadius: shape === "circle" ? "50%" : 1,
            backgroundColor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
        }}
    >
        {uploading ? (
            <CircularProgress size={32} />
        ) : src !== undefined ? (
            <Box
                component="img"
                src={src}
                // Named rather than decorative: with a picture here the
                // filename is shown nowhere else, so this is the only thing
                // saying anything is attached.
                alt={filename ?? ""}
                sx={{
                    width: "100%",
                    height: "100%",
                    // Only a forced shape means the edges really were cut. The
                    // box keeps a reserved size either way, so an unconstrained
                    // image is shown whole rather than sliced to fit it.
                    objectFit: forcedRatio === null ? "contain" : "cover",
                }}
            />
        ) : (
            <ImageIcon color="disabled" sx={{ fontSize: 40 }} />
        )}
    </Box>
);

type ZoneProps = {
    empty: boolean;
    droppable: boolean;
    draggingOver: boolean;
    onSelect: () => void;
    onDraggingOverChange: (draggingOver: boolean) => void;
    onDrop: (file: File) => void;
    children: ReactNode;
};

const Zone = ({
    empty,
    droppable,
    draggingOver,
    onSelect,
    onDraggingOverChange,
    onDrop,
    children,
}: ZoneProps): ReactNode => {
    const handleDragOver = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            if (!droppable) {
                return;
            }

            event.preventDefault();
            onDraggingOverChange(true);
        },
        [droppable, onDraggingOverChange],
    );

    const handleDragLeave = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            // Crossing onto something inside the zone fires this on the zone
            // itself, which would blink the highlight off for a frame.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
            }

            onDraggingOverChange(false);
        },
        [onDraggingOverChange],
    );

    const handleDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            onDraggingOverChange(false);

            const dropped = event.dataTransfer.files.item(0);

            if (dropped !== null && droppable) {
                onDrop(dropped);
            }
        },
        [droppable, onDraggingOverChange, onDrop],
    );

    return (
        <Box
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={empty ? onSelect : undefined}
            sx={{
                p: 2,
                border: 1,
                borderRadius: 1,
                borderStyle: empty ? "dashed" : "solid",
                // Matches a resting outlined input rather than a divider, which
                // is the theme's decorative weight and reads as disabled.
                borderColor: draggingOver ? "primary.main" : "action.disabled",
                backgroundColor: draggingOver ? "action.hover" : undefined,
                cursor: empty ? "pointer" : undefined,
            }}
        >
            {children}
        </Box>
    );
};

type EmptyContentsProps = {
    pickerProps: PickerProps;
    constraintId: string;
    constraints: string;
    onSelect: () => void;
};

const EmptyContents = ({
    pickerProps,
    constraintId,
    constraints,
    onSelect,
}: EmptyContentsProps): ReactNode => {
    // The zone around this carries the same click. Without this the picker
    // would open twice for one press of the button.
    const handleClick = useCallback(
        (event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onSelect();
        },
        [onSelect],
    );

    return (
        <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", py: 1 }}>
            <AddPhotoAlternateIcon color="action" sx={{ fontSize: 40 }} />

            <Button {...pickerProps} variant="outlined" onClick={handleClick}>
                Choose image
            </Button>

            {/* Dragging is unusable on a phone, and the button is the only
                path there, as WCAG 2.5.7 requires everywhere. */}
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: { xs: "none", sm: "block" } }}
            >
                or drag an image here
            </Typography>

            <FormHelperText id={constraintId} error={false} sx={{ mx: 0 }}>
                {constraints}
            </FormHelperText>
        </Stack>
    );
};

type FilledContentsProps = PreviewProps & {
    status: UploadStatus | null;
    pickerProps: PickerProps;
    describedBy: string;
    constraintId: string;
    constraints: string;
    removable: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onCancel: () => void;
};

const FilledContents = ({
    status,
    pickerProps,
    describedBy,
    constraintId,
    constraints,
    removable,
    onSelect,
    onRemove,
    onCancel,
    ...preview
}: FilledContentsProps): ReactNode => (
    <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" } }}
    >
        <Preview {...preview} />

        <Stack spacing={1} sx={{ alignItems: "flex-start", minWidth: 0 }}>
            {status !== null ? (
                <>
                    <Typography variant="body2" color="text.secondary">
                        {status.progress.type === "determinate"
                            ? "Uploading…"
                            : "Preparing upload…"}
                    </Typography>

                    <LinearProgress
                        variant={
                            status.progress.type === "determinate" ? "determinate" : "indeterminate"
                        }
                        value={
                            status.progress.type === "determinate"
                                ? (status.progress.current / status.progress.total) * 100
                                : undefined
                        }
                        sx={{ width: 200, maxWidth: "100%" }}
                    />

                    <Button onClick={onCancel} aria-describedby={describedBy}>
                        Cancel
                    </Button>
                </>
            ) : (
                <Stack direction="row" spacing={1}>
                    <Button {...pickerProps} variant="outlined" onClick={onSelect}>
                        Replace
                    </Button>

                    {removable && (
                        <Button
                            color="inherit"
                            onClick={onRemove}
                            aria-describedby={describedBy}
                            sx={{ color: "text.secondary" }}
                        >
                            Remove
                        </Button>
                    )}
                </Stack>
            )}

            <FormHelperText id={constraintId} error={false} sx={{ mx: 0 }}>
                {constraints}
            </FormHelperText>
        </Stack>
    </Stack>
);

type ImageUploadFieldProps<
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
    imageConstraints: ImageConstraints;
    /** Circular where the image is shown as one, so the preview is not a lie. */
    shape?: Shape;
    required?: boolean;
};

export const ImageUploadField = <
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
    imageConstraints,
    shape = "rectangle",
    required,
}: ImageUploadFieldProps<TFieldValues, TName, TContext, TTransformedValues>): ReactNode => {
    const { field, fieldState } = useController({ control, name });
    const [draggingOver, setDraggingOver] = useState(false);

    /**
     * The image that was uploaded, shown until the server has one of its own.
     *
     * A descriptor carries no url until it has been attached and read back, so
     * without this the zone would sit empty for the whole of the form someone
     * is still filling in. It is tied to the upload's key, so a value the form
     * puts back in the field shows as itself.
     */
    const [localPreview, setLocalPreview] = useState<LocalPreview | null>(null);
    const localPreviewRef = useRef<string | null>(null);

    const replaceLocalPreview = useCallback((upload: PreviewedUpload | null) => {
        if (localPreviewRef.current !== null) {
            URL.revokeObjectURL(localPreviewRef.current);
        }

        const preview =
            upload === null ? null : { url: URL.createObjectURL(upload.file), key: upload.key };
        localPreviewRef.current = preview?.url ?? null;
        setLocalPreview(preview);
    }, []);

    useEffect(() => () => replaceLocalPreview(null), [replaceLocalPreview]);

    /**
     * Shows the preview only once the upload has landed, never at the end of the decode.
     *
     * A preview set earlier survives a cancel and any later failure, leaving a
     * picture in a field that holds nothing and offers no way to clear it.
     */
    const handleUploaded = useCallback(
        (file: UploadedFile, uploaded: File) => {
            field.onChange(file);
            replaceLocalPreview({ file: uploaded, key: file.key });
        },
        [field.onChange, replaceLocalPreview],
    );

    /**
     * The open dialog and the promise the pipeline is parked on while it runs.
     *
     * `prepareFile` cannot return until the speaker has framed the image, so
     * the resolver is held here and called by whichever button they press.
     */
    const [cropRequest, setCropRequest] = useState<CropRequest | null>(null);
    const cropRequestRef = useRef<CropRequest | null>(null);
    const cropResolver = useRef<((crop: Rect | null) => void) | null>(null);

    /**
     * Ends whatever the dialog was asked, releasing what it was holding.
     *
     * Anything that takes the dialog away has to come through here. A request
     * left parked never settles its promise, so the bitmap behind it is never
     * closed and its url never revoked, and neither is collectable while the
     * promise keeps the closure alive.
     */
    const settleCrop = useCallback((crop: Rect | null) => {
        const request = cropRequestRef.current;
        const resolve = cropResolver.current;
        cropRequestRef.current = null;
        cropResolver.current = null;

        if (request !== null) {
            URL.revokeObjectURL(request.src);
        }

        setCropRequest(null);
        resolve?.(crop);
    }, []);

    const handleCropCancel = useCallback(() => {
        settleCrop(null);
    }, [settleCrop]);

    useEffect(() => () => settleCrop(null), [settleCrop]);

    const prepareFile = useCallback(
        async (file: File, isCurrent: () => boolean): Promise<PreparedFile | null> => {
            const decoded = await decodeImage(file);

            if ("error" in decoded) {
                return decoded;
            }

            const { bitmap } = decoded;

            try {
                // Decoding is slow enough to cancel during, and the dialog must
                // not appear over a field the speaker has already dismissed.
                if (!isCurrent()) {
                    return null;
                }

                if (imageConstraints.aspectRatio === null) {
                    return await renderImage(bitmap, file.name, imageConstraints);
                }

                const wholeImage = cropToRatio(bitmap, imageConstraints.aspectRatio);

                // Refused before the dialog rather than after it, so nobody
                // frames an image that was never going to be accepted.
                if (
                    wholeImage.width < imageConstraints.minWidth ||
                    wholeImage.height < imageConstraints.minHeight
                ) {
                    return await renderImage(bitmap, file.name, imageConstraints);
                }

                const crop = await new Promise<Rect | null>((resolve) => {
                    // Releases a request still parked from an earlier pick,
                    // whose resolver this one would otherwise overwrite.
                    settleCrop(null);

                    const request = {
                        src: URL.createObjectURL(file),
                        maxZoom: maxCropZoom(bitmap, imageConstraints),
                    };
                    cropRequestRef.current = request;
                    cropResolver.current = resolve;
                    setCropRequest(request);
                });

                if (crop === null) {
                    return null;
                }

                return await renderImage(bitmap, file.name, imageConstraints, { crop });
            } finally {
                bitmap.close();
            }
        },
        [imageConstraints, settleCrop],
    );

    const { status, error, select, accept, cancel, clearError } = useFileUpload({
        maxFileSize: uploadLimits.maxFileSize,
        mimeTypes: uploadLimits.imageContentTypes,
        prepareFile,
        onUploaded: handleUploaded,
    });

    const handleRemove = useCallback(() => {
        field.onChange(null);
        replaceLocalPreview(null);
        clearError();
    }, [field.onChange, replaceLocalPreview, clearError]);

    const value: FileUpload | null | undefined = field.value;
    const attached = value !== null && value !== undefined;
    const previewSrc =
        localPreview !== null && localPreview.key === value?.key
            ? localPreview.url
            : value?.thumbnailUrl;
    const constraints = describeImageConstraints(uploadLimits, imageConstraints);

    // The box keeps the shape the image will be shown in, so the thumbnail
    // arriving does not move everything below it.
    const aspectRatio = imageConstraints.aspectRatio ?? {
        width: imageConstraints.minWidth,
        height: imageConstraints.minHeight,
    };

    const empty = !attached && status === null;

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
                    <Zone
                        empty={empty}
                        droppable={status === null}
                        draggingOver={draggingOver}
                        onSelect={select}
                        onDraggingOverChange={setDraggingOver}
                        onDrop={accept}
                    >
                        {empty ? (
                            <EmptyContents
                                pickerProps={pickerProps}
                                constraintId={constraintId}
                                constraints={constraints}
                                onSelect={select}
                            />
                        ) : (
                            <FilledContents
                                status={status}
                                aspectRatio={aspectRatio}
                                forcedRatio={imageConstraints.aspectRatio}
                                shape={shape}
                                src={previewSrc}
                                filename={value?.filename}
                                uploading={status !== null}
                                pickerProps={pickerProps}
                                describedBy={describedBy}
                                constraintId={constraintId}
                                constraints={constraints}
                                removable={required !== true}
                                onSelect={select}
                                onRemove={handleRemove}
                                onCancel={cancel}
                            />
                        )}
                    </Zone>

                    {cropRequest !== null && (
                        <CropDialog
                            key={cropRequest.src}
                            src={cropRequest.src}
                            aspectRatio={aspectRatio}
                            shape={shape === "circle" ? "round" : "rect"}
                            maxZoom={cropRequest.maxZoom}
                            onCancel={handleCropCancel}
                            onConfirm={settleCrop}
                        />
                    )}
                </>
            )}
        </FieldShell>
    );
};
