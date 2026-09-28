import type { AspectRatio, ImageConstraints, UploadLimits } from "#/queries/edition.js";
import { formatSizeLimit } from "./format-size.js";
import { maxSourceBytes } from "./prepare-image.js";

const shortTypeNames: Record<string, string> = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/webp": "WebP",
};

const typeNameFormat = new Intl.ListFormat("en", { type: "disjunction" });

/**
 * Names the types, or nothing at all if one of them has no short name here.
 *
 * Half a list would read as the whole one, so a type the server added and this
 * map has not learned yet has to suppress the sentence rather than shorten it.
 */
const listTypeNames = (contentTypes: string[]): string | null => {
    const names = contentTypes
        .map((contentType) => shortTypeNames[contentType])
        .filter((name) => name !== undefined);

    if (names.length !== contentTypes.length || names.length === 0) {
        return null;
    }

    return typeNameFormat.format(names);
};

/**
 * Says what happens to a picked image, rather than what it has to be already.
 *
 * A forced ratio is not a requirement the speaker has to meet: the client
 * crops to it. Stating it as one sends people away to edit an image that would
 * have been accepted.
 */
const describeCrop = (aspectRatio: AspectRatio | null): string | null => {
    if (aspectRatio === null) {
        return null;
    }

    if (aspectRatio.width === aspectRatio.height) {
        return "cropped to a square";
    }

    return `cropped to ${aspectRatio.width.toString()}:${aspectRatio.height.toString()}`;
};

/**
 * States the rules a picked document has to satisfy.
 *
 * Naming twenty accepted types would bury the size, and the picker's own
 * filter already answers "will it take this one".
 */
export const describeFileConstraints = (uploadLimits: UploadLimits): string =>
    `Up to ${formatSizeLimit(uploadLimits.maxFileSize)}`;

/** States the rules a picked image has to satisfy. */
export const describeImageConstraints = (
    uploadLimits: UploadLimits,
    imageConstraints: ImageConstraints,
): string => {
    const clauses = [
        listTypeNames(uploadLimits.imageContentTypes) ?? "Any image",
        `at least ${imageConstraints.minWidth.toString()} × ${imageConstraints.minHeight.toString()} pixels`,
        // The store's limit applies to the webp this re-encodes to, which a
        // camera photograph clears by a wide margin however big it arrived.
        // Quoting it would send someone off to shrink a file that was fine.
        `up to ${formatSizeLimit(maxSourceBytes)}`,
    ];

    const crop = describeCrop(imageConstraints.aspectRatio);

    if (crop !== null) {
        clauses.push(crop);
    }

    return clauses.join(", ");
};
