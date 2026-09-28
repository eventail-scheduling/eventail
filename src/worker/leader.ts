import type { Client as PostgresClient } from "pg";
import { appConfig } from "../util/app-config.js";
import { logger } from "../util/logger.js";
import { sleep } from "../util/time.js";
import { BackgroundLoop } from "./loop.js";
import { JobCleaner } from "./maintenance/cleaner.js";
import { FilePruner } from "./maintenance/file-pruner.js";
import { InviteSweeper } from "./maintenance/invite-sweeper.js";
import { JobRescuer } from "./maintenance/rescuer.js";
import { JobScheduler } from "./maintenance/scheduler.js";
import { UserSweeper } from "./maintenance/user-sweeper.js";

// hashtext() is a Postgres internal that can change between major versions;
// only ever compared against itself on one server.
const LOCK_NAME = "worker-leader-election";

const config = appConfig.worker.leader;

export type MaintenanceTask = {
    start: () => void;
    stop: () => Promise<void>;
};

const defaultTasks = (): MaintenanceTask[] => [
    new JobScheduler(),
    new JobCleaner(),
    new JobRescuer(),
    new InviteSweeper(),
    new UserSweeper(),
    new FilePruner(),
];

type ElectionResult = {
    isLeader: boolean;
    leaderChange: Promise<void>;
};

type WorkerLeaderOptions = {
    tasks?: MaintenanceTask[];
    /** How long a node that lost the election waits before trying again. */
    electionInterval?: Temporal.Duration;
    /** How often the leader confirms it still holds the lock. */
    pollInterval?: Temporal.Duration;
};

export class WorkerLeader extends BackgroundLoop {
    private readonly client: PostgresClient;
    private readonly tasks: MaintenanceTask[];
    private readonly electionInterval: Temporal.Duration;
    private readonly pollInterval: Temporal.Duration;

    public constructor(client: PostgresClient, options: WorkerLeaderOptions = {}) {
        super();
        this.client = client;
        this.tasks = options.tasks ?? defaultTasks();
        this.electionInterval = options.electionInterval ?? config.electionInterval;
        this.pollInterval = options.pollInterval ?? config.pollInterval;
    }

    protected async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            const { isLeader, leaderChange } = await this.runElection(signal);

            if (isLeader) {
                for (const task of this.tasks) {
                    task.start();
                }

                await leaderChange;
                await this.relinquish();
            }

            await sleep(this.electionInterval.total("milliseconds"), signal);
        }
    }

    private async relinquish(): Promise<void> {
        // Settled rather than all: one task failing to stop must not skip the
        // others, nor leave the lock held for the lifetime of the connection.
        const results = await Promise.allSettled(this.tasks.map((task) => task.stop()));

        for (const result of results) {
            if (result.status === "rejected") {
                logger.error("Failed to stop a maintenance task", { error: result.reason });
            }
        }

        try {
            // Session advisory locks are counted; unlock until the lock is
            // fully released in case it was ever re-acquired.
            let released = true;

            while (released) {
                const result = await this.client.query<{ released: boolean }>(
                    `SELECT pg_advisory_unlock(0, hashtext('${LOCK_NAME}')) AS released`,
                );
                released = result.rows[0]?.released ?? false;
            }

            logger.info("Released leadership lock");
        } catch (error) {
            logger.warn("Failed to release advisory lock", { error });
        }
    }

    private async runElection(signal: AbortSignal): Promise<ElectionResult> {
        try {
            const result = await this.client.query<{
                acquired: boolean;
            }>(`SELECT pg_try_advisory_lock(0, hashtext('${LOCK_NAME}')) AS acquired`);

            if (result.rows.length === 0 || !result.rows[0].acquired) {
                logger.debug("Failed to become leader");
                return {
                    isLeader: false,
                    leaderChange: Promise.resolve(),
                };
            }
        } catch (error) {
            logger.error("Election error", { error });
            return {
                isLeader: false,
                leaderChange: Promise.resolve(),
            };
        }

        logger.info("Became new leader");

        const leaderChange = (async () => {
            while (!signal.aborted) {
                await sleep(this.pollInterval.total("milliseconds"), signal);

                if (signal.aborted) {
                    return;
                }

                try {
                    // objsubid = 2 marks the two-argument advisory-lock form.
                    const result = await this.client.query<{
                        lock_count: number;
                    }>(`
                        SELECT COUNT(*)::int AS lock_count
                        FROM pg_locks
                        WHERE pid = pg_backend_pid()
                        AND locktype = 'advisory'
                        AND classid = 0
                        AND objid::int = hashtext('${LOCK_NAME}')
                        AND objsubid = 2
                     `);

                    if (result.rows.length === 0 || result.rows[0].lock_count === 0) {
                        logger.warn("Lost advisory lock, stepping down");
                        return;
                    }
                } catch (error) {
                    // A failed query doesn't prove the lock is gone, and
                    // stepping down would pause maintenance cluster-wide.
                    // Re-check next round.
                    logger.error("Failed while checking leadership status", { error });
                }
            }
        })();

        return {
            isLeader: true,
            leaderChange,
        };
    }
}
