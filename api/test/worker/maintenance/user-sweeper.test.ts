import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Response } from "../../../src/entity/Response.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionTransition } from "../../../src/entity/SessionTransition.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Team } from "../../../src/entity/Team.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { UserSweeper } from "../../../src/worker/maintenance/user-sweeper.js";
import { buildEdition, buildHost, buildSession } from "../../setup/fixtures.js";
import { releaseAfterLockWait } from "../../setup/locks.js";

describe("user sweeper", () => {
    let dormantUserId: string;
    let hostingUserId: string;
    let memberUserId: string;
    let answeringUserId: string;
    let activeUserId: string;

    beforeEach(async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Sweep User Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Hosted Session" });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Which meal do you prefer?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const team = new Team({ name: "Sweep User Team", role: "viewer" });

        const dormantUser = new User({
            externalId: "sweep-dormant",
            displayName: "Dormant",
            emailAddress: "dormant@example.test",
        });
        const hostingUser = new User({
            externalId: "sweep-hosting",
            displayName: "Hosting",
            emailAddress: "hosting@example.test",
        });
        const memberUser = new User({
            externalId: "sweep-member",
            displayName: "Member",
            emailAddress: "member@example.test",
        });
        const answeringUser = new User({
            externalId: "sweep-answering",
            displayName: "Answering",
            emailAddress: "answering@example.test",
        });
        const activeUser = new User({
            externalId: "sweep-active",
            displayName: "Active",
            emailAddress: "active@example.test",
        });

        session.hosts.add(buildHost(edition, hostingUser));
        team.users.add(memberUser);
        const answeringHost = buildHost(edition, answeringUser);
        const response = Response.hostResponse(ref(customField), ref(answeringHost), "vegan");

        await fork
            .persist([
                edition,
                sessionType,
                session,
                customField,
                team,
                dormantUser,
                hostingUser,
                memberUser,
                answeringUser,
                activeUser,
                answeringHost,
                response,
            ])
            .flush();

        const staleLastSeenAt = Temporal.Now.zonedDateTimeISO()
            .subtract(appConfig.worker.userSweeper.retentionPeriod)
            .subtract({ days: 1 })
            .toInstant();

        await fork.nativeUpdate(
            User,
            {
                id: {
                    $in: [dormantUser.id, hostingUser.id, memberUser.id, answeringUser.id],
                },
            },
            { lastSeenAt: staleLastSeenAt },
        );

        dormantUserId = dormantUser.id;
        hostingUserId = hostingUser.id;
        memberUserId = memberUser.id;
        answeringUserId = answeringUser.id;
        activeUserId = activeUser.id;
    });

    it("deletes a dormant user nothing references", async () => {
        await new UserSweeper().runOnce();

        assert.equal(await em.fork().count(User, { id: dormantUserId }), 0);
    });

    it("keeps dormant users that are still referenced", async () => {
        await new UserSweeper().runOnce();

        const fork = em.fork();
        assert.equal(await fork.count(User, { id: hostingUserId }), 1);
        assert.equal(await fork.count(User, { id: memberUserId }), 1);
    });

    it("deletes a dormant user whose only reference is an answered host profile", async () => {
        await new UserSweeper().runOnce();

        const fork = em.fork();
        assert.equal(await fork.count(User, { id: answeringUserId }), 0);
        assert.equal(await fork.count(Response, { customField: { target: "per_host" } }), 0);
    });

    it("keeps a recently seen user without references", async () => {
        await new UserSweeper().runOnce();

        assert.equal(await em.fork().count(User, { id: activeUserId }), 1);
    });

    it("deletes a dormant transition actor and nulls the transition", async () => {
        const fork = em.fork();
        const actor = new User({
            externalId: "dormant-actor",
            displayName: "Dormant Actor",
            emailAddress: "dormant-actor@example.test",
        });
        const edition = buildEdition({ name: "Actor Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Acted Session" });
        const transition = new SessionTransition({
            session: ref(session),
            actor: ref(actor),
            fromState: "submitted",
            toState: "accepted",
            note: null,
        });
        await fork.persist([actor, edition, sessionType, session, transition]).flush();
        const staleLastSeenAt = Temporal.Now.zonedDateTimeISO()
            .subtract(appConfig.worker.userSweeper.retentionPeriod)
            .subtract({ days: 1 })
            .toInstant();
        await fork.nativeUpdate(User, { id: actor.id }, { lastSeenAt: staleLastSeenAt });

        await new UserSweeper().runOnce();

        assert.equal(await em.fork().count(User, { id: actor.id }), 0);
        const survivingTransition = await em.fork().findOneOrFail(SessionTransition, transition.id);
        assert.equal(survivingTransition.actor, null);
    });

    it("holds a dormant user's transition before it locks the user", async () => {
        const fork = em.fork();
        const actor = new User({
            externalId: "held-actor",
            displayName: "Held Actor",
            emailAddress: "held-actor@example.test",
        });
        const edition = buildEdition({ name: "Held Actor Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Held Session" });
        const transition = new SessionTransition({
            session: ref(session),
            actor: ref(actor),
            fromState: "submitted",
            toState: "accepted",
            note: null,
        });
        await fork.persist([actor, edition, sessionType, session, transition]).flush();
        const staleLastSeenAt = Temporal.Now.zonedDateTimeISO()
            .subtract(appConfig.worker.userSweeper.retentionPeriod)
            .subtract({ days: 1 })
            .toInstant();
        await fork.nativeUpdate(User, { id: actor.id }, { lastSeenAt: staleLastSeenAt });

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        let transitionLocked = false;
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, actor.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;
        const sweeping = new UserSweeper().runOnce();

        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    await em.fork().transactional(async (em) => {
                        transitionLocked =
                            (
                                await em
                                    .getConnection()
                                    .execute<unknown[]>(
                                        'select 1 from "session_transition" where "id" = ? for update skip locked',
                                        [transition.id],
                                        "all",
                                        em.getTransactionContext(),
                                    )
                            ).length === 0;
                    });
                },
            },
        );

        await holding;
        await sweeping;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(transitionLocked, true);
        assert.equal(await em.fork().count(User, { id: actor.id }), 0);
    });

    it("keeps a dormant user that becomes a host while it sweeps", async () => {
        const fork = em.fork();
        // An edition no candidate reaches, so the sweep locks no edition this
        // transaction holds and waits on the user row alone.
        const edition = buildEdition({ name: "Late Host Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Late Hosted Session" });
        await fork.persist([edition, sessionType, session]).flush();

        // A resolveHost caller's order: the edition, the user, then the host
        // it writes. Held open so the sweep has to decide about a user this
        // transaction is about to give a session to.
        const locked = Promise.withResolvers<void>();
        const swept = Promise.withResolvers<void>();
        const hosting = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Edition, edition.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            const user = await em.findOneOrFail(User, dormantUserId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            locked.resolve();
            await swept.promise;

            const host = buildHost(edition, user);
            const hosted = await em.findOneOrFail(Session, session.id, { populate: ["hosts"] });
            hosted.hosts.add(host);
            em.persist([host, hosted]);
        });

        await locked.promise;
        const sweeping = new UserSweeper().runOnce();

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            swept.resolve();
        });

        await hosting;
        await sweeping;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(await em.fork().count(User, { id: dormantUserId }), 1);
    });

    // A membership only takes a key share on the user and reaches no edition,
    // so the hold waits it out and still returns the user from its snapshot.
    // Only the delete's own reference check keeps the user.
    it("keeps a dormant user who joins a team while it sweeps", async () => {
        const joined = Promise.withResolvers<void>();
        const swept = Promise.withResolvers<void>();
        const joining = em.fork().transactional(async (em) => {
            const team = await em.findOneOrFail(
                Team,
                { name: "Sweep User Team" },
                { populate: ["users"] },
            );
            team.users.add(em.getReference(User, dormantUserId));
            await em.flush();
            joined.resolve();
            await swept.promise;
        });

        await joined.promise;
        const sweeping = new UserSweeper().runOnce();

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            swept.resolve();
        });

        await joining;
        await sweeping;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(await em.fork().count(User, { id: dormantUserId }), 1);
    });

    it("leaves a user who reached a new edition while it swept to the next run", async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Reached Mid-Sweep" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Reached Mid-Sweep" });
        await fork.persist([edition, sessionType, session]).flush();

        const locked = Promise.withResolvers<void>();
        const swept = Promise.withResolvers<void>();
        const acting = em.fork().transactional(async (em) => {
            await em.findOneOrFail(User, dormantUserId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            locked.resolve();
            await swept.promise;
            em.persist(
                new SessionTransition({
                    session: ref(em.getReference(Session, session.id)),
                    actor: ref(em.getReference(User, dormantUserId)),
                    fromState: "submitted",
                    toState: "accepted",
                    note: null,
                }),
            );
        });

        await locked.promise;
        const sweeping = new UserSweeper().runOnce();

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            swept.resolve();
        });

        await acting;
        await sweeping;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(await em.fork().count(User, { id: dormantUserId }), 1);

        await new UserSweeper().runOnce();

        assert.equal(await em.fork().count(User, { id: dormantUserId }), 0);
    });

    it("stops without waiting out its interval", async () => {
        const sweeper = new UserSweeper();
        sweeper.start();

        const startedAt = process.hrtime.bigint();
        await sweeper.stop();
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

        // The configured interval is hours, so resolving at all proves the loop
        // observed the abort rather than sleeping through it. Interrupting a
        // sleep already in flight is covered directly in the sleep tests.
        assert.ok(
            elapsedMs < 5_000,
            `stop() took ${elapsedMs.toString()}ms against an interval of ${appConfig.worker.userSweeper.interval.toString()}`,
        );
    });
});
