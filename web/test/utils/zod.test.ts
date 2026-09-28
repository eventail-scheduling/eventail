import { describe, expect, it } from "vitest";
import { z } from "zod/mini";
import { durationSchema, formResolver, plainDateSchema } from "#/utils/zod.ts";

const messageFor = async (schema: z.ZodMiniType, values: unknown): Promise<string | undefined> => {
    const resolver = formResolver(schema as never);
    const result = await resolver(values as never, undefined, {
        fields: {},
        shouldUseNativeValidation: false,
    });

    return (result.errors as Record<string, { message?: string }>).answer?.message;
};

const withAnswer = (answer: z.ZodMiniType) => z.object({ answer });

describe("formResolver", () => {
    it("calls a missing answer required", async () => {
        await expect(messageFor(withAnswer(z.string()), {})).resolves.toBe("Required");
    });

    it("calls an empty answer required", async () => {
        await expect(
            messageFor(withAnswer(z.string().check(z.minLength(1))), { answer: "" }),
        ).resolves.toBe("Required");
    });

    it("calls an empty selection required", async () => {
        await expect(
            messageFor(withAnswer(z.array(z.string()).check(z.minLength(1))), { answer: [] }),
        ).resolves.toBe("Required");
    });

    it("tells a fraction in a whole number field apart from a missing answer", async () => {
        await expect(messageFor(withAnswer(z.int()), { answer: 2.5 })).resolves.toBe(
            "Use a whole number",
        );
        await expect(messageFor(withAnswer(z.int()), {})).resolves.toBe("Required");
    });

    it("gives the bound when an answer is too long", async () => {
        await expect(
            messageFor(withAnswer(z.string().check(z.maxLength(500))), { answer: "x".repeat(600) }),
        ).resolves.toBe("Use at most 500 characters");
    });

    it("gives the bound when an answer is too short", async () => {
        await expect(
            messageFor(withAnswer(z.string().check(z.minLength(5))), { answer: "abc" }),
        ).resolves.toBe("Use at least 5 characters");
    });

    it("counts rather than measures a number below its minimum", async () => {
        await expect(
            messageFor(withAnswer(z.int().check(z.minimum(0))), { answer: -1 }),
        ).resolves.toBe("Must be 0 or more");
    });

    it("counts rather than measures a number above its maximum", async () => {
        await expect(
            messageFor(withAnswer(z.int().check(z.maximum(10))), { answer: 11 }),
        ).resolves.toBe("Must be 10 or less");
    });

    it("leaves a number at a minimum of one alone", async () => {
        await expect(
            messageFor(withAnswer(z.int().check(z.minimum(1))), { answer: 0 }),
        ).resolves.toBe("Must be 1 or more");
    });

    it("keeps the locale's wording for a failure it has nothing better to say about", async () => {
        await expect(messageFor(withAnswer(z.email()), { answer: "nope" })).resolves.toBe(
            "Invalid email address",
        );
    });
});

describe("the temporal schemas", () => {
    it("calls an unanswered date required", async () => {
        await expect(messageFor(withAnswer(plainDateSchema), {})).resolves.toBe("Required");
    });

    it("calls an unanswered duration required", async () => {
        await expect(messageFor(withAnswer(durationSchema), {})).resolves.toBe("Required");
    });

    it("still calls it required once a check is chained on", async () => {
        const schema = durationSchema.check(
            z.refine((duration) => duration.total("minutes") >= 1, { error: "Too short" }),
        );

        await expect(messageFor(withAnswer(schema), {})).resolves.toBe("Required");
    });

    it("leaves a chained check its own message", async () => {
        const schema = durationSchema.check(
            z.refine((duration) => duration.total("minutes") >= 1, { error: "Too short" }),
        );

        await expect(
            messageFor(withAnswer(schema), { answer: Temporal.Duration.from("PT5S") }),
        ).resolves.toBe("Too short");
    });
});
