import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Slot } from "../entity/Slot.js";
import { buildDurationSchemaObject } from "../util/docs.js";
import type { SerializeMap } from "./index.js";

export const slotSerializer: EntitySerializer<Slot> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                stableId: entity.stableId,
                startsAt: entity.startsAt.toString(),
                endsAt: entity.endsAt.toString(),
                setupTime: entity.setupTime.toString(),
                teardownTime: entity.teardownTime.toString(),
            },
            relationships: {
                session: {
                    data: {
                        type: "session",
                        id: entity.session.id,
                        entity: entity.session.isInitialized()
                            ? entity.session.unwrap()
                            : undefined,
                    },
                },
                location: {
                    data: {
                        type: "location",
                        id: entity.location.id,
                        entity: entity.location.isInitialized()
                            ? entity.location.unwrap()
                            : undefined,
                    },
                },
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const slotResourceFields = [
    "stableId",
    "startsAt",
    "endsAt",
    "setupTime",
    "teardownTime",
    "session",
    "location",
] as const;

export const slotResourceSchema = buildResourceSchemaObject({
    type: "slot",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            stableId: {
                description:
                    "An ID which is stable across all schedule versions. Publishing copies" +
                    " each slot into the next draft under a fresh `id`, so this is the key to" +
                    " match a slot against one held from an earlier fetch; `id` is not.",
                type: "string",
                format: "uuid",
            },
            startsAt: {
                type: "string",
                format: "date-time",
            },
            endsAt: {
                type: "string",
                format: "date-time",
            },
            setupTime: buildDurationSchemaObject(false),
            teardownTime: buildDurationSchemaObject(false),
        },
        required: ["stableId", "startsAt", "endsAt", "setupTime", "teardownTime"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "session",
            name: "session",
            cardinality: "one",
        },
        {
            id: { type: "string", format: "uuid" },
            type: "location",
            name: "location",
            cardinality: "one",
        },
    ],
});
