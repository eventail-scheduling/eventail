import { buildResourceSchemaObject, type RelationshipDefinition } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import { type Team, teamRoles } from "../entity/Team.js";
import type { SerializeMap } from "./index.js";

export const teamSerializer: EntitySerializer<Team> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                name: entity.name,
                role: entity.role,
            },
            relationships: {
                ...(entity.users.isInitialized() && {
                    users: {
                        data: entity.users.map((user) => ({
                            type: "user",
                            id: user.id,
                            entity: user,
                        })),
                    },
                }),
                ...(entity.invites.isInitialized() && {
                    invites: {
                        data: entity.invites.map((invite) => ({
                            type: "team_invite",
                            id: invite.id,
                            entity: invite,
                        })),
                    },
                }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const teamResourceFields = ["name", "role", "users", "invites"] as const;

const teamAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        name: {
            type: "string",
            minLength: 1,
        },
        role: {
            type: ["string"],
            enum: [...teamRoles],
        },
    },
    required: ["name", "role"],
    additionalProperties: false,
};

const usersRelationship: RelationshipDefinition = {
    id: { type: "string", format: "uuid" },
    type: "user",
    name: "users",
    cardinality: "many",
};

const invitesRelationship: RelationshipDefinition = {
    id: { type: "string", format: "uuid" },
    type: "team_invite",
    name: "invites",
    cardinality: "many",
};

export const teamResourceSchema = buildResourceSchemaObject({
    type: "team",
    id: { type: "string", format: "uuid" },
    attributes: teamAttributesSchemaObject,
    relationships: [usersRelationship, invitesRelationship],
});

/**
 * A team as the profile document carries it, which loads neither collection.
 *
 * Reading a profile should not cost every team's roster, so `GET /user`
 * includes teams by name alone.
 */
export const restrictedTeamResourceSchema = buildResourceSchemaObject({
    type: "team",
    id: { type: "string", format: "uuid" },
    attributes: teamAttributesSchemaObject,
    relationships: [
        { ...usersRelationship, optional: true },
        { ...invitesRelationship, optional: true },
    ],
});
