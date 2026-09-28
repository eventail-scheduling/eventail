import { buildResourceSchemaObject, type RelationshipDefinition } from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import {
    type CustomField,
    customFieldRequirements,
    customFieldTargets,
} from "../entity/CustomField.js";
import { answerMaxLength } from "../support/custom-fields.js";
import type { Caller } from "../util/auth.js";
import type { SerializeMap } from "./index.js";

export const customFieldSerializer: EntitySerializer<CustomField> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                externalKey: entity.externalKey,
                target: entity.target,
                requirement: entity.requirement,
                title: entity.title,
                helperText: entity.helperText,
                options: entity.options,
                answerMaxLength: answerMaxLength(entity.options),
                deadline: entity.deadline?.toString() ?? null,
                freezeAfter: entity.freezeAfter?.toString() ?? null,
                confidential: entity.confidential,
                position: entity.position,
            },
            relationships: {
                ...(entity.sessionTypes.isInitialized() && {
                    sessionTypes: {
                        data: entity.sessionTypes.map((sessionType) => ({
                            type: "session_type",
                            id: sessionType.id,
                            entity: sessionType,
                        })),
                    },
                }),
                ...(entity.tracks.isInitialized() && {
                    tracks: {
                        data: entity.tracks.map((track) => ({
                            type: "track",
                            id: track.id,
                            entity: track,
                        })),
                    },
                }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const embeddedCustomFieldResourceFields = [
    "externalKey",
    "target",
    "requirement",
    "title",
    "helperText",
    "options",
    "deadline",
    "freezeAfter",
    "confidential",
    "position",
] as const;

/**
 * Hides from an integration everything about running a submission.
 *
 * What it does not see describes running a submission rather than rendering an
 * answer: when the question closes, who may read it, and where it sits in the
 * form. `helperText` is guidance written for the person filling the form in.
 */
export const withVisibleCustomFieldFields = (
    caller: Caller,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] =
        caller === "integration"
            ? ["externalKey", "target", "title", "options"]
            : [...embeddedCustomFieldResourceFields];

    return {
        ...fields,
        custom_field: fields?.custom_field
            ? fields.custom_field.filter((field) => visible.includes(field))
            : visible,
    };
};

export const customFieldResourceFields = [
    ...embeddedCustomFieldResourceFields,
    "answerMaxLength",
    "sessionTypes",
    "tracks",
] as const;

const customFieldAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        externalKey: {
            type: ["string", "null"],
            minLength: 1,
        },
        target: {
            type: "string",
            enum: [...customFieldTargets],
        },
        requirement: {
            type: "string",
            enum: [...customFieldRequirements],
        },
        title: {
            type: "string",
            minLength: 1,
        },
        helperText: {
            type: "string",
        },
        answerMaxLength: {
            type: ["integer", "null"],
            minimum: 1,
            description:
                "The longest answer a text question takes: options.maxLength where set, else" +
                " 200 characters on a single line or 10000 on several, unless options.minLength" +
                " exceeds that, which leaves it uncapped. Null for any other type and for an" +
                " uncapped question. Served only on the custom field's own routes, never where a" +
                " document embeds one.",
        },
        deadline: {
            type: ["string", "null"],
            format: "date-time",
        },
        freezeAfter: {
            type: ["string", "null"],
            format: "date-time",
        },
        position: { type: "integer" },
        confidential: {
            type: "boolean",
            description:
                "Responses to confidential custom fields reach managers and admins, a caller" +
                " who hosts the session a response belongs to, and the host who answered it." +
                " An integration never receives them, and one host does not see another's." +
                " A withheld response is absent from linkage as well as from the included" +
                " resources, so it cannot be told apart from one that was never given.",
        },
        options: {
            oneOf: [
                {
                    title: "Simple",
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["boolean", "file", "date", "url"],
                        },
                    },
                    required: ["type"],
                },
                {
                    title: "Number",
                    type: "object",
                    properties: {
                        type: { type: "string", enum: ["number"] },
                        min: { type: "integer", minimum: 0 },
                        max: { type: "integer", minimum: 0 },
                    },
                    required: ["type"],
                },
                {
                    title: "Text",
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["single_line_text", "multi_line_text"],
                        },
                        minLength: { type: "integer", minimum: 1 },
                        maxLength: { type: "integer", minimum: 1 },
                    },
                    required: ["type"],
                },
                {
                    title: "Choice",
                    type: "object",
                    properties: {
                        type: {
                            type: "string",
                            enum: ["single_choice", "multiple_choice"],
                        },
                        items: {
                            type: "array",
                            minItems: 1,
                            items: {
                                type: "object",
                                properties: {
                                    id: { type: "string", format: "uuid" },
                                    label: { type: "string", minLength: 1 },
                                },
                                required: ["id", "label"],
                            },
                        },
                    },
                    required: ["type", "items"],
                },
            ],
        },
    },
    required: [
        "externalKey",
        "target",
        "requirement",
        "title",
        "helperText",
        "options",
        "answerMaxLength",
        "deadline",
        "freezeAfter",
        "position",
        "confidential",
    ],
    additionalProperties: false,
};

const { answerMaxLength: _answerMaxLength, ...embeddedCustomFieldAttributeProperties } =
    customFieldAttributesSchemaObject.properties ?? {};

const customFieldRelationships: RelationshipDefinition[] = [
    {
        id: { type: "string", format: "uuid" },
        type: "session_type",
        name: "sessionTypes",
        cardinality: "many",
    },
    {
        id: { type: "string", format: "uuid" },
        type: "track",
        name: "tracks",
        cardinality: "many",
    },
];

export const customFieldResourceSchema = buildResourceSchemaObject({
    type: "custom_field",
    id: { type: "string", format: "uuid" },
    attributes: customFieldAttributesSchemaObject,
    relationships: customFieldRelationships,
});

/**
 * A custom field as a document that embeds one carries it.
 *
 * Which attributes arrive depends on the caller rather than the request: see
 * {@link withVisibleCustomFieldFields}.
 */
export const embeddedCustomFieldResourceSchema = buildResourceSchemaObject({
    type: "custom_field",
    id: { type: "string", format: "uuid" },
    attributes: {
        ...customFieldAttributesSchemaObject,
        properties: embeddedCustomFieldAttributeProperties,
        required: ["externalKey", "target", "title", "options"],
        description:
            "requirement, helperText, deadline, freezeAfter, position and confidential are" +
            " absent for an integration token, which receives a custom field to render an" +
            " answer rather than to run a submission.",
    },
    relationships: customFieldRelationships.map((relationship) => ({
        ...relationship,
        optional: true,
    })),
});
