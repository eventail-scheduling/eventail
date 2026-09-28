import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    answerMaxLength,
    type CustomFieldOptions,
    createResponseSchema,
    customFieldOptionsSchema,
} from "../../src/support/custom-fields.js";

const RED_ID = "01a00800-0000-7000-8000-000000000001";
const BLUE_ID = "01a00800-0000-7000-8000-000000000002";

describe("number customField", () => {
    it("enforces max as an upper bound", () => {
        const schema = createResponseSchema({ type: "number", min: 1, max: 5 }, true);

        assert.equal(schema.safeParse(3).success, true);
        assert.equal(schema.safeParse(6).success, false);
        assert.equal(schema.safeParse(0).success, false);
    });

    it("honors zero bounds", () => {
        const schema = createResponseSchema({ type: "number", min: 0, max: 0 }, true);

        assert.equal(schema.safeParse(0).success, true);
        assert.equal(schema.safeParse(1).success, false);
        assert.equal(schema.safeParse(-1).success, false);
    });

    it("allows unbounded customFields", () => {
        const schema = createResponseSchema({ type: "number" }, true);

        assert.equal(schema.safeParse(1_000_000).success, true);
    });
});

describe("text customField", () => {
    it("holds an optional answer to its minimum once one is given", () => {
        const schema = createResponseSchema({ type: "single_line_text", minLength: 5 }, false);

        assert.equal(schema.safeParse("   ").data, "");
        assert.equal(schema.safeParse("no").error?.issues[0]?.code, "too_small");
        assert.equal(schema.safeParse(" a mic ").data, "a mic");
    });
});

describe("answerMaxLength", () => {
    it("serves the ceiling the answer schema enforces", () => {
        const cases: CustomFieldOptions[] = [
            { type: "single_line_text", maxLength: 40 },
            { type: "single_line_text" },
            { type: "multi_line_text" },
            { type: "multi_line_text", minLength: 20_000 },
        ];

        for (const options of cases) {
            const served = answerMaxLength(options);
            const schema = createResponseSchema(options, false);
            const atCap = "x".repeat(served ?? 30_000);

            assert.equal(schema.safeParse(atCap).success, true, JSON.stringify(options));
            assert.equal(schema.safeParse(`${atCap}x`).success, served === null);
        }

        assert.equal(answerMaxLength({ type: "number" }), null);
    });
});

describe("choice customField options", () => {
    for (const type of ["single_choice", "multiple_choice"]) {
        it(`rejects empty items for ${type}`, () => {
            const result = customFieldOptionsSchema.safeParse({ type, items: [] });

            assert.equal(result.success, false);
        });

        it(`rejects duplicate item ids for ${type}`, () => {
            const result = customFieldOptionsSchema.safeParse({
                type,
                items: [
                    { id: RED_ID, label: "Red" },
                    { id: RED_ID, label: "Also red" },
                ],
            });

            assert.equal(result.success, false);
            assert.deepEqual(result.error?.issues[0]?.path, ["items", 1, "id"]);
        });

        it(`rejects an item id that is not a uuid for ${type}`, () => {
            const result = customFieldOptionsSchema.safeParse({
                type,
                items: [{ id: "red", label: "Red" }],
            });

            assert.equal(result.success, false);
        });

        it(`rejects a blank item label for ${type}`, () => {
            const result = customFieldOptionsSchema.safeParse({
                type,
                items: [{ id: RED_ID, label: "   " }],
            });

            assert.equal(result.success, false);
        });

        it(`accepts distinct items for ${type}`, () => {
            const result = customFieldOptionsSchema.safeParse({
                type,
                items: [
                    { id: RED_ID, label: "Red" },
                    { id: BLUE_ID, label: "Blue" },
                ],
            });

            assert.equal(result.success, true);
        });
    }
});
