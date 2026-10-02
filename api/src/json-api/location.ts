import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Loaded } from "@mikro-orm/core";
import type { Location } from "../entity/Location.js";
import type { User } from "../entity/User.js";
import { type JwtPayload, userProvidesRole } from "../util/auth.js";
import type { SerializeMap } from "./index.js";

export const locationSerializer: EntitySerializer<Location> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                name: entity.name,
                externalKey: entity.externalKey,
                position: entity.position,
            },
            relationships: {
                venue: {
                    data: {
                        type: "venue",
                        id: entity.venue.id,
                        entity: entity.venue.isInitialized() ? entity.venue.unwrap() : undefined,
                    },
                },
                ...(entity.availabilities.isInitialized() && {
                    availabilities: {
                        data: entity.availabilities.map((availability) => ({
                            type: "location_availability",
                            id: availability.id,
                            entity: availability,
                        })),
                    },
                }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const locationResourceFields = [
    "name",
    "externalKey",
    "position",
    "venue",
    "availabilities",
] as const;

/**
 * Reports whether a caller may read location availability, which takes the manager role.
 *
 * Availability never reaches a published schedule and never bumps the edition
 * revision, so an integration reading it would have no way to learn it changed.
 */
export const seesLocationAvailability = (
    user: Loaded<User, "teams"> | null,
    jwtPayload: JwtPayload,
): boolean => user !== null && userProvidesRole(jwtPayload, user, "manager");

export const withVisibleLocationFields = (
    user: Loaded<User, "teams"> | null,
    jwtPayload: JwtPayload,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] = seesLocationAvailability(user, jwtPayload)
        ? [...locationResourceFields]
        : locationResourceFields.filter((field) => field !== "availabilities");

    return {
        ...fields,
        location: fields?.location
            ? fields.location.filter((field) => visible.includes(field))
            : visible,
    };
};

export const locationResourceSchema = buildResourceSchemaObject({
    type: "location",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            name: {
                type: "string",
                minLength: 1,
            },
            position: {
                description: "Which column this room is, on a grid that reads left to right",
                type: "integer",
                minimum: 0,
            },
            externalKey: {
                type: ["string", "null"],
                minLength: 1,
            },
        },
        required: ["name", "externalKey", "position"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "venue",
            name: "venue",
            cardinality: "one",
        },
        {
            id: { type: "string", format: "uuid" },
            type: "location_availability",
            name: "availabilities",
            cardinality: "many",
            optional: true,
        },
    ],
});
