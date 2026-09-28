import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Slider,
    Stack,
    Typography,
} from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import type { AspectRatio } from "#/queries/edition.js";
import type { Rect } from "./prepare-image.js";

export type CropShape = "rect" | "round";

type CropDialogProps = {
    src: string;
    aspectRatio: AspectRatio;
    shape: CropShape;
    maxZoom: number;
    onCancel: () => void;
    onConfirm: (crop: Rect) => void;
};

/**
 * Lets a speaker choose which part of their image survives a forced ratio.
 *
 * Only opens where the organizer demands a shape: without one the whole image
 * is kept and there is nothing to decide. The frame is fixed and the image
 * moves inside it, because the shape is not the speaker's to change.
 */
export const CropDialog = ({
    src,
    aspectRatio,
    shape,
    maxZoom,
    onCancel,
    onConfirm,
}: CropDialogProps): ReactNode => {
    const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [area, setArea] = useState<Area | null>(null);

    /**
     * Records every change, not just the end of one.
     *
     * `onCropComplete` waits for the pointer to be released, which it detects
     * from a document-level mouseup. Only the rect at the moment Use is pressed
     * matters here, so there is nothing to gain by waiting for that.
     */
    const handleCropAreaChange = useCallback((_percentages: Area, pixels: Area) => {
        setArea(pixels);
    }, []);

    const handleZoomChange = useCallback((_event: Event, value: number) => {
        setZoom(value);
    }, []);

    const handleConfirm = useCallback(() => {
        if (area !== null) {
            onConfirm(area);
        }
    }, [area, onConfirm]);

    return (
        <Dialog open onClose={onCancel} maxWidth="sm" fullWidth>
            <DialogTitle>Position your image</DialogTitle>

            <DialogContent>
                <Stack spacing={2}>
                    <Box
                        sx={{
                            position: "relative",
                            width: "100%",
                            height: 320,
                            backgroundColor: "action.hover",
                            borderRadius: 1,
                            overflow: "hidden",
                        }}
                    >
                        <Cropper
                            image={src}
                            crop={crop}
                            zoom={zoom}
                            aspect={aspectRatio.width / aspectRatio.height}
                            cropShape={shape}
                            minZoom={1}
                            maxZoom={maxZoom}
                            showGrid={shape === "rect"}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropAreaChange={handleCropAreaChange}
                        />
                    </Box>

                    <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary" id="crop-zoom-label">
                            Zoom
                        </Typography>
                        <Slider
                            value={zoom}
                            min={1}
                            max={maxZoom}
                            step={0.01}
                            onChange={handleZoomChange}
                            aria-labelledby="crop-zoom-label"
                            // Dragging the image is the pointer gesture; this
                            // is what a keyboard has, so it must not be hidden
                            // when the image already fills the frame.
                            disabled={maxZoom <= 1}
                        />
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                        Drag the image to choose what stays in frame.
                    </Typography>
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={onCancel} color="inherit" sx={{ color: "text.secondary" }}>
                    Cancel
                </Button>
                <Button onClick={handleConfirm} variant="contained" disabled={area === null}>
                    Use this image
                </Button>
            </DialogActions>
        </Dialog>
    );
};
