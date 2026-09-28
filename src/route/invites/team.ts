import { buildDataResponseObject, buildErrorResponseObject } from "@jsonapi-serde/openapi";
import { LockMode } from "@mikro-orm/postgresql";
import { pathParam } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { Team } from "../../entity/Team.js";
import { TeamInvite } from "../../entity/TeamInvite.js";
import { serialize } from "../../json-api/index.js";
import { teamInvitePreviewResourceSchema } from "../../json-api/team-invite-preview.js";
import { requireAcceptableInvite } from "../../support/invites.js";
import { RequireAuthorizationLayer, requiredUser } from "../../util/auth.js";
import { em } from "../../util/mikro-orm.js";
import { noContentResponseObject } from "../../util/openapi.js";

const showInvitePreviewHandler = createExtractHandler(pathParam(z.uuid()), requiredUser).handler(
    async (code, user) => {
        const invite = requireAcceptableInvite(
            await em.findOne(TeamInvite, { code }, { populate: ["team"] }),
            user,
        );

        return serialize("team_invite_preview", invite);
    },
);

const acceptInviteHandler = createExtractHandler(pathParam(z.uuid()), requiredUser).handler(
    async (code, user) => {
        await em.transactional(async (em) => {
            // The team leads its invites, and the only way to the team is through
            // the invite, so an unlocked read finds it first; see
            // support/locking.ts.
            const preview = await em.findOne(TeamInvite, { code });

            if (preview) {
                await em.findOneOrFail(Team, preview.team.id, {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                });
            }

            const invite = requireAcceptableInvite(
                await em.findOne(TeamInvite, { code }, { lockMode: LockMode.PESSIMISTIC_WRITE }),
                user,
            );

            const team = await invite.team.loadOrFail({ lockMode: LockMode.PESSIMISTIC_WRITE });
            team.users.add(user);
            em.persist(team);
            em.remove(invite);
        });

        return StatusCode.NO_CONTENT;
    },
);

export const teamInvitesRouter = new Router()
    .route("/:code", m.get(showInvitePreviewHandler))
    .route("/:code/acceptance", m.post(acceptInviteHandler))
    .layer(new RequireAuthorizationLayer({ user: true }));

const codePathParameter = {
    name: "code",
    in: "path" as const,
    required: true,
    schema: { type: "string" as const, format: "uuid" },
    description: "The invite code from the invite email",
};

export const addOpenapiTeamInviteAcceptancePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/team-invites/{code}", {
        get: {
            tags: ["Teams"],
            summary: "Preview a team invite",
            description:
                "Describes what an invite code grants, so the acceptance page can name the team " +
                "before the user accepts. Requires an authenticated user whose email address " +
                "matches the invite.",
            operationId: "previewTeamInvite",
            parameters: [codePathParameter],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: teamInvitePreviewResourceSchema,
                }),
                403: buildErrorResponseObject({
                    description: "Forbidden (invalid_code, invite_expired, invite_email_mismatch)",
                }),
            },
        },
    });

    builder.addPath("/team-invites/{code}/acceptance", {
        post: {
            tags: ["Teams"],
            summary: "Accept a team invite",
            description:
                "Accepts an invite by its code and adds the calling user to the team. Requires " +
                "an authenticated user whose email address matches the invite.",
            operationId: "acceptTeamInvite",
            parameters: [codePathParameter],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({
                    description: "Forbidden (invalid_code, invite_expired, invite_email_mismatch)",
                }),
            },
        },
    });
};
