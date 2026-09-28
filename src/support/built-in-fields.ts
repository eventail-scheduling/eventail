import { z } from "zod";
import {
    DEFAULT_MULTI_LINE_MAX_LENGTH,
    DEFAULT_SINGLE_LINE_MAX_LENGTH,
    descriptionSchema,
    durationSchema,
    nameSchema,
} from "../util/zod.js";
import { checkLengthOrder, type LengthObject, lengthObjectShape } from "./common.js";
import { type FileDescriptorInput, fileDescriptorInputSchema } from "./file-upload.js";
import {
    checkImageConstraints,
    type ImageConstraintDefaults,
    type ImageConstraintsObject,
    imageConstraintsShape,
    type ResolvedImageConstraints,
} from "./image-constraints.js";

export type FieldPresentation = {
    label: string;
    helperText?: string;
};

export type AttributeFieldSpec = FieldPresentation & {
    forceRequired?: boolean;
} & (
        | {
              type: "string";

              /** A field read as a paragraph, which is the wider of the two default ceilings. */
              multiline?: true;
              format?: "email";
          }
        | { type: "duration" | "availability" }
        | { type: "file"; imageDefaults: ImageConstraintDefaults }
        | { type: "file"; imageConstraints: ResolvedImageConstraints }
    );

export type RelationshipFieldSpec = FieldPresentation & {
    forceRequired?: boolean;
    type: "relationship";
    resourceType: string;
};

export type BuiltInFieldSpec = AttributeFieldSpec | RelationshipFieldSpec;

export const builtInFieldRequirements = ["optional", "required"] as const;
const requirementSchema = z.enum(builtInFieldRequirements);
export type BuiltInFieldRequirement = z.output<typeof requirementSchema>;

const requirementObjectSchema = z.object({
    requirement: requirementSchema,
});
export type RequirementObject = z.output<typeof requirementObjectSchema>;

const presentationObjectSchema = z.object({
    label: nameSchema.optional(),
    helperText: descriptionSchema.min(1).optional(),
    position: z.int().optional(),
});
type PresentationObject = z.output<typeof presentationObjectSchema>;

type BuiltInFieldOptionFromSpec<T extends BuiltInFieldSpec> = PresentationObject &
    (T extends { forceRequired: true } ? unknown : RequirementObject) &
    (T["type"] extends "string" ? LengthObject : unknown) &
    (T extends { imageDefaults: ImageConstraintDefaults } ? ImageConstraintsObject : unknown);

export type FieldOptionsFromSpecs<T extends Record<string, BuiltInFieldSpec>> = {
    [K in keyof T]?: BuiltInFieldOptionFromSpec<T[K]>;
};

export type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

const buildFieldSchema = (spec: BuiltInFieldSpec) => {
    const schema = z.strictObject({
        ...presentationObjectSchema.shape,
        ...(spec.forceRequired ? {} : requirementObjectSchema.shape),
        ...(spec.type === "string" ? lengthObjectShape : {}),
        ...("imageDefaults" in spec ? imageConstraintsShape : {}),
    });

    if (spec.type === "string") {
        return schema.check(checkLengthOrder).optional();
    }

    if ("imageDefaults" in spec) {
        return schema.check(checkImageConstraints(spec.imageDefaults)).optional();
    }

    return schema.optional();
};

export const buildFieldOptionsSchema = (specs: Record<string, BuiltInFieldSpec>) =>
    z
        .strictObject(
            Object.fromEntries(
                Object.entries(specs).map(([key, spec]) => [key, buildFieldSchema(spec)]),
            ),
        )
        .check((context) => {
            const seen = new Map<number, string>();

            for (const [fieldName, options] of Object.entries(context.value)) {
                const position = (options as PresentationObject | undefined)?.position;

                if (position === undefined) {
                    continue;
                }

                const taken = seen.get(position);

                if (taken !== undefined) {
                    context.issues.push({
                        code: "custom",
                        message: `Position ${position} is already taken by ${taken}`,
                        path: [fieldName, "position"],
                        input: position,
                    });
                    continue;
                }

                seen.set(position, fieldName);
            }
        });

export type SerializedFieldSpec = FieldPresentation & {
    forceRequired: boolean;
    type: BuiltInFieldSpec["type"];
    imageDefaults?: ImageConstraintDefaults;
    imageConstraints?: ResolvedImageConstraints;
};

export const serializeFieldSpecs = <T extends Record<string, BuiltInFieldSpec>>(
    specs: T,
): Record<keyof T, SerializedFieldSpec> =>
    Object.fromEntries(
        Object.entries<BuiltInFieldSpec>(specs).map(([key, spec]) => [
            key,
            {
                label: spec.label,
                ...(spec.helperText === undefined ? {} : { helperText: spec.helperText }),
                forceRequired: spec.forceRequired ?? false,
                type: spec.type,
                ...("imageDefaults" in spec ? { imageDefaults: spec.imageDefaults } : {}),
                ...("imageConstraints" in spec ? { imageConstraints: spec.imageConstraints } : {}),
            },
        ]),
    ) as Record<keyof T, SerializedFieldSpec>;

/**
 * Builds the schema for one string field, at the length its edition asks for.
 *
 * `multiline` has no default on purpose. It picks between two ceilings, and a
 * call that omits it judges a paragraph by the single-line one: where the two
 * calls for the same field disagree, the profile gate reports a filled-in
 * biography as missing and the write it sends the host to accepts it unchanged.
 */
export const createStringAttributeSchema = (
    requirement: BuiltInFieldRequirement,
    options: LengthObject,
    multiline: boolean | undefined,
): z.ZodType<string> => {
    const minLength = options.minLength ?? 1;
    const ceiling = multiline ? DEFAULT_MULTI_LINE_MAX_LENGTH : DEFAULT_SINGLE_LINE_MAX_LENGTH;
    // An organizer may set a minimum and no maximum, and a default below that
    // minimum would leave a field nobody can fill. The default is a guess at
    // what the field is for; the minimum is a statement about it.
    const maxLength = options.maxLength ?? (minLength > ceiling ? undefined : ceiling);

    let filled = z.string().min(minLength);

    if (maxLength !== undefined) {
        filled = filled.max(maxLength);
    }

    // Trimming before the branch keeps whitespace-only input on the empty
    // side, rather than judging it against the minimum.
    const value = requirement === "required" ? filled : z.union([z.literal(""), filled]);

    return z.string().trim().pipe(value);
};

export const createDurationAttributeSchema = (
    requirement: BuiltInFieldRequirement,
): z.ZodType<Temporal.Duration | null> => {
    return requirement === "required" ? durationSchema : durationSchema.nullable();
};

export const createFileAttributeSchema = (
    requirement: BuiltInFieldRequirement,
): z.ZodType<FileDescriptorInput | null> => {
    return requirement === "required"
        ? fileDescriptorInputSchema
        : fileDescriptorInputSchema.nullable();
};
