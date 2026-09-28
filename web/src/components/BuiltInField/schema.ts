import { z } from "zod/mini";
import { type FileUpload, fileUploadSchema } from "#/components/FileUploadField/index.js";
import type { BuiltInFieldRequirement } from "#/queries/edition.js";
import { durationSchema } from "#/utils/zod.js";
import { resolveRequirement } from "./requirement.js";

type MaybeOptionalProperty<T extends z.ZodMiniType | undefined> = [undefined] extends [T]
    ? z.ZodMiniOptional<NonNullable<T>>
    : NonNullable<T>;

export type ToZodMiniObjectShape<T extends Record<string, z.ZodMiniType>> = Required<{
    [P in keyof T]: MaybeOptionalProperty<T[P]>;
}>;

type OptionsWithRequirements = {
    requirement?: BuiltInFieldRequirement;
};
type CreateSchema<T, U> = (requirement: BuiltInFieldRequirement, options: T) => U;
type KeysMatching<T, U> = {
    [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export const addBuiltInFieldSchema = <
    T extends OptionsWithRequirements,
    U,
    S,
    K extends string & KeysMatching<S, U | undefined>,
>(
    options: T | undefined,
    shape: S,
    key: K,
    createSchema: CreateSchema<T, U>,
): void => {
    if (!options) {
        return;
    }

    (shape as Record<K, U | undefined>)[key] = createSchema(resolveRequirement(options), options);
};

export type BuiltInFieldStringSchema = z.ZodMiniType<string, string | undefined>;

export const createBuiltInFieldStringSchema = (
    requirement: BuiltInFieldRequirement,
    min?: number,
    max?: number,
    format?: "email",
): BuiltInFieldStringSchema => {
    let filled = z.string().check(z.minLength(min ?? 1));

    if (max !== undefined) {
        filled = filled.check(z.maxLength(max));
    }

    if (format === "email") {
        filled = filled.check(z.email());
    }

    // Trimming before the branch keeps whitespace-only input on the empty
    // side, rather than judging it against the minimum.
    const value = requirement === "required" ? filled : z.union([z.literal(""), filled]);
    const schema = z.pipe(z.string().check(z.trim()), value);

    if (requirement === "optional") {
        return z._default(schema, "");
    }

    return schema;
};

export type BuiltInFieldDurationSchema = z.ZodMiniType<
    Temporal.Duration | null,
    Temporal.Duration | null | undefined
>;

export const createBuiltInFieldDurationSchema = (
    requirement: BuiltInFieldRequirement,
): BuiltInFieldDurationSchema => {
    if (requirement === "optional") {
        return z.prefault(z.nullable(durationSchema), null);
    }

    return durationSchema;
};

export type BuiltInFieldRelationshipSchema = z.ZodMiniType<
    string | null,
    { id: string } | null | undefined
>;

export const createBuiltInFieldRelationshipSchema = (
    requirement: BuiltInFieldRequirement,
): BuiltInFieldRelationshipSchema => {
    const relationship = z.object({ id: z.string() });

    if (requirement === "required") {
        return z.pipe(
            relationship,
            z.transform((value) => value.id),
        );
    }

    return z.pipe(
        z.nullish(relationship),
        z.transform((value) => value?.id ?? null),
    );
};

export type BuiltInFieldFileUploadSchema = z.ZodMiniType<
    FileUpload | null,
    FileUpload | null | undefined
>;

export const createBuiltInFieldFileUploadSchema = (
    requirement: BuiltInFieldRequirement,
): BuiltInFieldFileUploadSchema => {
    const schema = fileUploadSchema;

    if (requirement === "optional") {
        return z.prefault(z.nullable(schema), null);
    }

    return schema;
};
