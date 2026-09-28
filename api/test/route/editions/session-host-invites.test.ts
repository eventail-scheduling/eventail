import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Host } from "../../../src/entity/Host.js";
import { Session, type SessionState } from "../../../src/entity/Session.js";
import { SessionHostInvite } from "../../../src/entity/SessionHostInvite.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { bumpEditionRevision } from "../../../src/support/edition-revision.js";
import { inviteTimeToLive } from "../../../src/support/invites.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildSuperAdmin,
    buildTeamMember,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait, waitForLockWaiters } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("session-host-invites", () => {
    let hostToken: string;
    let inviteeToken: string;
    let managerToken: string;
    let strangerToken: string;
    let editionId: string;
    let sessionId: string;
    let frozenSessionId: string;
    let inviteeUserId: string;

    before(async () => {
        [hostToken, inviteeToken, managerToken, strangerToken] = await Promise.all([
            fetchAccessToken("testhost"),
            fetchAccessToken("testuser"),
            fetchAccessToken("admin"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const invitee = new User({
            externalId: "testuser",
            displayName: "Test Invitee",
            emailAddress: "invitee@example.test",
        });
        // The superadmin token passes the manager checks without a team, but
        // the routes still resolve it to a user row.
        const manager = buildSuperAdmin({
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
        });
        // Without a user row the authorization layer would 403 before the
        // handler's involvement check runs.
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });
        const edition = buildEdition({
            name: "Cohost Edition",
            startDate: Temporal.PlainDate.from("2027-11-01"),
            endDate: Temporal.PlainDate.from("2027-11-03"),
        });
        const sessionType = SessionType.default(ref(edition));
        const hostRecord = buildHost(edition, host);
        const session = buildSession(edition, sessionType, { title: "Cohosted Session" });
        session.hosts.add(hostRecord);

        const frozenSession = buildSession(edition, sessionType, { title: "Frozen Session" });
        frozenSession.hosts.add(hostRecord);

        await fork
            .persist([
                host,
                invitee,
                manager,
                stranger,
                edition,
                sessionType,
                session,
                frozenSession,
            ])
            .flush();

        editionId = edition.id;
        sessionId = session.id;
        frozenSessionId = frozenSession.id;
        inviteeUserId = invitee.id;
    });

    const createInvite = (token: string, targetSessionId: string, emailAddress: string) =>
        jsonApi.post(`/editions/${editionId}/sessions/${targetSessionId}/host-invites`, token, {
            data: {
                type: "session_host_invite",
                attributes: { emailAddress },
            },
        });

    const acceptInvite = (token: string, code: string) =>
        jsonApi.post(`/session-host-invites/${code}/acceptance`, token);

    const showInvitation = (token: string, code: string) =>
        jsonApi.get(`/session-host-invites/${code}`, token);

    const setSessionState = async (targetSessionId: string, state: SessionState): Promise<void> => {
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, targetSessionId);
        session.state = state;
        await fork.flush();
    };

    const requireBiography = async (): Promise<void> => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        edition.profileFieldOptions = {
            ...edition.profileFieldOptions,
            biography: { requirement: "required" },
        };
        await fork.flush();
    };

    const inviteAndAccept = async (): Promise<TestResponse> => {
        const createResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "invitee@example.test",
        });

        return acceptInvite(inviteeToken, invite.code);
    };

    describe("revocation and the send quota", () => {
        const inviteFor = async (
            token: string,
            emailAddress: string,
        ): Promise<SessionHostInvite> => {
            assert.equal((await createInvite(token, sessionId, emailAddress)).status, 201);

            return em.fork().findOneOrFail(SessionHostInvite, {
                session: sessionId,
                emailAddress,
                revokedAt: null,
            });
        };

        const revoke = async (invite: SessionHostInvite): Promise<void> => {
            const response = await jsonApi.delete(
                `/editions/${editionId}/sessions/${sessionId}/host-invites/${invite.id}`,
                hostToken,
            );
            assert.equal(response.status, 204);
        };

        // A revoked invite keeps its row and its code, so the quota can count
        // it; only this guard stops the code from still working.
        it("refuses a revoked code on preview and on acceptance", async () => {
            const invite = await inviteFor(hostToken, "invitee@example.test");
            await revoke(invite);

            await expectJsonApiError(
                await showInvitation(inviteeToken, invite.code),
                403,
                "invalid_code",
            );
            await expectJsonApiError(
                await acceptInvite(inviteeToken, invite.code),
                403,
                "invalid_code",
            );
        });

        it("takes a new invite to an address whose invite was revoked", async () => {
            await revoke(await inviteFor(hostToken, "invitee@example.test"));

            assert.equal(
                (await createInvite(hostToken, sessionId, "invitee@example.test")).status,
                201,
            );
        });

        it("refuses a host's eleventh invite within the hour", async () => {
            for (let index = 0; index < 10; index += 1) {
                await inviteFor(hostToken, `cohost-${index.toString()}@example.test`);
            }

            await expectJsonApiError(
                await createInvite(hostToken, sessionId, "cohost-10@example.test"),
                429,
                "invite_quota_reached",
            );
        });

        it("counts revoked invites toward the quota", async () => {
            for (let index = 0; index < 10; index += 1) {
                await revoke(await inviteFor(hostToken, "invitee@example.test"));
            }

            await expectJsonApiError(
                await createInvite(hostToken, sessionId, "invitee@example.test"),
                429,
                "invite_quota_reached",
            );
        });

        it("leaves a manager's invites out of the quota", async () => {
            const { user, team } = buildTeamMember("speaker", "manager");
            await em.fork().persist([user, team]).flush();
            const teamManagerToken = await fetchAccessToken("speaker");

            for (let index = 0; index < 11; index += 1) {
                await inviteFor(teamManagerToken, `cohost-${index.toString()}@example.test`);
            }
        });
    });

    it("runs the invite, accept, and removal flow", async () => {
        const createResponse = await jsonApi.post(
            `/editions/${editionId}/sessions/${sessionId}/host-invites`,
            hostToken,
            {
                data: {
                    type: "session_host_invite",
                    attributes: { emailAddress: "invitee@example.test" },
                },
            },
        );
        assert.equal(createResponse.status, 201);

        // The code is deliberately never serialized; it only travels by mail.
        const invite = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });

        const acceptResponse = await acceptInvite(inviteeToken, invite.code);
        assert.equal(acceptResponse.status, 204);

        const session = await em.fork().findOneOrFail(Session, sessionId, {
            populate: ["hosts"],
        });
        assert.equal(session.hosts.length, 2);

        const inviteeHost = session.hosts.getItems().find((host) => host.user.id === inviteeUserId);
        assert.ok(inviteeHost);

        // Neither host may detach anyone, themselves included: adding is theirs
        // through an invite, and taking away is the organizer's.
        const selfRemoval = await jsonApi.delete(
            `/editions/${editionId}/sessions/${sessionId}/relationships/hosts`,
            inviteeToken,
            { data: [{ type: "host", id: inviteeHost.id }] },
        );
        await expectJsonApiError(selfRemoval, 403, "forbidden");

        const hostRemovingCoHost = await jsonApi.delete(
            `/editions/${editionId}/sessions/${sessionId}/relationships/hosts`,
            hostToken,
            { data: [{ type: "host", id: inviteeHost.id }] },
        );
        await expectJsonApiError(hostRemovingCoHost, 403, "forbidden");

        const removal = await jsonApi.delete(
            `/editions/${editionId}/sessions/${sessionId}/relationships/hosts`,
            managerToken,
            { data: [{ type: "host", id: inviteeHost.id }] },
        );
        assert.equal(removal.status, 204);

        const afterRemoval = await em.fork().findOneOrFail(Session, sessionId, {
            populate: ["hosts"],
        });
        assert.equal(afterRemoval.hosts.length, 1);
    });

    // Both tests below hold a session row lock while the accept request is
    // provably blocked on it. If the handler ever read the state without a
    // locking, refreshing query, a transition committing during the wait
    // would be invisible: the bump lost in one direction, a host admitted to
    // a dead session in the other.
    it("bumps for a session confirmed while the accept waits on its lock", async () => {
        await createInvite(hostToken, sessionId, "invitee@example.test");
        const invite = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });

        const held = Promise.withResolvers<void>();
        const confirming = em.fork().transactional(async (em) => {
            const session = await em.findOneOrFail(Session, sessionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            session.state = "confirmed";
            em.persist(session);
            await bumpEditionRevision(em, await em.findOneOrFail(Edition, editionId));
            await held.promise;
        });

        const accepting = send(acceptInvite(inviteeToken, invite.code));

        try {
            await waitForLockWaiters(em.fork());
        } finally {
            held.resolve();
        }

        await confirming;

        const response = await accepting;
        assert.equal(response.status, 204);

        // One bump from the confirmation, one from the accept: the accept saw
        // the confirmed state even though it was committed mid-wait.
        const counter = await em.fork().findOneOrFail(EditionRevision, { editionId });
        assert.equal(counter.revision, 2);
    });

    it("refuses acceptance for a session canceled while the accept waits on its lock", async () => {
        await createInvite(hostToken, sessionId, "invitee@example.test");
        const invite = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });

        const held = Promise.withResolvers<void>();
        const canceling = em.fork().transactional(async (em) => {
            const session = await em.findOneOrFail(Session, sessionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            session.state = "canceled";
            em.persist(session);
            await em.flush();
            await held.promise;
        });

        const accepting = send(acceptInvite(inviteeToken, invite.code));

        try {
            await waitForLockWaiters(em.fork());
        } finally {
            held.resolve();
        }

        await canceling;

        await expectJsonApiError(await accepting, 409, "session_not_acceptable");

        const session = await em.fork().findOneOrFail(Session, sessionId, {
            populate: ["hosts"],
        });
        assert.equal(session.hosts.length, 1);
    });

    it("rejects acceptance with a wrong code", async () => {
        const response = await acceptInvite(inviteeToken, randomUUID());

        await expectJsonApiError(response, 403, "invalid_code");
    });

    it("describes the invite before the invitee accepts", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });
        const response = await showInvitation(inviteeToken, invite.code);
        assert.equal(response.status, 200);

        const body = (await response.json()) as {
            data: {
                type: string;
                id: string;
                attributes: Record<string, string>;
                relationships: Record<string, { data: { type: string; id: string } }>;
            };
            included: { type: string; id: string; attributes: Record<string, unknown> }[];
        };
        assert.equal(body.data.type, "session_host_invite_preview");
        assert.equal(body.data.id, invite.code);
        assert.equal(body.data.attributes.emailAddress, "invitee@example.test");
        assert.ok(body.data.attributes.expiresAt);
        assert.equal(body.data.relationships.session.data.id, sessionId);
        assert.equal(body.data.relationships.edition.data.id, editionId);

        // Whole-object rather than per-key, because an invite code is not read
        // access: the session and edition serializers here are the ones the rest
        // of the API uses, and an attribute added to either would otherwise
        // reach someone who may not see the session at all.
        assert.deepEqual(
            body.included.find((resource) => resource.type === "session")?.attributes,
            { title: "Cohosted Session" },
        );
        assert.deepEqual(
            body.included.find((resource) => resource.type === "edition")?.attributes,
            { name: "Cohost Edition" },
        );
    });

    it("rejects an unknown code before the invitee commits", async () => {
        const response = await showInvitation(inviteeToken, randomUUID());

        await expectJsonApiError(response, 403, "invalid_code");
    });

    it("rejects an expired invite before the invitee commits", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(createResponse.status, 201);

        const fork = em.fork();
        const invite = await fork.findOneOrFail(SessionHostInvite, { session: sessionId });
        await fork.nativeUpdate(
            SessionHostInvite,
            { id: invite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const response = await showInvitation(inviteeToken, invite.code);

        await expectJsonApiError(response, 403, "invite_expired");
    });

    it("tells a mismatched account nothing about the invite", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });
        const response = await showInvitation(strangerToken, invite.code);

        await expectJsonApiError(response, 403, "invite_email_mismatch");

        const body = await response.text();
        assert.ok(!body.includes("Cohosted Session"), "leaked the session title");
        assert.ok(!body.includes("Cohost Edition"), "leaked the edition name");
        assert.ok(!body.includes("invitee@example.test"), "leaked the invited address");
    });

    it("rejects a second invite for the same address", async () => {
        const firstResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(firstResponse.status, 201);

        const secondResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        await expectJsonApiError(secondResponse, 409, "invite_exists");
    });

    it("replaces an expired invite on re-invite", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "again@example.test");
        assert.equal(createResponse.status, 201);

        const fork = em.fork();
        const staleInvite = await fork.findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "again@example.test",
        });
        await fork.nativeUpdate(
            SessionHostInvite,
            { id: staleInvite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const replacementResponse = await createInvite(hostToken, sessionId, "again@example.test");
        assert.equal(replacementResponse.status, 201);
        assert.equal(await em.fork().count(SessionHostInvite, { id: staleInvite.id }), 0);
        assert.equal(
            await em.fork().count(SessionHostInvite, {
                session: sessionId,
                emailAddress: "again@example.test",
            }),
            1,
        );
    });

    // The user purge locks the invites to an address, and those its users sent,
    // before the users. Clearing an expired invite after taking the sender's
    // user row for the quota would run the other way, and a host re-inviting
    // an address while theirs was purged would deadlock.
    it("clears an expired invite before it takes the sender's user row", async () => {
        const host = await em
            .fork()
            .findOneOrFail(Host, { edition: editionId, user: { externalId: "testhost" } });
        assert.equal((await createInvite(hostToken, sessionId, "again@example.test")).status, 201);
        const staleInvite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "again@example.test",
        });
        await em.fork().nativeUpdate(
            SessionHostInvite,
            { id: staleInvite.id },
            {
                createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }),
            },
        );
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let userLockFree = false;
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(SessionHostInvite, staleInvite.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const inviting = send(createInvite(hostToken, sessionId, "again@example.test"));
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    await em.fork().transactional(async (em) => {
                        const rows = await em
                            .getConnection()
                            .execute<unknown[]>(
                                'select 1 from "user" where "id" = ? for update skip locked',
                                [host.user.id],
                                "all",
                                em.getTransactionContext(),
                            );
                        userLockFree = rows.length === 1;
                    });
                },
            },
        );

        await holding;
        const response = await inviting;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 201);
        assert.ok(userLockFree, "the invite held the sender's user row while it waited");
    });

    it("keeps the invite code out of every response", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "secret@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "secret@example.test",
        });
        const createdBody = JSON.stringify(await createResponse.json());
        assert.equal(createdBody.includes(invite.code), false);

        const listResponse = await jsonApi.get(
            `/editions/${editionId}/sessions/${sessionId}/host-invites`,
            hostToken,
        );
        assert.equal(listResponse.status, 200);
        const listedBody = JSON.stringify(await listResponse.json());
        assert.equal(listedBody.includes(invite.code), false);
        assert.equal(listedBody.includes("secret@example.test"), true);
    });

    it("rejects acceptance of an expired invite", async () => {
        const createResponse = await createInvite(hostToken, sessionId, "invitee@example.test");
        assert.equal(createResponse.status, 201);

        const fork = em.fork();
        const invite = await fork.findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "invitee@example.test",
        });
        await fork.nativeUpdate(
            SessionHostInvite,
            { id: invite.id },
            { createdAt: Temporal.Now.instant().subtract(inviteTimeToLive).subtract({ hours: 1 }) },
        );

        const response = await acceptInvite(inviteeToken, invite.code);

        await expectJsonApiError(response, 403, "invite_expired");
    });

    it("rejects acceptance by another email address", async () => {
        const createResponse = await createInvite(
            hostToken,
            sessionId,
            "someone-else@example.test",
        );
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "someone-else@example.test",
        });
        const response = await acceptInvite(inviteeToken, invite.code);

        await expectJsonApiError(response, 403, "invite_email_mismatch");
    });

    it("blocks host invites while the session is frozen", async () => {
        await setSessionState(frozenSessionId, "rejected");

        const hostResponse = await createInvite(hostToken, frozenSessionId, "cohost@example.test");
        await expectJsonApiError(hostResponse, 403, "session_frozen");

        const managerResponse = await createInvite(
            managerToken,
            frozenSessionId,
            "cohost@example.test",
        );
        assert.equal(managerResponse.status, 201);
    });

    it("lets a host revoke an invite while the session is frozen", async () => {
        await setSessionState(frozenSessionId, "rejected");
        const createResponse = await createInvite(
            managerToken,
            frozenSessionId,
            "cohost@example.test",
        );
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: frozenSessionId,
            emailAddress: "cohost@example.test",
        });

        const response = await jsonApi.delete(
            `/editions/${editionId}/sessions/${frozenSessionId}/host-invites/${invite.id}`,
            hostToken,
        );

        assert.equal(response.status, 204);
        // The row stays so the send quota can count it; what revoking ends is
        // the invite's ability to be accepted.
        assert.equal(
            await em.fork().count(SessionHostInvite, { id: invite.id, revokedAt: null }),
            0,
        );
    });

    it("revokes an invite against a writer holding its session", async () => {
        const createResponse = await createInvite(managerToken, sessionId, "cohost@example.test");
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: sessionId,
            emailAddress: "cohost@example.test",
        });

        // The order every session writer takes: the session, then the invites
        // hanging off it. Reaching the invite first closes a cycle against it.
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Session, sessionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            taken.resolve();
            await held.promise;
            await em.findOneOrFail(SessionHostInvite, invite.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
        });

        await taken.promise;

        const revoke = send(
            jsonApi.delete(
                `/editions/${editionId}/sessions/${sessionId}/host-invites/${invite.id}`,
                managerToken,
            ),
        );

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;
        const response = await revoke;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
    });

    it("turns away an invitee who has not given the edition what it asks", async () => {
        await requireBiography();

        await expectJsonApiError(await inviteAndAccept(), 422, "incomplete_profile");

        // The code they were sent is the only way back in, so a refusal has to
        // leave it unspent and the half-built host record with it.
        const fork = em.fork();
        assert.ok(await fork.findOne(SessionHostInvite, { session: sessionId }));
        assert.equal(await fork.count(Host, { user: inviteeUserId }), 0);
    });

    it("lets an invitee in once they have given the edition what it asks", async () => {
        await requireBiography();

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const invitee = await fork.findOneOrFail(User, inviteeUserId);
        fork.persist(buildHost(edition, invitee, { biography: "Speaks about things" }));
        await fork.flush();

        assert.equal((await inviteAndAccept()).status, 204);
    });

    it("refuses acceptance for a session that takes no new hosts", async () => {
        await setSessionState(frozenSessionId, "rejected");
        const createResponse = await createInvite(
            managerToken,
            frozenSessionId,
            "invitee@example.test",
        );
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: frozenSessionId,
            emailAddress: "invitee@example.test",
        });
        const response = await acceptInvite(inviteeToken, invite.code);

        await expectJsonApiError(response, 409, "session_not_acceptable");
    });

    it("refuses to preview an invite to a session that takes no new hosts", async () => {
        await setSessionState(frozenSessionId, "rejected");
        const createResponse = await createInvite(
            managerToken,
            frozenSessionId,
            "invitee@example.test",
        );
        assert.equal(createResponse.status, 201);

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: frozenSessionId,
            emailAddress: "invitee@example.test",
        });
        const response = await showInvitation(inviteeToken, invite.code);

        await expectJsonApiError(response, 409, "session_not_acceptable");
    });

    it("accepts a pending manager invite on a confirmed session", async () => {
        await setSessionState(frozenSessionId, "rejected");
        const pendingResponse = await createInvite(
            managerToken,
            frozenSessionId,
            "invitee@example.test",
        );
        assert.equal(pendingResponse.status, 201);

        await setSessionState(frozenSessionId, "confirmed");

        const hostResponse = await createInvite(hostToken, frozenSessionId, "late@example.test");
        await expectJsonApiError(hostResponse, 403, "session_frozen");

        const invite = await em.fork().findOneOrFail(SessionHostInvite, {
            session: frozenSessionId,
            emailAddress: "invitee@example.test",
        });
        const response = await acceptInvite(inviteeToken, invite.code);
        assert.equal(response.status, 204);

        const session = await em.fork().findOneOrFail(Session, frozenSessionId, {
            populate: ["hosts"],
        });
        assert.equal(session.hosts.length, 2);
    });

    it("refuses invites from a user not involved with the session", async () => {
        const response = await createInvite(strangerToken, sessionId, "outsider@example.test");

        await expectJsonApiError(response, 403, "forbidden");
        assert.equal(
            await em.fork().count(SessionHostInvite, { emailAddress: "outsider@example.test" }),
            0,
        );
    });

    it("sends an invite while its sender's profile save is in flight", async () => {
        const host = await em
            .fork()
            .findOneOrFail(Host, { edition: editionId, user: { externalId: "testhost" } });
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const saving = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, host.user.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
            await em.nativeUpdate(Host, { id: host.id }, { biography: "Edited" });
        });

        await taken.promise;

        const inviting = send(createInvite(hostToken, sessionId, "cohost@example.test"));
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await saving;
        const response = await inviting;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 201);
    });
});
