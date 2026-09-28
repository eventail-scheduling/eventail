import type { Collection, FilterQuery } from "@mikro-orm/core";
import { Response } from "../entity/Response.js";
import type { Session } from "../entity/Session.js";
import type { User } from "../entity/User.js";
import { loadRelation, type RelationQuery, relationLoadMode } from "../json-api/query.js";
import { em } from "../util/mikro-orm.js";
import { visibleResponseFilter } from "./responses.js";

type ResponseHolder = {
    id: string;
    responses: Collection<Response>;
};

/**
 * Loads responses with a find, because `em.populate` cannot carry the filter.
 *
 * MikroORM copies one branch of the `$or` into the populate join, where it
 * applies to every row, so a response matching only another branch never comes
 * back.
 */
export const loadResponsesInto = async (
    owners: ResponseHolder[],
    ownerKind: "session" | "host",
    filter: FilterQuery<Response>,
    withCustomField: boolean,
): Promise<void> => {
    if (owners.length === 0) {
        return;
    }

    const responses = await em.find(
        Response,
        { $and: [{ [ownerKind]: { $in: owners.map((owner) => owner.id) } }, filter] },
        withCustomField ? { populate: ["customField"] } : {},
    );
    const grouped = Map.groupBy(responses, (response) => response[ownerKind]?.id);

    for (const owner of owners) {
        owner.responses.hydrate(grouped.get(owner.id) ?? []);
    }
};

type SessionRelationsOptions = {
    sessions: Session[];
    query: RelationQuery;
    sessionIncludePath: string;
    seesEveryResponse: boolean;
    callerUser: User | null;
};

export const populateSessionRelations = async (options: SessionRelationsOptions): Promise<void> => {
    const { sessions, query, sessionIncludePath, seesEveryResponse, callerUser } = options;
    const includePath = (name: string): string =>
        sessionIncludePath === "" ? name : `${sessionIncludePath}.${name}`;
    const hostsLoadMode = relationLoadMode(query, "session", "hosts", includePath("hosts"));

    await loadRelation(hostsLoadMode, {
        full: () => em.populate(sessions, ["hosts"]),
        linkage: () => em.populate(sessions, ["hosts"], { fields: ["*", "hosts.id"] }),
    });

    const responseFilter = visibleResponseFilter({ seesEveryResponse, callerUser });

    await loadRelation(relationLoadMode(query, "session", "responses", includePath("responses")), {
        full: () => loadResponsesInto(sessions, "session", responseFilter, true),
        linkage: () => loadResponsesInto(sessions, "session", responseFilter, false),
    });

    if (hostsLoadMode !== "full") {
        return;
    }

    const hosts = sessions.flatMap((session) => session.hosts.getItems());

    await loadRelation(
        relationLoadMode(query, "host", "responses", includePath("hosts.responses")),
        {
            full: () => loadResponsesInto(hosts, "host", responseFilter, true),
            linkage: () => loadResponsesInto(hosts, "host", responseFilter, false),
        },
    );

    // Loaded only when asked for by name, rather than through `loadRelation`,
    // which would also load on "linkage". This document is not the only one
    // built here: the schedule document shares this function and never allows
    // the path, so a linkage load would run on every schedule read and put a
    // relationship member on a host that the schedule's own schema does not
    // declare. A count of someone's free windows is also more than nothing.
    const availabilityMode = relationLoadMode(
        query,
        "host",
        "availabilities",
        includePath("hosts.availabilities"),
    );

    if (availabilityMode === "full") {
        await em.populate(hosts, ["availabilities"], {
            orderBy: { availabilities: { startsAt: "asc" } },
        });
    }
};
