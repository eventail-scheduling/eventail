import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { Edition } from "../../src/entity/Edition.js";
import { Host } from "../../src/entity/Host.js";
import { Job } from "../../src/entity/Job.js";
import { Session } from "../../src/entity/Session.js";
import { SessionHostInvite } from "../../src/entity/SessionHostInvite.js";
import { SessionTransition } from "../../src/entity/SessionTransition.js";
import { SessionType } from "../../src/entity/SessionType.js";
import { Team } from "../../src/entity/Team.js";
import { TeamInvite } from "../../src/entity/TeamInvite.js";
import { User } from "../../src/entity/User.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildSuperAdmin } from "../setup/fixtures.js";
import { jsonApi, send } from "../setup/json-api.js";
import { releaseAfterLockWait } from "../setup/locks.js";
import { fetchAccessToken } from "../setup/token.js";

const SUBJECT = "purge-me@example.test";
const BYSTANDER = "someone-else@example.test";

describe("user-purges", () => {
    let adminToken: string;
    let confirmedSessionId: string;
    let draftSessionId: string;
    let teamId: string;

    before(async () => {
        adminToken = await fetchAccessToken("admin");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const admin = buildSuperAdmin({
            displayName: "Purge Admin",
            emailAddress: "admin@example.test",
        });
        const edition = buildEdition({ name: "Purge Edition" });
        const sessionType = new SessionType({
            name: "Talk",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ hours: 1 }),
            internal: false,
            selectionDefault: true,
            edition: ref(edition),
        });
        const session = buildSession(edition, sessionType, { title: "Purge Session" });
        session.state = "confirmed";
        const draftSession = buildSession(edition, sessionType, { title: "Purge Draft Session" });
        const team = new Team({ name: "Purge Team", role: "viewer" });

        await fork.persist([admin, edition, sessionType, session, draftSession, team]).flush();

        confirmedSessionId = session.id;
        draftSessionId = draftSession.id;
        teamId = team.id;
    });

    const purge = (emailAddress: string, dryRun: boolean) =>
        jsonApi.post("/user-purges", adminToken, {
            data: {
                type: "user_purge",
                attributes: { emailAddress },
                meta: { dryRun },
            },
        });

    beforeEach(async () => {
        const fork = em.fork();
        const subject = new User({
            externalId: "purge-subject",
            displayName: "Purge Subject",
            emailAddress: SUBJECT,
        });
        const bystander = new User({
            externalId: "purge-bystander",
            displayName: "Purge Bystander",
            emailAddress: BYSTANDER,
        });
        const session = await fork.findOneOrFail(Session, confirmedSessionId, {
            populate: ["hosts"],
        });
        const draftSession = await fork.findOneOrFail(Session, draftSessionId, {
            populate: ["hosts"],
        });
        const team = await fork.findOneOrFail(Team, teamId, { populate: ["users"] });
        const edition = await session.edition.loadOrFail();

        const subjectHost = buildHost(edition, subject);
        session.hosts.add(subjectHost);
        draftSession.hosts.add(subjectHost);
        team.users.add(subject);

        fork.persist([
            draftSession,
            subject,
            session,
            team,
            new TeamInvite({ emailAddress: SUBJECT, team: ref(team) }),
            new SessionHostInvite({
                emailAddress: SUBJECT,
                session: ref(session),
                createdBy: ref(subject),
            }),
            new SessionTransition({
                session: ref(session),
                actor: ref(subject),
                fromState: "submitted",
                toState: "accepted",
                note: null,
            }),
            new Job({
                payload: {
                    type: "send_email",
                    recipient: SUBJECT,
                    subject: "Pending",
                    template: "team-invite",
                    variables: {},
                },
            }),
            // Every row the purge scopes by address gets a twin belonging to
            // someone else, so an invite or mail delete that lost its scoping
            // fails rather than passing on rows that were all the subject's.
            bystander,
            new TeamInvite({ emailAddress: BYSTANDER, team: ref(team) }),
            new SessionHostInvite({
                emailAddress: BYSTANDER,
                session: ref(session),
                createdBy: ref(bystander),
            }),
            new Job({
                payload: {
                    type: "send_email",
                    recipient: BYSTANDER,
                    subject: "Pending for someone else",
                    template: "team-invite",
                    variables: {},
                },
            }),
        ]);
        await fork.flush();
    });

    it("holds what a purged user made and sent before it locks the user", async () => {
        const fork = em.fork();
        const subject = await fork.findOneOrFail(User, { externalId: "purge-subject" });
        const sentInvite = new SessionHostInvite({
            emailAddress: "friend@example.test",
            session: ref(await fork.findOneOrFail(Session, confirmedSessionId)),
            createdBy: ref(subject),
        });
        await fork.persist(sentInvite).flush();
        const madeTransition = await fork.findOneOrFail(SessionTransition, { actor: subject.id });
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let lockedRows: string[] = [];
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, subject.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const purging = send(purge(SUBJECT, false));
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    await em.fork().transactional(async (em) => {
                        const isFree = async (table: string, id: string): Promise<boolean> =>
                            (
                                await em
                                    .getConnection()
                                    .execute<unknown[]>(
                                        `select 1 from "${table}" where "id" = ? for update skip locked`,
                                        [id],
                                        "all",
                                        em.getTransactionContext(),
                                    )
                            ).length === 1;

                        lockedRows = [
                            ...((await isFree("session_host_invite", sentInvite.id))
                                ? []
                                : ["invite"]),
                            ...((await isFree("session_transition", madeTransition.id))
                                ? []
                                : ["transition"]),
                        ];
                    });
                },
            },
        );

        await holding;
        const response = await purging;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 200);
        assert.deepEqual(lockedRows, ["invite", "transition"]);
        assert.equal(
            (await em.fork().findOneOrFail(SessionHostInvite, sentInvite.id)).createdBy,
            null,
        );
    });

    // An organizer's transitions sit in editions they host nothing in. An
    // edition delete cascades through those sessions one at a time, so unless
    // the purge takes the edition first, the two can cross between sessions.
    it("locks an edition it reaches only through a transition", async () => {
        const fork = em.fork();
        const subject = await fork.findOneOrFail(User, { externalId: "purge-subject" });
        const otherEdition = buildEdition({ name: "Organized Elsewhere" });
        const sessionType = new SessionType({
            name: "Talk",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ hours: 1 }),
            internal: false,
            selectionDefault: true,
            edition: ref(otherEdition),
        });
        const session = buildSession(otherEdition, sessionType, { title: "Organized" });
        fork.persist([
            otherEdition,
            sessionType,
            session,
            new SessionTransition({
                session: ref(session),
                actor: ref(subject),
                fromState: "submitted",
                toState: "accepted",
                note: null,
            }),
        ]);
        await fork.flush();
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let editionFree = true;
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, subject.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const purging = send(purge(SUBJECT, false));
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
                                'select 1 from "edition" where "id" = ? for update skip locked',
                                [otherEdition.id],
                                "all",
                                em.getTransactionContext(),
                            );
                        editionFree = rows.length === 1;
                    });
                },
            },
        );

        await holding;
        const response = await purging;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 200);
        assert.ok(!editionFree, "the purge reached a transition in an edition it had not locked");
    });

    it("locks editions it reaches only through an invite", async () => {
        const fork = em.fork();
        const subject = await fork.findOneOrFail(User, { externalId: "purge-subject" });
        const bystander = await fork.findOneOrFail(User, { externalId: "purge-bystander" });
        const buildInviteSession = (name: string): [Edition, SessionType, Session] => {
            const edition = buildEdition({ name });
            const sessionType = SessionType.default(ref(edition));

            return [edition, sessionType, buildSession(edition, sessionType, { title: name })];
        };
        const [sentEdition, sentType, sentSession] = buildInviteSession("Invited From");
        const [receivedEdition, receivedType, receivedSession] = buildInviteSession("Invited To");
        fork.persist([
            sentEdition,
            sentType,
            sentSession,
            receivedEdition,
            receivedType,
            receivedSession,
            new SessionHostInvite({
                emailAddress: "friend@example.test",
                session: ref(sentSession),
                createdBy: ref(subject),
            }),
            new SessionHostInvite({
                emailAddress: SUBJECT,
                session: ref(receivedSession),
                createdBy: ref(bystander),
            }),
        ]);
        await fork.flush();
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let lockedEditions: string[] = [];
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, subject.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const purging = send(purge(SUBJECT, false));
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    await em.fork().transactional(async (em) => {
                        const isFree = async (editionId: string): Promise<boolean> =>
                            (
                                await em
                                    .getConnection()
                                    .execute<unknown[]>(
                                        'select 1 from "edition" where "id" = ? for update skip locked',
                                        [editionId],
                                        "all",
                                        em.getTransactionContext(),
                                    )
                            ).length === 1;

                        lockedEditions = [
                            ...((await isFree(sentEdition.id)) ? [] : ["sent"]),
                            ...((await isFree(receivedEdition.id)) ? [] : ["received"]),
                        ];
                    });
                },
            },
        );

        await holding;
        const response = await purging;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 200);
        assert.deepEqual(lockedEditions, ["sent", "received"]);
    });

    // A held lock on the late edition is how the test sees the second attempt
    // reach for it.
    it("retries to lock an edition the subject reached while it waited", async () => {
        const fork = em.fork();
        const subject = await fork.findOneOrFail(User, { externalId: "purge-subject" });
        const lateEdition = buildEdition({ name: "Reached Late" });
        const lateType = SessionType.default(ref(lateEdition));
        const lateSession = buildSession(lateEdition, lateType, { title: "Reached Late" });
        await fork.persist([lateEdition, lateType, lateSession]).flush();

        const userTaken = Promise.withResolvers<void>();
        const userHeld = Promise.withResolvers<void>();
        const userHolding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, subject.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            userTaken.resolve();
            await userHeld.promise;
            em.persist(
                new SessionTransition({
                    session: ref(em.getReference(Session, lateSession.id)),
                    actor: ref(em.getReference(User, subject.id)),
                    fromState: "submitted",
                    toState: "accepted",
                    note: null,
                }),
            );
        });
        const editionTaken = Promise.withResolvers<number>();
        const editionHeld = Promise.withResolvers<void>();
        const editionHolding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Edition, lateEdition.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            const [{ pid }] = await em
                .getConnection()
                .execute<{ pid: number }[]>(
                    "select pg_backend_pid() as pid",
                    [],
                    "all",
                    em.getTransactionContext(),
                );
            editionTaken.resolve(pid);
            await editionHeld.promise;
        });

        await userTaken.promise;
        const editionHolderPid = await editionTaken.promise;

        const purging = send(purge(SUBJECT, false));
        const userWaitError = await releaseAfterLockWait(em.fork(), () => {
            userHeld.resolve();
        });
        await userHolding;
        const editionWaitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                editionHeld.resolve();
            },
            { blockedBy: editionHolderPid },
        );
        await editionHolding;
        const response = await purging;

        if (userWaitError !== null) {
            throw userWaitError;
        }

        if (editionWaitError !== null) {
            throw editionWaitError;
        }

        assert.equal(response.status, 200);
        assert.equal(await em.fork().count(User, { id: subject.id }), 0);
    });

    it("removes the invites the account cannot reach", async () => {
        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const fork = em.fork();
        assert.equal(await fork.count(TeamInvite, { emailAddress: SUBJECT }), 0);
        assert.equal(await fork.count(SessionHostInvite, { emailAddress: SUBJECT }), 0);
        assert.equal(await fork.count(TeamInvite, { emailAddress: BYSTANDER }), 1);
        assert.equal(await fork.count(SessionHostInvite, { emailAddress: BYSTANDER }), 1);
        assert.equal(await fork.count(User, { emailAddress: BYSTANDER }), 1);
    });

    it("removes unsent mail but leaves what the cleaner owns", async () => {
        const fork = em.fork();
        const finalized = new Job({
            payload: {
                type: "send_email",
                recipient: SUBJECT,
                subject: "Already sent",
                template: "team-invite",
                variables: {},
            },
        });
        finalized.state = "completed";
        finalized.finalizedAt = Temporal.Now.instant();
        await fork.persist(finalized).flush();

        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const after = em.fork();
        const pendingFor = async (recipient: string) =>
            after.count(Job, {
                state: { $in: ["available", "scheduled"] },
                payload: { type: "send_email" as const, recipient },
            });

        assert.equal(await pendingFor(SUBJECT), 0);
        assert.equal(await pendingFor(BYSTANDER), 1);
        assert.equal(await after.count(Job, { id: finalized.id }), 1);
    });

    // The scheduler and the rescuer lock job batches in id order, and a
    // multi-row delete takes its rows in whatever order the plan scans them.
    // A state change moves the first job's tuple behind the second, which is
    // what turns a plan-ordered delete against theirs.
    it("locks the mail it deletes in id order", async () => {
        const fork = em.fork();
        const mail = (subject: string) =>
            new Job({
                payload: {
                    type: "send_email",
                    recipient: SUBJECT,
                    subject,
                    template: "team-invite",
                    variables: {},
                },
            });
        const first = mail("First");
        const second = mail("Second");
        await fork.persist([first, second]).flush();
        first.state = "scheduled";
        await fork.flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Job, first.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const purged = send(purge(SUBJECT, false));
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    await em
                        .fork()
                        .getConnection()
                        .execute('select 1 from "job" where "id" = ? for update nowait', [
                            second.id,
                        ]);
                },
            },
        );

        await holding;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal((await purged).status, 200);
        assert.equal(await em.fork().count(Job, { id: { $in: [first.id, second.id] } }), 0);
    });

    // A host address is whatever the speaker typed for the edition, so the
    // bystander's own address, or one invited without an account, can be one.
    it("removes unsent mail to a host address only the account used", async () => {
        const fork = em.fork();
        const subject = await fork.findOneOrFail(User, { externalId: "purge-subject" });
        const host = await fork.findOneOrFail(Host, { user: subject });
        host.emailAddress = "subject-alias@example.test";
        const otherEdition = buildEdition({ name: "Alias Edition" });
        const invitedEdition = buildEdition({ name: "Invited Alias Edition" });
        const team = await fork.findOneOrFail(Team, teamId);
        fork.persist([
            otherEdition,
            invitedEdition,
            buildHost(otherEdition, subject, { emailAddress: BYSTANDER }),
            buildHost(invitedEdition, subject, { emailAddress: "assistant@example.test" }),
            new TeamInvite({ emailAddress: "assistant@example.test", team: ref(team) }),
            new Job({
                payload: {
                    type: "send_email",
                    recipient: "assistant@example.test",
                    subject: "Pending team invite",
                    template: "team-invite",
                    variables: {},
                },
            }),
            new Job({
                payload: {
                    type: "send_email",
                    recipient: "subject-alias@example.test",
                    subject: "Pending to the alias",
                    template: "session-accepted",
                    variables: {},
                },
            }),
        ]);
        await fork.flush();

        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const after = em.fork();
        const pendingFor = async (recipient: string) =>
            after.count(Job, {
                state: { $in: ["available", "scheduled"] },
                payload: { type: "send_email" as const, recipient },
            });

        assert.equal(await pendingFor("subject-alias@example.test"), 0);
        assert.equal(await pendingFor(BYSTANDER), 1);
        assert.equal(await pendingFor("assistant@example.test"), 1);
    });

    it("keeps the session, and lets it go hostless", async () => {
        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const session = await em
            .fork()
            .findOneOrFail(Session, confirmedSessionId, { populate: ["hosts"] });
        assert.equal(session.title, "Purge Session");
        assert.equal(session.hosts.length, 0);
    });

    it("keeps the transition and forgets who made it", async () => {
        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const transitions = await em
            .fork()
            .find(SessionTransition, { session: confirmedSessionId });
        assert.equal(transitions.length, 1);
        assert.equal(transitions[0].actor, null);
    });

    it("changes nothing on a dry run", async () => {
        const response = await purge(SUBJECT, true);
        assert.equal(response.status, 200);

        const body = (await response.json()) as {
            data: { attributes: Record<string, unknown> };
        };
        assert.equal(body.data.attributes.dryRun, true);
        assert.deepEqual(body.data.attributes.displayNames, ["Purge Subject"]);
        assert.equal(body.data.attributes.hostedSessions, 2);
        // The report runs its own queries rather than reading what the deletes
        // matched, so an unscoped count here would promise to erase the
        // bystander's rows while the delete left them alone.
        assert.equal(body.data.attributes.teamInvites, 1);
        assert.equal(body.data.attributes.sessionHostInvites, 1);
        assert.equal(body.data.attributes.pendingMails, 1);

        const fork = em.fork();
        assert.equal(await fork.count(User, { emailAddress: SUBJECT }), 1);
        assert.equal(await fork.count(TeamInvite, { emailAddress: SUBJECT }), 1);
        assert.equal(await fork.count(SessionHostInvite, { emailAddress: SUBJECT }), 1);
        assert.equal(
            await fork.count(Job, { payload: { type: "send_email", recipient: SUBJECT } }),
            1,
        );
    });

    it("purges every account sharing the address", async () => {
        const fork = em.fork();
        fork.persist(
            new User({
                externalId: "purge-subject-2",
                displayName: "Purge Subject Two",
                emailAddress: SUBJECT,
            }),
        );
        await fork.flush();

        const response = await purge(SUBJECT, false);
        assert.equal(response.status, 200);

        const body = (await response.json()) as {
            data: { attributes: { displayNames: string[] } };
        };
        assert.equal(body.data.attributes.displayNames.length, 2);
        assert.equal(await em.fork().count(User, { emailAddress: SUBJECT }), 0);
    });

    // The sibling session schema defaults its meta directive and prefaults the
    // whole member, which is the edit that would turn either of these into a run.
    for (const meta of [{}, { dryRun: null }]) {
        it(`refuses to run on a meta that decides nothing: ${JSON.stringify(meta)}`, async () => {
            const response = await jsonApi.post("/user-purges", adminToken, {
                data: {
                    type: "user_purge",
                    attributes: { emailAddress: SUBJECT },
                    meta,
                },
            });

            assert.equal(response.status, 422);
            assert.equal(await em.fork().count(User, { emailAddress: SUBJECT }), 1);
        });
    }

    it("refuses to run without an explicit dry run decision", async () => {
        const response = await jsonApi.post("/user-purges", adminToken, {
            data: {
                type: "user_purge",
                attributes: { emailAddress: SUBJECT },
            },
        });

        assert.equal(response.status, 422);
        assert.equal(await em.fork().count(User, { emailAddress: SUBJECT }), 1);
    });

    for (const dryRun of [true, false]) {
        it(`refuses to erase the caller's own address${dryRun ? " on a dry run" : ""}`, async () => {
            const response = await purge("admin@example.test", dryRun);

            assert.equal(response.status, 403);
            const document = (await response.json()) as { errors: { code: string }[] };
            assert.equal(document.errors[0]?.code, "own_account");
            assert.equal(await em.fork().count(User, { emailAddress: "admin@example.test" }), 1);
        });
    }
});
