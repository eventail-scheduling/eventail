import { LockMode } from "@mikro-orm/core";
import { Job } from "../../entity/Job.js";
import { appConfig } from "../../util/app-config.js";
import { instantAgo } from "../../util/time.js";
import { IntervalTask } from "../loop.js";
import { abortableFork } from "./util.js";

const config = appConfig.worker.cleaner;

export class JobCleaner extends IntervalTask {
    public constructor() {
        super({ interval: config.interval, failureMessage: "Failed to delete jobs" });
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        const canceledThreshold = instantAgo(config.canceledJobRetentionPeriod);
        const completedThreshold = instantAgo(config.completedJobRetentionPeriod);
        const discardedThreshold = instantAgo(config.discardedJobRetentionPeriod);

        await abortableFork(signal).transactional(async (em) => {
            // Locked in id order first, as the purge, the scheduler and the
            // rescuer lock jobs: a delete takes its rows in whatever order its
            // plan scans them.
            const expired = await em.find(
                Job,
                {
                    $or: [
                        {
                            state: "canceled",
                            finalizedAt: { $lt: canceledThreshold },
                        },
                        {
                            state: "completed",
                            finalizedAt: { $lt: completedThreshold },
                        },
                        {
                            state: "discarded",
                            finalizedAt: { $lt: discardedThreshold },
                        },
                    ],
                },
                { fields: ["id"], lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
            );

            if (expired.length > 0) {
                await em.nativeDelete(Job, { id: { $in: expired.map((job) => job.id) } });
            }
        });
    }
}
