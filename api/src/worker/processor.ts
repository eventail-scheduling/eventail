import { type EntityManager, LockMode } from "@mikro-orm/core";
import { Job, type JobPayload, type JobType } from "../entity/Job.js";
import { appConfig } from "../util/app-config.js";
import { logger } from "../util/logger.js";
import { em } from "../util/mikro-orm.js";
import { processAvatarJobConsumer } from "./consumer/avatar.js";
import { sendEmailJobConsumer } from "./consumer/email.js";
import { processTeaserImageJobConsumer } from "./consumer/teaser-image.js";

type JobOutcome = Pick<Job, "state" | "lastError"> &
    Partial<Pick<Job, "finalizedAt" | "scheduledAt">>;

export type JobConsumer<T extends JobType> = (payload: JobPayload & { type: T }) => Promise<void>;

/**
 * Thrown by consumers for failures that no retry can fix.
 *
 * The job is discarded immediately instead of exhausting its attempts.
 */
export class UnrecoverableJobError extends Error {
    public override readonly name = "UnrecoverableJobError";
}

const config = appConfig.worker.runtime;

const LAST_ERROR_MAX_LENGTH = 2000;

/**
 * Names a thrown value without throwing itself.
 *
 * `String()` on an object with a null prototype raises, and this runs inside
 * the catch that decides the job's outcome: a throw here would escape into the
 * "could not record a job outcome" path and leave the row running.
 */
const describeThrown = (value: unknown): string => {
    // A connection to a name with more than one address fails as an
    // AggregateError with an empty message, the reasons sitting in `errors`.
    // Those are described one level deep, since an aggregate can hold itself.
    if (value instanceof AggregateError && Array.isArray(value.errors)) {
        const reasons = value.errors.map((inner: unknown) =>
            inner instanceof Error ? `${inner.name}: ${inner.message}` : describeThrown(inner),
        );

        return `${value.name}: ${[value.message, ...reasons].filter((part) => part !== "").join("; ")}`;
    }

    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }

    try {
        return String(value);
    } catch {
        return "An error that could not be described";
    }
};

/**
 * Reduces a thrown value to a bounded description for the job row.
 *
 * The cause is followed because the wrapper usually carries the category and
 * the cause carries the detail: a render failure reads "Failed to render email
 * template" and only its cause names the variable that was missing.
 *
 * Bounded because the column is `text`, so a driver error quoting a whole
 * response body would be stored whole and then read by an operator page. The
 * logs keep the full error and its stack.
 */
const describeJobError = (error: unknown): string => {
    const described = describeThrown(error);
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : null;
    const full = cause === null ? described : `${described}: ${describeThrown(cause)}`;

    return full.length > LAST_ERROR_MAX_LENGTH
        ? `${full.slice(0, LAST_ERROR_MAX_LENGTH - 1)}\u2026`
        : full;
};

export class JobProcessor {
    private consumers = new Map<JobType, JobConsumer<JobType>>();
    private readonly concurrency: number;
    private readonly loops = new Set<Promise<void>>();
    private notificationPending = false;
    private stopping = false;

    public constructor(concurrency = 1) {
        this.concurrency = concurrency;
    }

    public static default(concurrency?: number): JobProcessor {
        const processor = new JobProcessor(concurrency);
        processor.setConsumer("send_email", sendEmailJobConsumer);
        processor.setConsumer("process_teaser_image", processTeaserImageJobConsumer);
        processor.setConsumer("process_avatar", processAvatarJobConsumer);

        return processor;
    }

    public setConsumer<T extends JobType>(type: T, consumer: JobConsumer<T>): void {
        this.consumers.set(type, consumer as JobConsumer<JobType>);
    }

    /** Starts a loop, or queues exactly one more pass when every loop is busy. */
    public trigger(): void {
        if (this.stopping) {
            return;
        }

        if (this.loops.size >= this.concurrency) {
            this.notificationPending = true;
            return;
        }

        void this.startLoop();
    }

    /**
     * Callers landing on running loops join them instead of starting more.
     *
     * Public as a test seam; production reaches the loops through trigger().
     */
    public processJobs(): Promise<void> {
        if (!this.stopping && this.loops.size === 0) {
            return this.startLoop();
        }

        return Promise.all([...this.loops]).then(() => undefined);
    }

    /**
     * Stops claiming jobs and waits for the running ones rather than abandoning them.
     *
     * Their consumers may have already sent the mail, and only the outcome
     * written after them records that. Terminal, since the only caller is
     * shutdown.
     */
    public async stop(): Promise<void> {
        this.stopping = true;
        await Promise.all([...this.loops]);
    }

    private startLoop(): Promise<void> {
        const loop = this.claimAndRun().finally(() => {
            this.loops.delete(loop);

            // A notification landing between a loop's empty fetch and this
            // removal saw every loop busy and parked itself; without the
            // re-check it would wait behind a busy sibling's whole job, or
            // for the fallback interval. Consuming the flag bounds it: each
            // parked notification buys one restart, and a down database sends
            // no new triggers.
            if (this.notificationPending && !this.stopping && this.loops.size < this.concurrency) {
                this.notificationPending = false;
                void this.startLoop();
            }
        });

        this.loops.add(loop);
        return loop;
    }

    /**
     * Clears the parked wakeup only on the last loop out.
     *
     * On an error exit it stays for a surviving sibling to consume. The last
     * loop clears it because its own exit re-check would otherwise hot-loop
     * restarts against a database that is down.
     */
    private clearPendingOnLastLoop(): void {
        if (this.loops.size <= 1) {
            this.notificationPending = false;
        }
    }

    /**
     * Starts another loop unless the processor is stopping or already at its concurrency.
     *
     * Called on a successful claim, since finding work suggests there may be
     * more. Another loop drains it in parallel instead of behind this loop's
     * job. A wrong guess costs one empty fetch.
     */
    private maybeGrow(): void {
        if (!this.stopping && this.loops.size < this.concurrency) {
            void this.startLoop();
        }
    }

    /**
     * Runs claimed jobs one at a time, each to its recorded outcome.
     *
     * Protected as a test seam; production code reaches it through the loops.
     */
    protected async claimAndRun(): Promise<void> {
        const localEm = em.fork();

        while (!this.stopping) {
            let jobs: Job[];

            try {
                jobs = await this.fetchJobs(localEm);
            } catch (error) {
                logger.error("Could not fetch jobs from database", { error });
                this.clearPendingOnLastLoop();
                return;
            }

            if (jobs.length < 1) {
                if (this.notificationPending) {
                    this.notificationPending = false;
                    continue;
                }

                return;
            }

            this.maybeGrow();

            for (const job of jobs) {
                try {
                    await this.runJob(localEm, job);
                } catch (error) {
                    // runJob catches what a consumer throws, so reaching here
                    // means recording the outcome itself failed. Shutdown
                    // awaits this pass, and a rejection would take the rest of
                    // the shutdown down with it; the job stays running and the
                    // rescuer reclaims it.
                    logger.error("Could not record a job outcome", { error });
                    this.clearPendingOnLastLoop();
                    return;
                }
            }

            // The fork lives as long as the loop; without this every
            // processed job stays managed and each claim transaction
            // re-registers the whole map, quadratic over a sustained backlog.
            localEm.clear();
        }
    }

    private async fetchJobs(em: EntityManager): Promise<Job[]> {
        return await em.transactional(async (em) => {
            const now = Temporal.Now.instant();
            // Every way into "available" makes the job due, so no clock is
            // compared here: scheduledAt was stamped by whichever machine wrote
            // the job, and one lagging worker would skip a fresh job until the
            // fallback poll.
            const jobs = await em.find(
                Job,
                { state: "available" },
                {
                    limit: 1,
                    orderBy: { scheduledAt: "asc" },
                    lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
                },
            );

            if (jobs.length === 0) {
                return [];
            }

            for (const job of jobs) {
                job.state = "running";
                job.attempt += 1;
                job.attemptedAt = now;
            }

            em.persist(jobs);
            return jobs;
        });
    }

    /**
     * Runs a job's consumer and settles it as completed, discarded or retryable.
     *
     * Protected as a test seam; nothing outside the claim loop calls it.
     */
    protected async runJob(em: EntityManager, job: Job): Promise<void> {
        const consumer = this.consumers.get(job.payload.type);

        if (!consumer) {
            logger.warn(`No consumer registered for ${job.payload.type}`);
            await this.settle(em, job, {
                state: "discarded",
                lastError: `No consumer registered for ${job.payload.type}`,
                finalizedAt: Temporal.Now.instant(),
            });
            return;
        }

        try {
            await consumer(job.payload);
        } catch (error) {
            logger.error("Failed to perform job", { error });
            const lastError = describeJobError(error);

            if (error instanceof UnrecoverableJobError) {
                await this.settle(em, job, {
                    state: "discarded",
                    lastError,
                    finalizedAt: Temporal.Now.instant(),
                });
                return;
            }

            if (job.attempt >= config.maxAttempts) {
                logger.warn("Job exceeded max attempts, discarding");
                await this.settle(em, job, {
                    state: "discarded",
                    lastError,
                    finalizedAt: Temporal.Now.instant(),
                });
                return;
            }

            // Rounded because Duration components must be integers.
            const backoff = Math.round(job.attempt ** 4 * (1 + (Math.random() * 0.2 - 0.1)));
            await this.settle(em, job, {
                state: "retryable",
                lastError,
                scheduledAt: Temporal.Now.instant().add({ seconds: backoff }),
            });
            return;
        }

        await this.settle(em, job, {
            state: "completed",
            lastError: null,
            finalizedAt: Temporal.Now.instant(),
        });
    }

    /**
     * Records how a job ended, unless the row stopped being this claim's while it ran.
     *
     * The rescuer hands a job back once it has been running past a threshold,
     * which a slow worker can outlive, and an operator may cancel or retry it
     * from there; an unconditional write would undo that. Written natively,
     * because an update through the entity is keyed on its id alone and cannot
     * carry that condition.
     */
    private async settle(em: EntityManager, job: Job, outcome: JobOutcome): Promise<void> {
        const recorded = await em.nativeUpdate(
            Job,
            { id: job.id, state: "running", attempt: job.attempt, attemptedAt: job.attemptedAt },
            outcome,
        );

        if (recorded === 0) {
            logger.warn("A job was taken back while it ran, so its outcome was not recorded", {
                jobId: job.id,
            });
        }
    }
}
