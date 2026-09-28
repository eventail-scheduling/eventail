import { createHash } from "node:crypto";
import { jsonApiQuery } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { type AnyParseQueryOptions, createQueryParser } from "@jsonapi-serde/server/request";
import { type FindOneOptions, IsolationLevel, type Loaded } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, header, pathParams } from "@taxum/core/extract";
import { type HeaderEntryLike, type HttpResponseLike, StatusCode } from "@taxum/core/http";
import { createExtractHandler } from "@taxum/core/routing";
import type {
    HeaderObject,
    OpenApiBuilder,
    ParameterObject,
    ResponsesObject,
} from "openapi3-ts/oas31";
import { z } from "zod";
import { Edition } from "../../../entity/Edition.js";
import { EditionRevision } from "../../../entity/EditionRevision.js";
import { Schedule } from "../../../entity/Schedule.js";
import {
    embeddedCustomFieldResourceFields,
    embeddedCustomFieldResourceSchema,
    withVisibleCustomFieldFields,
} from "../../../json-api/custom-field.js";
import {
    editionResourceFields,
    restrictedEditionResourceSchema,
    withVisibleEditionFields,
} from "../../../json-api/edition.js";
import {
    hostResourceFields,
    restrictedHostResourceSchema,
    withVisibleHostFields,
} from "../../../json-api/host.js";
import { serialize } from "../../../json-api/index.js";
import { locationResourceFields, locationResourceSchema } from "../../../json-api/location.js";
import { isIncluded } from "../../../json-api/query.js";
import { responseResourceFields, responseResourceSchema } from "../../../json-api/response.js";
import { scheduleResourceFields, scheduleResourceSchema } from "../../../json-api/schedule.js";
import {
    restrictedSessionResourceSchema,
    sessionResourceFields,
    withVisibleSessionFields,
} from "../../../json-api/session.js";
import {
    restrictedSessionTypeResourceSchema,
    sessionTypeResourceFields,
    withVisibleSessionTypeFields,
} from "../../../json-api/session-type.js";
import { slotResourceFields, slotResourceSchema } from "../../../json-api/slot.js";
import { trackResourceFields, trackResourceSchema } from "../../../json-api/track.js";
import { findCurrentSchedule } from "../../../support/schedules.js";
import { populateSessionRelations } from "../../../support/sessions.js";
import {
    type Caller,
    caller,
    JWT_PAYLOAD,
    type JwtPayload,
    userProvidesRole,
} from "../../../util/auth.js";
import { notFoundError } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter } from "../../../util/openapi.js";
import { EDITION } from "../resolve-edition-layer.js";

/**
 * Fields alone, deliberately.
 *
 * A list that could include would serve a publication's whole grid per row.
 */
const listQueryOptions = {
    fields: {
        allowed: {
            schedule: scheduleResourceFields,
        },
    },
} as const satisfies AnyParseQueryOptions;

const parseListQuery = createQueryParser(listQueryOptions);

export const listSchedulesHandler = createExtractHandler(
    jsonApiQuery(parseListQuery),
    extension(EDITION, true),
).handler(async (query, edition) => {
    const schedules = await em.find(Schedule, { edition }, { orderBy: { sequence: "desc" } });

    if (query.fields?.schedule?.includes("slots") ?? true) {
        await em.populate(schedules, ["slots"], { fields: ["*", "slots.id"] });
    }

    return serialize("schedule", schedules, { fields: query.fields });
});

const showQueryOptions = {
    fields: {
        allowed: {
            schedule: scheduleResourceFields,
            edition: editionResourceFields,
            slot: slotResourceFields,
            location: locationResourceFields.filter((field) => field !== "availabilities"),
            session: sessionResourceFields,
            host: hostResourceFields.filter((field) => field !== "availabilities"),
            response: responseResourceFields,
            custom_field: embeddedCustomFieldResourceFields,
            track: trackResourceFields,
            session_type: sessionTypeResourceFields,
        },
    },
    include: {
        allowed: [
            "slots.location",
            "slots.session.responses.customField",
            "slots.session.hosts.responses.customField",
            "slots.session.track",
            "slots.session.sessionType",
        ],
        default: ["slots"],
    },
} as const satisfies AnyParseQueryOptions;

const parseGetQuery = createQueryParser(showQueryOptions);
type ScheduleQuery = ReturnType<typeof parseGetQuery>;
type AllowedInclude = ScheduleQuery["include"][number];
type PopulateInclude = Exclude<
    AllowedInclude,
    `slots.session.hosts${string}` | `slots.session.responses${string}`
>;

type SchedulePopulate = PopulateInclude | "edition";

const isPopulateInclude = (field: AllowedInclude): field is PopulateInclude =>
    !(field.startsWith("slots.session.hosts") || field.startsWith("slots.session.responses"));

type ScheduleDocument = {
    schedule: Loaded<Schedule, SchedulePopulate>;
    query: ScheduleQuery;
    caller: Caller;
    jwtPayload: JwtPayload;
};

const buildFindOptions = (
    query: ScheduleQuery,
    caller: Caller,
): FindOneOptions<Schedule, SchedulePopulate> => {
    const { include } = query;
    // The hosts and responses paths are filtered out above, so including one of
    // those and nothing else has to load the sessions here or nothing will.
    const populate: PopulateInclude[] = isIncluded(query, "slots.session")
        ? ["slots.session", ...(include ?? []).filter(isPopulateInclude)]
        : ["slots", ...(include ?? []).filter(isPopulateInclude)];

    return {
        // Forced in rather than left to `include`: a draft carries no window
        // of its own, so the edition's is what makes its slot instants
        // meaningful. A publication answers for itself.
        populate: [...populate, "edition"],
        // Published schedules still carry unconfirmed slots.
        ...(caller === "integration" && {
            populateWhere: { slots: { session: { state: "confirmed" } } },
        }),
    };
};

const serializeScheduleDocument = async ({
    schedule,
    query,
    caller,
    jwtPayload,
}: ScheduleDocument) => {
    if (isIncluded(query, "slots.session")) {
        await populateSessionRelations({
            sessions: schedule.slots.map((slot) => slot.session.unwrap()),
            query,
            sessionIncludePath: "slots.session",
            seesEveryResponse:
                caller !== "integration" && userProvidesRole(jwtPayload, caller, "manager"),
            callerUser: caller === "integration" ? null : caller,
        });
    }

    return serialize("schedule", schedule, {
        context: { edition: { caller } },
        include: [...(query.include ?? []), "edition"],
        fields: withVisibleSessionFields(
            caller,
            withVisibleHostFields(
                caller,
                jwtPayload,
                withVisibleCustomFieldFields(
                    caller,
                    withVisibleSessionTypeFields(
                        caller,
                        withVisibleEditionFields(caller, query.fields),
                    ),
                ),
            ),
        ),
    });
};

type ScheduleFinder = (
    em: EntityManager,
    findOptions: FindOneOptions<Schedule, SchedulePopulate>,
) => Promise<Loaded<Schedule, SchedulePopulate> | null>;

type ScheduleDocumentRequest = {
    find: ScheduleFinder;
    notFound: () => JsonApiError;
    query: ScheduleQuery;
    caller: Caller;
    jwtPayload: JwtPayload;
    edition: Edition;
    ifNoneMatch?: string | undefined;
};

/**
 * Builds a weak validator, hashed so nothing invites parsing it.
 *
 * Weak, because `.compression()` is in the global stack and a strong validator
 * claims byte equality of the selected representation. `If-None-Match` compares
 * weakly (RFC 9110, section 13.1.2).
 *
 * Hashed so the validator is opaque in fact and not only by contract: a
 * structured one invites a consumer to parse it and compare revisions
 * numerically. Not secrecy, since the document already names the schedule id;
 * the full digest is kept so there is no truncation constant to explain.
 *
 * The schedule id stays in the preimage even though the per-edition counter is
 * monotonic and publish bumps it: it costs nothing and keeps the validator
 * moving on publication regardless.
 */
const scheduleValidator = (schedule: Schedule, revision: number): string =>
    `W/"${createHash("sha256").update(`${schedule.id}:${revision}`).digest("hex")}"`;

const readEditionRevision = async (em: EntityManager, edition: Edition): Promise<number> => {
    const row = await em.findOne(EditionRevision, { editionId: edition.id });

    return row ? row.revision : 0;
};

/**
 * Returns the validator and the cache headers it has to travel with.
 *
 * The global layer sets `no-store` (`app.ts:51-54`), which would tell a consumer
 * not to keep the validator it was just handed. A route-level value wins because
 * that layer only inserts when absent: store it, and revalidate every time.
 */
const validatorHeaders = (value: string): HeaderEntryLike[] => [
    ["etag", value],
    ["cache-control", "private, no-cache"],
];

// The same URL serves a manager a document carrying notes and confidential
// responses and an integration a narrowed one with a validator, so a cache
// keying on the URL alone must be told about the split. The compression layer
// appends its own vary member at runtime, so this arrives appended rather
// than clobbered.
const varyHeader: HeaderEntryLike = ["vary", "authorization"];

/**
 * Strips the `W/` prefix, which weak comparison per RFC 9110 ignores.
 *
 * The caller applies this to both sides, so a client or intermediary that
 * normalizes the weak marker away still gets its 304 instead of a silent full
 * rebuild forever.
 */
const stripWeakPrefix = (tag: string): string => (tag.startsWith("W/") ? tag.slice(2) : tag);

const matchesValidator = (ifNoneMatch: string, validator: string): boolean =>
    ifNoneMatch
        .split(",")
        .map((candidate) => stripWeakPrefix(candidate.trim()))
        .some((candidate) => candidate === "*" || candidate === stripWeakPrefix(validator));

/**
 * Reads the document in one snapshot, so it cannot come back torn.
 *
 * Building the document takes several queries, and under read committed each
 * gets its own snapshot: a write landing between two of them yields a document
 * that is half old and half new under a validator built from the newer
 * counter. A consumer stores that and stops asking for it.
 *
 * Every route that can serve a validator reads through here, because the tear
 * is what makes a stored copy wrong rather than merely stale. The list and a
 * reversion's response never reach this, and of the routes that do, only
 * `/current` answers an integration, which is the only caller given one.
 * Reads take no row locks, so no writer is delayed.
 */
const readScheduleDocument = async ({
    find,
    notFound,
    query,
    caller,
    jwtPayload,
    edition: staleEdition,
    ifNoneMatch,
}: ScheduleDocumentRequest): Promise<HttpResponseLike> =>
    em.transactional(
        async (em) => {
            // Read again inside the transaction, and uncovered by any test,
            // since the stale window opens inside a single request with
            // nothing to latch onto: resolveEditionLayer read the edition as
            // middleware, before this transaction existed, and the fork
            // inherits that instance. Without this a timeZone committed in
            // that window rides into the document under the fresh validator,
            // and every slot instant is read in the wrong zone for as long as
            // the consumer holds it.
            const edition = await em.findOne(Edition, staleEdition.id, { refresh: true });

            if (!edition) {
                throw notFound();
            }

            // Only an integration gets a validator, and only on the route
            // whose revision tracks what it can see. A manager's document
            // carries notes and confidential responses, which change the bytes
            // without moving the revision, so a 304 would hand back content
            // that is stale for them.
            const revision = caller === "integration" ? await readEditionRevision(em, edition) : 0;

            if (ifNoneMatch !== undefined && caller === "integration") {
                const current = await find(em, {});

                if (
                    current &&
                    matchesValidator(ifNoneMatch, scheduleValidator(current, revision))
                ) {
                    // Our own validator, never the client's list.
                    return [
                        StatusCode.NOT_MODIFIED,
                        [...validatorHeaders(scheduleValidator(current, revision)), varyHeader],
                        null,
                    ];
                }
            }

            const schedule = await find(em, buildFindOptions(query, caller));

            if (!schedule) {
                throw notFound();
            }

            const document = await serializeScheduleDocument({
                schedule,
                query,
                caller,
                jwtPayload,
            });

            if (caller !== "integration") {
                return [[varyHeader], document];
            }

            return [
                [...validatorHeaders(scheduleValidator(schedule, revision)), varyHeader],
                document,
            ];
        },
        // readOnly does not stop the flush MikroORM runs after the callback, so
        // its real effect is to turn a stray change set into a failure here
        // rather than a write during a read.
        { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
    );

// Not notFoundError: it names an id in the detail, and the two static routes
// address a schedule by position rather than by one.
const scheduleNotFound = (detail: string): JsonApiError =>
    new JsonApiError({
        status: "404",
        code: "not_found",
        title: "Schedule not found",
        detail,
    });

export const showCurrentScheduleHandler = createExtractHandler(
    jsonApiQuery(parseGetQuery),
    caller,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
    header("if-none-match"),
).handler(async (query, caller, jwtPayload, edition, ifNoneMatch) =>
    readScheduleDocument({
        find: (em, findOptions) => findCurrentSchedule(em, edition, findOptions),
        notFound: () => scheduleNotFound("This edition has no published schedule"),
        query,
        caller,
        jwtPayload,
        edition,
        ifNoneMatch,
    }),
);

export const showLatestScheduleHandler = createExtractHandler(
    jsonApiQuery(parseGetQuery),
    caller,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async (query, caller, jwtPayload, edition) =>
    readScheduleDocument({
        find: (em, findOptions) =>
            em.findOne(Schedule, { edition }, { ...findOptions, orderBy: { sequence: "desc" } }),
        notFound: () => scheduleNotFound("This edition has no draft schedule"),
        query,
        caller,
        jwtPayload,
        edition,
    }),
);

export const showScheduleHandler = createExtractHandler(
    pathParams(z.object({ scheduleId: z.uuid() })),
    jsonApiQuery(parseGetQuery),
    caller,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ scheduleId }, query, caller, jwtPayload, edition) =>
    readScheduleDocument({
        find: (em, findOptions) => em.findOne(Schedule, { edition, id: scheduleId }, findOptions),
        notFound: () => notFoundError("Schedule", scheduleId),
        query,
        caller,
        jwtPayload,
        edition,
    }),
);

const ifNoneMatchParameter: ParameterObject = {
    name: "If-None-Match",
    in: "header",
    required: false,
    description:
        "A validator from an earlier read of this route. Answers 304 when it still holds," +
        " without building the document. Honored for integration tokens only.",
    schema: { type: "string" },
};

const varyResponseHeader: HeaderObject = {
    description:
        "Always authorization: the representation depends on the caller, so a cache" +
        " must not serve one caller's copy to another.",
    schema: { type: "string" },
};

const etagResponseHeader: HeaderObject = {
    description:
        "Opaque weak validator. It changes whenever the published schedule an integration" +
        " reads changes, and a new publication always yields a new one. Store it and send" +
        " it back verbatim; nothing about its structure is contractual.",
    schema: {
        type: "string",
        example: 'W/"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"',
    },
};

const scheduleReadResponses: ResponsesObject = {
    200: buildDataResponseObject({
        description: "OK",
        cardinality: "one",
        resourceSchema: scheduleResourceSchema,
        included: [
            restrictedEditionResourceSchema,
            slotResourceSchema,
            locationResourceSchema,
            restrictedSessionResourceSchema,
            restrictedHostResourceSchema,
            responseResourceSchema,
            embeddedCustomFieldResourceSchema,
            trackResourceSchema,
            restrictedSessionTypeResourceSchema,
        ],
    }),
    403: buildErrorResponseObject({ description: "Forbidden" }),
    404: buildErrorResponseObject({ description: "Edition or schedule not found" }),
};

export const addOpenapiScheduleReadPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/schedules", {
        get: {
            tags: ["Schedules"],
            summary: "List schedules",
            description:
                "Lists the schedules of an edition, newest first. Requires the viewer role. Carries a resource identifier per slot of each schedule, so a client that does not need them should name the fields it wants: `fields[schedule]` both narrows the document and stops the slots being read at all.",
            operationId: "listSchedules",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(listQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: scheduleResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/schedules/current", {
        get: {
            tags: ["Schedules"],
            summary: "Show the current schedule",
            description:
                "Retrieves the most recent publication of an edition, preliminary or final. This is the route an integration reads. Requires the viewer role or an integration token; the latter sees slots for confirmed sessions only and is the only caller given a validator.\n\nThe document is a complete snapshot rather than a delta: anything absent from a fresh fetch is gone, and there is no tombstone saying so. Match slots against a previously held copy by `stableId`, since `id` changes on every publication, and everything else by `id`. The validator covers this document alone. Other routes an integration reads, the edition and the location, track, session type and custom field lists, carry no validator and can change without moving it, so refetch those unconditionally.",
            operationId: "showCurrentSchedule",
            parameters: [
                createUuidPathParameter("editionId"),
                ifNoneMatchParameter,
                ...buildQueryParameters(showQueryOptions),
            ],
            responses: {
                ...scheduleReadResponses,
                200: {
                    ...scheduleReadResponses[200],
                    headers: { ETag: etagResponseHeader, Vary: varyResponseHeader },
                },
                304: {
                    description: "The held validator still matches; the body is empty",
                    headers: { ETag: etagResponseHeader, Vary: varyResponseHeader },
                },
            },
        },
    });

    builder.addPath("/editions/{editionId}/schedules/latest", {
        get: {
            tags: ["Schedules"],
            summary: "Show the working draft",
            description:
                "Retrieves the newest draft schedule, which is where further edits go. Requires the viewer role; integration tokens cannot read drafts.",
            operationId: "showLatestSchedule",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(showQueryOptions),
            ],
            responses: scheduleReadResponses,
        },
    });

    builder.addPath("/editions/{editionId}/schedules/{scheduleId}", {
        get: {
            tags: ["Schedules"],
            summary: "Show a schedule",
            description:
                "Retrieves a single schedule by id. Requires the viewer role. An integration reads the current publication instead.",
            operationId: "showSchedule",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
                ...buildQueryParameters(showQueryOptions),
            ],
            responses: scheduleReadResponses,
        },
    });
};
