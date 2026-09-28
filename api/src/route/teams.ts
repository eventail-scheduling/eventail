import { jsonApiRelationships, jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildRelationshipsRequestContentObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import { pathParam, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { Team, teamRoles } from "../entity/Team.js";
import { TeamInvite } from "../entity/TeamInvite.js";
import { serialize } from "../json-api/index.js";
import { teamResourceSchema } from "../json-api/team.js";
import { teamInviteResourceSchema } from "../json-api/team-invite.js";
import { userResourceFields, userResourceSchema } from "../json-api/user.js";
import { clearExistingInvite } from "../support/invites.js";
import { pinTeam } from "../support/locking.js";
import { queueMail, teamInviteAcceptUrl } from "../support/mail.js";
import { RequireAuthorizationLayer } from "../util/auth.js";
import { translateUniqueViolations, type UniqueViolation } from "../util/constraint-violation.js";
import { assertExists, patchObject } from "../util/helpers.js";
import { em } from "../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../util/openapi.js";
import { emailAddressSchema, nameSchema } from "../util/zod.js";

const listTeamsHandler = async () => {
    const teams = await em.findAll(Team, {
        orderBy: { name: "asc", id: "asc" },
        populate: ["users", "invites"],
    });

    return serialize("team", teams);
};

const showTeamHandler = createExtractHandler(pathParam(z.uuid())).handler(async (teamId) => {
    const team = await em.findOne(Team, { id: teamId }, { populate: ["users", "invites"] });
    assertExists(team, "Team", teamId);

    return serialize("team", team, {
        include: ["users", "invites"],
        fields: { user: [...userResourceFields] },
    });
});

const attributesSchema = z.strictObject({
    name: nameSchema,
    role: z.enum(teamRoles),
});

const createTeamResourceOptions = {
    type: "team",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;
const createTeamContentObject = buildResourceRequestContentObject(createTeamResourceOptions);

const createTeamHandler = createExtractHandler(jsonApiResource(createTeamResourceOptions)).handler(
    async ({ attributes }) => {
        const team = new Team(attributes);
        await em.persist(team).flush();

        return [StatusCode.CREATED, serialize("team", team)];
    },
);

const updateTeamResourceOptions = {
    type: "team",
    idSchema: z.uuid(),
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;
const updateTeamContentObject = buildResourceRequestContentObject(updateTeamResourceOptions);

const updateTeamHandler = createExtractHandler(
    pathParam(z.uuid()),
    jsonApiResource(updateTeamResourceOptions, "teamId"),
).handler(async (teamId, { attributes }) => {
    const team = await em.transactional(async (em) => {
        const locked = await em.findOne(
            Team,
            { id: teamId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(locked, "Team", teamId);
        const team = await em.populate(locked, ["users", "invites"]);

        patchObject(team, attributes);
        em.persist(team);
        return team;
    });

    return serialize("team", team);
});

const deleteTeamHandler = createExtractHandler(pathParam(z.uuid())).handler(async (teamId) => {
    await em.transactional(async (em) => {
        const team = await em.findOne(
            Team,
            { id: teamId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(team, "Team", teamId);
        em.remove(team);
    });

    return StatusCode.NO_CONTENT;
});

const removeUsersHandler = createExtractHandler(
    pathParam(z.uuid()),
    jsonApiRelationships("user", z.uuid()),
).handler(async (teamId, userIds) => {
    await em.transactional(async (em) => {
        const team = await em.findOne(
            Team,
            { id: teamId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(team, "Team", teamId);
        await team.users.load();

        team.users.remove((user) => userIds.includes(user.id));
        em.persist(team);
    });

    return StatusCode.NO_CONTENT;
});

const inviteAttributesSchema = z.object({
    emailAddress: emailAddressSchema,
});

const createInviteResourceOptions = {
    type: "team_invite",
    attributesSchema: inviteAttributesSchema,
} satisfies AnyParseResourceRequestOptions;
const createInviteContentObject = buildResourceRequestContentObject(createInviteResourceOptions);

/**
 * The 409 `clearExistingInvite` answers, for the pair that never saw each other.
 *
 * Two requests for one address both hold the team in a shared mode, so both
 * find no live invite and both insert.
 */
const inviteUniqueViolations: Record<string, UniqueViolation> = {
    team_invite_team_id_email_address_unique: {
        code: "invite_exists",
        title: "Invite exists",
        detail: "This address already has a pending invite for this team",
        pointer: "/data/attributes/emailAddress",
    },
};

const createInviteHandler = createExtractHandler(
    pathParam(z.uuid()),
    jsonApiResource(createInviteResourceOptions),
).handler(async (teamId, { attributes }) => {
    const team = await em.findOne(Team, { id: teamId });
    assertExists(team, "Team", teamId);

    const invite = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                await pinTeam(em, team);

                const existingInvite = await em.findOne(TeamInvite, {
                    team,
                    emailAddress: attributes.emailAddress,
                });
                await clearExistingInvite(em, existingInvite, "team");

                const invite = new TeamInvite({
                    ...attributes,
                    team: ref(team),
                });
                em.persist(invite);

                await queueMail(em, {
                    template: "team-invite",
                    recipient: invite.emailAddress,
                    variables: {
                        teamName: team.name,
                        acceptUrl: teamInviteAcceptUrl(invite.code),
                    },
                });

                return invite;
            }),
        inviteUniqueViolations,
    );

    return [StatusCode.CREATED, serialize("team_invite", invite)];
});

const deleteInviteHandler = createExtractHandler(
    pathParams(z.object({ teamId: z.uuid(), inviteId: z.uuid() })),
).handler(async ({ teamId, inviteId }) => {
    await em.transactional(async (em) => {
        const invite = await em.findOne(
            TeamInvite,
            { id: inviteId, team: teamId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(invite, "Team invite", inviteId);
        em.remove(invite);
    });

    return StatusCode.NO_CONTENT;
});

export const teamsRouter = new Router()
    .route("/", m.get(listTeamsHandler).post(createTeamHandler))
    .route("/:teamId", m.get(showTeamHandler).patch(updateTeamHandler).delete(deleteTeamHandler))
    .route("/:teamId/relationships/users", m.delete(removeUsersHandler))
    .route("/:teamId/invites", m.post(createInviteHandler))
    .route("/:teamId/invites/:inviteId", m.delete(deleteInviteHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "admin" } }));

const userRelationshipsContentObject = buildRelationshipsRequestContentObject("user", z.uuid());

export const addOpenapiTeamPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/teams", {
        get: {
            tags: ["Teams"],
            summary: "List teams",
            description: "Lists all teams, ordered by name. Requires the admin role.",
            operationId: "listTeams",
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: teamResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
            },
        },
        post: {
            tags: ["Teams"],
            summary: "Create a team",
            description: "Creates a team with the given name and role. Requires the admin role.",
            operationId: "createTeam",
            requestBody: {
                required: true,
                content: createTeamContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: teamResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });

    builder.addPath("/teams/{teamId}", {
        get: {
            tags: ["Teams"],
            summary: "Show a team",
            description:
                "Retrieves a single team together with its members and pending invites. Requires the admin role.",
            operationId: "showTeam",
            parameters: [createUuidPathParameter("teamId")],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: teamResourceSchema,
                    included: [userResourceSchema, teamInviteResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Team not found" }),
            },
        },
        patch: {
            tags: ["Teams"],
            summary: "Update a team",
            description: "Updates the name and role of a team. Requires the admin role.",
            operationId: "updateTeam",
            parameters: [createUuidPathParameter("teamId")],
            requestBody: {
                required: true,
                content: updateTeamContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: teamResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Team not found" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
        delete: {
            tags: ["Teams"],
            summary: "Delete a team",
            description:
                "Deletes a team along with its memberships and pending invites. Requires the admin role.",
            operationId: "deleteTeam",
            parameters: [createUuidPathParameter("teamId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Team not found" }),
            },
        },
    });

    builder.addPath("/teams/{teamId}/relationships/users", {
        delete: {
            tags: ["Teams"],
            summary: "Remove team members",
            description:
                "Removes users from a team. Ids that are not members are silently ignored. Requires the admin role.",
            operationId: "removeTeamUsers",
            parameters: [createUuidPathParameter("teamId")],
            requestBody: {
                required: true,
                content: userRelationshipsContentObject,
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Team not found" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });

    builder.addPath("/teams/{teamId}/invites", {
        post: {
            tags: ["Teams"],
            summary: "Invite a team member",
            description:
                "Invites an email address to a team and sends the invite mail. An expired invite for the same address is replaced, a pending one blocks the request. Requires the admin role.",
            operationId: "inviteTeamMember",
            parameters: [createUuidPathParameter("teamId")],
            requestBody: {
                required: true,
                content: createInviteContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: teamInviteResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Team not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Address already has a pending invite for this team (invite_exists)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });

    builder.addPath("/teams/{teamId}/invites/{inviteId}", {
        delete: {
            tags: ["Teams"],
            summary: "Revoke a team invite",
            description: "Revokes a pending team invite. Requires the admin role.",
            operationId: "revokeTeamInvite",
            parameters: [createUuidPathParameter("teamId"), createUuidPathParameter("inviteId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description: "Invite not found for this team",
                }),
            },
        },
    });
};
