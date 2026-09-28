import { z } from "zod/mini";
import {
    type BuiltInFieldOptions,
    builtInFieldRequirementSchema,
    type ImageDefaults,
    type SessionFieldSpec,
} from "#/queries/edition.js";

// WebP's per-axis format limit; the server rejects anything above it.
export const maxImageDimension = 16383;

const optionalTrimmed = z.pipe(
    z.string(),
    z.transform((value) => value.trim()),
);

const optionalInt = (maximum?: number) =>
    z.pipe(
        z.nullish(
            z.int().check(z.minimum(1), ...(maximum === undefined ? [] : [z.maximum(maximum)])),
        ),
        z.transform((input) => input ?? undefined),
    );

const lengthSchema = optionalInt();
const dimensionSchema = optionalInt(maxImageDimension);
const ratioPartSchema = optionalInt();

type ConstraintCheckValues = {
    minLength?: number | undefined;
    maxLength?: number | undefined;
    minWidth?: number | undefined;
    minHeight?: number | undefined;
    maxWidth?: number | undefined;
    maxHeight?: number | undefined;
    aspectRatioWidth?: number | undefined;
    aspectRatioHeight?: number | undefined;
};

type ConstraintIssue = {
    message: string;
    path: string[];
    input: unknown;
};

const lengthOrderIssues = (values: ConstraintCheckValues): ConstraintIssue[] =>
    values.minLength !== undefined &&
    values.maxLength !== undefined &&
    values.minLength > values.maxLength
        ? [
              {
                  message: "Must not be above the maximum",
                  path: ["minLength"],
                  input: values.minLength,
              },
          ]
        : [];

const imageBoundIssues = (
    defaults: ImageDefaults | undefined,
    values: ConstraintCheckValues,
): ConstraintIssue[] => {
    if (!defaults) {
        return [];
    }

    const issues: ConstraintIssue[] = [];

    for (const axis of ["Width", "Height"] as const) {
        const givenMin = values[`min${axis}`];
        const givenMax = values[`max${axis}`];
        const min = givenMin ?? defaults[`min${axis}`];
        const max = givenMax ?? defaults[`max${axis}`];

        if (min <= max) {
            continue;
        }

        if (givenMax !== undefined) {
            issues.push({
                message: `Must not be below the minimum (${min.toString()})`,
                path: [`max${axis}`],
                input: givenMax,
            });
        } else {
            issues.push({
                message: `Must not be above the maximum (${max.toString()})`,
                path: [`min${axis}`],
                input: givenMin,
            });
        }
    }

    return issues;
};

const aspectRatioIssues = (values: ConstraintCheckValues): ConstraintIssue[] =>
    (values.aspectRatioWidth === undefined) === (values.aspectRatioHeight === undefined)
        ? []
        : [
              {
                  message: "Needed to form a ratio",
                  path: [
                      values.aspectRatioWidth === undefined
                          ? "aspectRatioWidth"
                          : "aspectRatioHeight",
                  ],
                  input: undefined,
              },
          ];

export const buildBuiltInFieldSchema = (spec: SessionFieldSpec) =>
    z
        .object({
            label: optionalTrimmed,
            helperText: optionalTrimmed,
            requirement: builtInFieldRequirementSchema,
            minLength: lengthSchema,
            maxLength: lengthSchema,
            minWidth: dimensionSchema,
            minHeight: dimensionSchema,
            maxWidth: dimensionSchema,
            maxHeight: dimensionSchema,
            aspectRatioWidth: ratioPartSchema,
            aspectRatioHeight: ratioPartSchema,
        })
        .check((context) => {
            const issues = [
                ...lengthOrderIssues(context.value),
                ...imageBoundIssues(spec.imageDefaults, context.value),
                ...aspectRatioIssues(context.value),
            ];

            for (const issue of issues) {
                context.issues.push({ code: "custom", ...issue });
            }
        });

export type BuiltInFieldValues = z.input<ReturnType<typeof buildBuiltInFieldSchema>>;
export type BuiltInFieldTransformedValues = z.output<ReturnType<typeof buildBuiltInFieldSchema>>;

type FieldOption = BuiltInFieldOptions[string] | undefined;

export const createBuiltInFieldDefaultValues = (options: FieldOption): BuiltInFieldValues => ({
    label: options?.label ?? "",
    helperText: options?.helperText ?? "",
    requirement: options?.requirement ?? "required",
    minLength: options?.minLength ?? null,
    maxLength: options?.maxLength ?? null,
    minWidth: options?.minWidth ?? null,
    minHeight: options?.minHeight ?? null,
    maxWidth: options?.maxWidth ?? null,
    maxHeight: options?.maxHeight ?? null,
    aspectRatioWidth: options?.aspectRatio?.width ?? null,
    aspectRatioHeight: options?.aspectRatio?.height ?? null,
});

const managedKeys = [
    "label",
    "helperText",
    "requirement",
    "minLength",
    "maxLength",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "aspectRatio",
] as const;

const lengthEntries = (values: BuiltInFieldTransformedValues): Record<string, number> => ({
    ...(values.minLength === undefined ? {} : { minLength: values.minLength }),
    ...(values.maxLength === undefined ? {} : { maxLength: values.maxLength }),
});

const imageConstraintEntries = (
    values: BuiltInFieldTransformedValues,
): Record<string, unknown> => ({
    ...(values.minWidth === undefined ? {} : { minWidth: values.minWidth }),
    ...(values.minHeight === undefined ? {} : { minHeight: values.minHeight }),
    ...(values.maxWidth === undefined ? {} : { maxWidth: values.maxWidth }),
    ...(values.maxHeight === undefined ? {} : { maxHeight: values.maxHeight }),
    ...(values.aspectRatioWidth !== undefined && values.aspectRatioHeight !== undefined
        ? {
              aspectRatio: {
                  width: values.aspectRatioWidth,
                  height: values.aspectRatioHeight,
              },
          }
        : {}),
});

/**
 * Rebuilds a field's options from the form.
 *
 * Every key the form does not manage is kept untouched: position, plus anything
 * only newer servers know.
 */
export const buildBuiltInFieldOption = (
    spec: SessionFieldSpec,
    options: FieldOption,
    values: BuiltInFieldTransformedValues,
): NonNullable<FieldOption> => {
    const passthrough: Record<string, unknown> = { ...options };

    for (const key of managedKeys) {
        delete passthrough[key];
    }

    return {
        ...passthrough,
        ...(values.label === "" ? {} : { label: values.label }),
        ...(values.helperText === "" ? {} : { helperText: values.helperText }),
        ...(spec.forceRequired ? {} : { requirement: values.requirement }),
        ...(spec.type === "string" ? lengthEntries(values) : {}),
        ...(spec.imageDefaults === undefined ? {} : imageConstraintEntries(values)),
    };
};
