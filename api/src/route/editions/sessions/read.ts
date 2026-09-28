import { jsonApiQuery } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { type AnyParseQueryOptions, createQueryParser } from "@jsonapi-serde/server/request";
import type { FilterQuery } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { createExtractHandler, ORIGINAL_URI } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { Session, sessionStates } from "../../../entity/Session.js";
import {
    embeddedCustomFieldResourceFields,
    embeddedCustomFieldResourceSchema,
} from "../../../json-api/custom-field.js";
import {
    hostResourceFields,
    restrictedHostResourceSchema,
    schedulingHostResourceSchema,
    seesHostAvailability,
    withVisibleHostFields,
} from "../../../json-api/host.js";
import {
    hostAvailabilityResourceFields,
    hostAvailabilityResourceSchema,
} from "../../../json-api/host-availability.js";
import { serialize } from "../../../json-api/index.js";
import { responseResourceFields, responseResourceSchema } from "../../../json-api/response.js";
import {
    sessionListDocumentMetaSchemaObject,
    sessionResourceFields,
    sessionWithTransitionsResourceSchema,
    withVisibleSessionFields,
} from "../../../json-api/session.js";
import {
    sessionTypeResourceFields,
    sessionTypeResourceSchema,
} from "../../../json-api/session-type.js";
import { trackResourceFields, trackResourceSchema } from "../../../json-api/track.js";
import { hostsSession } from "../../../support/hosts.js";
import { populateSessionRelations } from "../../../support/sessions.js";
import {
    type Caller,
    hasGlobalReadAccess,
    JWT_PAYLOAD,
    type JwtPayload,
    requiredUser,
    userProvidesRole,
} from "../../../util/auth.js";
import { assertExists, escapeLikePattern } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter, paginationLinkSchemaObjects } from "../../../util/openapi.js";
import { encodeCursor, findPage } from "../../../util/pagination.js";
import { createPageSchema } from "../../../util/zod.js";
import { EDITION } from "../resolve-edition-layer.js";
import { serializeSessionDocument } from "./document.js";

const listCursorSchema = z.object({
    id: z.uuid(),
});

const listFilterSchema = z
    .strictObject({
        state: z
            .string()
            .transform((states) => states.split(","))
            .pipe(z.array(z.enum(sessionStates)).min(1))
            .optional(),
        track: z.uuid().optional(),
        sessionType: z.uuid().optional(),
        search: z.string().trim().min(1).max(200).optional(),
    })
    .optional();

const listQueryOptions = {
    fields: {
        allowed: {
            host: hostResourceFields,
            host_availability: hostAvailabilityResourceFields,
            session: sessionResourceFields,
            response: responseResourceFields,
            custom_field: embeddedCustomFieldResourceFields,
            session_type: sessionTypeResourceFields,
            track: trackResourceFields,
        },
    },
    include: {
        allowed: [
            "hosts.responses.customField",
            "hosts.availabilities",
            "responses.customField",
            "sessionType",
            "track",
        ],
    },
    page: createPageSchema(listCursorSchema),
    filter: listFilterSchema,
} as const satisfies AnyParseQueryOptions;

const parseListQuery = createQueryParser(listQueryOptions);

type ListInclude = ReturnType<typeof parseListQuery>["include"][number];
type PopulateSessionInclude = Exclude<ListInclude, `hosts${string}` | `responses${string}`>;

const isPopulateSessionInclude = (field: ListInclude): field is PopulateSessionInclude =>
    !(field.startsWith("hosts") || field.startsWith("responses"));

/**
 * Drops the availability path for anyone who may not read it, rather than erroring.
 *
 * `withVisibleHostFields` already keeps the rows out of the query. This filter
 * is what keeps the include list honest, so the serializer is never asked for a
 * path nothing loaded, and it still holds if a second host include is ever
 * added without anyone remembering the field set.
 */
const withVisibleHostIncludes = (
    include: readonly ListInclude[],
    caller: Caller,
    jwtPayload: JwtPayload,
): ListInclude[] =>
    seesHostAvailability(caller, jwtPayload)
        ? [...include]
        : include.filter((field) => field !== "hosts.availabilities");

export const listSessionsHandler = createExtractHandler(
    jsonApiQuery(parseListQuery),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
    extension(ORIGINAL_URI, true),
).handler(async (query, user, jwtPayload, edition, requestUri) => {
    const where: FilterQuery<Session> = {
        edition,
    };

    if (query.filter?.state) {
        where.state = { $in: query.filter.state };
    }

    if (query.filter?.track) {
        where.track = query.filter.track;
    }

    if (query.filter?.sessionType) {
        where.sessionType = query.filter.sessionType;
    }

    if (query.filter?.search) {
        where.title = { $ilike: `%${escapeLikePattern(query.filter.search)}%` };
    }

    // Narrowed once, then used for the query and the document alike, so the
    // rows loaded are the rows served. The fields travel with it rather than
    // being applied at serialize time alone: `relationLoadMode` reads them, so
    // filtering here is what stops an unreadable relation being loaded at all.
    const visible = {
        ...query,
        include: withVisibleHostIncludes(query.include, user, jwtPayload),
        fields: {
            ...withVisibleSessionFields(
                user,
                withVisibleHostFields(user, jwtPayload, query.fields),
            ),
            custom_field: query.fields?.custom_field ?? [...embeddedCustomFieldResourceFields],
        },
    };

    const { items, links, total } = await findPage(Session, requestUri, {
        where,
        page: query.page,
        countMatches: true,
        createCursor: (session) => encodeCursor({ id: session.id }),
        populate: visible.include.filter(isPopulateSessionInclude),
        orderBy: {
            id: "desc",
        },
    });

    const isManager = userProvidesRole(jwtPayload, user, "manager");

    await populateSessionRelations({
        sessions: items,
        query: visible,
        sessionIncludePath: "",
        seesEveryResponse: isManager,
        callerUser: user,
    });

    const hostedSessionIds = new Set(
        (
            await em.find(
                Session,
                { id: { $in: items.map((session) => session.id) }, hosts: { user } },
                { fields: ["id"] },
            )
        ).map((session) => session.id),
    );

    return serialize("session", items, {
        ...visible,
        links,
        meta: { total },
        context: { session: { actor: { isManager, hostsSessions: hostedSessionIds } } },
    });
});

export const showSessionHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, user, jwtPayload, edition) => {
    const session = await em.findOne(
        Session,
        { edition, id: sessionId },
        { populate: ["hosts", "track", "sessionType"] },
    );
    assertExists(session, "Session", sessionId);

    // Judged after the load rather than folded into it, so this answers the
    // same way every sub-route of the same session does. Scoping the lookup
    // would say "not found" to a speaker who is merely not on it, and would
    // hide nothing: the sub-routes sit behind the same layer and tell a caller
    // which of the two it was.
    if (!(hasGlobalReadAccess(jwtPayload, user) || hostsSession(session, user))) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You are not involved with this session",
        });
    }

    const isManager = userProvidesRole(jwtPayload, user, "manager");

    return serializeSessionDocument(session, user, jwtPayload, isManager);
});

export const addOpenapiSessionReadPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/sessions", {
        get: {
            tags: ["Sessions"],
            summary: "List sessions",
            description:
                "Lists the edition's sessions, newest first, with cursor pagination. Open to " +
                "any member of a team, whatever their role, and to superadmins; a speaker " +
                "reads their own sessions through /me/sessions and the session's own route. " +
                "Requested fields the caller may not see are dropped; a `fields[host]` " +
                "naming only such fields yields host resources without an attributes member. " +
                "`filter[state]` takes a comma separated list and matches any of them; " +
                "`filter[track]` and `filter[sessionType]` each take one id; `filter[search]` " +
                "matches part of a title, ignoring case, and is capped at 200 characters. " +
                "`meta.total` counts everything this " +
                "caller's filters matched, not the page. Cursors are keyed on the id this list is ordered by, so a cursor whose row was since deleted still resolves to the right place. A row created mid-walk sorts above the first page and a forward walk never sees it. `meta.total` is recounted per request, so it may differ between one page and the next. The links replay the request's filters, `first` is null on the first page, and there is no `last`. " +
                "Each session carries `meta.hostTransitions` and " +
                "`meta.managerTransitions`, the states this caller may move it to in each " +
                "role from where it stands, and `meta.hosting`, whether they host it. A " +
                "caller who hosts a session on the page is offered their host moves here as " +
                "well as on the speaker's routes.",
            operationId: "listSessions",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(listQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: sessionWithTransitionsResourceSchema,
                    included: [
                        schedulingHostResourceSchema,
                        hostAvailabilityResourceSchema,
                        responseResourceSchema,
                        embeddedCustomFieldResourceSchema,
                        sessionTypeResourceSchema,
                        trackResourceSchema,
                    ],
                    links: paginationLinkSchemaObjects,
                    meta: sessionListDocumentMetaSchemaObject,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/sessions/{sessionId}", {
        get: {
            tags: ["Sessions"],
            summary: "Retrieve a session",
            description:
                "Retrieves a session with its hosts, track, session type and responses. Open to any " +
                "authenticated user; those without global read access may read only sessions " +
                "they host, and are refused with 403 otherwise. Responses to " +
                "confidential custom fields are filtered by caller, and a withheld one is " +
                "absent from linkage too.",
            operationId: "showSession",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: sessionWithTransitionsResourceSchema,
                    included: [
                        restrictedHostResourceSchema,
                        sessionTypeResourceSchema,
                        trackResourceSchema,
                        responseResourceSchema,
                    ],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
            },
        },
    });
};
