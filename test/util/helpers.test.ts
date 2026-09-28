import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeLikePattern, patchObject } from "../../src/util/helpers.js";

describe("patchObject", () => {
    it("applies falsy values that are defined", () => {
        const target = {
            flag: true,
            count: 7,
            label: "filled",
            note: "kept" as string | null,
        };

        patchObject(target, { flag: false, count: 0, label: "", note: null });

        assert.deepEqual(target, { flag: false, count: 0, label: "", note: null });
    });

    it("skips undefined values", () => {
        const target = { flag: true, label: "kept" };

        patchObject(target, { flag: undefined, label: "changed" });

        assert.deepEqual(target, { flag: true, label: "changed" });
    });
});

describe("escapeLikePattern", () => {
    it("leaves an ordinary term alone", () => {
        assert.equal(escapeLikePattern("scheduling at scale"), "scheduling at scale");
    });

    it("escapes the wildcards", () => {
        assert.equal(escapeLikePattern("50% off"), "50\\% off");
        assert.equal(escapeLikePattern("a_b"), "a\\_b");
    });

    it("escapes the escape character itself", () => {
        assert.equal(escapeLikePattern("back\\slash"), "back\\\\slash");
    });

    // A second pass would escape the backslashes the first one added, so a
    // term carrying both has to come out of a single pass.
    it("does not escape what it just escaped", () => {
        assert.equal(escapeLikePattern("\\%"), "\\\\\\%");
    });
});
