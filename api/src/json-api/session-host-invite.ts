import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SessionHostInvite } from "../entity/SessionHostInvite.js";
import type { SerializeMap } from "./index.js";

export const sessionHostInviteSerializer: EntitySerializer<SessionHostInvite> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                createdAt: entity.createdAt.toString(),
                emailAddress: entity.emailAddress,
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
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const sessionHostInviteResourceFields = ["createdAt", "emailAddress", "session"] as const;

export const sessionHostInviteResourceSchema = buildResourceSchemaObject({
    type: "session_host_invite",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            createdAt: {
                type: "string",
                format: "date-time",
            },
            emailAddress: {
                type: "string",
                format: "email",
            },
        },
        required: ["createdAt", "emailAddress"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "session",
            name: "session",
            cardinality: "one",
        },
    ],
});
