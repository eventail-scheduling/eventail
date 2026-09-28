import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { TeamInvite } from "../entity/TeamInvite.js";
import type { SerializeMap } from "./index.js";

export const teamInviteSerializer: EntitySerializer<TeamInvite> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                emailAddress: entity.emailAddress,
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const teamInviteResourceFields = ["emailAddress"] as const;

export const teamInviteResourceSchema = buildResourceSchemaObject({
    type: "team_invite",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            emailAddress: {
                type: "string",
                format: "email",
            },
        },
        required: ["emailAddress"],
        additionalProperties: false,
    },
});
