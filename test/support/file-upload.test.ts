import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    fileDescriptorInputSchema,
    serializeImageFileDescriptor,
} from "../../src/support/file-upload.js";
import { appConfig } from "../../src/util/app-config.js";

const TEMP_KEY = "temp/0189d2f0-1234-7abc-8def-0123456789ab.png";
const STORED_KEY = "0189d2f0-0000-7abc-8def-0123456789ab/sessions/abc/image/def.png";

const issuePaths = (result: ReturnType<typeof fileDescriptorInputSchema.safeParse>): string[] => {
    assert.equal(result.success, false);
    return result.error.issues.map((issue) => issue.path.join("."));
};

describe("fileDescriptorInputSchema", () => {
    it("accepts a temp descriptor", () => {
        const result = fileDescriptorInputSchema.safeParse({
            key: TEMP_KEY,
            filename: "teaser.png",
        });

        assert.equal(result.success, true);
    });

    it("rejects a temp key that is not a uuid upload path", () => {
        for (const key of ["temp/evil.png", "temp/../secret.png", "temp/0189d2f0.png"]) {
            const result = fileDescriptorInputSchema.safeParse({
                key,
                filename: "teaser.png",
            });

            assert.deepEqual(issuePaths(result), ["key"], key);
        }
    });

    it("rejects a word in place of an upload", () => {
        assert.equal(fileDescriptorInputSchema.safeParse("keep").success, false);
    });

    it("rejects a stored key, since only an upload may be named", () => {
        const result = fileDescriptorInputSchema.safeParse({
            key: STORED_KEY,
            filename: "teaser.png",
        });

        assert.deepEqual(issuePaths(result), ["key"]);
    });

    it("rejects control and directional characters in the filename", () => {
        for (const filename of ["tea\u0000ser.png", "tea\u202egnp.exe", "tea\u2028ser.png"]) {
            const result = fileDescriptorInputSchema.safeParse({
                key: TEMP_KEY,
                filename,
            });

            assert.deepEqual(issuePaths(result), ["filename"], JSON.stringify(filename));
        }
    });

    it("rejects an etag, which proves nothing about the upload", () => {
        const result = fileDescriptorInputSchema.safeParse({
            key: TEMP_KEY,
            filename: "teaser.png",
            etag: '"d41d8cd98f00b204e9800998ecf8427e"',
        });

        assert.equal(result.success, false);
    });

    it("rejects oversized fields", () => {
        const result = fileDescriptorInputSchema.safeParse({
            key: `temp/${"a".repeat(256)}.png`,
            filename: "a".repeat(256),
        });

        assert.deepEqual([...new Set(issuePaths(result))].sort(), ["filename", "key"]);
    });
});

describe("serializeImageFileDescriptor", () => {
    const base = { key: STORED_KEY, filename: "teaser.png" };

    it("reports an image still carrying its ingest thumbnail as processing", () => {
        const serialized = serializeImageFileDescriptor({ ...base, thumbnailKey: STORED_KEY });

        assert.deepEqual(serialized, {
            ...base,
            url: `${appConfig.s3.publicBaseUrl}/${STORED_KEY}`,
            thumbnailUrl: `${appConfig.s3.publicBaseUrl}/${STORED_KEY}`,
            processing: true,
        });
    });

    it("reports an image with its own thumbnail as processed", () => {
        const thumbnailKey = `${STORED_KEY}-thumb.webp`;
        const serialized = serializeImageFileDescriptor({ ...base, thumbnailKey });

        assert.equal(serialized?.processing, false);
        assert.equal(serialized?.thumbnailUrl, `${appConfig.s3.publicBaseUrl}/${thumbnailKey}`);
    });

    it("passes a missing image through", () => {
        assert.equal(serializeImageFileDescriptor(null), null);
    });
});
