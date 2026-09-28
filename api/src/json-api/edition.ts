import { buildResourceSchemaObject, type MetaSchemaObject } from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import type { Edition } from "../entity/Edition.js";
import { type BuiltInFieldSpec, builtInFieldRequirements } from "../support/built-in-fields.js";
import { maxImageDimension } from "../support/image-constraints.js";
import { profileFieldSpecs } from "../support/profile-fields.js";
import { sessionFieldSpecs } from "../support/session-fields.js";
import type { Caller } from "../util/auth.js";
import type { SerializeMap } from "./index.js";

/**
 * What a handler tells the edition serializer about the caller.
 *
 * An integration gets no `meta.version`: the counter moves on form edits that
 * do not bump the schedule revision, so serving it would change the document
 * under an unchanged validator. Without a caller, `meta` is served.
 */
export type EditionSerializerContext = {
    caller?: Caller;
};

export const editionSerializer: EntitySerializer<Edition, EditionSerializerContext> = {
    getId: (entity) => entity.id,
    serialize: (entity, context) =>
        ({
            attributes: {
                name: entity.name,
                startDate: entity.startDate.toString(),
                endDate: entity.endDate.toString(),
                timeZone: entity.timeZone,
                submissionDeadline: entity.submissionDeadline?.toString() ?? null,
                sessionFieldOptions: entity.sessionFieldOptions,
                profileFieldOptions: entity.profileFieldOptions,
            },
            ...(context?.caller !== "integration" && { meta: { version: entity.version } }),
        }) satisfies SerializedEntity<SerializeMap>,
};

export const editionResourceFields = [
    "name",
    "startDate",
    "endDate",
    "timeZone",
    "submissionDeadline",
    "sessionFieldOptions",
    "profileFieldOptions",
] as const;

/**
 * Drops the two field-options maps for an integration.
 *
 * They are the submission form's configuration, saying which questions the form
 * asks and how. An integration renders a published schedule and cannot act on
 * any of it, so carrying them would churn the schedule revision every time an
 * organizer edits the form.
 *
 * This is about keeping that document stable, not about confidentiality: the
 * edition routes carry no role layer, so the same maps are readable there until
 * the integration loses those routes.
 *
 * `submissionDeadline` stays. It is one edition-level date a consumer can
 * reasonably show next to a schedule, and it moves once or twice a cycle rather
 * than on every form edit.
 */
export const withVisibleEditionFields = (
    caller: Caller,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] =
        caller === "integration"
            ? editionResourceFields.filter(
                  (field) => field !== "sessionFieldOptions" && field !== "profileFieldOptions",
              )
            : [...editionResourceFields];

    return {
        ...fields,
        edition: fields?.edition
            ? fields.edition.filter((field) => visible.includes(field))
            : visible,
    };
};

const requirementSchema: SchemaObject = {
    type: "string",
    enum: [...builtInFieldRequirements],
};

const lengthSchema: SchemaObject = {
    type: "integer",
    minimum: 1,
};

const dimensionSchema: SchemaObject = {
    type: "integer",
    minimum: 1,
    maximum: maxImageDimension,
};

const aspectRatioSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
    },
    required: ["width", "height"],
    additionalProperties: false,
};

const imageDefaultsSchemaObject: SchemaObject = {
    type: "object",
    description: "Default constraint values for the field.",
    properties: {
        minWidth: dimensionSchema,
        minHeight: dimensionSchema,
        maxWidth: dimensionSchema,
        maxHeight: dimensionSchema,
    },
    required: ["minWidth", "minHeight", "maxWidth", "maxHeight"],
    additionalProperties: false,
};

const imageConstraintsSchemaObject: SchemaObject = {
    type: "object",
    description: "Fixed constraint values for the field, not configurable per edition.",
    properties: {
        minWidth: dimensionSchema,
        minHeight: dimensionSchema,
        maxWidth: dimensionSchema,
        maxHeight: dimensionSchema,
        aspectRatio: { ...aspectRatioSchemaObject, type: ["object", "null"] },
    },
    required: ["minWidth", "minHeight", "maxWidth", "maxHeight", "aspectRatio"],
    additionalProperties: false,
};

const fieldSpecsSchemaObject = (specs: Record<string, BuiltInFieldSpec>): SchemaObject => ({
    type: "object",
    description:
        "What each built-in field is: the label and helper text it falls back to, whether it can" +
        " be made optional, and which kind of value it holds.",
    properties: Object.fromEntries(
        Object.entries<BuiltInFieldSpec>(specs).map(([key, spec]) => [
            key,
            {
                type: "object",
                properties: {
                    label: { type: "string" },
                    helperText: { type: "string" },
                    forceRequired: { type: "boolean" },
                    type: { type: "string", const: spec.type },
                    ...("imageDefaults" in spec
                        ? { imageDefaults: imageDefaultsSchemaObject }
                        : {}),
                    ...("imageConstraints" in spec
                        ? { imageConstraints: imageConstraintsSchemaObject }
                        : {}),
                },
                required: [
                    "label",
                    "forceRequired",
                    "type",
                    ...("imageDefaults" in spec ? ["imageDefaults"] : []),
                    ...("imageConstraints" in spec ? ["imageConstraints"] : []),
                ],
                additionalProperties: false,
            },
        ]),
    ),
    additionalProperties: false,
});

const settledSessionsSchemaObject: SchemaObject = {
    type: "array",
    description:
        "Sessions that lost at least one slot, each said once. The sessions themselves are" +
        " untouched: a slot that cannot follow the edition is removed and its session waits to" +
        " be scheduled again. slotsLeft of zero means it is nowhere in the draft, though a" +
        " publication may still carry it.",
    items: {
        type: "object",
        properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            slotsRemoved: { type: "integer", minimum: 1 },
            slotsLeft: { type: "integer", minimum: 0 },
        },
        required: ["id", "title", "slotsRemoved", "slotsLeft"],
        additionalProperties: false,
    },
};

export const editionDocumentMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        sessionFieldSpecs: fieldSpecsSchemaObject(sessionFieldSpecs),
        profileFieldSpecs: fieldSpecsSchemaObject(profileFieldSpecs),
        maxFileSize: {
            type: "integer",
            description:
                "Bytes any single upload may reach, enforced by the store as a condition of" +
                " the presigned post. Served here so a client can reject a file before asking" +
                " for one.",
        },
        fileContentTypes: {
            type: "array",
            items: { type: "string" },
            description:
                "Content types a signed post will be issued for. Served so a client can" +
                " narrow its file picker to what an upload can succeed with.",
        },
        imageContentTypes: {
            type: "array",
            items: { type: "string" },
            description:
                "The narrower set an image slot accepts on attach, a subset of" +
                " fileContentTypes.",
        },
    },
    required: [
        "sessionFieldSpecs",
        "profileFieldSpecs",
        "maxFileSize",
        "fileContentTypes",
        "imageContentTypes",
    ],
    additionalProperties: false,
};

export const settledEditionDocumentMetaSchemaObject: MetaSchemaObject = {
    ...editionDocumentMetaSchemaObject,
    properties: {
        ...editionDocumentMetaSchemaObject.properties,
        settled: {
            type: "object",
            description:
                "What settling the edition's new dates removed. Absent only when neither the" +
                " dates nor the zone changed; a change that turns out to move nothing still" +
                " reports, with everything at zero.",
            properties: {
                sessions: settledSessionsSchemaObject,
                trimmedAvailability: {
                    type: "integer",
                    minimum: 0,
                    description:
                        "Intervals shortened rather than dropped whole, either by the edition" +
                        " no longer reaching them or by an edge landing in an hour that does" +
                        " not exist on the day it moved to.",
                },
                droppedAvailability: {
                    type: "integer",
                    minimum: 0,
                    description: "Intervals removed, having nothing left inside the edition.",
                },
            },
            required: ["sessions", "trimmedAvailability", "droppedAvailability"],
            additionalProperties: false,
        },
    },
};

const fieldOptionsSchemaObject = (spec: BuiltInFieldSpec): SchemaObject => {
    const properties: Record<string, SchemaObject> = {
        label: { type: "string", minLength: 1 },
        helperText: { type: "string", minLength: 1 },
        position: { type: "integer" },
    };

    if (!spec.forceRequired) {
        properties.requirement = requirementSchema;
    }

    if (spec.type === "string") {
        properties.minLength = lengthSchema;
        properties.maxLength = lengthSchema;
    }

    if ("imageDefaults" in spec) {
        properties.minWidth = dimensionSchema;
        properties.minHeight = dimensionSchema;
        properties.maxWidth = dimensionSchema;
        properties.maxHeight = dimensionSchema;
        properties.aspectRatio = aspectRatioSchemaObject;
    }

    return {
        type: "object",
        properties,
        ...(spec.forceRequired ? {} : { required: ["requirement"] }),
        additionalProperties: false,
    };
};

const fieldOptionsMapSchemaObject = (specs: Record<string, BuiltInFieldSpec>): SchemaObject => ({
    type: "object",
    properties: Object.fromEntries(
        Object.entries<BuiltInFieldSpec>(specs).map(([key, spec]) => [
            key,
            fieldOptionsSchemaObject(spec),
        ]),
    ),
    additionalProperties: false,
});

const editionAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        name: {
            type: "string",
            minLength: 1,
        },
        startDate: {
            type: "string",
            format: "date",
        },
        endDate: {
            type: "string",
            format: "date",
        },
        timeZone: {
            type: "string",
        },
        submissionDeadline: {
            type: ["string", "null"],
            format: "date-time",
        },
        sessionFieldOptions: fieldOptionsMapSchemaObject(sessionFieldSpecs),
        profileFieldOptions: fieldOptionsMapSchemaObject(profileFieldSpecs),
    },
    required: [
        "name",
        "startDate",
        "endDate",
        "timeZone",
        "submissionDeadline",
        "sessionFieldOptions",
        "profileFieldOptions",
    ],
    additionalProperties: false,
};

export const editionResourceMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        version: {
            type: "integer",
            description:
                "Counts writes to this edition. A write names the one it read and is refused with" +
                " edition_changed if another has landed since.",
        },
    },
    required: ["version"],
    additionalProperties: false,
};

const baseEditionResourceSchema = buildResourceSchemaObject({
    type: "edition",
    id: { type: "string", format: "uuid" },
    attributes: editionAttributesSchemaObject,
});

export const editionResourceSchema: SchemaObject = {
    ...baseEditionResourceSchema,
    properties: {
        ...baseEditionResourceSchema.properties,
        meta: editionResourceMetaSchemaObject,
    },
    required: [...(baseEditionResourceSchema.required ?? []), "meta"],
};

const baseRestrictedEditionResourceSchema = buildResourceSchemaObject({
    type: "edition",
    id: { type: "string", format: "uuid" },
    attributes: {
        ...editionAttributesSchemaObject,
        required: ["name", "startDate", "endDate", "timeZone", "submissionDeadline"],
        description:
            "sessionFieldOptions and profileFieldOptions are absent for integration tokens.",
    },
});

export const restrictedEditionResourceSchema: SchemaObject = {
    ...baseRestrictedEditionResourceSchema,
    properties: {
        ...baseRestrictedEditionResourceSchema.properties,
        meta: {
            ...editionResourceMetaSchemaObject,
            description: "Absent for integration tokens.",
        },
    },
};

/**
 * The settled report without the availability halves.
 *
 * A schedule reversion settles slots alone, so promising the two availability
 * counters the edition patch carries would describe members it never sends.
 */
export const settledSlotsDocumentMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        settled: {
            type: "object",
            properties: {
                sessions: settledSessionsSchemaObject,
            },
            required: ["sessions"],
            additionalProperties: false,
        },
    },
    required: ["settled"],
    additionalProperties: false,
};
