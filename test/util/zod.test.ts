import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { durationSchema } from "../../src/util/zod.js";

describe("durationSchema", () => {
    it("accepts hour and minute durations", () => {
        assert.equal(durationSchema.safeParse("PT90M").success, true);
        assert.equal(durationSchema.safeParse("PT2H30M").success, true);
    });

    it("rejects negative durations", () => {
        assert.equal(durationSchema.safeParse("-PT30M").success, false);
    });

    it("rejects seconds", () => {
        assert.equal(durationSchema.safeParse("PT30S").success, false);
    });

    it("rejects calendar durations instead of throwing", () => {
        assert.equal(durationSchema.safeParse("P1D").success, false);
        assert.equal(durationSchema.safeParse("P1W").success, false);
        assert.equal(durationSchema.safeParse("P1M").success, false);
        assert.equal(durationSchema.safeParse("P1Y").success, false);
    });

    it("rejects durations above 24 hours", () => {
        assert.equal(durationSchema.safeParse("PT25H").success, false);
    });
});
