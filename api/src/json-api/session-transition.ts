import { buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import { sessionStates } from "../entity/Session.js";
import type { SessionTransition } from "../entity/SessionTransition.js";
import type { SerializeMap } from "./index.js";

export const sessionTransitionSerializer: EntitySerializer<SessionTransition> = {
    getId: (entity) => entity.id,
    serialize: (entity) =>
        ({
            attributes: {
                createdAt: entity.createdAt.toString(),
                fromState: entity.fromState,
                toState: entity.toState,
                note: entity.note,
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
                actor: {
                    data:
                        entity.actor === null
                            ? null
                            : {
                                  type: "user",
                                  id: entity.actor.id,
                                  entity: entity.actor.isInitialized()
                                      ? entity.actor.unwrap()
                                      : undefined,
                              },
                },
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const sessionTransitionResourceFields = [
    "createdAt",
    "fromState",
    "toState",
    "note",
    "session",
    "actor",
] as const;

export const sessionTransitionResourceSchema = buildResourceSchemaObject({
    type: "session_transition",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            createdAt: {
                type: "string",
                format: "date-time",
            },
            fromState: {
                type: "string",
                enum: [...sessionStates],
            },
            toState: {
                type: "string",
                enum: [...sessionStates],
            },
            note: {
                type: ["string", "null"],
            },
        },
        required: ["createdAt", "fromState", "toState", "note"],
        additionalProperties: false,
    },
    relationships: [
        {
            id: { type: "string", format: "uuid" },
            type: "session",
            name: "session",
            cardinality: "one",
        },
        {
            id: { type: "string", format: "uuid" },
            type: "user",
            name: "actor",
            cardinality: "one_nullable",
        },
    ],
});
