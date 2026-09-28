import { readFileSync } from "node:fs";
import { buildDataResponseObject, buildResourceSchemaObject } from "@jsonapi-serde/openapi";
import { htmlResponse, type JsonSerializable, jsonResponse } from "@taxum/core/http";
import { m, type Router } from "@taxum/core/routing";
import { OpenApiBuilder } from "openapi3-ts/oas31";
import { addOpenapiClockPaths } from "./clock.js";
import { addOpenapiCustomFieldPaths } from "./editions/custom-fields.js";
import { addOpenapiHostPaths } from "./editions/hosts.js";
import { addOpenapiEditionPaths } from "./editions/index.js";
import { addOpenapiLocationPaths } from "./editions/locations.js";
import { addOpenapiMeHostPaths, addOpenapiMeSessionPaths } from "./editions/me/index.js";
import { addOpenapiResponseFilePaths } from "./editions/response-files.js";
import { addOpenapiSchedulePaths } from "./editions/schedules/index.js";
import { addOpenapiSessionHostInvitePaths } from "./editions/session-host-invites.js";
import { addOpenapiSessionTransitionPaths } from "./editions/session-transitions.js";
import { addOpenapiSessionTypePaths } from "./editions/session-types.js";
import { addOpenapiSessionPaths } from "./editions/sessions/index.js";
import { addOpenapiTrackPaths } from "./editions/tracks.js";
import { addOpenapiSessionHostInviteAcceptancePaths } from "./invites/session-host.js";
import { addOpenapiTeamInviteAcceptancePaths } from "./invites/team.js";
import { addOpenapiJobPaths } from "./jobs.js";
import { addOpenapiSignedPostPaths } from "./signed-posts.js";
import { addOpenapiTeamPaths } from "./teams.js";
import { addOpenapiCurrentUserPaths } from "./user.js";
import { addOpenapiUserPurgePaths } from "./user-purges.js";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const timezoneResourceSchema = buildResourceSchemaObject({
    type: "timezone",
    id: { type: "string", description: "IANA time zone identifier" },
});

// The /timezones handler lives inline in route/index.ts; its paths are built
// here to keep the aggregator free of a cycle with that module.
const addOpenapiTimezonePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/timezones", {
        get: {
            tags: ["Timezones"],
            operationId: "listTimezones",
            summary: "List time zones",
            description:
                "Lists every IANA time zone identifier the server accepts for edition time" +
                " zones. Open to any authenticated subject.",
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: timezoneResourceSchema,
                }),
            },
        },
    });
};

export const buildOpenapiSpecJson = (): string => {
    const builder = OpenApiBuilder.create({
        openapi: "3.1.0",
        info: {
            title: "Eventail API",
            description:
                "Conference CFP and scheduling API. All endpoints require a bearer JWT issued" +
                " by the configured identity provider.\n\nBeyond the responses documented per" +
                " operation, any endpoint may return 400 for a malformed query string, 401 for" +
                " a missing or invalid token, 406 or 415 when content negotiation fails, and" +
                " 500 on server errors. Error bodies follow the JSON:API error format." +
                "\n\nRefused writes divide by status, so a client can branch before reading" +
                " the error code. 403 means another caller could do this now and you cannot:" +
                " the role or the relationship to the resource is what is missing. 409 means" +
                " nobody could do it now, because the stored state conflicts with the request." +
                " 422 means the submitted document is wrong on its own terms, including where" +
                " it disagrees with how the edition is configured.",
            version,
        },
    });

    builder.addSecurityScheme("bearerAuth", {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
    });
    builder.rootDoc.security = [{ bearerAuth: [] }];

    addOpenapiEditionPaths(builder);
    addOpenapiLocationPaths(builder);
    addOpenapiTrackPaths(builder);
    addOpenapiSessionTypePaths(builder);
    addOpenapiCustomFieldPaths(builder);
    addOpenapiResponseFilePaths(builder);
    addOpenapiHostPaths(builder);
    addOpenapiSessionPaths(builder);
    addOpenapiSessionTransitionPaths(builder);
    addOpenapiSessionHostInvitePaths(builder);
    addOpenapiSessionHostInviteAcceptancePaths(builder);
    addOpenapiSchedulePaths(builder);
    addOpenapiMeHostPaths(builder);
    addOpenapiMeSessionPaths(builder);
    addOpenapiCurrentUserPaths(builder);
    addOpenapiTeamPaths(builder);
    addOpenapiTeamInviteAcceptancePaths(builder);
    addOpenapiUserPurgePaths(builder);
    addOpenapiJobPaths(builder);
    addOpenapiSignedPostPaths(builder);
    addOpenapiTimezonePaths(builder);
    addOpenapiClockPaths(builder);

    return builder.getSpecAsJson();
};

const scalarHtml = `<!doctype html>
<html>
  <head>
    <title>Eventail API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
    <script>
      Scalar.createApiReference("#app", { url: "/openapi.json" });
    </script>
  </body>
</html>
`;

let cachedSpec: JsonSerializable | undefined;

/**
 * Serves the spec and its reference UI.
 *
 * Development only; production consumers get the spec from the docs site.
 */
export const registerOpenapiRoutes = (router: Router): void => {
    router
        .route(
            "/openapi.json",
            m.get(() => {
                cachedSpec ??= JSON.parse(buildOpenapiSpecJson()) as JsonSerializable;

                return jsonResponse(cachedSpec);
            }),
        )
        .route(
            "/openapi",
            m.get(() => htmlResponse(scalarHtml)),
        );
};
