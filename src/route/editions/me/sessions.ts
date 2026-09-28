import { buildDataResponseObject, buildErrorResponseObject } from "@jsonapi-serde/openapi";
import { extension } from "@taxum/core/extract";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { Session } from "../../../entity/Session.js";
import { serialize } from "../../../json-api/index.js";
import { sessionWithTransitionsResourceSchema } from "../../../json-api/session.js";
import { sessionTypeResourceSchema } from "../../../json-api/session-type.js";
import { trackResourceSchema } from "../../../json-api/track.js";
import { populateSessionRelations } from "../../../support/sessions.js";
import {
    JWT_PAYLOAD,
    RequireAuthorizationLayer,
    requiredUser,
    userProvidesRole,
} from "../../../util/auth.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter } from "../../../util/openapi.js";
import { EDITION } from "../resolve-edition-layer.js";

/**
 * Lists every session the caller hosts, deliberately unpaginated.
 *
 * It is one person's sessions, not the edition's program.
 */
const listMeSessionsHandler = createExtractHandler(
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async (user, jwtPayload, edition) => {
    const isManager = userProvidesRole(jwtPayload, user, "manager");
    const query = { include: ["sessionType", "track"] };
    const sessions = await em.find(
        Session,
        { edition, hosts: { user } },
        { populate: ["sessionType", "track"], orderBy: { id: "desc" } },
    );

    await populateSessionRelations({
        sessions,
        query,
        sessionIncludePath: "",
        seesEveryResponse: isManager,
        callerUser: user,
    });

    return serialize("session", sessions, {
        ...query,
        context: {
            session: {
                actor: {
                    isManager,
                    hostsSessions: new Set(sessions.map((session) => session.id)),
                },
            },
        },
    });
});

export const meSessionsRouter = new Router()
    .route("/", m.get(listMeSessionsHandler))
    .layer(new RequireAuthorizationLayer({ user: true }));

export const addOpenapiMeSessionPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/me/sessions", {
        get: {
            tags: ["Me"],
            summary: "List my sessions",
            description:
                "Lists the sessions of an edition that the calling user hosts, whatever their " +
                "state. Unpaginated, unlike the edition's session list. Requires an " +
                "authenticated user.",
            operationId: "listMeSessions",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: sessionWithTransitionsResourceSchema,
                    included: [sessionTypeResourceSchema, trackResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
    });
};
