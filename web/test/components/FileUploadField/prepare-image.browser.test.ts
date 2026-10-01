import { describe, expect, it } from "vitest";
import {
    type Dimensions,
    decodeImage,
    type Rect,
    renderImage,
} from "#/components/FileUploadField/prepare-image.ts";
import type { ImageConstraints } from "#/queries/edition.ts";

const constraints = (overrides: Partial<ImageConstraints> = {}): ImageConstraints => ({
    minWidth: 640,
    minHeight: 360,
    maxWidth: 3840,
    maxHeight: 2160,
    aspectRatio: null,
    ...overrides,
});

/** Draws a PNG whose halves differ in color, so a crop can be told from the whole image. */
const sourceFile = async (width: number, height: number): Promise<File> => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (context === null) {
        throw new Error("no 2d context");
    }

    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, width / 2, height);
    context.fillStyle = "#0000ff";
    context.fillRect(width / 2, 0, width / 2, height);

    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
    });

    if (blob === null) {
        throw new Error("no blob");
    }

    return new File([blob], "source.png", { type: "image/png" });
};

const rendered = async (source: File, imageConstraints: ImageConstraints, crop?: Rect) => {
    const decoded = await decodeImage(source);

    if ("error" in decoded) {
        throw new Error(decoded.error);
    }

    try {
        return await renderImage(decoded.bitmap, source.name, imageConstraints, { crop });
    } finally {
        decoded.bitmap.close();
    }
};

const sizeOf = async (file: File): Promise<Dimensions> => {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();

    return size;
};

describe("renderImage", () => {
    it("re-encodes to webp whatever came in", async () => {
        const result = await rendered(await sourceFile(1600, 900), constraints());

        expect(result).toHaveProperty("file");

        if ("file" in result) {
            expect(result.file.type).toBe("image/webp");
            expect(result.file.name).toBe("source.webp");
        }
    });

    it("leaves an image already inside the box at its own size", async () => {
        const result = await rendered(await sourceFile(700, 400), constraints());

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        await expect(sizeOf(result.file)).resolves.toEqual({ width: 700, height: 400 });
    });

    it("scales an oversized image down into the box", async () => {
        const result = await rendered(
            await sourceFile(4000, 3000),
            constraints({ maxWidth: 2880, maxHeight: 2160 }),
        );

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        await expect(sizeOf(result.file)).resolves.toEqual({ width: 2880, height: 2160 });
    });

    it("stops scaling at the minimum rather than at the maximum", async () => {
        const result = await rendered(await sourceFile(8000, 400), constraints());

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        await expect(sizeOf(result.file)).resolves.toEqual({ width: 7200, height: 360 });
    });

    // The API refuses a width more than a pixel from what the height implies,
    // and rounding both axes on their own lands 1.67 px off here.
    it("keeps a wide forced shape within the server's pixel after scaling", async () => {
        const result = await rendered(
            await sourceFile(4000, 3000),
            constraints({ aspectRatio: { width: 21, height: 9 } }),
        );

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        const { width, height } = await sizeOf(result.file);
        expect(Math.abs(width - (height * 21) / 9)).toBeLessThanOrEqual(1);
    });

    it("keeps a derived width at the minimum the scaled source met", async () => {
        const result = await rendered(
            await sourceFile(2191, 939),
            constraints({
                minWidth: 1200,
                minHeight: 64,
                maxHeight: 400,
                aspectRatio: { width: 21, height: 9 },
            }),
        );

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        const { width, height } = await sizeOf(result.file);
        expect(width).toBeGreaterThanOrEqual(1200);
        expect(Math.abs(width - (height * 21) / 9)).toBeLessThanOrEqual(1);
    });

    it("crops to a forced shape when nobody chose a frame", async () => {
        const result = await rendered(
            await sourceFile(1200, 800),
            constraints({
                minWidth: 64,
                minHeight: 64,
                maxWidth: 512,
                maxHeight: 512,
                aspectRatio: { width: 1, height: 1 },
            }),
        );

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        await expect(sizeOf(result.file)).resolves.toEqual({ width: 512, height: 512 });
    });

    it("takes the frame it is given over the centered default", async () => {
        const source = await sourceFile(1200, 800);
        const square = constraints({
            minWidth: 64,
            minHeight: 64,
            maxWidth: 512,
            maxHeight: 512,
            aspectRatio: { width: 1, height: 1 },
        });
        // Wholly inside the red left half, which the centered crop would split.
        const result = await rendered(source, square, { x: 0, y: 0, width: 400, height: 400 });

        if (!("file" in result)) {
            throw new Error(result.error);
        }

        const bitmap = await createImageBitmap(result.file);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        const middle = canvas
            .getContext("2d")
            ?.getImageData(Math.round(bitmap.width / 2), Math.round(bitmap.height / 2), 1, 1).data;
        bitmap.close();

        expect(middle?.[0]).toBeGreaterThan(200);
        expect(middle?.[2]).toBeLessThan(60);
    });

    it("refuses an image under the minimum, which nothing can invent pixels for", async () => {
        const result = await rendered(await sourceFile(320, 180), constraints());

        expect(result).toEqual({
            error: "The selected image must be at least 640 × 360 pixels.",
        });
    });

    // The crop decides the size of the result, so a frame pulled under the
    // minimum has to be refused even though the image it came from clears it.
    it("measures the minimum against the frame, not the image behind it", async () => {
        const result = await rendered(await sourceFile(4000, 3000), constraints(), {
            x: 0,
            y: 0,
            width: 400,
            height: 300,
        });

        expect(result).toEqual({
            error: "The selected image must be at least 640 × 360 pixels.",
        });
    });
});
