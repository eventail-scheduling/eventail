import { JsonApiError } from "@jsonapi-serde/server/common";
import { imageSize } from "image-size";
import { match } from "ts-pattern";
import { maxImageDimension, type ResolvedImageConstraints } from "./image-constraints.js";

export const imageSlotContentTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageSlotContentType = (typeof imageSlotContentTypes)[number];

export type ProbedImage = {
    contentType: ImageSlotContentType;
    width: number;
    height: number;
    animated: boolean;
};

const contentTypesByProbedType: Partial<Record<string, ImageSlotContentType>> = {
    png: "image/png",
    jpg: "image/jpeg",
    webp: "image/webp",
};

const fourCc = (view: DataView, offset: number): string =>
    String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3),
    );

const hasApngControlChunk = (view: DataView): boolean => {
    let offset = 8;

    while (offset + 8 <= view.byteLength) {
        const chunkType = fourCc(view, offset + 4);

        if (chunkType === "acTL") {
            return true;
        }

        if (chunkType === "IDAT" || chunkType === "IEND") {
            return false;
        }

        offset += 12 + view.getUint32(offset);
    }

    return false;
};

const hasWebpAnimationFlag = (view: DataView): boolean => {
    if (view.byteLength < 21 || fourCc(view, 12) !== "VP8X") {
        return false;
    }

    return (view.getUint8(20) & 0x02) !== 0;
};

const isAnimated = (bytes: Uint8Array, contentType: ImageSlotContentType): boolean => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    return match(contentType)
        .with("image/png", () => hasApngControlChunk(view))
        .with("image/webp", () => hasWebpAnimationFlag(view))
        .with("image/jpeg", () => false)
        .exhaustive();
};

export const probeImage = (bytes: Uint8Array): ProbedImage | null => {
    let width: number;
    let height: number;
    let probedType: string | undefined;
    let orientation: number | undefined;

    try {
        ({ width, height, type: probedType, orientation } = imageSize(bytes));
    } catch {
        return null;
    }

    const contentType = contentTypesByProbedType[probedType ?? ""];

    if (contentType === undefined) {
        return null;
    }

    // Constraints apply to what is displayed rather than to what is stored.
    if (orientation !== undefined && orientation >= 5 && orientation <= 8) {
        [width, height] = [height, width];
    }

    return { contentType, width, height, animated: isAnimated(bytes, contentType) };
};

type ImageUploadHead = {
    contentType: string | undefined;
    contentLength: number | undefined;
};

const invalidImageError = (code: string, detail: string): JsonApiError =>
    new JsonApiError({
        status: "422",
        code,
        title: "Invalid image",
        detail,
    });

export const assertImageUploadHead = (head: ImageUploadHead, maxFileSize: number): void => {
    if (!imageSlotContentTypes.includes(head.contentType as ImageSlotContentType)) {
        throw invalidImageError(
            "unsupported_image_type",
            `Content type must be one of: ${imageSlotContentTypes.join(", ")}`,
        );
    }

    if (head.contentLength !== undefined && head.contentLength > maxFileSize) {
        throw invalidImageError(
            "image_file_too_large",
            `File exceeds the maximum size of ${maxFileSize.toString()} bytes`,
        );
    }
};

/**
 * Reads the header and stops there, deliberately.
 *
 * The whole file is already in memory and decoding it would catch more. The
 * presigned upload pins Content-MD5, which the store was verified to enforce,
 * so an honest upload cannot arrive corrupt and anything that fails to decode
 * was built to. A decode here would therefore run on every legitimate upload to
 * catch a file nobody sent by accident, and would hand out a way to make this
 * route do expensive work on demand. The job decodes instead, where it costs an
 * attacker nothing anyone else pays for, and throws the descriptor away.
 */
export const assertImageBytesWithinConstraints = (
    bytes: Uint8Array,
    contentType: string | undefined,
    constraints: ResolvedImageConstraints,
): void => {
    const probed = probeImage(bytes);

    if (probed === null || probed.contentType !== contentType) {
        throw invalidImageError(
            "image_type_mismatch",
            "File content does not match the declared content type",
        );
    }

    if (probed.animated) {
        throw invalidImageError("animated_image", "Animated images are not allowed");
    }

    if (probed.width < constraints.minWidth || probed.height < constraints.minHeight) {
        throw invalidImageError(
            "image_too_small",
            `Image must be at least ${constraints.minWidth.toString()}x${constraints.minHeight.toString()} pixels`,
        );
    }

    // The organizer maximum is the processing job's downscale target, not a
    // rejection; the format ceiling is what rails the job's decoder.
    if (probed.width > maxImageDimension || probed.height > maxImageDimension) {
        throw invalidImageError(
            "image_too_large",
            `Image must be at most ${maxImageDimension.toString()} pixels per axis`,
        );
    }

    const { aspectRatio } = constraints;

    if (aspectRatio) {
        const expectedWidth = (probed.height * aspectRatio.width) / aspectRatio.height;

        if (Math.abs(probed.width - expectedWidth) > 1) {
            throw invalidImageError(
                "aspect_ratio_mismatch",
                `Image must have an aspect ratio of ${aspectRatio.width.toString()}:${aspectRatio.height.toString()}`,
            );
        }
    }
};
