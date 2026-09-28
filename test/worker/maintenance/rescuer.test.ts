import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Job, type JobState } from "../../../src/entity/Job.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { instantAgo } from "../../../src/util/time.js";
import { JobRescuer } from "../../../src/worker/maintenance/rescuer.js";
import { buildEmailPayload } from "../../setup/jobs.js";

const { maxAttempts } = appConfig.worker.runtime;
const { rescueAfter } = appConfig.worker.rescuer;

const longAgo = (): Temporal.Instant => instantAgo(rescueAfter).subtract({ minutes: 1 });

type JobShape = {
    state: JobState;
    attemptedAt: Temporal.Instant;
    attempt: number;
};

const persistJob = async ({ state, attemptedAt, attempt }: JobShape): Promise<string> => {
    const fork = em.fork();
    const job = new Job({ payload: buildEmailPayload("rescue@example.test", "Stalled") });
    job.state = state;
    job.attemptedAt = attemptedAt;
    job.attempt = attempt;
    await fork.persist(job).flush();

    return job.id;
};

const readJob = async (id: string): Promise<Job> => em.fork().findOneOrFail(Job, id);

describe("job rescuer", () => {
    let rescuer: JobRescuer;

    beforeEach(() => {
        rescuer = new JobRescuer();
    });

    // At maxAttempts - 1 rather than at 1, so the pair with the discard case
    // below straddles the ceiling. Lowering it by one would otherwise burn a
    // job's last retry with nothing failing.
    it("puts a job back that a worker left running", async () => {
        const id = await persistJob({
            state: "running",
            attemptedAt: longAgo(),
            attempt: maxAttempts - 1,
        });

        await rescuer.runOnce();

        const job = await readJob(id);
        assert.equal(job.state, "available");
        assert.equal(job.finalizedAt, null);
        // Otherwise the spent attempt reads as one that never failed.
        assert.equal(job.lastError, "A worker stopped while running this job");
    });

    // The threshold is what separates a dead worker from a live one, so the
    // wrong comparison here re-runs jobs that are still in flight and sends
    // their mail twice.
    it("leaves a job a worker only just picked up", async () => {
        const id = await persistJob({
            state: "running",
            attemptedAt: Temporal.Now.instant(),
            attempt: 1,
        });

        await rescuer.runOnce();

        assert.equal((await readJob(id)).state, "running");
    });

    it("leaves a job that is not running", async () => {
        const id = await persistJob({ state: "retryable", attemptedAt: longAgo(), attempt: 1 });

        await rescuer.runOnce();

        assert.equal((await readJob(id)).state, "retryable");
    });

    it("discards a job that has used every attempt", async () => {
        const id = await persistJob({
            state: "running",
            attemptedAt: longAgo(),
            attempt: maxAttempts,
        });

        await rescuer.runOnce();

        const job = await readJob(id);
        assert.equal(job.state, "discarded");
        assert.notEqual(job.finalizedAt, null);
    });
});
