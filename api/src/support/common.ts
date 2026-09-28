import { z } from "zod";

export const lengthObjectShape = {
    minLength: z.int().min(1).optional(),
    maxLength: z.int().min(1).optional(),
} satisfies Record<string, z.ZodType>;

type LengthBounds = {
    minLength?: unknown;
    maxLength?: unknown;
};

export const checkLengthOrder = (context: z.core.ParsePayload<LengthBounds>): void => {
    const { minLength, maxLength } = context.value;

    if (typeof minLength !== "number" || typeof maxLength !== "number") {
        return;
    }

    if (minLength > maxLength) {
        context.issues.push({
            code: "custom",
            message: "Must be larger or equal to minLength",
            path: ["maxLength"],
            input: maxLength,
        });
    }
};

export const lengthObjectSchema = z.object(lengthObjectShape).check(checkLengthOrder);
export type LengthObject = z.output<typeof lengthObjectSchema>;
