import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { SessionHostInvite } from "../../../src/entity/SessionHostInvite.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Team } from "../../../src/entity/Team.js";
import { TeamInvite } from "../../../src/entity/TeamInvite.js";
import { User } from "../../../src/entity/User.js";
import { inviteTimeToLive } from "../../../src/support/invites.js";
import { em } from "../../../src/util/mikro-orm.js";
import { InviteSweeper } from "../../../src/worker/maintenance/invite-sweeper.js";
import { buildEdition, buildSession } from "../../setup/fixtures.js";

describe("invite sweeper", () => {
    let freshTeamInviteId: string;
    let expiredTeamInviteId: string;
    let freshHostInviteId: string;
    let expiredHostInviteId: string;

    beforeEach(async () => {
        const fork = em.fork();
        const team = new Team({ name: "Sweep Team", role: "viewer" });
        const edition = buildEdition({ name: "Sweep Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Sweep Session" });
        const inviter = new User({
            externalId: "sweep-inviter",
            displayName: "Sweep Inviter",
            emailAddress: "sweep-inviter@example.test",
        });

        const freshTeamInvite = new TeamInvite({
            emailAddress: "fresh-team@example.test",
            team: ref(team),
        });
        const expiredTeamInvite = new TeamInvite({
            emailAddress: "expired-team@example.test",
            team: ref(team),
        });
        const freshHostInvite = new SessionHostInvite({
            emailAddress: "fresh-host@example.test",
            session: ref(session),
            createdBy: ref(inviter),
        });
        const expiredHostInvite = new SessionHostInvite({
            emailAddress: "expired-host@example.test",
            session: ref(session),
            createdBy: ref(inviter),
        });

        await fork
            .persist([
                team,
                edition,
                sessionType,
                session,
                inviter,
                freshTeamInvite,
                expiredTeamInvite,
                freshHostInvite,
                expiredHostInvite,
            ])
            .flush();

        const expiredCreatedAt = Temporal.Now.instant()
            .subtract(inviteTimeToLive)
            .subtract({ hours: 1 });
        await fork.nativeUpdate(
            TeamInvite,
            { id: expiredTeamInvite.id },
            {
                createdAt: expiredCreatedAt,
            },
        );
        await fork.nativeUpdate(
            SessionHostInvite,
            { id: expiredHostInvite.id },
            {
                createdAt: expiredCreatedAt,
            },
        );

        freshTeamInviteId = freshTeamInvite.id;
        expiredTeamInviteId = expiredTeamInvite.id;
        freshHostInviteId = freshHostInvite.id;
        expiredHostInviteId = expiredHostInvite.id;
    });

    it("deletes expired invites and keeps fresh ones", async () => {
        await new InviteSweeper().runOnce();

        const fork = em.fork();
        assert.equal(await fork.count(TeamInvite, { id: expiredTeamInviteId }), 0);
        assert.equal(await fork.count(SessionHostInvite, { id: expiredHostInviteId }), 0);
        assert.equal(await fork.count(TeamInvite, { id: freshTeamInviteId }), 1);
        assert.equal(await fork.count(SessionHostInvite, { id: freshHostInviteId }), 1);
    });
});
