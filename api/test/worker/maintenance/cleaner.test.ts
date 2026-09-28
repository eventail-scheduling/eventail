import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { LockMode } from "@mikro-orm/core";
import { Job, type JobState } from "../../../src/entity/Job.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { instantAgo } from "../../../src/util/time.js";
import { JobCleaner } from "../../../src/worker/maintenance/cleaner.js";
import { buildEmailPayload } from "../../setup/jobs.js";
import { releaseAfterLockWait } from "../../setup/locks.js";

const { canceledJobRetentionPeriod, completedJobRetentionPeriod, discardedJobRetentionPeriod } =
    appConfig.worker.cleaner;

const retentionFor: Record<"canceled" | "completed" | "discarded", Temporal.Duration> = {
    canceled: canceledJobRetentionPeriod,
    completed: completedJobRetentionPeriod,
    discarded: discardedJobRetentionPeriod,
};

type FinishedState = keyof typeof retentionFor;

const finishedStates = Object.keys(retentionFor) as FinishedState[];

const persistJob = async (
    state: JobState,
    finalizedAt: Temporal.Instant | null,
): Promise<string> => {
    const job = new Job({ payload: buildEmailPayload("cleaner@example.test", `A ${state} job`) });
    job.state = state;
    job.finalizedAt = finalizedAt;
    await em.fork().persist(job).flush();

    return job.id;
};

// Well clear of the hour a daylight saving change moves a zoned threshold by.
const margin = { hours: 12 };

const exists = async (id: string): Promise<boolean> => (await em.fork().count(Job, { id })) === 1;

describe("job cleaner", () => {
    let cleaner: JobCleaner;

    beforeEach(() => {
        cleaner = new JobCleaner();
    });

    it("deletes each finished job once it outlives its retention", async () => {
        const ids = await Promise.all(
            finishedStates.map((state) =>
                persistJob(state, instantAgo(retentionFor[state]).subtract(margin)),
            ),
        );

        await cleaner.runOnce();

        for (const id of ids) {
            assert.equal(await exists(id), false);
        }
    });

    it("keeps each finished job within its retention", async () => {
        const ids = await Promise.all(
            finishedStates.map((state) =>
                persistJob(state, instantAgo(retentionFor[state]).add(margin)),
            ),
        );

        await cleaner.runOnce();

        for (const id of ids) {
            assert.equal(await exists(id), true);
        }
    });

    // An age that already clears a completed job is the one that tells the two
    // retentions apart.
    it("keeps a failed job at an age that clears a completed one", async () => {
        const finalizedAt = instantAgo(completedJobRetentionPeriod).subtract(margin);
        const failed = await persistJob("discarded", finalizedAt);
        const completed = await persistJob("completed", finalizedAt);

        await cleaner.runOnce();

        assert.equal(await exists(failed), true);
        assert.equal(await exists(completed), false);
    });

    it("never deletes a job that has not finished, however old", async () => {
        const unfinished = await Promise.all(
            (["available", "scheduled", "retryable", "running"] as const).map((state) =>
                persistJob(state, null),
            ),
        );

        // Older than any retention, so a cleaner that pruned by age alone would
        // take them.
        await em
            .fork()
            .nativeUpdate(
                Job,
                { id: { $in: unfinished } },
                { createdAt: instantAgo(discardedJobRetentionPeriod).subtract({ hours: 24 }) },
            );

        await cleaner.runOnce();

        for (const id of unfinished) {
            assert.equal(await exists(id), true);
        }
    });

    // The purge locks an address's mail by id before deleting it, and the
    // cleaner reaches failed mail too. Moving the first job's tuple and its
    // index entry behind the second's is what turns a plan-ordered delete
    // against the purge's order.
    it("locks what it deletes in id order", async () => {
        const old = instantAgo(discardedJobRetentionPeriod).subtract(margin);
        const first = await persistJob("discarded", old.subtract({ minutes: 2 }));
        const second = await persistJob("discarded", old.subtract({ minutes: 1 }));
        const fork = em.fork();
        (await fork.findOneOrFail(Job, first)).finalizedAt = old;
        await fork.flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Job, first, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const cleaned = cleaner.runOnce();
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
                        .execute('select 1 from "job" where "id" = ? for update nowait', [second]);
                },
            },
        );

        await holding;

        if (waitError !== null) {
            throw waitError;
        }

        await cleaned;
        assert.equal(await exists(first), false);
        assert.equal(await exists(second), false);
    });
});
