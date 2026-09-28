import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { Job, type SendEmailJobPayload } from "../../src/entity/Job.js";
import { Session } from "../../src/entity/Session.js";
import { SessionType } from "../../src/entity/SessionType.js";
import { em } from "../../src/util/mikro-orm.js";
import { publishJob } from "../../src/worker/util.js";
import { buildEdition, buildSession } from "../setup/fixtures.js";
import { buildEmailPayload } from "../setup/jobs.js";

const buildPayload = (subject: string): SendEmailJobPayload =>
    buildEmailPayload("publish@example.test", subject);

describe("publishJob", () => {
    let sessionId: string;
    let takenJobId: string;

    beforeEach(async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Publish Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Original" });
        const existing = new Job({ payload: buildPayload("Already queued") });

        await fork.persist([edition, sessionType, session, existing]).flush();

        sessionId = session.id;
        takenJobId = existing.id;
    });

    const readTitle = async (): Promise<string> =>
        (await em.fork().findOneOrFail(Session, sessionId)).title;

    it("queues a job inside the caller's transaction", async () => {
        await em.fork().transactional(async (em) => {
            const session = await em.findOneOrFail(Session, sessionId);
            session.title = "Renamed";
            em.persist(session);

            await publishJob(new Job({ payload: buildPayload("Queued alongside") }), em);
        });

        assert.equal(await readTitle(), "Renamed");
        assert.equal(await em.fork().count(Job, { payload: { subject: "Queued alongside" } }), 1);
    });

    it("does not let a failed queue attempt discard the caller's writes", async () => {
        const doomed = new Job({ payload: buildPayload("Doomed") });
        // A primary key already in the table, so the insert fails at whichever
        // flush ends up running it.
        Object.assign(doomed, { id: takenJobId });

        await assert.rejects(
            em.fork().transactional(async (em) => {
                const session = await em.findOneOrFail(Session, sessionId);
                session.title = "Renamed";
                em.persist(session);

                try {
                    await publishJob(doomed, em);
                } catch {
                    // A handler that carries on after failing to queue mail is
                    // what makes the savepoint bug reachable at all.
                }
            }),
        );

        assert.equal(await readTitle(), "Original");
    });
});
