import { ZodValidationErrorParams } from "@jsonapi-serde/server/common";
import {
    type RelationshipSchema,
    type ResourceIdentifierSchema,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import { match } from "ts-pattern";
import { z } from "zod";
import type { Edition } from "../entity/Edition.js";
import {
    type AttributeFieldSpec,
    type BuiltInFieldRequirement,
    buildFieldOptionsSchema,
    createDurationAttributeSchema,
    createFileAttributeSchema,
    createStringAttributeSchema,
    type FieldOptionsFromSpecs,
    type OmitNever,
    type RelationshipFieldSpec,
    type RequirementObject,
    serializeFieldSpecs,
} from "./built-in-fields.js";
import type { LengthObject } from "./common.js";
import type { FileDescriptorInput } from "./file-upload.js";
import { type ResolvedImageConstraints, resolveImageConstraints } from "./image-constraints.js";

type SessionAttributeFieldSpec = AttributeFieldSpec & {
    type: "string" | "duration" | "file";
};

type SessionFieldSpec = SessionAttributeFieldSpec | RelationshipFieldSpec;

export const sessionFieldSpecs = {
    title: { label: "Title", forceRequired: true, type: "string" },
    sessionType: {
        label: "Session type",
        forceRequired: true,
        type: "relationship",
        resourceType: "session_type",
    },
    abstract: { label: "Abstract", type: "string", multiline: true },
    description: { label: "Description", type: "string", multiline: true },
    notes: {
        label: "Notes",
        helperText: "Only organizers see this",
        type: "string",
        multiline: true,
    },
    track: { label: "Track", type: "relationship", resourceType: "track" },
    duration: { label: "Duration", type: "duration" },
    setupTime: { label: "Setup time", type: "duration" },
    teardownTime: { label: "Teardown time", type: "duration" },
    teaserImage: {
        label: "Teaser image",
        type: "file",
        imageDefaults: {
            minWidth: 640,
            minHeight: 360,
            maxWidth: 3840,
            maxHeight: 2160,
        },
    },
} as const satisfies Record<string, SessionFieldSpec>;
type BuiltInFieldSpecs = typeof sessionFieldSpecs;

type AttributeFieldSpecs = OmitNever<{
    [K in keyof BuiltInFieldSpecs]: BuiltInFieldSpecs[K]["type"] extends "relationship"
        ? never
        : BuiltInFieldSpecs[K];
}>;

type RelationshipFieldSpecs = OmitNever<{
    [K in keyof BuiltInFieldSpecs]: BuiltInFieldSpecs[K]["type"] extends "relationship"
        ? BuiltInFieldSpecs[K]
        : never;
}>;

export type SessionFieldAttributeNames = keyof AttributeFieldSpecs;
export type SessionFieldRelationshipNames = keyof RelationshipFieldSpecs;
export type SessionFieldOptions = FieldOptionsFromSpecs<typeof sessionFieldSpecs>;

export const sessionFieldOptionsSchema = buildFieldOptionsSchema(
    sessionFieldSpecs,
) satisfies z.ZodType<SessionFieldOptions>;

export const initialSessionFieldOptions: SessionFieldOptions = {
    title: {},
    sessionType: {},
    abstract: { requirement: "required" },
    description: { requirement: "optional" },
};

export const serializedSessionFieldSpecs = serializeFieldSpecs(sessionFieldSpecs);

export const resolveTeaserImageConstraints = (edition: Edition): ResolvedImageConstraints =>
    resolveImageConstraints(
        sessionFieldSpecs.teaserImage.imageDefaults,
        edition.sessionFieldOptions.teaserImage,
    );

type AttributeFieldValueType<T extends AttributeFieldSpec> = T["type"] extends "string"
    ? string
    : T["type"] extends "duration"
      ? Temporal.Duration | null
      : T["type"] extends "file"
        ? FileDescriptorInput | null
        : never;

type ForceRequiredAttributeNames = {
    [K in keyof AttributeFieldSpecs]: AttributeFieldSpecs[K] extends { forceRequired: true }
        ? K
        : never;
}[keyof AttributeFieldSpecs];

// The ZodOptional wrapper only describes that a key may be absent. The
// factory wraps no asked field in one, so don't call ZodOptional-specific
// methods on members.
export type SessionFieldAttributeSchemas<T extends keyof AttributeFieldSpecs> = {
    [K in Extract<T, ForceRequiredAttributeNames>]: z.ZodType<
        AttributeFieldValueType<AttributeFieldSpecs[K]>
    >;
} & {
    [K in Exclude<T, ForceRequiredAttributeNames>]: z.ZodOptional<
        z.ZodType<AttributeFieldValueType<AttributeFieldSpecs[K]>>
    >;
};

const fieldsChangedParams = (detail: string): ZodValidationErrorParams =>
    new ZodValidationErrorParams("session_fields_changed", detail, 422);

/** Refuses any value, so a field the edition stopped asking for reads as a stale form. */
const notAskedSchema = (label: string): z.ZodType =>
    z.optional(
        z.unknown().check((context) => {
            context.issues.push({
                code: "custom",
                message: "Field not asked for",
                input: context.value,
                params: fieldsChangedParams(`This edition no longer asks for the ${label}`),
            });
        }),
    );

/** Refuses an absent key as a stale form, where the sender's edition did not ask for the field yet. */
const askedOnCreateSchema = (label: string, schema: z.core.$ZodType): z.ZodType =>
    z
        .unknown()
        .check((context) => {
            if (context.value === undefined) {
                context.issues.push({
                    code: "custom",
                    message: "Field asked for",
                    input: context.value,
                    params: fieldsChangedParams(`This edition now asks for the ${label}`),
                });
            }
        })
        .pipe(schema);

/**
 * Builds the attribute schemas, one per name, whether or not the edition asks for the field.
 *
 * `staleWhenMissing` is for a create, where every asked field must be sent. It turns
 * an absent optional field into a stale form rather than a missing key, and breaks the
 * schema's JSON Schema rendering, so documentation builds without it.
 */
export const createSessionFieldAttributeSchemas = <T extends keyof AttributeFieldSpecs>(
    fieldNames: readonly T[],
    edition: Edition,
    staleWhenMissing: boolean,
): SessionFieldAttributeSchemas<T> => {
    const schemaEntries: Record<string, z.ZodType> = {};

    for (const fieldName of fieldNames) {
        const spec = sessionFieldSpecs[fieldName] as SessionAttributeFieldSpec;
        const options = edition.sessionFieldOptions[fieldName] as
            | (RequirementObject & LengthObject)
            | undefined;
        const label = spec.label.toLowerCase();

        if (!(spec.forceRequired || options)) {
            schemaEntries[fieldName] = notAskedSchema(label);
            continue;
        }

        const requirement: BuiltInFieldRequirement = spec.forceRequired
            ? "required"
            : (options as RequirementObject).requirement;

        const schema = match(spec)
            .with({ type: "string" }, (stringSpec) =>
                createStringAttributeSchema(
                    requirement,
                    (options ?? {}) as LengthObject,
                    stringSpec.multiline,
                ),
            )
            .with({ type: "duration" }, () => createDurationAttributeSchema(requirement))
            .with({ type: "file" }, () => createFileAttributeSchema(requirement))
            .exhaustive();

        schemaEntries[fieldName] =
            staleWhenMissing && !spec.forceRequired ? askedOnCreateSchema(label, schema) : schema;
    }

    return schemaEntries as SessionFieldAttributeSchemas<T>;
};

export type SessionFieldRelationshipSchemas<T extends keyof RelationshipFieldSpecs> = {
    [K in T]: z.ZodOptional<
        RelationshipSchema<
            z.ZodNullable<ResourceIdentifierSchema<RelationshipFieldSpecs[K]["resourceType"]>>
        >
    >;
};

/** Builds the relationship schemas the way {@link createSessionFieldAttributeSchemas} builds attributes. */
export const createSessionFieldRelationshipSchemas = <T extends keyof RelationshipFieldSpecs>(
    fieldNames: readonly T[],
    edition: Edition,
    staleWhenMissing: boolean,
): SessionFieldRelationshipSchemas<T> => {
    const schemaEntries: Record<string, z.core.$ZodType> = {};

    for (const fieldName of fieldNames) {
        const spec = sessionFieldSpecs[fieldName] as RelationshipFieldSpec;
        const options = edition.sessionFieldOptions[fieldName] as RequirementObject | undefined;
        const label = spec.label.toLowerCase();

        if (!(spec.forceRequired || options)) {
            schemaEntries[fieldName] = notAskedSchema(label);
            continue;
        }

        const requirement: BuiltInFieldRequirement = spec.forceRequired
            ? "required"
            : (options as RequirementObject).requirement;
        const identifierSchema = resourceIdentifierSchema(spec.resourceType, z.uuid());
        const schema =
            requirement === "optional"
                ? relationshipSchema(z.nullable(identifierSchema))
                : relationshipSchema(identifierSchema);

        schemaEntries[fieldName] =
            staleWhenMissing && !spec.forceRequired ? askedOnCreateSchema(label, schema) : schema;
    }

    return schemaEntries as SessionFieldRelationshipSchemas<T>;
};
