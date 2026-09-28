import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { Edition } from "../../../src/entity/Edition.js";
import { Job } from "../../../src/entity/Job.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type ReminderDocument = {
    meta: { remindedSessions: number; skippedSessions: number };
};

describe("confirm reminders", () => {
    let managerToken: string;
    let editionId: string;
    let acceptedSessionId: string;
    let hostlessSessionId: string;
    let confirmedSessionId: string;

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const host = new User({
            externalId: "testhost",
            displayName: "Reminded Host",
            emailAddress: "reminded-host@example.test",
        });
        const cohost = new User({
            externalId: "stranger",
            displayName: "Reminded Cohost",
            emailAddress: "reminded-cohost@example.test",
        });

        const edition = buildEdition({ name: "Reminder Edition" });
        const sessionType = SessionType.default(ref(edition));

        const hostRecord = buildHost(edition, host);
        const cohostRecord = buildHost(edition, cohost);

        const acceptedSession = buildSession(edition, sessionType, { title: "Accepted Session" });
        acceptedSession.state = "accepted";
        acceptedSession.hosts.add(hostRecord);
        acceptedSession.hosts.add(cohostRecord);

        const recentlyRemindedSession = buildSession(edition, sessionType, {
            title: "Recently Reminded Session",
        });
        recentlyRemindedSession.state = "accepted";
        recentlyRemindedSession.hosts.add(hostRecord);
        recentlyRemindedSession.confirmationRemindedAt = Temporal.Now.instant();

        const hostlessSession = buildSession(edition, sessionType, { title: "Hostless Session" });
        hostlessSession.state = "accepted";

        const confirmedSession = buildSession(edition, sessionType, { title: "Confirmed Session" });
        confirmedSession.state = "confirmed";
        confirmedSession.hosts.add(hostRecord);

        const submittedSession = buildSession(edition, sessionType, { title: "Submitted Session" });
        submittedSession.hosts.add(hostRecord);

        await fork
            .persist([
                manager,
                team,
                host,
                cohost,
                edition,
                sessionType,
                acceptedSession,
                recentlyRemindedSession,
                hostlessSession,
                confirmedSession,
                submittedSession,
            ])
            .flush();

        editionId = edition.id;
        acceptedSessionId = acceptedSession.id;
        hostlessSessionId = hostlessSession.id;
        confirmedSessionId = confirmedSession.id;
    });

    const dispatchReminders = () =>
        jsonApi.post(`/editions/${editionId}/confirm-reminders`, managerToken, {
            data: { type: "confirm_reminder_dispatch" },
        });

    const findReminderMails = async (): Promise<string[]> => {
        const jobs = await em.fork().find(Job, { state: "available" });

        return jobs.flatMap((job) =>
            job.payload.type === "send_email" && job.payload.template === "session-confirm-reminder"
                ? [job.payload.recipient]
                : [],
        );
    };

    // Publishing holds the edition and then takes key shares on sessions in
    // its own order, while the reminder locks them by id. Waiting at the
    // edition first is what keeps the two from meeting among the sessions.
    it("waits for a writer holding the edition before locking any session", async () => {
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOne(Edition, editionId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const dispatched = send(dispatchReminders());
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
                        .execute('select 1 from "session" where "id" = ? for update nowait', [
                            acceptedSessionId,
                        ]);
                },
            },
        );

        await holding;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal((await dispatched).status, 200);
    });

    it("reminds due accepted sessions and skips the rest", async () => {
        const response = await dispatchReminders();

        assert.equal(response.status, 200);
        const document = (await response.json()) as ReminderDocument;

        // Due and mailed: the accepted session. Skipped: the recently
        // reminded one and the hostless one, which is never stamped.
        assert.equal(document.meta.remindedSessions, 1);
        assert.equal(document.meta.skippedSessions, 2);

        assert.deepEqual((await findReminderMails()).sort(), [
            "reminded-cohost@example.test",
            "reminded-host@example.test",
        ]);

        const session = await em.fork().findOneOrFail(Session, acceptedSessionId);
        assert.notEqual(session.confirmationRemindedAt, null);

        const hostlessSession = await em.fork().findOneOrFail(Session, hostlessSessionId);
        assert.equal(hostlessSession.confirmationRemindedAt, null);

        const confirmedSession = await em.fork().findOneOrFail(Session, confirmedSessionId);
        assert.equal(confirmedSession.confirmationRemindedAt, null);
    });

    it("skips sessions reminded within the cooldown", async () => {
        await em
            .fork()
            .nativeUpdate(
                Session,
                { id: acceptedSessionId },
                { confirmationRemindedAt: Temporal.Now.instant() },
            );

        const response = await dispatchReminders();

        assert.equal(response.status, 200);
        const document = (await response.json()) as ReminderDocument;
        assert.equal(document.meta.remindedSessions, 0);
        assert.equal(document.meta.skippedSessions, 3);

        assert.equal((await findReminderMails()).length, 0);
    });

    it("reminds again once the cooldown lapsed", async () => {
        const beyondCooldown = Temporal.Now.zonedDateTimeISO()
            .subtract(appConfig.email.confirmReminderCooldown)
            .subtract({ hours: 1 })
            .toInstant();
        await em
            .fork()
            .nativeUpdate(
                Session,
                { id: acceptedSessionId },
                { confirmationRemindedAt: beyondCooldown },
            );

        const response = await dispatchReminders();

        assert.equal(response.status, 200);
        const document = (await response.json()) as ReminderDocument;
        assert.equal(document.meta.remindedSessions, 1);
        assert.equal(document.meta.skippedSessions, 2);

        assert.equal((await findReminderMails()).length, 2);
    });
});
