import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { sleep } from "../../src/util/time.js";
import { type MaintenanceTask, WorkerLeader } from "../../src/worker/leader.js";
import { connectDirectly, waitFor } from "../setup/pg.js";

/**
 * Says whether this connection holds the leader election's advisory lock.
 *
 * Advisory locks carry the database oid, so test workers on separate clones
 * never contend for it.
 */
const holdsLock = async (client: pg.Client): Promise<boolean> => {
    const result = await client.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count
        FROM pg_locks
        WHERE pid = pg_backend_pid()
        AND locktype = 'advisory'
        AND classid = 0
        AND objid::int = hashtext('worker-leader-election')
        AND objsubid = 2
    `);

    return result.rows[0].count > 0;
};

const waitForLock = (client: pg.Client): Promise<boolean> => waitFor(() => holdsLock(client));

describe("job leader", () => {
    it("stops its tasks before it releases the lock", async () => {
        const client = await connectDirectly();
        const events: string[] = [];
        const task: MaintenanceTask = {
            start: () => {
                events.push("started");
            },
            stop: async () => {
                events.push(`stopped, holding lock: ${(await holdsLock(client)).toString()}`);
            },
        };

        const leader = new WorkerLeader(client, { tasks: [task] });
        leader.start();

        try {
            assert.ok(await waitForLock(client), "never became leader");
            assert.deepEqual(events, ["started"]);

            await leader.stop();

            // A successor that acquired the lock mid-handover would run
            // maintenance alongside this node's still-running tasks.
            assert.deepEqual(events, ["started", "stopped, holding lock: true"]);
            assert.equal(await holdsLock(client), false);
        } finally {
            await leader.stop();
            await client.end();
        }
    });

    it("stands its tasks down when it loses the lock", async () => {
        const client = await connectDirectly();
        const events: string[] = [];
        const task: MaintenanceTask = {
            start: () => {
                events.push("started");
            },
            stop: () => {
                events.push("stopped");

                return Promise.resolve();
            },
        };

        const leader = new WorkerLeader(client, {
            tasks: [task],
            // Long enough that the node cannot win a second term before the
            // assertions run, so the event list stays readable.
            electionInterval: Temporal.Duration.from({ minutes: 1 }),
            pollInterval: Temporal.Duration.from({ milliseconds: 20 }),
        });
        leader.start();

        try {
            assert.ok(await waitForLock(client), "never became leader");
            assert.deepEqual(events, ["started"]);

            // Releasing behind the leader's back is what its poll exists to
            // notice; a node that kept running maintenance here would compete
            // with whoever took the lock next.
            await client.query("SELECT pg_advisory_unlock(0, hashtext('worker-leader-election'))");

            assert.ok(
                await waitFor(() => events.includes("stopped")),
                "never stood its tasks down",
            );
            assert.deepEqual(events, ["started", "stopped"]);
        } finally {
            await leader.stop();
            await client.end();
        }
    });

    it("releases the lock even when a task fails to stop", async () => {
        const client = await connectDirectly();
        let started = false;
        const task: MaintenanceTask = {
            start: () => {
                started = true;
            },
            stop: () => Promise.reject(new Error("task refused to stop")),
        };

        const leader = new WorkerLeader(client, { tasks: [task] });
        leader.start();

        try {
            assert.ok(await waitForLock(client), "never became leader");
            assert.ok(started);

            await leader.stop();

            // The lock is session scoped, so a task throwing on the way out
            // would otherwise leave it held for the life of the connection and
            // pause maintenance cluster-wide.
            assert.equal(await holdsLock(client), false);
        } finally {
            await leader.stop();
            await client.end();
        }
    });

    it("elects exactly one leader among two contenders", async () => {
        const [firstClient, secondClient] = await Promise.all([
            connectDirectly(),
            connectDirectly(),
        ]);
        const first = new WorkerLeader(firstClient, { tasks: [] });
        const second = new WorkerLeader(secondClient, { tasks: [] });

        try {
            first.start();
            assert.ok(await waitForLock(firstClient), "the first contender never became leader");

            second.start();
            await sleep(200);

            assert.equal(await holdsLock(secondClient), false);
            assert.equal(await holdsLock(firstClient), true);

            await first.stop();
            assert.equal(await holdsLock(firstClient), false);
        } finally {
            await Promise.all([first.stop(), second.stop()]);
            await Promise.all([firstClient.end(), secondClient.end()]);
        }
    });
});
