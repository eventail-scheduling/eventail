import { z } from "zod";

// WebP's per-axis format limit; the client pipeline cannot produce more.
export const maxImageDimension = 16383;

const dimensionSchema = z.int().min(1).max(maxImageDimension).optional();

export const imageConstraintsShape = {
    minWidth: dimensionSchema,
    minHeight: dimensionSchema,
    maxWidth: dimensionSchema,
    maxHeight: dimensionSchema,
    aspectRatio: z
        .strictObject({
            width: z.int().min(1),
            height: z.int().min(1),
        })
        .optional(),
} satisfies Record<string, z.ZodType>;

const imageConstraintsObjectSchema = z.object(imageConstraintsShape);
export type ImageConstraintsObject = z.output<typeof imageConstraintsObjectSchema>;

export type AspectRatio = {
    width: number;
    height: number;
};

export type ImageConstraintDefaults = {
    readonly minWidth: number;
    readonly minHeight: number;
    readonly maxWidth: number;
    readonly maxHeight: number;
};

export type ResolvedImageConstraints = ImageConstraintDefaults & {
    aspectRatio: AspectRatio | null;
};

export const resolveImageConstraints = (
    defaults: ImageConstraintDefaults,
    options: ImageConstraintsObject | undefined,
): ResolvedImageConstraints => ({
    minWidth: options?.minWidth ?? defaults.minWidth,
    minHeight: options?.minHeight ?? defaults.minHeight,
    maxWidth: options?.maxWidth ?? defaults.maxWidth,
    maxHeight: options?.maxHeight ?? defaults.maxHeight,
    aspectRatio: options?.aspectRatio ?? null,
});

type ImageConstraintsPayload = z.core.ParsePayload<{
    [K in keyof ImageConstraintsObject]?: unknown;
}>;

const numberOrUndefined = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;

export const checkImageConstraints =
    (defaults: ImageConstraintDefaults) =>
    (context: ImageConstraintsPayload): void => {
        for (const axis of ["Width", "Height"] as const) {
            const givenMin = numberOrUndefined(context.value[`min${axis}`]);
            const givenMax = numberOrUndefined(context.value[`max${axis}`]);
            const min = givenMin ?? defaults[`min${axis}`];
            const max = givenMax ?? defaults[`max${axis}`];

            if (min <= max) {
                continue;
            }

            if (givenMax !== undefined) {
                context.issues.push({
                    code: "custom",
                    message: `Must be larger or equal to min${axis} (${min.toString()})`,
                    path: [`max${axis}`],
                    input: givenMax,
                });
            } else {
                context.issues.push({
                    code: "custom",
                    message: `Must be smaller or equal to max${axis} (${max.toString()})`,
                    path: [`min${axis}`],
                    input: givenMin,
                });
            }
        }
    };
