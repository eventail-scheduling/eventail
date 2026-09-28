import { LockMode } from "@mikro-orm/core";
import { Job } from "../../entity/Job.js";
import { appConfig } from "../../util/app-config.js";
import { IntervalTask } from "../loop.js";
import { abortableFork, backoffBetweenBatches } from "./util.js";

const config = appConfig.worker.scheduler;

export class JobScheduler extends IntervalTask {
    public constructor() {
        super({ interval: config.interval, failureMessage: "Failed to schedule jobs" });
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        // Only jobs already due: the processor claims whatever is available
        // without looking at scheduledAt, so promoting one that is merely due
        // soon would run it early.
        const now = Temporal.Now.instant();
        let done = false;

        while (!done) {
            done = await abortableFork(signal).transactional(async (em) => {
                const jobs = await em.find(
                    Job,
                    {
                        scheduledAt: { $lte: now },
                        state: { $in: ["scheduled", "retryable"] },
                    },
                    {
                        fields: ["id"],
                        limit: config.limit,
                        lockMode: LockMode.PESSIMISTIC_WRITE,
                        orderBy: { id: "asc" },
                    },
                );

                if (jobs.length === 0) {
                    return true;
                }

                await em.nativeUpdate(
                    Job,
                    { id: { $in: jobs.map((job) => job.id) } },
                    { state: "available" },
                );

                await em.execute("NOTIFY jobs_available");

                return jobs.length < config.limit;
            });

            if (!(done || (await backoffBetweenBatches(signal)))) {
                return;
            }
        }
    }
}
