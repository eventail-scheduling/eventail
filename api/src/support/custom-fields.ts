import { match, P } from "ts-pattern";
import { z } from "zod";
import { zt } from "zod-temporal";
import {
    DEFAULT_MULTI_LINE_MAX_LENGTH,
    DEFAULT_SINGLE_LINE_MAX_LENGTH,
    nameSchema,
} from "../util/zod.js";
import { type LengthObject, lengthObjectSchema } from "./common.js";
import { fileDescriptorInputSchema } from "./file-upload.js";

type CreateResponseSchema<
    TOptionsSchema extends z.ZodObject = z.ZodObject,
    TResponseSchema extends z.ZodType = z.ZodType,
> = (options: z.output<TOptionsSchema>, required: boolean) => TResponseSchema;
type CustomFieldSpec<
    TOptionsSchema extends z.ZodObject = z.ZodObject,
    TResponseSchema extends z.ZodType = z.ZodType,
> = {
    optionsSchema?: TOptionsSchema;
    createResponseSchema: CreateResponseSchema<TOptionsSchema, TResponseSchema>;
};

const createCustomFieldSpec = <
    TOptionsSchema extends z.ZodObject = z.ZodObject,
    TResponseSchema extends z.ZodType = z.ZodType,
>(
    createResponseSchema: CreateResponseSchema<TOptionsSchema, TResponseSchema>,
    optionsSchema?: TOptionsSchema,
): CustomFieldSpec<TOptionsSchema, TResponseSchema> => ({
    optionsSchema,
    createResponseSchema,
});

const booleanCustomFieldSpec = createCustomFieldSpec((_options, required) =>
    required ? z.literal(true) : z.boolean(),
);

const effectiveMaxLength = (options: LengthObject, defaultMaxLength: number): number | undefined =>
    options.maxLength ??
    ((options.minLength ?? 1) > defaultMaxLength ? undefined : defaultMaxLength);

const createTextCustomFieldSpec = (defaultMaxLength: number) =>
    createCustomFieldSpec((options, required) => {
        let filled = z.string().min(options.minLength ?? 1);
        const maxLength = effectiveMaxLength(options, defaultMaxLength);

        if (maxLength !== undefined) {
            filled = filled.max(maxLength);
        }

        return z
            .string()
            .trim()
            .pipe(required ? filled : z.union([z.literal(""), filled]));
    }, lengthObjectSchema);

const choiceOptionsSchema = z.object({
    items: z
        .array(
            z.object({
                id: z.uuid(),
                label: nameSchema,
            }),
        )
        .min(1)
        .check((context) => {
            const seenIds = new Set<string>();

            context.value.forEach((item, index) => {
                if (seenIds.has(item.id)) {
                    context.issues.push({
                        code: "custom",
                        message: "Must be unique",
                        path: [index, "id"],
                        input: item.id,
                    });
                }

                seenIds.add(item.id);
            });
        }),
});

const singleChoiceCustomFieldSpec = createCustomFieldSpec((options, required) => {
    const schema = z.enum(options.items.map((option) => option.id));
    return required ? schema : schema.nullable();
}, choiceOptionsSchema);

const multipleChoiceCustomFieldSpec = createCustomFieldSpec((options, required) => {
    let schema = z.array(z.enum(options.items.map((option) => option.id)));

    if (required) {
        schema = schema.min(1);
    }

    return schema.transform((selected) => [...new Set(selected)]);
}, choiceOptionsSchema);

const numberCustomFieldSpec = createCustomFieldSpec(
    (options, required) => {
        let schema = z.int();

        if (options.min !== undefined) {
            schema = schema.min(options.min);
        }

        if (options.max !== undefined) {
            schema = schema.max(options.max);
        }

        return required ? schema : schema.nullable();
    },
    z.object({
        min: z.int().min(0).optional(),
        max: z.int().min(0).optional(),
    }),
);

const fileCustomFieldSpec = createCustomFieldSpec((_options, required) =>
    required ? fileDescriptorInputSchema : z.nullable(fileDescriptorInputSchema),
);

const urlCustomFieldSpec = createCustomFieldSpec((_options, required) =>
    required ? z.httpUrl() : z.nullable(z.httpUrl()),
);

const dateCustomFieldSpec = createCustomFieldSpec((_options, required) => {
    const schema = zt.plainDate().transform((date) => date.toString());
    return required ? schema : schema.nullable();
});

const customFieldSpecs = {
    boolean: booleanCustomFieldSpec,
    single_line_text: createTextCustomFieldSpec(DEFAULT_SINGLE_LINE_MAX_LENGTH),
    multi_line_text: createTextCustomFieldSpec(DEFAULT_MULTI_LINE_MAX_LENGTH),
    single_choice: singleChoiceCustomFieldSpec,
    multiple_choice: multipleChoiceCustomFieldSpec,
    number: numberCustomFieldSpec,
    file: fileCustomFieldSpec,
    date: dateCustomFieldSpec,
    url: urlCustomFieldSpec,
} as const satisfies Record<string, CustomFieldSpec>;
type CustomFieldSpecs = typeof customFieldSpecs;

type InferOptions<T> = T extends CustomFieldSpec<infer U> ? z.output<U> : never;

export type CustomFieldOptions = {
    [K in keyof CustomFieldSpecs]: InferOptions<CustomFieldSpecs[K]> & {
        type: K;
    };
}[keyof CustomFieldSpecs];

export const customFieldOptionsSchema = z
    .discriminatedUnion(
        "type",
        Object.entries(customFieldSpecs).map(([type, spec]) => {
            const schema = z.object({
                type: z.literal(type),
            });

            return spec.optionsSchema ? schema.safeExtend(spec.optionsSchema.shape) : schema;
        }) as unknown as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]],
    )
    // safeExtend() composes only the member shapes, so object-level checks
    // like lengthObjectSchema's ordering rule are re-applied here.
    .check((context) => {
        const options = context.value as CustomFieldOptions;

        if (
            (options.type === "single_line_text" || options.type === "multi_line_text") &&
            options.minLength !== undefined &&
            options.maxLength !== undefined &&
            options.minLength > options.maxLength
        ) {
            context.issues.push({
                code: "custom",
                message: "Must be larger or equal to minLength",
                path: ["maxLength"],
                input: options.maxLength,
            });
        }

        if (
            options.type === "number" &&
            options.min !== undefined &&
            options.max !== undefined &&
            options.min > options.max
        ) {
            context.issues.push({
                code: "custom",
                message: "Must be larger or equal to min",
                path: ["max"],
                input: options.max,
            });
        }
    }) as unknown as z.ZodType<CustomFieldOptions>;

export const createResponseSchema = (options: CustomFieldOptions, required: boolean): z.ZodType =>
    (customFieldSpecs[options.type].createResponseSchema as CreateResponseSchema)(
        options,
        required,
    );

type ChoiceItem = z.output<typeof choiceOptionsSchema>["items"][number];

export const choiceItems = (options: CustomFieldOptions): ChoiceItem[] =>
    options.type === "single_choice" || options.type === "multiple_choice" ? options.items : [];

/**
 * Lists the choice item ids a stored response names.
 *
 * Choice responses store the item id itself, so a removed id strands them.
 */
export const referencedChoiceItemIds = (options: CustomFieldOptions, value: unknown): string[] => {
    if (options.type === "single_choice") {
        return typeof value === "string" ? [value] : [];
    }

    if (options.type === "multiple_choice") {
        return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    }

    return [];
};

/** Mirrors the cap the answer schema enforces, as null where nothing caps the question. */
export const answerMaxLength = (options: CustomFieldOptions): number | null =>
    match(options)
        .with(
            { type: "single_line_text" },
            (text) => effectiveMaxLength(text, DEFAULT_SINGLE_LINE_MAX_LENGTH) ?? null,
        )
        .with(
            { type: "multi_line_text" },
            (text) => effectiveMaxLength(text, DEFAULT_MULTI_LINE_MAX_LENGTH) ?? null,
        )
        .with(
            {
                type: P.union(
                    "boolean",
                    "single_choice",
                    "multiple_choice",
                    "number",
                    "file",
                    "date",
                    "url",
                ),
            },
            () => null,
        )
        .exhaustive();
