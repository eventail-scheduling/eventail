import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import type { User } from "../entity/User.js";
import type { SerializeMap } from "./index.js";

export const userSerializer: EntitySerializer<User> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                displayName: entity.displayName,
                emailAddress: entity.emailAddress,
            },
            ...(entity.teams.isInitialized() && {
                relationships: {
                    teams: {
                        data: entity.teams.map((team) => ({
                            type: "team",
                            id: team.id,
                            entity: team,
                        })),
                    },
                },
            }),
        }) satisfies SerializedEntity<SerializeMap>,
};

export const userResourceFields = ["displayName", "emailAddress"] as const;

const displayNameSchemaObject: SchemaObject = {
    type: "string",
    minLength: 1,
};

const userAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        displayName: displayNameSchemaObject,
        emailAddress: {
            type: "string",
            format: "email",
        },
    },
    required: ["displayName", "emailAddress"],
    additionalProperties: false,
};

export const userResourceSchema = buildResourceSchemaObject({
    type: "user",
    id: { type: "string", format: "uuid" },
    attributes: userAttributesSchemaObject,
});

/** Carries the display name alone, for documents a non-manager may read. */
export const namedUserResourceSchema = buildResourceSchemaObject({
    type: "user",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: { displayName: displayNameSchemaObject },
        required: ["displayName"],
        additionalProperties: false,
    },
});

export const userProfileResourceSchema = buildResourceSchemaObject({
    type: "user",
    id: { type: "string", format: "uuid" },
    attributes: userAttributesSchemaObject,
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "team",
            name: "teams",
            cardinality: "many",
        },
    ],
});
