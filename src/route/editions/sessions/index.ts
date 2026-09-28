import {
    buildErrorResponseObject,
    buildRelationshipsRequestContentObject,
} from "@jsonapi-serde/openapi";
import { m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { RequireAuthorizationLayer } from "../../../util/auth.js";
import { createUuidPathParameter, noContentResponseObject } from "../../../util/openapi.js";
import {
    createHostInviteHandler,
    deleteHostInviteHandler,
    listHostInvitesHandler,
    removeHostsHandler,
} from "../session-host-invites.js";
import { createTransitionHandler, listTransitionsHandler } from "../session-transitions.js";
import { addOpenapiSessionReadPaths, listSessionsHandler, showSessionHandler } from "./read.js";
import {
    addOpenapiSessionWritePaths,
    createSessionHandler,
    deleteSessionHandler,
    updateSessionHandler,
} from "./write.js";

const requireUserLayer = new RequireAuthorizationLayer({ user: true });

// `providesRole` grants "viewer" to every team role, so this admits any member
// and no one else. The list serves the whole edition, so it is for the
// organizing side; a speaker reads their own sessions through /me/sessions and
// the session's own route.
const requireTeamLayer = new RequireAuthorizationLayer({ user: { role: "viewer" } });

const requireManagerLayer = new RequireAuthorizationLayer({ user: { role: "manager" } });

export const sessionsRouter = new Router()
    .route("/:sessionId", m.delete(deleteSessionHandler).layer(requireManagerLayer))
    .route("/", m.get(listSessionsHandler).layer(requireTeamLayer))
    .route("/:sessionId", m.get(showSessionHandler).layer(requireUserLayer))
    .route("/", m.post(createSessionHandler).layer(requireUserLayer))
    .route("/:sessionId", m.patch(updateSessionHandler).layer(requireUserLayer))
    .route(
        "/:sessionId/transitions",
        m.post(createTransitionHandler).get(listTransitionsHandler).layer(requireUserLayer),
    )
    .route(
        "/:sessionId/host-invites",
        m.post(createHostInviteHandler).get(listHostInvitesHandler).layer(requireUserLayer),
    )
    .route(
        "/:sessionId/host-invites/:inviteId",
        m.delete(deleteHostInviteHandler).layer(requireUserLayer),
    )
    .route(
        "/:sessionId/relationships/hosts",
        m.delete(removeHostsHandler).layer(requireManagerLayer),
    );

export const addOpenapiSessionPaths = (builder: OpenApiBuilder): void => {
    addOpenapiSessionReadPaths(builder);
    addOpenapiSessionWritePaths(builder);

    builder.addPath("/editions/{editionId}/sessions/{sessionId}/relationships/hosts", {
        delete: {
            tags: ["Sessions"],
            summary: "Remove session hosts",
            description:
                "Removes the given hosts from the session. Requires the manager role: a " +
                "host adds a co-host by invite and detaches nobody, so a session cannot be " +
                "left without hosts by anyone but an organizer.",
            operationId: "removeSessionHosts",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            requestBody: {
                required: true,
                content: buildRelationshipsRequestContentObject("host", z.uuid()),
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({
                    description: "Forbidden",
                }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
