import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Response } from "../entity/Response.js";
import type { SerializeMap } from "./index.js";

export const responseSerializer: EntitySerializer<Response> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                value: entity.value,
            },
            relationships: {
                customField: {
                    data: {
                        type: "custom_field",
                        id: entity.customField.id,
                        entity: entity.customField.isInitialized()
                            ? entity.customField.unwrap()
                            : undefined,
                    },
                },
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const responseResourceFields = ["value", "customField"] as const;

export const responseResourceSchema = buildResourceSchemaObject({
    type: "response",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            value: {},
        },
        required: ["value"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "custom_field",
            name: "customField",
            cardinality: "one",
        },
    ],
});
