import { describe, expect, it } from "vitest";
import { cropToRatio, maxCropZoom } from "#/components/FileUploadField/prepare-image.ts";
import type { ImageConstraints } from "#/queries/edition.ts";

const constraints = (overrides: Partial<ImageConstraints> = {}): ImageConstraints => ({
    minWidth: 640,
    minHeight: 360,
    maxWidth: 3840,
    maxHeight: 2160,
    aspectRatio: null,
    ...overrides,
});

describe("cropToRatio", () => {
    it("keeps the whole image when no shape is forced", () => {
        expect(cropToRatio({ width: 1600, height: 900 }, null)).toEqual({
            x: 0,
            y: 0,
            width: 1600,
            height: 900,
        });
    });

    it("trims the sides of an image wider than the shape", () => {
        expect(cropToRatio({ width: 1600, height: 900 }, { width: 1, height: 1 })).toEqual({
            x: 350,
            y: 0,
            width: 900,
            height: 900,
        });
    });

    it("trims the top and bottom of an image taller than the shape", () => {
        expect(cropToRatio({ width: 900, height: 1600 }, { width: 1, height: 1 })).toEqual({
            x: 0,
            y: 350,
            width: 900,
            height: 900,
        });
    });

    it("leaves an image that already has the shape alone", () => {
        expect(cropToRatio({ width: 1600, height: 900 }, { width: 16, height: 9 })).toEqual({
            x: 0,
            y: 0,
            width: 1600,
            height: 900,
        });
    });
});

describe("maxCropZoom", () => {
    it("allows no zoom at all when the whole image only just clears the minimum", () => {
        const zoom = maxCropZoom(
            { width: 641, height: 427 },
            constraints({ aspectRatio: { width: 3, height: 2 } }),
        );

        expect(zoom).toBe(1);
    });

    it("keeps a pixel of margin rather than aiming at the minimum", () => {
        const zoom = maxCropZoom(
            { width: 1000, height: 1000 },
            constraints({
                minWidth: 300,
                minHeight: 300,
                aspectRatio: { width: 1, height: 1 },
            }),
        );

        expect(zoom).toBeCloseTo(1000 / 301, 5);
        expect(zoom).toBeLessThan(1000 / 300);
    });

    it("never drops below 1, however small the image is against the minimum", () => {
        const zoom = maxCropZoom(
            { width: 640, height: 360 },
            constraints({ aspectRatio: { width: 16, height: 9 } }),
        );

        expect(zoom).toBe(1);
    });

    it("stops at 5, past which a speaker is framing single pixels", () => {
        const zoom = maxCropZoom(
            { width: 4000, height: 4000 },
            constraints({ minWidth: 64, minHeight: 64, aspectRatio: { width: 1, height: 1 } }),
        );

        expect(zoom).toBe(5);
    });
});
