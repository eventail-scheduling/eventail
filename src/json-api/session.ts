import {
    buildResourceSchemaObject,
    type MetaSchemaObject,
    type RelationshipDefinition,
} from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import { type Session, sessionStates } from "../entity/Session.js";
import { serializeImageFileDescriptor } from "../support/file-upload.js";
import { allowedTransitions } from "../support/session-transitions.js";
import type { Caller } from "../util/auth.js";
import { buildDurationSchemaObject } from "../util/docs.js";
import { imageFileDescriptorSchemaObject } from "../util/openapi.js";
import type { SerializeMap } from "./index.js";

/**
 * Who the caller is to the sessions in one document.
 *
 * Host-ness is named per session rather than worked out here, because a
 * session listed without `include=hosts` loads its hosts by id alone and
 * cannot answer it.
 */
export type SessionActor = {
    isManager: boolean;
    hostsSessions: ReadonlySet<string>;
};

/**
 * What a handler tells the session serializer about the caller.
 *
 * Without an actor the session is served with no `meta` at all rather than one
 * holding empty lists, which would read as a caller who may make no move rather
 * than a document that never asked. Named, every member is worked out and sent,
 * empty included: absence here means uncomputed, not inapplicable.
 */
export type SessionSerializerContext = {
    actor?: SessionActor;
};

export const sessionSerializer: EntitySerializer<Session, SessionSerializerContext> = {
    getId: (entity) => entity.id,
    serialize: (entity, context) =>
        ({
            ...(context?.actor !== undefined && {
                meta: {
                    hostTransitions: allowedTransitions(entity.state, {
                        isManager: false,
                        isHost: context.actor.hostsSessions.has(entity.id),
                    }),
                    managerTransitions: allowedTransitions(entity.state, {
                        isManager: context.actor.isManager,
                        isHost: false,
                    }),
                    hosting: context.actor.hostsSessions.has(entity.id),
                },
            }),
            attributes: {
                createdAt: entity.createdAt.toString(),
                state: entity.state,
                title: entity.title,
                abstract: entity.abstract,
                description: entity.description,
                notes: entity.notes,
                duration: entity.duration?.toString() ?? null,
                setupTime: entity.setupTime?.toString() ?? null,
                teardownTime: entity.teardownTime?.toString() ?? null,
                teaserImage: serializeImageFileDescriptor(entity.teaserImage),
            },
            relationships: {
                ...(entity.hosts.isInitialized() && {
                    hosts: {
                        data: entity.hosts.map((host) => ({
                            type: "host",
                            id: host.id,
                            entity: host,
                        })),
                    },
                }),
                ...(entity.responses.isInitialized() && {
                    responses: {
                        data: entity.responses.map((response) => ({
                            type: "response",
                            id: response.id,
                            entity: response,
                        })),
                    },
                }),
                sessionType: {
                    data: {
                        type: "session_type",
                        id: entity.sessionType.id,
                        entity: entity.sessionType.isInitialized()
                            ? entity.sessionType.unwrap()
                            : undefined,
                    },
                },
                track: {
                    data:
                        entity.track === null
                            ? null
                            : {
                                  type: "track",
                                  id: entity.track.id,
                                  entity: entity.track.isInitialized()
                                      ? entity.track.unwrap()
                                      : undefined,
                              },
                },
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

/**
 * Hides notes, which must never reach the integration.
 *
 * Notes are what a speaker tells the organizing team, and the integration's
 * schedule is the outward facing one.
 */
export const withVisibleSessionFields = (
    caller: Caller,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] =
        caller === "integration"
            ? sessionResourceFields.filter((field) => field !== "notes")
            : [...sessionResourceFields];

    return {
        ...fields,
        session: fields?.session
            ? fields.session.filter((field) => visible.includes(field))
            : visible,
    };
};

export const sessionResourceFields = [
    "createdAt",
    "state",
    "title",
    "abstract",
    "description",
    "notes",
    "duration",
    "setupTime",
    "teardownTime",
    "teaserImage",
    "hosts",
    "sessionType",
    "track",
    "responses",
] as const;

export const sessionResourceMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        hostTransitions: {
            type: "array",
            items: { type: "string", enum: [...sessionStates] },
            description:
                "States this caller may move the session to as a host of it, empty where" +
                " they host it but may make no move, or do not host it at all.",
        },
        managerTransitions: {
            type: "array",
            items: { type: "string", enum: [...sessionStates] },
            description:
                "States this caller may move the session to as a manager, empty for" +
                " everyone else. Scoped separately from hostTransitions so each surface" +
                " offers the moves of the role it is for: an organizer who submitted their" +
                " own session decides on it where they organize, not where they speak.",
        },
        hosting: {
            type: "boolean",
            description:
                "Whether this caller hosts the session. Not derivable from the transition" +
                " lists: a manager receives managerTransitions without hosting it, and a" +
                " host may receive hostTransitions empty.",
        },
    },
    required: ["hostTransitions", "managerTransitions", "hosting"],
    additionalProperties: false,
};

export const sessionListDocumentMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        total: {
            type: "integer",
            description:
                "Sessions this caller's filters matched, across every page rather than the one" +
                " served.",
        },
    },
    required: ["total"],
    additionalProperties: false,
};

const sessionAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        createdAt: {
            type: "string",
            format: "date-time",
        },
        state: {
            type: "string",
            enum: [...sessionStates],
        },
        title: {
            type: ["string"],
            minLength: 1,
        },
        abstract: { type: ["string"] },
        description: { type: ["string"] },
        notes: { type: ["string"] },
        duration: buildDurationSchemaObject(true),
        setupTime: buildDurationSchemaObject(true),
        teardownTime: buildDurationSchemaObject(true),
        teaserImage: imageFileDescriptorSchemaObject,
    },
    required: [
        "createdAt",
        "state",
        "title",
        "abstract",
        "description",
        "notes",
        "duration",
        "setupTime",
        "teardownTime",
        "teaserImage",
    ],
    additionalProperties: false,
};

const sessionRelationships: RelationshipDefinition[] = [
    {
        id: { type: "string", format: "uuid" },
        type: "host",
        name: "hosts",
        cardinality: "many",
    },
    {
        id: { type: "string", format: "uuid" },
        type: "session_type",
        name: "sessionType",
        cardinality: "one",
    },
    {
        id: { type: "string", format: "uuid" },
        type: "track",
        name: "track",
        cardinality: "one_nullable",
    },
    {
        id: { type: "string", format: "uuid" },
        type: "response",
        name: "responses",
        cardinality: "many",
    },
];

export const sessionResourceSchema = buildResourceSchemaObject({
    type: "session",
    id: { type: "string", format: "uuid" },
    attributes: sessionAttributesSchemaObject,
    relationships: sessionRelationships,
});

/**
 * A session as a document serving an integration alongside the team carries it.
 *
 * `notes` is organizer-only, so `withVisibleSessionFields` withholds it from an
 * integration token. Which attributes arrive therefore depends on the caller
 * rather than the request, and a schema cannot express that, so `notes` is not
 * required here.
 */
export const restrictedSessionResourceSchema = buildResourceSchemaObject({
    type: "session",
    id: { type: "string", format: "uuid" },
    attributes: {
        ...sessionAttributesSchemaObject,
        required: (sessionAttributesSchemaObject.required ?? []).filter(
            (field) => field !== "notes",
        ),
        description: "notes is absent for an integration token.",
    },
    relationships: sessionRelationships,
});

/**
 * The session as an endpoint that names an actor serves it.
 *
 * Separate from {@link sessionResourceSchema} because a declared `meta` is a
 * required member, and an endpoint that merely mentions a session, the
 * schedule document among them, sends none.
 */
export const sessionWithTransitionsResourceSchema: SchemaObject = {
    ...sessionResourceSchema,
    properties: {
        ...sessionResourceSchema.properties,
        meta: sessionResourceMetaSchemaObject,
    },
    required: [...(sessionResourceSchema.required ?? []), "meta"],
};
