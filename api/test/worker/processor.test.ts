import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAfter } from "temporal-extra";
import { Job, type SendEmailJobPayload } from "../../src/entity/Job.js";
import { appConfig } from "../../src/util/app-config.js";
import { em } from "../../src/util/mikro-orm.js";
import { sleep, withTimeout } from "../../src/util/time.js";
import { JobProcessor, UnrecoverableJobError } from "../../src/worker/processor.js";
import { buildEmailPayload } from "../setup/jobs.js";

const { maxAttempts } = appConfig.worker.runtime;

const buildPayload = (subject: string): SendEmailJobPayload =>
    buildEmailPayload("queue@example.test", subject);

type JobOverrides = {
    scheduledAt?: Temporal.Instant;
    attempt?: number;
};

const buildJob = (subject: string, overrides: JobOverrides = {}): Job => {
    // Passing scheduledAt to the constructor marks the job as "scheduled", so
    // the processor would never see it; assign it afterwards instead.
    const job = new Job({ payload: buildPayload(subject) });

    if (overrides.scheduledAt) {
        job.scheduledAt = overrides.scheduledAt;
    }

    if (overrides.attempt !== undefined) {
        job.attempt = overrides.attempt;
    }

    return job;
};

const persistJobs = async (jobs: Job[]): Promise<void> => {
    await em.fork().persist(jobs).flush();
};

const reloadJob = async (job: Job): Promise<Job> => await em.fork().findOneOrFail(Job, job.id);

type RecordingProcessor = {
    processor: JobProcessor;
    processed: string[];
};

const createRecordingProcessor = (
    onJob: (subject: string) => Promise<void> = () => Promise.resolve(),
    concurrency = 1,
): RecordingProcessor => {
    const processed: string[] = [];
    const processor = new JobProcessor(concurrency);

    processor.setConsumer("send_email", (payload) => {
        processed.push(payload.subject);
        return onJob(payload.subject);
    });

    return { processor, processed };
};

const failRecoverably = (): Promise<void> => Promise.reject(new Error("temporary failure"));

type Latch = {
    /** Resolves once a consumer has entered hold() and is waiting there. */
    reached: Promise<void>;
    hold: () => Promise<void>;
    release: () => void;
};

const createLatch = (): Latch => {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();

    return {
        reached: entered.promise,
        release: () => {
            held.resolve();
        },
        hold: async () => {
            entered.resolve();
            await held.promise;
        },
    };
};

describe("job processor", () => {
    it("runs due jobs in scheduled order", async () => {
        const now = Temporal.Now.instant();
        const first = buildJob("first", { scheduledAt: now.subtract({ seconds: 30 }) });
        const second = buildJob("second", { scheduledAt: now.subtract({ seconds: 20 }) });
        const third = buildJob("third", { scheduledAt: now.subtract({ seconds: 10 }) });

        // Persisted out of order so the assertion cannot pass on insertion order.
        await persistJobs([third, first, second]);

        const { processor, processed } = createRecordingProcessor();
        await processor.processJobs();

        assert.deepEqual(processed, ["first", "second", "third"]);

        for (const job of [first, second, third]) {
            const stored = await reloadJob(job);
            assert.equal(stored.state, "completed");
            assert.equal(stored.attempt, 1);
            assert.notEqual(stored.finalizedAt, null);
        }
    });

    it("discards a job on an unrecoverable failure", async () => {
        const job = buildJob("unrecoverable");
        await persistJobs([job]);

        const { processor, processed } = createRecordingProcessor(() =>
            Promise.reject(new UnrecoverableJobError("permanent failure")),
        );
        await processor.processJobs();

        assert.deepEqual(processed, ["unrecoverable"]);

        const stored = await reloadJob(job);
        assert.equal(stored.state, "discarded");
        assert.equal(stored.attempt, 1);
        assert.notEqual(stored.finalizedAt, null);
    });

    it("reschedules a job after a recoverable failure", async () => {
        const job = buildJob("recoverable");
        await persistJobs([job]);

        const beforeRun = Temporal.Now.instant();
        const { processor } = createRecordingProcessor(failRecoverably);
        await processor.processJobs();

        const stored = await reloadJob(job);
        assert.equal(stored.state, "retryable");
        assert.equal(stored.attempt, 1);
        assert.equal(stored.finalizedAt, null);
        assert.ok(isAfter(stored.scheduledAt, beforeRun));
    });

    it("discards a job that reaches the attempt ceiling", async () => {
        // The claim increments the attempt, so this run is the last allowed one.
        const job = buildJob("exhausted", { attempt: maxAttempts - 1 });
        await persistJobs([job]);

        const { processor } = createRecordingProcessor(failRecoverably);
        await processor.processJobs();

        const stored = await reloadJob(job);
        assert.equal(stored.state, "discarded");
        assert.equal(stored.attempt, maxAttempts);
        assert.notEqual(stored.finalizedAt, null);
    });

    it("discards a job without a registered consumer", async () => {
        const job = buildJob("unconsumed");
        await persistJobs([job]);

        const processor = new JobProcessor();
        await processor.processJobs();

        const stored = await reloadJob(job);
        assert.equal(stored.state, "discarded");
        assert.equal(stored.attempt, 1);
        assert.notEqual(stored.finalizedAt, null);
    });

    describe("the reason a job last failed", () => {
        const failWith =
            (error: unknown): (() => Promise<void>) =>
            () =>
                Promise.reject(error);

        const lastErrorAfter = async (onJob: () => Promise<void>): Promise<string | null> => {
            const job = buildJob("failing");
            await persistJobs([job]);

            const { processor } = createRecordingProcessor(onJob);
            await processor.processJobs();

            return (await reloadJob(job)).lastError;
        };

        // The wrapper names the category and only its cause the detail, such
        // as the variable a mail template was missing.
        it("follows the cause", async () => {
            const lastError = await lastErrorAfter(
                failWith(
                    new Error("Failed to render email template", {
                        cause: new Error("undefined variable: name"),
                    }),
                ),
            );

            assert.equal(
                lastError,
                "Error: Failed to render email template: Error: undefined variable: name",
            );
        });

        // A connection to a name with two addresses fails with an empty
        // message and the reasons inside.
        it("names every reason an AggregateError carries", async () => {
            const lastError = await lastErrorAfter(
                failWith(
                    new AggregateError([
                        new Error("connect ECONNREFUSED ::1:12005"),
                        new Error("connect ECONNREFUSED 127.0.0.1:12005"),
                    ]),
                ),
            );

            assert.equal(
                lastError,
                "AggregateError: Error: connect ECONNREFUSED ::1:12005; Error: connect ECONNREFUSED 127.0.0.1:12005",
            );
        });

        // Describing the failure runs where the job's outcome is decided, and a
        // throw there would leave the job running.
        it("describes an AggregateError that holds itself", async () => {
            const aggregate = new AggregateError([new Error("first")]);
            aggregate.errors.push(aggregate);

            const lastError = await lastErrorAfter(failWith(aggregate));

            assert.equal(lastError, "AggregateError: Error: first; AggregateError: ");
        });

        it("keeps a long reason to its bound", async () => {
            const lastError = await lastErrorAfter(failWith(new Error("x".repeat(5000))));

            assert.equal(lastError?.length, 2000);
            assert.ok(lastError?.endsWith("\u2026"));
        });

        it("clears it once the job completes", async () => {
            const job = buildJob("recovered");
            job.lastError = "Error: temporary failure";
            await persistJobs([job]);

            const { processor } = createRecordingProcessor();
            await processor.processJobs();

            assert.equal((await reloadJob(job)).lastError, null);
        });
    });

    // The rescuer can hand a job back while a slow worker still runs it, and
    // an operator can cancel it from there. The worker's outcome must not undo
    // that.
    it("leaves a job alone that was taken back while it ran", async () => {
        const job = buildJob("taken back");
        await persistJobs([job]);
        const latch = createLatch();
        const { processor } = createRecordingProcessor(latch.hold);

        const running = processor.processJobs();
        await latch.reached;
        await em
            .fork()
            .nativeUpdate(
                Job,
                { id: job.id },
                { state: "canceled", finalizedAt: Temporal.Now.instant() },
            );
        latch.release();
        await running;

        assert.equal((await reloadJob(job)).state, "canceled");
    });

    // A worker that stalls past the rescue finds its job claimed again by
    // another, and its late outcome must not settle that second run. One
    // re-claim per condition, since each alone would let the outcome through.
    describe("a job claimed again while it ran", () => {
        type Claim = {
            attempt: number;
            attemptedAt: Temporal.Instant;
        };

        type Reclaim = (claimed: Claim) => Claim;

        const settleAfterReclaim = async (reclaim: Reclaim): Promise<Job> => {
            const job = buildJob("claimed again");
            await persistJobs([job]);
            const latch = createLatch();
            const { processor } = createRecordingProcessor(latch.hold);

            const running = processor.processJobs();
            await latch.reached;
            const claimed = await reloadJob(job);
            assert.ok(claimed.attemptedAt !== null);
            await em.fork().nativeUpdate(
                Job,
                { id: job.id },
                {
                    state: "running",
                    ...reclaim({ attempt: claimed.attempt, attemptedAt: claimed.attemptedAt }),
                },
            );
            latch.release();
            await running;

            return reloadJob(job);
        };

        // An operator retry resets the attempt, so a fresh claim can carry the
        // same number with a later time.
        it("leaves a re-claim with the same attempt running", async () => {
            const stored = await settleAfterReclaim((claimed) => ({
                attempt: claimed.attempt,
                attemptedAt: Temporal.Now.instant().add({ seconds: 1 }),
            }));

            assert.equal(stored.state, "running");
        });

        it("leaves a re-claim at the next attempt running", async () => {
            const stored = await settleAfterReclaim((claimed) => ({
                attempt: claimed.attempt + 1,
                attemptedAt: claimed.attemptedAt,
            }));

            assert.equal(stored.state, "running");
        });
    });

    it("leaves jobs scheduled in the future untouched", async () => {
        const job = new Job({
            payload: buildPayload("future"),
            scheduledAt: Temporal.Now.instant().add({ hours: 1 }),
        });
        await persistJobs([job]);

        const { processor, processed } = createRecordingProcessor();
        await processor.processJobs();

        assert.deepEqual(processed, []);

        const stored = await reloadJob(job);
        assert.equal(stored.state, "scheduled");
        assert.equal(stored.attempt, 0);
        assert.equal(stored.attemptedAt, null);
    });

    // scheduledAt is stamped by whichever machine wrote the job, so a worker
    // whose clock lags would otherwise skip it until the fallback poll.
    it("claims an available job whose writer's clock ran ahead", async () => {
        const job = buildJob("ahead", {
            scheduledAt: Temporal.Now.instant().add({ seconds: 30 }),
        });
        await persistJobs([job]);

        const { processor, processed } = createRecordingProcessor();
        await processor.processJobs();

        assert.deepEqual(processed, ["ahead"]);
    });
    describe("stopping", () => {
        it("waits for the job in flight and records its outcome", async () => {
            const job = buildJob("drain-in-flight");
            await persistJobs([job]);

            const latch = createLatch();
            const { processor } = createRecordingProcessor(() => latch.hold());

            processor.trigger();
            await latch.reached;

            let stopped = false;
            const stopping = processor.stop().then(() => {
                stopped = true;
            });

            // Still inside the consumer, so a stop that did not wait would
            // leave the job stuck in running for the rescuer to find.
            await sleep(20);
            assert.equal(stopped, false);
            assert.equal((await reloadJob(job)).state, "running");

            latch.release();
            await stopping;

            assert.equal((await reloadJob(job)).state, "completed");
        });

        it("claims nothing further once it is stopping", async () => {
            const first = buildJob("drain-first");
            const second = buildJob("drain-second");
            await persistJobs([first, second]);

            const latch = createLatch();
            const { processor, processed } = createRecordingProcessor(() => latch.hold());

            processor.trigger();
            await latch.reached;

            const stopping = processor.stop();
            latch.release();
            await stopping;

            assert.deepEqual(processed, ["drain-first"]);
            assert.equal((await reloadJob(second)).state, "available");
        });

        it("ignores notifications once it is stopping", async () => {
            const job = buildJob("drain-ignored");
            await persistJobs([job]);

            const { processor, processed } = createRecordingProcessor();
            await processor.stop();

            processor.trigger();
            await sleep(20);

            assert.deepEqual(processed, []);
            assert.equal((await reloadJob(job)).state, "available");
        });

        it("survives a failure to record an outcome", async () => {
            const job = buildJob("drain-unrecordable");
            await persistJobs([job]);

            // runJob is where the outcome is flushed; replacing it wholesale is
            // that flush failing, which a rejection would otherwise let take the
            // whole shutdown with it.
            class UnrecordableProcessor extends JobProcessor {
                protected runJob(): Promise<void> {
                    return Promise.reject(new Error("could not write"));
                }
            }

            const processor = new UnrecordableProcessor();

            processor.trigger();
            await processor.stop();

            assert.equal((await reloadJob(job)).state, "running");
        });

        it("leaves the running job to the rescuer when the drain runs out of time", async () => {
            const job = buildJob("drain-timeout");
            await persistJobs([job]);

            const latch = createLatch();
            const { processor } = createRecordingProcessor(() => latch.hold());

            processor.trigger();
            await latch.reached;

            const drained = await withTimeout(processor.stop(), 50);

            assert.equal(drained, false);
            assert.equal((await reloadJob(job)).state, "running");

            latch.release();
            await processor.stop();
        });
    });

    describe("concurrency", () => {
        it("runs two jobs at once when the cap allows it", async () => {
            const first = buildJob("parallel-1");
            const second = buildJob("parallel-2");
            await persistJobs([first, second]);

            const latches = new Map([
                ["parallel-1", createLatch()],
                ["parallel-2", createLatch()],
            ]);
            const { processor } = createRecordingProcessor(
                (subject) => latches.get(subject)?.hold() ?? Promise.resolve(),
                2,
            );

            processor.trigger();

            // Both consumers waiting at their latch at the same time is the
            // overlap itself; a single loop can never get here, since the
            // first hold would block the second claim.
            const overlapped = await withTimeout(
                Promise.all([...latches.values()].map((latch) => latch.reached)),
                5000,
            );
            assert.equal(overlapped, true);

            for (const latch of latches.values()) {
                latch.release();
            }

            await processor.stop();
            assert.equal((await reloadJob(first)).state, "completed");
            assert.equal((await reloadJob(second)).state, "completed");
        });

        it("keeps jobs serial at a cap of one", async () => {
            // Backdated so the claim order is deterministic.
            const first = buildJob("serial-1", {
                scheduledAt: Temporal.Now.instant().subtract({ seconds: 1 }),
            });
            const second = buildJob("serial-2");
            await persistJobs([first, second]);

            const latches = new Map([
                ["serial-1", createLatch()],
                ["serial-2", createLatch()],
            ]);
            const { processor } = createRecordingProcessor(
                (subject) => latches.get(subject)?.hold() ?? Promise.resolve(),
            );

            processor.trigger();
            const firstLatch = latches.get("serial-1");
            const secondLatch = latches.get("serial-2");
            assert.ok(firstLatch && secondLatch);
            assert.equal(await withTimeout(firstLatch.reached, 5000), true);

            assert.equal(await withTimeout(secondLatch.reached, 1500), false);

            firstLatch.release();
            assert.equal(await withTimeout(secondLatch.reached, 5000), true);
            secondLatch.release();
            await processor.stop();
        });

        it("drains every loop on stop and records every outcome", async () => {
            const first = buildJob("drain-1");
            const second = buildJob("drain-2");
            await persistJobs([first, second]);

            const latches = new Map([
                ["drain-1", createLatch()],
                ["drain-2", createLatch()],
            ]);
            const { processor } = createRecordingProcessor(
                (subject) => latches.get(subject)?.hold() ?? Promise.resolve(),
                2,
            );

            processor.trigger();
            assert.equal(
                await withTimeout(
                    Promise.all([...latches.values()].map((latch) => latch.reached)),
                    5000,
                ),
                true,
            );

            const stopped = processor.stop();

            for (const latch of latches.values()) {
                latch.release();
            }

            await stopped;
            assert.equal((await reloadJob(first)).state, "completed");
            assert.equal((await reloadJob(second)).state, "completed");
        });

        it("serves a parked wakeup as soon as any loop exits", async () => {
            const blocker = buildJob("parked-blocker");
            const lateJob = buildJob("parked-late");
            await persistJobs([blocker]);

            const held = createLatch();
            const processedLate = Promise.withResolvers<void>();
            let armed = true;

            class ParkingProcessor extends JobProcessor {
                protected override async claimAndRun(): Promise<void> {
                    await super.claimAndRun();

                    // After this loop's empty fetch, while it still counts
                    // toward the cap and its sibling holds the blocker: a
                    // trigger here parks the flag with every slot looking
                    // busy.
                    if (armed) {
                        armed = false;
                        await persistJobs([lateJob]);
                        this.trigger();
                    }
                }
            }

            const processor = new ParkingProcessor(2);
            processor.setConsumer("send_email", (payload) => {
                if (payload.subject === "parked-blocker") {
                    return held.hold();
                }

                processedLate.resolve();

                return Promise.resolve();
            });

            processor.trigger();

            // The late job must complete while the blocker still holds its
            // loop: the parked wakeup is served by the exiting sibling's
            // re-check, not by the blocker finishing.
            assert.equal(await withTimeout(processedLate.promise, 5000), true);

            held.release();
            await processor.stop();
            assert.equal((await reloadJob(blocker)).state, "completed");
            assert.equal((await reloadJob(lateJob)).state, "completed");
        });

        it("serves a trigger that lands after the last fetch of a pass", async () => {
            const lateJob = buildJob("late-arrival");
            let armed = false;

            class RacingProcessor extends JobProcessor {
                protected override async claimAndRun(): Promise<void> {
                    await super.claimAndRun();

                    // This point is after the pass's empty fetch and pending
                    // check, before startLoop's finally removes the loop: the
                    // window a notification must not be lost in.
                    if (armed) {
                        armed = false;
                        await persistJobs([lateJob]);
                        this.trigger();
                    }
                }
            }

            const processed = Promise.withResolvers<void>();
            const processor = new RacingProcessor();
            processor.setConsumer("send_email", () => {
                processed.resolve();
                return Promise.resolve();
            });

            armed = true;
            await processor.processJobs();

            assert.equal(await withTimeout(processed.promise, 5000), true);
            await processor.stop();
            assert.equal((await reloadJob(lateJob)).state, "completed");
        });
    });
});
