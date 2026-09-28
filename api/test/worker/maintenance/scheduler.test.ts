import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Job, type SendEmailJobPayload } from "../../../src/entity/Job.js";
import { em } from "../../../src/util/mikro-orm.js";
import { JobScheduler } from "../../../src/worker/maintenance/scheduler.js";
import { buildEmailPayload } from "../../setup/jobs.js";

const buildPayload = (subject: string): SendEmailJobPayload =>
    buildEmailPayload("scheduled@example.test", subject);

const scheduleJob = async (subject: string, offsetSeconds: number): Promise<string> => {
    const fork = em.fork();
    const job = new Job({
        payload: buildPayload(subject),
        scheduledAt: Temporal.Now.instant().add({ seconds: offsetSeconds }),
    });
    await fork.persist(job).flush();

    return job.id;
};

const readState = async (id: string): Promise<string> =>
    (await em.fork().findOneOrFail(Job, id)).state;

describe("job scheduler", () => {
    it("promotes a job that is already due", async () => {
        const id = await scheduleJob("Due", -1);

        await new JobScheduler().runOnce();

        assert.equal(await readState(id), "available");
    });

    it("leaves a job that is due soon alone", async () => {
        // The processor claims whatever is available, so promoting early would
        // run the job early.
        const id = await scheduleJob("Due in three seconds", 3);

        await new JobScheduler().runOnce();

        assert.equal(await readState(id), "scheduled");
    });

    it("promotes a retryable job once its backoff has elapsed", async () => {
        const id = await scheduleJob("Retrying", -1);
        const fork = em.fork();
        await fork.nativeUpdate(Job, { id }, { state: "retryable" });

        await new JobScheduler().runOnce();

        assert.equal(await readState(id), "available");
    });
});
