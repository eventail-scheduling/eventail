import type { Loaded } from "@mikro-orm/core";
import type { Session } from "../../../entity/Session.js";
import type { User } from "../../../entity/User.js";
import { withVisibleHostFields } from "../../../json-api/host.js";
import { serialize } from "../../../json-api/index.js";
import { withVisibleSessionFields } from "../../../json-api/session.js";
import { hostsSession } from "../../../support/hosts.js";
import { visibleResponseFilter } from "../../../support/responses.js";
import { loadResponsesInto } from "../../../support/sessions.js";
import type { JwtPayload } from "../../../util/auth.js";
import { em } from "../../../util/mikro-orm.js";

/**
 * Loads the rest of a session and serializes what this caller may see of it.
 *
 * Every route answering with one session goes through here, because which
 * answers a reader is served follows their role and whether they host it, and
 * a route that loaded and serialized on its own would be a second place for
 * that rule to be wrong.
 */
export const serializeSessionDocument = async (
    session: Loaded<Session, "hosts">,
    user: Loaded<User, "teams">,
    jwtPayload: JwtPayload,
    isManager: boolean,
) => {
    const responseFilter = visibleResponseFilter({
        seesEveryResponse: isManager,
        callerUser: user,
    });

    await em.populate(session, ["track", "sessionType"]);
    await loadResponsesInto([session], "session", responseFilter, false);
    await loadResponsesInto(session.hosts.getItems(), "host", responseFilter, false);

    return serialize("session", session, {
        include: ["hosts", "hosts.responses", "track", "sessionType", "responses"],
        fields: withVisibleSessionFields(user, withVisibleHostFields(user, jwtPayload)),
        context: {
            session: {
                actor: {
                    isManager,
                    hostsSessions: hostsSession(session, user) ? new Set([session.id]) : new Set(),
                },
            },
        },
    });
};
