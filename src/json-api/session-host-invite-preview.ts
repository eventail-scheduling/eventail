import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type {
    EntitySerializer,
    SerializedEntity,
    SerializeOptions,
} from "@jsonapi-serde/server/response";
import type { Loaded } from "@mikro-orm/core";
import type { SessionHostInvite } from "../entity/SessionHostInvite.js";
import { inviteTimeToLive } from "../support/invites.js";
import type { SerializeMap } from "./index.js";

type LoadedInvite = Loaded<SessionHostInvite, "session.edition">;

/**
 * The little the acceptance page needs to name what is being accepted.
 *
 * The invitee cannot read the session itself; the two included resources carry
 * a name apiece so the page can say what it is and ask the edition what it
 * wants from a host.
 */
export const sessionHostInvitePreviewSerializer: EntitySerializer<LoadedInvite> = {
    getId: (entity) => entity.code,
    serialize: (entity) => {
        const session = entity.session.unwrap();

        return {
            attributes: {
                emailAddress: entity.emailAddress,
                expiresAt: entity.createdAt.add(inviteTimeToLive).toString(),
            },
            relationships: {
                session: {
                    data: { type: "session", id: session.id, entity: session },
                },
                edition: {
                    data: {
                        type: "edition",
                        id: session.edition.id,
                        entity: session.edition.unwrap(),
                    },
                },
            },
        } satisfies SerializedEntity<SerializeMap>;
    },
};

/**
 * Bounds the two included resources to a name apiece.
 *
 * Their serializers are the ones the rest of the API uses, and describe far more
 * than someone holding an invite code may see: a session carries the organizer's
 * notes, an edition its whole configuration. The allowlist is what keeps an
 * attribute added to either from reaching this response.
 */
export const sessionHostInvitePreviewSerializeOptions: SerializeOptions<SerializeMap> = {
    include: ["session", "edition"],
    fields: {
        session: ["title"],
        edition: ["name"],
    },
};

const previewSessionResourceSchema = buildResourceSchemaObject({
    type: "session",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
    },
});

const previewEditionResourceSchema = buildResourceSchemaObject({
    type: "edition",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false,
    },
});

export const sessionHostInvitePreviewIncludedSchemas = [
    previewSessionResourceSchema,
    previewEditionResourceSchema,
];

export const sessionHostInvitePreviewResourceSchema = buildResourceSchemaObject({
    type: "session_host_invite_preview",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            emailAddress: { type: "string", format: "email" },
            expiresAt: { type: "string", format: "date-time" },
        },
        required: ["emailAddress", "expiresAt"],
        additionalProperties: false,
    },
    relationships: [
        {
            name: "session",
            type: "session",
            id: { type: "string", format: "uuid" },
            cardinality: "one",
        },
        {
            name: "edition",
            type: "edition",
            id: { type: "string", format: "uuid" },
            cardinality: "one",
        },
    ],
});
