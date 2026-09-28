import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Track } from "../entity/Track.js";
import type { SerializeMap } from "./index.js";

export const trackSerializer: EntitySerializer<Track> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                name: entity.name,
                externalKey: entity.externalKey,
                description: entity.description,
                color: entity.color,
                internal: entity.internal,
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const trackResourceFields = [
    "name",
    "externalKey",
    "description",
    "color",
    "internal",
] as const;

export const trackResourceSchema = buildResourceSchemaObject({
    type: "track",
    id: { type: "string", format: "uuid" },
    attributes: {
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
            description: { type: "string" },
            color: { type: "string", format: "rgb", example: "#ff0000" },
            internal: { type: "boolean" },
        },
        required: ["name", "externalKey", "description", "color", "internal"],
        additionalProperties: false,
    },
});
