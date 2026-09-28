import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    maxImageDimension,
    type ResolvedImageConstraints,
} from "../../src/support/image-constraints.js";
import { assertImageBytesWithinConstraints, probeImage } from "../../src/support/image-probe.js";
import { createPng } from "../setup/png.js";

const createJpegHeader = (width: number, height: number): Buffer => {
    const bytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
    ]);
    bytes.writeUInt16BE(height, 13);
    bytes.writeUInt16BE(width, 15);

    return bytes;
};

const createLosslessWebp = (width: number, height: number): Buffer => {
    const packed = (width - 1) | ((height - 1) << 14);
    const payload = Buffer.alloc(9);
    payload.writeUInt8(0x2f, 0);
    payload.writeUInt32LE(packed, 1);

    return Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([payload.length + 12, 0, 0, 0]),
        Buffer.from("WEBPVP8L"),
        Buffer.from([payload.length, 0, 0, 0]),
        payload,
    ]);
};

const createExtendedWebp = (width: number, height: number, animated: boolean): Buffer => {
    const payload = Buffer.alloc(10);
    payload.writeUInt8(animated ? 0x02 : 0x00, 0);
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);

    return Buffer.concat([
        Buffer.from("RIFF"),
        Buffer.from([payload.length + 12, 0, 0, 0]),
        Buffer.from("WEBPVP8X"),
        Buffer.from([payload.length, 0, 0, 0]),
        payload,
    ]);
};

describe("probeImage", () => {
    it("probes a png", () => {
        assert.deepEqual(probeImage(createPng(2, 3)), {
            contentType: "image/png",
            width: 2,
            height: 3,
            animated: false,
        });
    });

    it("detects an apng as animated", () => {
        assert.deepEqual(probeImage(createPng(2, 3, { animated: true })), {
            contentType: "image/png",
            width: 2,
            height: 3,
            animated: true,
        });
    });

    it("probes a jpeg", () => {
        assert.deepEqual(probeImage(createJpegHeader(640, 360)), {
            contentType: "image/jpeg",
            width: 640,
            height: 360,
            animated: false,
        });
    });

    it("probes a lossless webp", () => {
        assert.deepEqual(probeImage(createLosslessWebp(2, 2)), {
            contentType: "image/webp",
            width: 2,
            height: 2,
            animated: false,
        });
    });

    it("probes an extended webp and its animation flag", () => {
        assert.deepEqual(probeImage(createExtendedWebp(100, 50, false)), {
            contentType: "image/webp",
            width: 100,
            height: 50,
            animated: false,
        });

        assert.deepEqual(probeImage(createExtendedWebp(100, 50, true)), {
            contentType: "image/webp",
            width: 100,
            height: 50,
            animated: true,
        });
    });

    it("swaps the axes for a rotated EXIF orientation", async () => {
        const sharp = (await import("sharp")).default;
        const rotated = await sharp(createPng(640, 360))
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();

        assert.deepEqual(probeImage(rotated), {
            contentType: "image/jpeg",
            width: 360,
            height: 640,
            animated: false,
        });
    });

    it("returns null for unrecognized bytes", () => {
        assert.equal(probeImage(Buffer.from("definitely not an image")), null);
        assert.equal(probeImage(Buffer.alloc(0)), null);
    });

    it("returns null for a truncated png", () => {
        assert.equal(probeImage(createPng(2, 3).subarray(0, 10)), null);
    });
});

describe("assertImageBytesWithinConstraints", () => {
    const anySize: ResolvedImageConstraints = {
        minWidth: 1,
        minHeight: 1,
        maxWidth: 1920,
        maxHeight: 1080,
        aspectRatio: null,
    };
    const widescreen: ResolvedImageConstraints = {
        ...anySize,
        aspectRatio: { width: 16, height: 9 },
    };

    const refusalCode = (
        bytes: Buffer,
        contentType: string,
        constraints: ResolvedImageConstraints,
    ): string | undefined => {
        try {
            assertImageBytesWithinConstraints(bytes, contentType, constraints);
        } catch (error) {
            assert.ok(error instanceof JsonApiError);
            return error.errors[0]?.code;
        }

        return undefined;
    };

    it("refuses an animated png and an animated webp", () => {
        assert.equal(
            refusalCode(createPng(2, 3, { animated: true }), "image/png", anySize),
            "animated_image",
        );
        assert.equal(
            refusalCode(createExtendedWebp(100, 50, true), "image/webp", anySize),
            "animated_image",
        );
    });

    it("refuses an image past the format ceiling on either axis", () => {
        const beyond = maxImageDimension + 1;

        assert.equal(
            refusalCode(createJpegHeader(beyond, 1), "image/jpeg", anySize),
            "image_too_large",
        );
        assert.equal(
            refusalCode(createJpegHeader(1, beyond), "image/jpeg", anySize),
            "image_too_large",
        );
        assert.equal(
            refusalCode(
                createJpegHeader(maxImageDimension, maxImageDimension),
                "image/jpeg",
                anySize,
            ),
            undefined,
        );
    });

    it("accepts a forced ratio to within one pixel of width, and no further", () => {
        assert.equal(refusalCode(createPng(800, 450), "image/png", widescreen), undefined);
        assert.equal(refusalCode(createPng(799, 450), "image/png", widescreen), undefined);
        assert.equal(refusalCode(createPng(801, 450), "image/png", widescreen), undefined);
        assert.equal(
            refusalCode(createPng(798, 450), "image/png", widescreen),
            "aspect_ratio_mismatch",
        );
        assert.equal(
            refusalCode(createPng(802, 450), "image/png", widescreen),
            "aspect_ratio_mismatch",
        );
        assert.equal(
            refusalCode(createPng(600, 450), "image/png", widescreen),
            "aspect_ratio_mismatch",
        );
    });

    // Tall enough that one pixel of width is nearly two of height, so the
    // tolerance measured along the wrong axis would refuse it.
    it("measures the tolerance along the width of a portrait image too", () => {
        const portrait: ResolvedImageConstraints = {
            ...anySize,
            aspectRatio: { width: 9, height: 16 },
        };

        assert.equal(refusalCode(createPng(449, 800), "image/png", portrait), undefined);
        assert.equal(
            refusalCode(createPng(448, 800), "image/png", portrait),
            "aspect_ratio_mismatch",
        );
    });

    it("leaves the ratio open when the slot forces none", () => {
        assert.equal(refusalCode(createPng(600, 450), "image/png", anySize), undefined);
    });
});
