import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { LocationAvailability } from "../entity/LocationAvailability.js";
import type { SerializeMap } from "./index.js";

export const locationAvailabilitySerializer: EntitySerializer<LocationAvailability> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                startsAt: entity.startsAt.toString(),
                endsAt: entity.endsAt.toString(),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const locationAvailabilityResourceFields = ["startsAt", "endsAt"] as const;

export const locationAvailabilityResourceSchema = buildResourceSchemaObject({
    type: "location_availability",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        description:
            "One stretch of time the location can be used for. A location with none of these" +
            " is unconstrained and counts as usable throughout the edition; the first one" +
            " added is what narrows it to the times given.",
        properties: {
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
        },
        required: ["startsAt", "endsAt"],
        additionalProperties: false,
    },
});
