import { LockMode } from "@mikro-orm/core";
import { Job } from "../../entity/Job.js";
import { appConfig } from "../../util/app-config.js";
import { logger } from "../../util/logger.js";
import { instantAgo } from "../../util/time.js";
import { IntervalTask } from "../loop.js";
import { abortableFork, backoffBetweenBatches } from "./util.js";

const config = appConfig.worker.rescuer;

export class JobRescuer extends IntervalTask {
    public constructor() {
        super({ interval: config.interval, failureMessage: "Failed to rescue jobs" });
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        const rescueThreshold = instantAgo(config.rescueAfter);
        let done = false;

        while (!done) {
            done = await abortableFork(signal).transactional(async (em) => {
                const jobs = await em.find(
                    Job,
                    {
                        attemptedAt: { $lt: rescueThreshold },
                        state: "running",
                    },
                    {
                        limit: config.limit,
                        lockMode: LockMode.PESSIMISTIC_WRITE,
                        orderBy: { id: "asc" },
                    },
                );

                if (jobs.length === 0) {
                    return true;
                }

                let jobsAvailable = false;

                for (const job of jobs) {
                    job.lastError = "A worker stopped while running this job";

                    if (job.attempt >= appConfig.worker.runtime.maxAttempts) {
                        logger.warn("Job exceeded max attempts, discarding");
                        job.state = "discarded";
                        job.finalizedAt = Temporal.Now.instant();
                    } else {
                        jobsAvailable = true;
                        job.state = "available";
                    }
                }

                em.persist(jobs);

                if (jobsAvailable) {
                    await em.execute("NOTIFY jobs_available");
                }

                return jobs.length < config.limit;
            });

            if (!(done || (await backoffBetweenBatches(signal)))) {
                return;
            }
        }
    }
}
