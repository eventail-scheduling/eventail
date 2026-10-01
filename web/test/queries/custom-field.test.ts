import { describe, expect, it } from "vitest";
import { customFieldAttributesSchema } from "#/queries/custom-field.ts";

const attributes = (options: unknown) => ({
    externalKey: null,
    target: "per_proposal",
    requirement: "always_optional",
    title: "A customField",
    helperText: "",
    options,
    answerMaxLength: null,
    deadline: null,
    freezeAfter: null,
    confidential: false,
});

describe("customFieldAttributesSchema options", () => {
    it("keeps the fields of each option kind", () => {
        const text = customFieldAttributesSchema.safeParse(
            attributes({ type: "single_line_text", minLength: 1, maxLength: 40 }),
        );
        expect(text.success).toBe(true);
        expect(text.data?.options).toMatchObject({ minLength: 1, maxLength: 40 });

        const choice = customFieldAttributesSchema.safeParse(
            attributes({ type: "single_choice", items: [{ id: "a", label: "A" }] }),
        );
        expect(choice.success).toBe(true);
        expect(choice.data?.options).toMatchObject({ items: [{ id: "a", label: "A" }] });

        const number = customFieldAttributesSchema.safeParse(
            attributes({ type: "number", min: 0, max: 10 }),
        );
        expect(number.success).toBe(true);
        expect(number.data?.options).toMatchObject({ min: 0, max: 10 });

        const simple = customFieldAttributesSchema.safeParse(attributes({ type: "boolean" }));
        expect(simple.success).toBe(true);
    });

    it("rejects an option kind it does not know", () => {
        expect(customFieldAttributesSchema.safeParse(attributes({ type: "color" })).success).toBe(
            false,
        );
    });

    it("rejects a choice option missing its items", () => {
        expect(
            customFieldAttributesSchema.safeParse(attributes({ type: "single_choice" })).success,
        ).toBe(false);
    });
});
