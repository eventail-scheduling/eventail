import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { HostAvailability } from "../entity/HostAvailability.js";
import type { SerializeMap } from "./index.js";

export const hostAvailabilitySerializer: EntitySerializer<HostAvailability> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                startsAt: entity.startsAt.toString(),
                endsAt: entity.endsAt.toString(),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const hostAvailabilityResourceFields = ["startsAt", "endsAt"] as const;

export const hostAvailabilityResourceSchema = buildResourceSchemaObject({
    type: "host_availability",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        description:
            "One stretch of time the host said they can present in. A host with none of these" +
            " has not narrowed anything down and counts as available throughout the edition;" +
            " the first one added is what limits them to the times given.",
        properties: {
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
        },
        required: ["startsAt", "endsAt"],
        additionalProperties: false,
    },
});
