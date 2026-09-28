import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { sleep } from "../../../src/util/time.js";
import { abortableFork } from "../../../src/worker/maintenance/util.js";
import { connectDirectly } from "../../setup/pg.js";

const PROBE = "abortable_fork_probe";

const countRunningProbes = async (observer: pg.Client): Promise<number> => {
    const result = await observer.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
         WHERE state = 'active'
         AND pid <> pg_backend_pid()
         AND query LIKE '%${PROBE}%'`,
    );

    return result.rows[0].count;
};

const waitForProbes = async (observer: pg.Client, expected: number): Promise<boolean> => {
    for (let attempt = 0; attempt < 60; ++attempt) {
        if ((await countRunningProbes(observer)) === expected) {
            return true;
        }

        await sleep(25);
    }

    return false;
};

describe("abortableFork", () => {
    it("cancels a query still running on the server when the signal aborts", async () => {
        const observer = await connectDirectly();
        const controller = new AbortController();

        try {
            const work = abortableFork(controller.signal).execute(`SELECT pg_sleep(5) AS ${PROBE}`);

            assert.ok(
                await waitForProbes(observer, 1),
                "the probe statement never reached the server",
            );

            controller.abort();
            await assert.rejects(() => work);

            // Abandoning the wait is the default and would leave the statement
            // running here for its full five seconds; canceling ends it.
            assert.ok(
                await waitForProbes(observer, 0),
                "the statement outlived the abort on the server",
            );
        } finally {
            await observer.end();
        }
    });

    it("leaves a query alone when nothing aborts", async () => {
        const rows = await abortableFork().execute<{ value: number }[]>("SELECT 1 AS value");

        assert.equal(rows[0].value, 1);
    });
});
