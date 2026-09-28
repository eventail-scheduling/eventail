import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import type { SessionType } from "../entity/SessionType.js";
import type { Caller } from "../util/auth.js";
import { buildDurationSchemaObject } from "../util/docs.js";
import type { SerializeMap } from "./index.js";

export const sessionTypeSerializer: EntitySerializer<SessionType> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                name: entity.name,
                externalKey: entity.externalKey,
                defaultDuration: entity.defaultDuration.toString(),
                internal: entity.internal,
                selectionDefault: entity.selectionDefault,
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const sessionTypeResourceFields = [
    "name",
    "externalKey",
    "defaultDuration",
    "internal",
    "selectionDefault",
] as const;

/**
 * Drops two form-tuning fields for an integration.
 *
 * `defaultDuration` seeds the submission form and `selectionDefault` picks which
 * type a new submission starts on. Neither describes a scheduled session, and
 * leaving them in would churn the revision every time organizers retune the
 * form.
 */
export const withVisibleSessionTypeFields = (
    caller: Caller,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] =
        caller === "integration"
            ? ["name", "externalKey", "internal"]
            : [...sessionTypeResourceFields];

    return {
        ...fields,
        session_type: fields?.session_type
            ? fields.session_type.filter((field) => visible.includes(field))
            : visible,
    };
};

const sessionTypeAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        name: {
            type: "string",
            minLength: 1,
        },
        externalKey: {
            type: ["string", "null"],
            minLength: 1,
        },
        defaultDuration: buildDurationSchemaObject(),
        internal: { type: "boolean" },
        selectionDefault: { type: "boolean" },
    },
    required: ["name", "externalKey", "defaultDuration", "internal", "selectionDefault"],
    additionalProperties: false,
};

export const sessionTypeResourceSchema = buildResourceSchemaObject({
    type: "session_type",
    id: { type: "string", format: "uuid" },
    attributes: sessionTypeAttributesSchemaObject,
});

export const restrictedSessionTypeResourceSchema = buildResourceSchemaObject({
    type: "session_type",
    id: { type: "string", format: "uuid" },
    attributes: {
        ...sessionTypeAttributesSchemaObject,
        required: ["name", "externalKey", "internal"],
        description:
            "defaultDuration and selectionDefault are absent for an integration token, which" +
            " receives a session type to label a slot rather than to run a submission.",
    },
});
