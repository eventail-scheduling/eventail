import { describe, expect, it } from "vitest";
import {
    createBuiltInFieldRelationshipSchema,
    createBuiltInFieldStringSchema,
} from "#/components/BuiltInField/schema.ts";

describe("createBuiltInFieldStringSchema", () => {
    describe("an optional field with a minimum", () => {
        const schema = createBuiltInFieldStringSchema("optional", 5, 10);

        it("takes an empty answer", () => {
            expect(schema.safeParse("").data).toBe("");
        });

        it("takes whitespace as no answer at all", () => {
            expect(schema.safeParse("   ").data).toBe("");
        });

        it("refuses an answer below the minimum", () => {
            expect(schema.safeParse("abc").success).toBe(false);
        });

        it("takes an answer that trims into range", () => {
            expect(schema.safeParse("  abcde  ").data).toBe("abcde");
        });

        it("refuses an answer above the maximum", () => {
            expect(schema.safeParse("abcdefghijk").success).toBe(false);
        });
    });

    describe("a required field with a minimum", () => {
        const schema = createBuiltInFieldStringSchema("required", 5, 10);

        it("refuses an empty answer", () => {
            expect(schema.safeParse("").success).toBe(false);
        });

        it("refuses an answer below the minimum", () => {
            expect(schema.safeParse("abc").success).toBe(false);
        });

        it("takes an answer at the minimum", () => {
            expect(schema.safeParse("abcde").data).toBe("abcde");
        });
    });

    describe("a field without bounds", () => {
        it("takes a single character when optional", () => {
            expect(createBuiltInFieldStringSchema("optional").safeParse("a").data).toBe("a");
        });

        it("refuses an empty answer when required", () => {
            expect(createBuiltInFieldStringSchema("required").safeParse("").success).toBe(false);
        });
    });
});

describe("createBuiltInFieldRelationshipSchema", () => {
    describe("an optional field", () => {
        const schema = createBuiltInFieldRelationshipSchema("optional");

        it("takes an untouched autocomplete as no answer", () => {
            expect(schema.safeParse(undefined).data).toBe(null);
        });

        it("takes a cleared autocomplete as no answer", () => {
            expect(schema.safeParse(null).data).toBe(null);
        });

        it("reduces an answer to its id", () => {
            expect(schema.safeParse({ id: "abc" }).data).toBe("abc");
        });
    });

    describe("a required field", () => {
        const schema = createBuiltInFieldRelationshipSchema("required");

        it("refuses an untouched autocomplete", () => {
            expect(schema.safeParse(undefined).success).toBe(false);
        });

        it("refuses a cleared autocomplete", () => {
            expect(schema.safeParse(null).success).toBe(false);
        });

        it("refuses it as a missing value, which the form reads as required", () => {
            expect(schema.safeParse(undefined).error?.issues[0]?.code).toBe("invalid_type");
        });

        it("reduces an answer to its id", () => {
            expect(schema.safeParse({ id: "abc" }).data).toBe("abc");
        });
    });
});
