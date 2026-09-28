import type { AspectRatio, ImageConstraints } from "#/queries/edition.js";
import type { PreparedFile } from "./useFileUpload.js";

/**
 * A ceiling on what is worth opening, well above any real photograph.
 *
 * It bounds the file rather than the pixels it decodes to, which is the thing
 * that actually costs memory, because nothing can know the pixel count without
 * decoding first. A hostile file can still defeat it; a careless one cannot.
 */
export const maxSourceBytes = 50_000_000;

/**
 * Below the derivative job's 95, so anything lost here is lost for good.
 *
 * Close enough to be invisible at the sizes these images are displayed at.
 */
const webpQuality = 0.92;

export type Dimensions = {
    width: number;
    height: number;
};

export type Rect = Dimensions & {
    x: number;
    y: number;
};

/**
 * Takes the largest centered rectangle of the demanded shape.
 *
 * Where a ratio is forced the server refuses anything else, so an image has to
 * lose its edges somewhere. The middle is the default the crop dialog opens
 * on, and what a field with no dialog settles for.
 */
export const cropToRatio = (source: Dimensions, ratio: AspectRatio | null): Rect => {
    if (ratio === null) {
        return { x: 0, y: 0, width: source.width, height: source.height };
    }

    const wanted = ratio.width / ratio.height;

    if (source.width / source.height > wanted) {
        const width = Math.round(source.height * wanted);
        return { x: Math.round((source.width - width) / 2), y: 0, width, height: source.height };
    }

    const height = Math.round(source.width / wanted);
    return { x: 0, y: Math.round((source.height - height) / 2), width: source.width, height };
};

/**
 * Scales into the organizer's box without dropping under their minimum.
 *
 * The maximum is a target the server's own job can finish, so overshooting it
 * costs nothing; a dimension below the minimum is refused outright. A wide
 * banner shrunk to fit a narrow maximum loses its height first, which is why
 * the scale needs a floor and not only a ceiling. With a forced shape the width
 * comes from the rounded height, since the server measures the ratio as the
 * width the height implies, to within a pixel.
 */
const fitWithin = (source: Dimensions, constraints: ImageConstraints): Dimensions => {
    const ceiling = Math.min(
        1,
        constraints.maxWidth / source.width,
        constraints.maxHeight / source.height,
    );
    const floor = Math.max(
        constraints.minWidth / source.width,
        constraints.minHeight / source.height,
    );
    const scale = Math.min(1, Math.max(ceiling, floor));
    const { aspectRatio } = constraints;
    let height = Math.max(1, Math.round(source.height * scale));

    if (aspectRatio === null) {
        return { width: Math.max(1, Math.round(source.width * scale)), height };
    }

    const widthFor = (forHeight: number): number =>
        Math.max(1, Math.round((forHeight * aspectRatio.width) / aspectRatio.height));

    // A height rounded down can take the derived width under a minimum the
    // scaled source met, which the server refuses as too small.
    while (widthFor(height) < constraints.minWidth) {
        height += 1;
    }

    return { width: widthFor(height), height };
};

const toWebpName = (filename: string): string => {
    const lastDot = filename.lastIndexOf(".");
    const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    return `${stem}.webp`;
};

/** How the decoded image comes back, since a caller may need it before cropping. */
export type DecodedImage = { bitmap: ImageBitmap } | { error: string };

/**
 * Opens the file as pixels, with EXIF rotation applied.
 *
 * The caller owns the bitmap and has to close it. Rotation is baked in because
 * the server validates the dimensions EXIF would have displayed, and the rest
 * of the metadata, GPS included, is dropped along with it.
 */
export const decodeImage = async (file: File): Promise<DecodedImage> => {
    if (file.size > maxSourceBytes) {
        return { error: "The selected image is too large to open." };
    }

    try {
        return { bitmap: await createImageBitmap(file, { imageOrientation: "from-image" }) };
    } catch (decodeError) {
        console.error(decodeError);
        return { error: "The selected file could not be read as an image." };
    }
};

type RenderImageOptions = {
    /** Where the speaker put the frame. The centered maximum when they were not asked. */
    crop?: Rect;
};

/**
 * Re-encodes a decoded image to a webp the server will accept.
 *
 * The canvas output is what gets uploaded, so the shape and the maximum cannot
 * be violated by construction. The minimum is the one rule left to refuse on,
 * since nothing can invent pixels, and it is measured after the crop because
 * that is what decides the size of the result.
 *
 * Does not close the bitmap; whoever decoded it owns it.
 */
export const renderImage = async (
    bitmap: ImageBitmap,
    filename: string,
    constraints: ImageConstraints,
    { crop: chosen }: RenderImageOptions = {},
): Promise<PreparedFile> => {
    const crop = chosen ?? cropToRatio(bitmap, constraints.aspectRatio);

    if (crop.width < constraints.minWidth || crop.height < constraints.minHeight) {
        return {
            error:
                `The selected image must be at least ${constraints.minWidth.toString()}` +
                ` × ${constraints.minHeight.toString()} pixels.`,
        };
    }

    const target = fitWithin(crop, constraints);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext("2d");

    if (context === null) {
        return { error: "The selected image could not be processed." };
    }

    context.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        target.width,
        target.height,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/webp", webpQuality);
    });

    // A canvas that cannot encode webp silently hands back a png, which would
    // be presigned as one thing and refused as another.
    if (blob === null || blob.type !== "image/webp") {
        return { error: "The selected image could not be processed." };
    }

    return { file: new File([blob], toWebpName(filename), { type: "image/webp" }) };
};

/**
 * Finds the tightest zoom that still leaves a crop the server will accept.
 *
 * A cropper that let the frame go under the minimum could only report the
 * mistake afterwards, with the dialog already gone, so it is barred instead.
 *
 * Aimed one pixel clear of each minimum rather than at it: the cropper rounds
 * one side to a whole pixel and then derives the other from the rounded value,
 * so two roundings can cost a pixel between them. Without the margin a source
 * that does clear the minimum is refused at exactly the maximum zoom, which is
 * where a full drag of the slider and the End key both land.
 */
export const maxCropZoom = (source: Dimensions, constraints: ImageConstraints): number => {
    const base = cropToRatio(source, constraints.aspectRatio);
    const limit = Math.min(
        base.width / (constraints.minWidth + 1),
        base.height / (constraints.minHeight + 1),
    );

    return Math.max(1, Math.min(limit, 5));
};
