import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Venue } from "../entity/Venue.js";
import type { SerializeMap } from "./index.js";

export const venueSerializer: EntitySerializer<Venue> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                name: entity.name,
                address: entity.address,
                externalKey: entity.externalKey,
                position: entity.position,
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const venueResourceFields = ["name", "address", "externalKey", "position"] as const;

export const venueResourceSchema = buildResourceSchemaObject({
    type: "venue",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            name: {
                type: "string",
                minLength: 1,
            },
            address: {
                type: ["string", "null"],
                minLength: 1,
            },
            externalKey: {
                type: ["string", "null"],
                minLength: 1,
            },
            position: {
                description: "Which venue this is, in the order an organizer put them in",
                type: "integer",
                minimum: 0,
            },
        },
        required: ["name", "address", "externalKey", "position"],
        additionalProperties: false,
    },
});
