import { isAfter } from "temporal-extra";
import { match } from "ts-pattern";
import { z } from "zod/mini";
import type { CustomField } from "#/queries/custom-field.ts";
import type { SessionType } from "#/queries/session-type.ts";
import type { Track } from "#/queries/track.ts";
import { emptyToNullSchema, formRelationshipSchema, zonedDateTimeSchema } from "#/utils/zod.js";

export const customFieldOptionTypes = [
    "boolean",
    "single_line_text",
    "multi_line_text",
    "single_choice",
    "multiple_choice",
    "number",
    "file",
    "date",
    "url",
] as const;

export type CustomFieldOptionType = (typeof customFieldOptionTypes)[number];

const optionalBound = (minimum: number) =>
    z.pipe(
        z.nullish(z.int().check(z.minimum(minimum))),
        z.transform((input) => input ?? undefined),
    );

const lengthValue = optionalBound(1);
const numberBound = optionalBound(0);

export const customFieldFormSchema = z
    .object({
        title: z.string().check(z.trim(), z.minLength(1)),
        helperText: z.string().check(z.trim()),
        externalKey: emptyToNullSchema,
        target: z.enum(["per_proposal", "per_host"]),
        requirement: z.enum(["always_optional", "always_required", "required_after_deadline"]),
        optionType: z.enum(customFieldOptionTypes),
        minLength: lengthValue,
        maxLength: lengthValue,
        min: numberBound,
        max: numberBound,
        items: z.array(z.object({ id: z.uuid(), label: z.string().check(z.trim()) })),
        deadline: z.nullable(zonedDateTimeSchema),
        freezeAfter: z.nullable(zonedDateTimeSchema),
        confidential: z.boolean(),
        sessionTypes: z.array(formRelationshipSchema),
        tracks: z.array(formRelationshipSchema),
    })
    .check((context) => {
        const values = context.value;

        if (values.requirement === "required_after_deadline" && values.deadline === null) {
            context.issues.push({
                code: "custom",
                message: "Required when the custom field becomes required after a deadline",
                path: ["deadline"],
                input: values.deadline,
            });
        }

        if (
            values.requirement === "required_after_deadline" &&
            values.deadline &&
            values.freezeAfter &&
            !isAfter(values.freezeAfter, values.deadline)
        ) {
            context.issues.push({
                code: "custom",
                message: "Must be after the deadline",
                path: ["freezeAfter"],
                input: values.freezeAfter,
            });
        }

        if (
            (values.optionType === "single_line_text" || values.optionType === "multi_line_text") &&
            values.minLength !== undefined &&
            values.maxLength !== undefined &&
            values.minLength > values.maxLength
        ) {
            context.issues.push({
                code: "custom",
                message: "Must be larger or equal to the minimum length",
                path: ["maxLength"],
                input: values.maxLength,
            });
        }

        if (
            values.optionType === "number" &&
            values.min !== undefined &&
            values.max !== undefined &&
            values.min > values.max
        ) {
            context.issues.push({
                code: "custom",
                message: "Must be larger or equal to the minimum",
                path: ["max"],
                input: values.max,
            });
        }

        if (values.optionType === "single_choice" || values.optionType === "multiple_choice") {
            if (values.items.length === 0) {
                context.issues.push({
                    code: "custom",
                    message: "Add at least one option",
                    path: ["items"],
                    input: values.items,
                });
            }

            values.items.forEach((item, index) => {
                if (item.label === "") {
                    context.issues.push({
                        code: "custom",
                        message: "Required",
                        path: ["items", index, "label"],
                        input: item.label,
                    });
                }
            });
        }
    });

export type CustomFieldInputValues = z.input<typeof customFieldFormSchema>;
export type CustomFieldTransformedValues = z.output<typeof customFieldFormSchema>;

export const buildCustomFieldPayload = (values: CustomFieldTransformedValues) => ({
    title: values.title,
    helperText: values.helperText,
    externalKey: values.externalKey,
    target: values.target,
    requirement: values.requirement,
    options: buildCustomFieldOptions(values),
    deadline: values.requirement === "required_after_deadline" ? values.deadline : null,
    freezeAfter: values.freezeAfter,
    confidential: values.confidential,
    sessionTypes: values.target === "per_host" ? [] : values.sessionTypes,
    tracks: values.target === "per_host" ? [] : values.tracks,
});

export const buildCustomFieldOptions = (
    values: CustomFieldTransformedValues,
): CustomField["options"] =>
    match(values.optionType)
        .with("single_line_text", "multi_line_text", (type) => ({
            type,
            minLength: values.minLength,
            maxLength: values.maxLength,
        }))
        .with("single_choice", "multiple_choice", (type) => ({ type, items: values.items }))
        .with("number", (type) => ({ type, min: values.min, max: values.max }))
        .with("boolean", "file", "date", "url", (type) => ({ type }))
        .exhaustive();

type CustomFieldScopeOptions = {
    sessionTypes: SessionType[];
    tracks: Track[];
};

export const createChoiceItem = (): CustomFieldInputValues["items"][number] => ({
    id: crypto.randomUUID(),
    label: "",
});

type ScopeIdentifier = {
    id: string;
};

const resolveScope = <TOption extends ScopeIdentifier>(
    identifiers: ScopeIdentifier[],
    options: TOption[],
): TOption[] =>
    identifiers.flatMap((identifier) => {
        const option = options.find((candidate) => candidate.id === identifier.id);

        return option ? [option] : [];
    });

export const createCustomFieldDefaultValues = (
    customField: CustomField | null,
    scope: CustomFieldScopeOptions,
    timeZone: string,
): CustomFieldInputValues => {
    if (!customField) {
        return {
            title: "",
            helperText: "",
            externalKey: "",
            target: "per_proposal",
            requirement: "always_optional",
            optionType: "single_line_text",
            minLength: null,
            maxLength: null,
            min: null,
            max: null,
            items: [createChoiceItem()],
            deadline: null,
            freezeAfter: null,
            confidential: false,
            sessionTypes: [],
            tracks: [],
        };
    }

    const options = customField.options;

    return {
        title: customField.title,
        helperText: customField.helperText,
        externalKey: customField.externalKey ?? "",
        target: customField.target,
        requirement: customField.requirement,
        optionType: options.type,
        minLength: "minLength" in options ? (options.minLength ?? null) : null,
        maxLength: "maxLength" in options ? (options.maxLength ?? null) : null,
        min: "min" in options ? (options.min ?? null) : null,
        max: "max" in options ? (options.max ?? null) : null,
        items: "items" in options ? options.items : [],
        deadline: customField.deadline?.toZonedDateTimeISO(timeZone) ?? null,
        freezeAfter: customField.freezeAfter?.toZonedDateTimeISO(timeZone) ?? null,
        confidential: customField.confidential,
        sessionTypes: resolveScope(customField.sessionTypes, scope.sessionTypes),
        tracks: resolveScope(customField.tracks, scope.tracks),
    };
};
