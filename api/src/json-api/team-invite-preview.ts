import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { Loaded } from "@mikro-orm/core";
import type { TeamInvite } from "../entity/TeamInvite.js";
import { inviteTimeToLive } from "../support/invites.js";
import type { SerializeMap } from "./index.js";

/**
 * The little the acceptance page needs to name what is being accepted.
 *
 * The invitee is not a member yet and the code is the only credential behind
 * this, so nothing beyond the team name, the address and the expiry belongs.
 */
export const teamInvitePreviewSerializer: EntitySerializer<Loaded<TeamInvite, "team">> = {
    getId: (entity) => entity.code,
    serialize: (entity) =>
        ({
            attributes: {
                teamName: entity.team.unwrap().name,
                emailAddress: entity.emailAddress,
                expiresAt: entity.createdAt.add(inviteTimeToLive).toString(),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const teamInvitePreviewResourceSchema = buildResourceSchemaObject({
    type: "team_invite_preview",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            teamName: { type: "string" },
            emailAddress: { type: "string", format: "email" },
            expiresAt: { type: "string", format: "date-time" },
        },
        required: ["teamName", "emailAddress", "expiresAt"],
        additionalProperties: false,
    },
});
