import { buildResourceSchemaObject, type MetaSchemaObject } from "@jsonapi-serde/openapi";
import type { EntitySerializer, SerializedEntity } from "@jsonapi-serde/server/response";
import type { SchemaObject } from "openapi3-ts/oas31";
import { match } from "ts-pattern";
import { type Job, type JobPayload, jobStates, jobTypes } from "../entity/Job.js";
import type { SerializeMap } from "./index.js";

/**
 * Says what a job is for in one line, so a reader needs no payload.
 *
 * Built here rather than in the client: the client would need its own copy of
 * every payload shape, and a shape that changed on this side would go on
 * rendering the old way until someone noticed.
 */
const summarize = (payload: JobPayload): string =>
    match(payload)
        .with(
            { type: "send_email" },
            ({ recipient, subject }) => `Email to ${recipient}: ${subject}`,
        )
        .with(
            { type: "process_teaser_image" },
            ({ sessionId }) => `Teaser image for session ${sessionId}`,
        )
        .with({ type: "process_avatar" }, ({ hostId }) => `Avatar for host ${hostId}`)
        .exhaustive();

/**
 * The payload travels only where it was asked for, which is the detail route.
 *
 * A send_email payload carries the recipient and the whole variables bag, so a
 * list of two hundred rows would ship all of it to draw a summary line that is
 * already an attribute of its own.
 */
export type JobSerializerContext = {
    withPayload?: boolean;
};

export const jobSerializer: EntitySerializer<Job, JobSerializerContext> = {
    getId: (entity) => entity.id,
    serialize: (entity, context) =>
        ({
            attributes: {
                createdAt: entity.createdAt.toString(),
                attemptedAt: entity.attemptedAt?.toString() ?? null,
                scheduledAt: entity.scheduledAt.toString(),
                finalizedAt: entity.finalizedAt?.toString() ?? null,
                attempt: entity.attempt,
                state: entity.state,
                lastError: entity.lastError,
                type: entity.payload.type,
                summary: summarize(entity.payload),
                ...(context?.withPayload === true && { payload: entity.payload }),
            },
        }) satisfies SerializedEntity<SerializeMap>,
};

const sharedAttributes = {
    createdAt: {
        type: "string",
        format: "date-time",
    },
    attemptedAt: {
        type: ["string", "null"],
        format: "date-time",
    },
    scheduledAt: {
        type: "string",
        format: "date-time",
    },
    finalizedAt: {
        type: ["string", "null"],
        format: "date-time",
    },
    attempt: {
        type: "integer",
        minimum: 0,
    },
    state: {
        type: "string",
        enum: [...jobStates],
    },
    lastError: {
        description:
            "Why the job last failed, capped at 2000 characters. Null until it fails, kept across an automatic retry so a running job still shows what went wrong last time, and cleared when it completes or an operator retries it.",
        type: ["string", "null"],
    },
    type: {
        type: "string",
        enum: [...jobTypes],
    },
    summary: {
        description: "What the job is for, in one line, built from the payload.",
        type: "string",
    },
} satisfies Record<string, SchemaObject>;

const sharedRequired = [
    "createdAt",
    "attemptedAt",
    "scheduledAt",
    "finalizedAt",
    "attempt",
    "state",
    "lastError",
    "type",
    "summary",
];

export const jobListDocumentMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        total: {
            type: "integer",
            description: "Jobs the filter matched, across every page rather than the one served.",
        },
    },
    required: ["total"],
    additionalProperties: false,
};

export const jobResourceSchema = buildResourceSchemaObject({
    type: "job",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: sharedAttributes,
        required: sharedRequired,
        additionalProperties: false,
    },
});

export const jobDetailResourceSchema = buildResourceSchemaObject({
    type: "job",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            ...sharedAttributes,
            payload: {
                description: "Everything the consumer was handed, shaped by the job type.",
                type: "object",
            },
        },
        required: [...sharedRequired, "payload"],
        additionalProperties: false,
    },
});
