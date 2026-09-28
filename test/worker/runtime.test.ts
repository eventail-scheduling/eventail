import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { Job } from "../../src/entity/Job.js";
import { appConfig } from "../../src/util/app-config.js";
import { em } from "../../src/util/mikro-orm.js";
import { sleep, withTimeout } from "../../src/util/time.js";
import { assertConcurrencyFitsPool } from "../../src/worker/config-checks.js";
import { type MaintenanceTask, WorkerLeader } from "../../src/worker/leader.js";
import { JobProcessor } from "../../src/worker/processor.js";
import { WorkerRuntime } from "../../src/worker/runtime.js";
import { connectDirectly, waitFor } from "../setup/pg.js";

/**
 * Counts holders across the whole database rather than one backend.
 *
 * That is what lets it see a lock taken by the runtime's own connection.
 */
const countLockHolders = async (observer: pg.Client): Promise<number> => {
    const result = await observer.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count
        FROM pg_locks
        WHERE locktype = 'advisory'
        AND classid = 0
        AND objid::int = hashtext('worker-leader-election')
        AND objsubid = 2
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    `);

    return result.rows[0].count;
};

/** Claims nothing, so `passes` counts fallback polls with the database out of the picture. */
class IdleProcessor extends JobProcessor {
    public passes = 0;
    public stopped = false;

    public trigger(): void {
        this.passes += 1;
    }

    public stop(): Promise<void> {
        this.stopped = true;

        return Promise.resolve();
    }
}

describe("worker runtime", () => {
    it("drains the processor and gives up leadership when stopped", async () => {
        const observer = await connectDirectly();
        const processor = new IdleProcessor();
        // A real leader would start all six maintenance tasks against the test
        // database; this one only records that it was shut down.
        const stoppedTasks: string[] = [];
        const task: MaintenanceTask = {
            start: () => {
                stoppedTasks.length = 0;
            },
            stop: () => {
                stoppedTasks.push("stopped");

                return Promise.resolve();
            },
        };

        const runtime = new WorkerRuntime({
            processor,
            createLeader: (client) => new WorkerLeader(client, { tasks: [task] }),
        });
        runtime.start();

        try {
            assert.ok(
                await waitFor(async () => (await countLockHolders(observer)) === 1),
                "the runtime never took leadership",
            );
            assert.ok(processor.passes > 0, "the fallback poll never ran");

            await runtime.stop();

            assert.ok(processor.stopped);
            // Ending the connection would drop the lock on its own, so the
            // task is what proves the leader was shut down rather than cut off.
            assert.deepEqual(stoppedTasks, ["stopped"]);
            assert.equal(await countLockHolders(observer), 0);

            // A reconnect timer outliving stop() would bring a fresh leader
            // up after shutdown.
            await sleep(200);
            assert.equal(await countLockHolders(observer), 0);
        } finally {
            await runtime.stop();
            await observer.end();
        }
    });

    it("stops within the drain timeout while a job is stuck", async () => {
        const job = new Job({
            payload: {
                type: "send_email",
                recipient: "stuck@example.test",
                subject: "Stuck",
                template: "team-invite",
                variables: {},
            },
        });
        await em.fork().persist(job).flush();

        const reached = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const processor = new JobProcessor();
        processor.setConsumer("send_email", () => {
            reached.resolve();

            return held.promise;
        });

        // A real leader would run all six maintenance tasks against the test
        // database; the stub keeps the stop budget to the poll and the drain.
        const runtime = new WorkerRuntime({
            processor,
            createLeader: (client) => new WorkerLeader(client, { tasks: [] }),
        });
        const originalDrainTimeout = appConfig.worker.runtime.drainTimeout;

        try {
            appConfig.worker.runtime.drainTimeout = Temporal.Duration.from({ seconds: 1 });
            runtime.start();
            assert.equal(await withTimeout(reached.promise, 5000), true);

            assert.equal(await withTimeout(runtime.stop(), 5000), true);
        } finally {
            appConfig.worker.runtime.drainTimeout = originalDrainTimeout;
            held.resolve();
            await processor.stop();
            await runtime.stop();
        }
    });
});

describe("assertConcurrencyFitsPool", () => {
    it("accepts a concurrency the pool can carry with headroom", () => {
        assert.doesNotThrow(() => assertConcurrencyFitsPool(8, 10));
    });

    it("rejects a concurrency that leaves no headroom", () => {
        assert.throws(() => assertConcurrencyFitsPool(9, 10), /pool/);
    });
});
