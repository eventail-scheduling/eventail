import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Schedule } from "../entity/Schedule.js";
import type { SerializeMap } from "./index.js";

export const scheduleSerializer: EntitySerializer<Schedule> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                createdAt: entity.createdAt.toString(),
                publishedAt: entity.publishedAt?.toString() ?? null,
                startDate: entity.startDate?.toString() ?? null,
                endDate: entity.endDate?.toString() ?? null,
                timeZone: entity.timeZone,
                preliminary: entity.preliminary,
            },
            relationships: {
                edition: {
                    data: {
                        type: "edition",
                        id: entity.edition.id,
                        entity: entity.edition.isInitialized()
                            ? entity.edition.unwrap()
                            : undefined,
                    },
                },
                ...(entity.slots.isInitialized() && {
                    slots: {
                        data: entity.slots.map((slot) => ({
                            type: "slot",
                            id: slot.id,
                            entity: slot,
                        })),
                    },
                }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const scheduleResourceFields = [
    "createdAt",
    "publishedAt",
    "startDate",
    "endDate",
    "timeZone",
    "preliminary",
    "edition",
    "slots",
] as const;

export const scheduleResourceSchema = buildResourceSchemaObject({
    type: "schedule",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            createdAt: {
                type: "string",
                format: "date-time",
            },
            publishedAt: {
                type: ["string", "null"],
                format: "date-time",
            },
            startDate: {
                type: ["string", "null"],
                format: "date",
                description:
                    "The window this schedule was published for, together with endDate and timeZone. Set when publishedAt is, and never after: a publication records what was announced, and the edition is free to move away from it. Null on a draft, whose window is the edition's current one.",
            },
            endDate: {
                type: ["string", "null"],
                format: "date",
            },
            timeZone: {
                type: ["string", "null"],
                description:
                    "The zone the slot instants of this publication were laid out in. Read them against this rather than the edition's, which may have changed since.",
            },
            preliminary: {
                type: "boolean",
                description:
                    "Whether this publication is provisional. Only meaningful once publishedAt is set, and never true for a publication that follows a final one.",
            },
        },
        required: ["createdAt", "publishedAt", "startDate", "endDate", "timeZone", "preliminary"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "edition",
            name: "edition",
            cardinality: "one",
        },
        {
            id: { type: "string", format: "uuid" },
            type: "slot",
            name: "slots",
            cardinality: "many",
        },
    ],
});
