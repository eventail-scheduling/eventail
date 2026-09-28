import { jsonApiQuery } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
} from "@jsonapi-serde/openapi";
import { type AnyParseQueryOptions, createQueryParser } from "@jsonapi-serde/server/request";
import type { FilterQuery } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { createExtractHandler, m, ORIGINAL_URI, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../../entity/Edition.js";
import { Host } from "../../entity/Host.js";
import { Session } from "../../entity/Session.js";
import {
    countedHostResourceSchema,
    hostListDocumentMetaSchemaObject,
    hostResourceFields,
    restrictedHostResourceSchema,
    withVisibleHostFields,
} from "../../json-api/host.js";
import { hostAvailabilityResourceSchema } from "../../json-api/host-availability.js";
import { serialize } from "../../json-api/index.js";
import { responseResourceSchema } from "../../json-api/response.js";
import { visibleResponseFilter } from "../../support/responses.js";
import { loadResponsesInto } from "../../support/sessions.js";
import {
    JWT_PAYLOAD,
    RequireAuthorizationLayer,
    requiredUser,
    userProvidesRole,
} from "../../util/auth.js";
import { assertExists, escapeLikePattern } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter } from "../../util/openapi.js";
import { encodeCursor, findPage } from "../../util/pagination.js";
import { createPageSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const listCursorSchema = z.object({
    displayName: z.string(),
    id: z.uuid(),
});

const listFilterSchema = z
    .strictObject({
        search: z.string().trim().min(1).max(200).optional(),
    })
    .optional();

const listQueryOptions = {
    fields: {
        allowed: {
            host: hostResourceFields,
        },
    },
    page: createPageSchema(listCursorSchema),
    filter: listFilterSchema,
} as const satisfies AnyParseQueryOptions;

const parseListQuery = createQueryParser(listQueryOptions);

/**
 * Counts each host's sessions in one query rather than per row.
 *
 * `Session.hosts` owns the join and a host does not collect its sessions, so
 * the walk goes the only direction the mapping offers. Every state counts: an
 * organizer chasing people wants a withdrawn submission to say the person
 * showed up once, not that they were never here.
 */
const countSessionsPerHost = async (
    edition: Edition,
    hostIds: string[],
): Promise<ReadonlyMap<string, number>> => {
    const counts = new Map<string, number>();

    if (hostIds.length === 0) {
        return counts;
    }

    // A host belongs to one edition and the write paths are edition scoped, so
    // the edition here is redundant against the data as it stands. It is named
    // anyway rather than resting on that: this reads the join table, which
    // carries no edition of its own.
    const sessions = await em.find(
        Session,
        { edition, hosts: { id: { $in: hostIds } } },
        { populate: ["hosts"] },
    );

    for (const session of sessions) {
        for (const hostId of session.hosts.getIdentifiers()) {
            if (hostIds.includes(hostId)) {
                counts.set(hostId, (counts.get(hostId) ?? 0) + 1);
            }
        }
    }

    return counts;
};

export const listHostsHandler = createExtractHandler(
    jsonApiQuery(parseListQuery),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
    extension(ORIGINAL_URI, true),
).handler(async (query, user, jwtPayload, edition, requestUri) => {
    const where: FilterQuery<Host> = { edition };
    const isManager = userProvidesRole(jwtPayload, user, "manager");

    if (query.filter?.search) {
        const pattern = `%${escapeLikePattern(query.filter.search)}%`;

        // Searchable by exactly whoever is served it. Matching the address for
        // everyone would hand a viewer an oracle for addresses it may not read,
        // one query at a time, which is worse than the column being hidden.
        if (isManager) {
            where.$or = [
                { displayName: { $ilike: pattern } },
                { emailAddress: { $ilike: pattern } },
            ];
        } else {
            where.displayName = { $ilike: pattern };
        }
    }

    const { items, links, total } = await findPage(Host, requestUri, {
        where,
        page: query.page,
        countMatches: true,
        createCursor: (host) => encodeCursor({ displayName: host.displayName, id: host.id }),
        orderBy: { displayName: "asc", id: "asc" },
    });

    const sessionCounts = await countSessionsPerHost(
        edition,
        items.map((host) => host.id),
    );

    return serialize("host", items, {
        fields: withVisibleHostFields(user, jwtPayload, query.fields),
        links,
        meta: { total },
        context: { host: { sessionCounts } },
    });
});

const showQueryOptions = {
    fields: {
        allowed: {
            host: hostResourceFields,
        },
    },
    include: {
        // No `responses.customField`: `loadResponsesInto` is called without it
        // here, so offering the path would name one nothing loads.
        allowed: ["responses", "availabilities"],
        default: ["responses"],
    },
} as const satisfies AnyParseQueryOptions;

const parseShowQuery = createQueryParser(showQueryOptions);

export const showHostHandler = createExtractHandler(
    pathParams(z.object({ hostId: z.uuid() })),
    jsonApiQuery(parseShowQuery),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ hostId }, query, user, jwtPayload, edition) => {
    const host = await em.findOne(Host, { edition, id: hostId });
    assertExists(host, "Host", hostId);

    // The field set decides first: `withVisibleHostFields` drops availabilities
    // for anyone below manager, so an include naming them is dropped here too
    // rather than erroring, the way the session list treats the same path.
    const fields = withVisibleHostFields(user, jwtPayload, query.fields);
    const include = query.include.filter(
        (path) => path !== "availabilities" || (fields.host ?? []).includes("availabilities"),
    );

    if (include.includes("availabilities")) {
        await em.populate(host, ["availabilities"]);
    }

    const responseFilter = visibleResponseFilter({
        seesEveryResponse: userProvidesRole(jwtPayload, user, "manager"),
        callerUser: user,
    });

    await loadResponsesInto([host], "host", responseFilter, false);

    return serialize("host", host, { include, fields });
});

export const hostsRouter = new Router()
    .route(
        "/",
        m.get(listHostsHandler).layer(new RequireAuthorizationLayer({ user: { role: "viewer" } })),
    )
    .route(
        "/:hostId",
        m.get(showHostHandler).layer(new RequireAuthorizationLayer({ user: { role: "viewer" } })),
    );

export const addOpenapiHostPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/hosts", {
        get: {
            tags: ["Hosts"],
            summary: "List hosts",
            description:
                "Lists everyone with a host record in the edition, by display name, with cursor" +
                " pagination. A record exists from the moment someone opens their profile for" +
                " the edition, submits a session or accepts an invite, so the list includes" +
                " people who have submitted nothing;" +
                " `meta.sessionCount` on each is what tells them apart. Requires a team role." +
                " `filter[search]` matches the display name or, for a caller who may read it," +
                " the email address. `meta.total` counts what the filter matched across every" +
                " page rather than the one served.",
            operationId: "listHosts",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(listQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: countedHostResourceSchema,
                    meta: hostListDocumentMetaSchemaObject,
                }),
                400: buildErrorResponseObject({ description: "Invalid query parameter" }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/hosts/{hostId}", {
        get: {
            tags: ["Hosts"],
            summary: "Show a host",
            description:
                "Retrieves a single host of an edition, with the answers that host gave to " +
                "per-host custom fields. Requires global read access; a user without it reads " +
                "nothing here, even for a session they host. An integration reads hosts through " +
                "the current schedule document instead. The answers differ by caller: managers " +
                "and admins " +
                "see every answer, a team member reading their own host record also sees " +
                "their own confidential answers, and everyone else sees only the " +
                "non-confidential ones. The email address is limited to managers and admins, " +
                "and so is `include=availabilities`, which is dropped rather than refused for " +
                "anyone else.",
            operationId: "showHost",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("hostId"),
                ...buildQueryParameters(showQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: restrictedHostResourceSchema,
                    included: [responseResourceSchema, hostAvailabilityResourceSchema],
                }),
                400: buildErrorResponseObject({ description: "Invalid query parameter" }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or host not found" }),
            },
        },
    });
};
