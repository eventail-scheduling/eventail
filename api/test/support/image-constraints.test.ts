import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionFieldOptionsSchema } from "../../src/support/session-fields.js";

const parseTeaserOptions = (options: Record<string, unknown>) =>
    sessionFieldOptionsSchema.safeParse({
        teaserImage: { requirement: "optional", ...options },
    });

describe("image constraints", () => {
    it("accepts overrides within the resolved bounds", () => {
        const result = parseTeaserOptions({
            minWidth: 800,
            maxHeight: 1080,
            aspectRatio: { width: 16, height: 9 },
        });

        assert.equal(result.success, true);
    });

    it("flags a minimum conflicting with the default maximum", () => {
        const result = parseTeaserOptions({ minWidth: 5000 });

        assert.equal(result.success, false);
        assert.deepEqual(result.error.issues[0]?.path, ["teaserImage", "minWidth"]);
        assert.match(result.error.issues[0].message, /maxWidth \(3840\)/);
    });

    it("flags a maximum conflicting with the default minimum", () => {
        const result = parseTeaserOptions({ maxHeight: 200 });

        assert.equal(result.success, false);
        assert.deepEqual(result.error.issues[0]?.path, ["teaserImage", "maxHeight"]);
        assert.match(result.error.issues[0].message, /minHeight \(360\)/);
    });

    it("flags the maximum when both explicit values conflict", () => {
        const result = parseTeaserOptions({ minWidth: 2000, maxWidth: 1000 });

        assert.equal(result.success, false);
        assert.deepEqual(result.error.issues[0]?.path, ["teaserImage", "maxWidth"]);
        assert.match(result.error.issues[0].message, /minWidth \(2000\)/);
    });
});
