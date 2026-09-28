import {
    buildResourceSchemaObject,
    type MetaSchemaObject,
    type RelationshipDefinition,
} from "@jsonapi-serde/openapi";
import type { SparseFieldSets } from "@jsonapi-serde/server/request";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import type { Host } from "../entity/Host.js";
import { serializeImageFileDescriptor } from "../support/file-upload.js";
import { type Caller, type JwtPayload, userProvidesRole } from "../util/auth.js";
import { imageFileDescriptorSchemaObject } from "../util/openapi.js";
import type { SerializeMap } from "./index.js";

/**
 * What a handler tells the host serializer about the wider edition.
 *
 * Without counts a host is served with no `meta` at all rather than a zero,
 * which would claim the endpoint had looked. Only the organizer's list looks;
 * a host appearing inside a session or a schedule document does not.
 */
export type HostSerializerContext = {
    sessionCounts?: ReadonlyMap<string, number>;
};

export const hostSerializer: EntitySerializer<Host, HostSerializerContext> = {
    getId: (entity) => entity.id,
    serialize: (entity, context) =>
        ({
            ...(context?.sessionCounts !== undefined && {
                meta: { sessionCount: context.sessionCounts.get(entity.id) ?? 0 },
            }),
            attributes: {
                displayName: entity.displayName,
                emailAddress: entity.emailAddress,
                biography: entity.biography,
                avatar: serializeImageFileDescriptor(entity.avatar),
            },
            relationships: {
                ...(entity.responses.isInitialized() && {
                    responses: {
                        data: entity.responses.map((response) => ({
                            type: "response",
                            id: response.id,
                            entity: response,
                        })),
                    },
                }),
                ...(entity.availabilities.isInitialized() && {
                    availabilities: {
                        data: entity.availabilities.map((availability) => ({
                            type: "host_availability",
                            id: availability.id,
                            entity: availability,
                        })),
                    },
                }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

export const hostResourceFields = [
    "displayName",
    "emailAddress",
    "biography",
    "avatar",
    "responses",
    "availabilities",
] as const;

/**
 * Reports whether the caller may read when a host is free, which is personal data.
 *
 * Organizers alone. A speaker sharing a session with someone has no business
 * reading their calendar, and an integration serves a published schedule
 * rather than plans one.
 */
export const seesHostAvailability = (caller: Caller, jwtPayload: JwtPayload): boolean =>
    caller !== "integration" && userProvidesRole(jwtPayload, caller, "manager");

export const withVisibleHostFields = (
    caller: Caller,
    jwtPayload: JwtPayload,
    fields?: Partial<SparseFieldSets>,
): Partial<SparseFieldSets> => {
    const visible: string[] = seesHostAvailability(caller, jwtPayload)
        ? [...hostResourceFields]
        : hostResourceFields.filter(
              (field) => field !== "emailAddress" && field !== "availabilities",
          );

    return {
        ...fields,
        host: fields?.host ? fields.host.filter((field) => visible.includes(field)) : visible,
    };
};

const hostAttributesSchemaObject: SchemaObject = {
    type: "object",
    properties: {
        displayName: {
            type: "string",
            minLength: 1,
        },
        emailAddress: {
            type: "string",
            format: "email",
        },
        biography: {
            type: "string",
        },
        avatar: imageFileDescriptorSchemaObject,
    },
    required: ["displayName", "emailAddress", "biography", "avatar"],
    additionalProperties: false,
};

const responsesRelationship: RelationshipDefinition = {
    id: { type: "string", format: "uuid" },
    type: "response",
    name: "responses",
    cardinality: "many",
};

const availabilitiesRelationship: RelationshipDefinition = {
    id: { type: "string", format: "uuid" },
    type: "host_availability",
    name: "availabilities",
    cardinality: "many",
};

const restrictedHostAttributesSchemaObject: SchemaObject = {
    ...hostAttributesSchemaObject,
    required: ["displayName", "biography", "avatar"],
    description: "emailAddress is only present for managers and admins.",
};

export const restrictedHostResourceSchema = buildResourceSchemaObject({
    type: "host",
    id: { type: "string", format: "uuid" },
    attributes: restrictedHostAttributesSchemaObject,
    relationships: [responsesRelationship],
});

export const schedulingHostResourceSchema = buildResourceSchemaObject({
    type: "host",
    id: { type: "string", format: "uuid" },
    attributes: restrictedHostAttributesSchemaObject,
    relationships: [responsesRelationship, { ...availabilitiesRelationship, optional: true }],
});

export const ownHostResourceSchema = buildResourceSchemaObject({
    type: "host",
    id: { type: "string", format: "uuid" },
    attributes: hostAttributesSchemaObject,
    relationships: [responsesRelationship, availabilitiesRelationship],
});

export const hostResourceMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        sessionCount: {
            type: "integer",
            description:
                "Sessions of this edition the host is on, counted whatever state each is in," +
                " so a host who submitted and withdrew still shows one.",
        },
    },
    required: ["sessionCount"],
    additionalProperties: false,
};

const listedHostResourceSchema = buildResourceSchemaObject({
    type: "host",
    id: { type: "string", format: "uuid" },
    attributes: restrictedHostAttributesSchemaObject,
    relationships: [],
});

/**
 * The host as the organizer's own list serves it.
 *
 * Its own schema on both counts: a declared `meta` is a required member and
 * every other endpoint mentioning a host counts nothing, while the list loads
 * no relationships at all, so requiring the ones a single host carries would
 * describe a document this route never sends.
 */
export const countedHostResourceSchema: SchemaObject = {
    ...listedHostResourceSchema,
    properties: {
        ...listedHostResourceSchema.properties,
        meta: hostResourceMetaSchemaObject,
    },
    required: [...(listedHostResourceSchema.required ?? []), "meta"],
};

export const hostListDocumentMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        total: {
            type: "integer",
            description:
                "Hosts this caller's filters matched, across every page rather than the one" +
                " served.",
        },
    },
    required: ["total"],
    additionalProperties: false,
};
