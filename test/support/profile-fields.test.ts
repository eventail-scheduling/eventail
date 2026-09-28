import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    profileFieldOptionsSchema,
    serializedProfileFieldSpecs,
} from "../../src/support/profile-fields.js";

describe("profile fields", () => {
    it("accepts avatar options carrying a requirement", () => {
        const result = profileFieldOptionsSchema.safeParse({
            avatar: { requirement: "required", label: "Portrait" },
        });

        assert.equal(result.success, true);
    });

    it("rejects constraint overrides on the avatar", () => {
        const result = profileFieldOptionsSchema.safeParse({
            avatar: { requirement: "optional", minWidth: 128 },
        });

        assert.equal(result.success, false);
        assert.equal(result.error.issues[0]?.code, "unrecognized_keys");
        assert.deepEqual(result.error.issues[0]?.path, ["avatar"]);
    });

    it("asks for the address organizers reach a host on", () => {
        assert.equal(serializedProfileFieldSpecs.emailAddress.forceRequired, true);
    });

    it("refuses a requirement on a field that is always required", () => {
        const result = profileFieldOptionsSchema.safeParse({
            emailAddress: { requirement: "optional" },
        });

        assert.equal(result.success, false);
        assert.equal(result.error.issues[0]?.code, "unrecognized_keys");
        assert.deepEqual(result.error.issues[0]?.path, ["emailAddress"]);
    });

    // A patch replaces the whole map, so an options map missing a field is the
    // ordinary state rather than only an old one.
    it("takes an options map that names no force-required field at all", () => {
        const result = profileFieldOptionsSchema.safeParse({
            biography: { requirement: "optional" },
        });

        assert.equal(result.success, true);
    });

    it("serializes the fixed avatar constraints", () => {
        assert.deepEqual(serializedProfileFieldSpecs.avatar, {
            label: "Avatar",
            forceRequired: false,
            type: "file",
            imageConstraints: {
                minWidth: 64,
                minHeight: 64,
                maxWidth: 512,
                maxHeight: 512,
                aspectRatio: { width: 1, height: 1 },
            },
        });
    });
});
