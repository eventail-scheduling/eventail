import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode } from "@mikro-orm/core";
import { Job } from "../../src/entity/Job.js";
import { Team } from "../../src/entity/Team.js";
import { TeamInvite } from "../../src/entity/TeamInvite.js";
import { User } from "../../src/entity/User.js";
import { inviteTimeToLive } from "../../src/support/invites.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildSuperAdmin } from "../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../setup/json-api.js";
import { releaseAfterLockWait } from "../setup/locks.js";
import { fetchAccessToken } from "../setup/token.js";

type TeamDocument = {
    data: {
        id: string;
        type: string;
        attributes: { name: string; role: string };
        relationships: {
            users: { data: { id: string }[] };
            invites: { data: { id: string }[] };
        };
    };
};

describe("teams", () => {
    let adminToken: string;
    let inviteeToken: string;
    let teamId: string;
    let inviteeId: string;

    before(async () => {
        [adminToken, inviteeToken] = await Promise.all([
            fetchAccessToken("admin"),
            fetchAccessToken("testhost"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const admin = buildSuperAdmin({
            displayName: "Team Admin",
            emailAddress: "admin@example.test",
        });
        const invitee = new User({
            externalId: "testhost",
            displayName: "Team Invitee",
            emailAddress: "invitee@example.test",
        });
        const team = new Team({ name: "Standing Crew", role: "manager" });

        await fork.persist([admin, invitee, team]).flush();

        teamId = team.id;
        inviteeId = invitee.id;
    });

    const showTeam = (id: string) => jsonApi.get(`/teams/${id}`, adminToken);

    const createInvite = (emailAddress: string) =>
        jsonApi.post(`/teams/${teamId}/invites`, adminToken, {
            data: {
                type: "team_invite",
                attributes: { emailAddress },
            },
        });

    const acceptInvite = (code: string) =>
        jsonApi.post(`/team-invites/${code}/acceptance`, inviteeToken);

    const showInvitation = (token: string, code: string) =>
        jsonApi.get(`/team-invites/${code}`, token);

    it("creates, reads, updates, and deletes a team", async () => {
        const createResponse = await jsonApi.post("/teams", adminToken, {
            data: {
                type: "team",
                attributes: { name: "Reviewers", role: "viewer" },
            },
        });

        assert.equal(createResponse.status, 201);
        const createdDocument = (await createResponse.json()) as TeamDocument;
        assert.equal(createdDocument.data.type, "team");
        assert.equal(createdDocument.data.attributes.name, "Reviewers");
        assert.equal(createdDocument.data.attributes.role, "viewer");

        const createdTeamId = createdDocument.data.id;

        const listResponse = await jsonApi.get("/teams", adminToken);

        assert.equal(listResponse.status, 200);
        const listDocument = (await listResponse.json()) as { data: { id: string }[] };
        assert.ok(listDocument.data.some((resource) => resource.id === createdTeamId));

        const updateResponse = await jsonApi.patch(`/teams/${createdTeamId}`, adminToken, {
            data: {
                type: "team",
                id: createdTeamId,
                attributes: { name: "Senior Reviewers", role: "manager" },
            },
        });

        assert.equal(updateResponse.status, 200);
        const updatedDocument = (await updateResponse.json()) as TeamDocument;
        assert.equal(updatedDocument.data.attributes.name, "Senior Reviewers");
        assert.equal(updatedDocument.data.attributes.role, "manager");

        const deleteResponse = await jsonApi.delete(`/teams/${createdTeamId}`, adminToken);

        assert.equal(deleteResponse.status, 204);
        assert.equal(await em.fork().count(Team, { id: createdTeamId }), 0);

        const afterDelete = await showTeam(createdTeamId);
        assert.equal(afterDelete.status, 404);
    });

    // Absent linkage would claim the team has neither members nor invites,
    // which a list that did not load them cannot claim.
    it("carries member and invite linkage in a list", async () => {
        assert.equal((await createInvite("linkage@example.test")).status, 201);

        const response = await jsonApi.get("/teams", adminToken);
        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { relationships?: { users?: unknown; invites?: unknown } }[];
        };

        assert.ok(document.data.length > 0);
        assert.ok(document.data.every((team) => team.relationships?.users !== undefined));
        assert.ok(document.data.every((team) => team.relationships?.invites !== undefined));
    });

    it("removes a team member", async () => {
        const createResponse = await createInvite("invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "invitee@example.test",
        });
        assert.equal((await acceptInvite(invite.code)).status, 204);

        const afterAccept = (await (await showTeam(teamId)).json()) as TeamDocument;
        assert.deepEqual(
            afterAccept.data.relationships.users.data.map((identifier) => identifier.id),
            [inviteeId],
        );

        const removeResponse = await jsonApi.delete(
            `/teams/${teamId}/relationships/users`,
            adminToken,
            { data: [{ type: "user", id: inviteeId }] },
        );
        assert.equal(removeResponse.status, 204);

        const afterRemove = (await (await showTeam(teamId)).json()) as TeamDocument;
        assert.deepEqual(afterRemove.data.relationships.users.data, []);
    });

    it("invites a user and adds them on acceptance", async () => {
        const createResponse = await createInvite("invitee@example.test");

        assert.equal(createResponse.status, 201);
        const createdDocument = (await createResponse.json()) as {
            data: { type: string; attributes: { emailAddress: string } };
        };
        assert.equal(createdDocument.data.type, "team_invite");
        assert.equal(createdDocument.data.attributes.emailAddress, "invitee@example.test");

        const inviteMails = await em
            .fork()
            .find(Job, { state: "available" })
            .then((jobs) =>
                jobs.filter(
                    (job) =>
                        job.payload.type === "send_email" && job.payload.template === "team-invite",
                ),
            );
        assert.equal(inviteMails.length, 1);
        assert.equal(
            inviteMails[0].payload.type === "send_email" && inviteMails[0].payload.recipient,
            "invitee@example.test",
        );

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "invitee@example.test",
        });

        const acceptResponse = await acceptInvite(invite.code);

        assert.equal(acceptResponse.status, 204);
        assert.equal(await em.fork().count(TeamInvite, { id: invite.id }), 0);

        const team = await em.fork().findOneOrFail(Team, teamId, { populate: ["users"] });
        assert.deepEqual(
            team.users.map((user) => user.id),
            [inviteeId],
        );
    });

    it("keeps the invite code out of every response", async () => {
        const createResponse = await createInvite("secret@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "secret@example.test",
        });
        const createdBody = JSON.stringify(await createResponse.json());
        assert.equal(createdBody.includes(invite.code), false);

        const showResponse = await showTeam(teamId);
        assert.equal(showResponse.status, 200);
        const shownBody = JSON.stringify(await showResponse.json());
        assert.equal(shownBody.includes(invite.code), false);
        assert.equal(shownBody.includes("secret@example.test"), true);

        const deleteResponse = await jsonApi.delete(
            `/teams/${teamId}/invites/${invite.id}`,
            adminToken,
        );

        assert.equal(deleteResponse.status, 204);
        assert.equal(await em.fork().count(TeamInvite, { id: invite.id }), 0);
    });

    it("rejects a duplicate invite but replaces an expired one", async () => {
        const firstResponse = await createInvite("repeat@example.test");
        assert.equal(firstResponse.status, 201);

        const duplicateResponse = await createInvite("repeat@example.test");
        await expectJsonApiError(duplicateResponse, 409, "invite_exists");

        const fork = em.fork();
        const staleInvite = await fork.findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "repeat@example.test",
        });
        await fork.nativeUpdate(
            TeamInvite,
            { id: staleInvite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const replacementResponse = await createInvite("repeat@example.test");
        assert.equal(replacementResponse.status, 201);
        assert.equal(await em.fork().count(TeamInvite, { id: staleInvite.id }), 0);
        assert.equal(
            await em
                .fork()
                .count(TeamInvite, { team: teamId, emailAddress: "repeat@example.test" }),
            1,
        );
    });

    it("accepts an invite against a writer holding its team", async () => {
        const createResponse = await createInvite("invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, { team: teamId });

        // The order a team delete takes: the team, then the invites its
        // cascade reaches. Acceptance reaching the invite first closes a
        // cycle against it.
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Team, teamId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
            await em.findOneOrFail(TeamInvite, invite.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
        });

        await taken.promise;

        const acceptance = send(acceptInvite(invite.code));

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;
        const response = await acceptance;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
    });

    it("rejects acceptance with a wrong code", async () => {
        const response = await acceptInvite(randomUUID());

        await expectJsonApiError(response, 403, "invalid_code");
    });

    it("rejects acceptance of an expired invite", async () => {
        const createResponse = await createInvite("invitee@example.test");
        assert.equal(createResponse.status, 201);

        const fork = em.fork();
        const invite = await fork.findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "invitee@example.test",
        });
        await fork.nativeUpdate(
            TeamInvite,
            { id: invite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const response = await acceptInvite(invite.code);

        await expectJsonApiError(response, 403, "invite_expired");
        assert.equal(await em.fork().count(TeamInvite, { id: invite.id }), 1);
    });

    it("rejects acceptance by another email address", async () => {
        const createResponse = await createInvite("someone-else@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "someone-else@example.test",
        });

        const response = await acceptInvite(invite.code);

        await expectJsonApiError(response, 403, "invite_email_mismatch");
        assert.equal(await em.fork().count(TeamInvite, { id: invite.id }), 1);
    });

    it("names the team before the invitee accepts", async () => {
        const createResponse = await createInvite("invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "invitee@example.test",
        });
        const response = await showInvitation(inviteeToken, invite.code);
        assert.equal(response.status, 200);

        const body = (await response.json()) as {
            data: { type: string; id: string; attributes: Record<string, string> };
        };
        assert.equal(body.data.type, "team_invite_preview");
        assert.equal(body.data.id, invite.code);
        assert.equal(body.data.attributes.emailAddress, "invitee@example.test");
        assert.ok(body.data.attributes.teamName);
        assert.ok(body.data.attributes.expiresAt);
    });

    it("rejects an unknown code before the invitee commits", async () => {
        const response = await showInvitation(inviteeToken, randomUUID());

        await expectJsonApiError(response, 403, "invalid_code");
    });

    it("rejects an expired invite before the invitee commits", async () => {
        const createResponse = await createInvite("invitee@example.test");
        assert.equal(createResponse.status, 201);

        const fork = em.fork();
        const invite = await fork.findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "invitee@example.test",
        });
        await fork.nativeUpdate(
            TeamInvite,
            { id: invite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const response = await showInvitation(inviteeToken, invite.code);

        await expectJsonApiError(response, 403, "invite_expired");
    });

    it("tells a mismatched account nothing about the invite", async () => {
        const createResponse = await createInvite("someone-else@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(TeamInvite, {
            team: teamId,
            emailAddress: "someone-else@example.test",
        });
        const response = await showInvitation(inviteeToken, invite.code);

        await expectJsonApiError(response, 403, "invite_email_mismatch");

        const body = await response.text();
        assert.ok(!body.includes("someone-else@example.test"), "leaked the invited address");
    });
});
