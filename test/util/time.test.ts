import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { sleep, withTimeout } from "../../src/util/time.js";

const elapsedMs = async (run: () => Promise<void>): Promise<number> => {
    const startedAt = process.hrtime.bigint();
    await run();

    return Number(process.hrtime.bigint() - startedAt) / 1e6;
};

describe("sleep", () => {
    it("waits for the requested duration", async () => {
        const elapsed = await elapsedMs(() => sleep(50));

        assert.ok(elapsed >= 45, `resolved after ${elapsed.toString()}ms`);
    });

    it("resolves at once when the signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        const elapsed = await elapsedMs(() => sleep(60_000, controller.signal));

        assert.ok(elapsed < 1_000, `resolved after ${elapsed.toString()}ms`);
    });

    it("resolves early when the signal aborts while it waits", async () => {
        const controller = new AbortController();

        const elapsed = await elapsedMs(async () => {
            const pending = sleep(60_000, controller.signal);
            controller.abort();
            await pending;
        });

        assert.ok(elapsed < 1_000, `resolved after ${elapsed.toString()}ms`);
    });

    it("leaves no abort listener behind once it resolves", async () => {
        const controller = new AbortController();
        await sleep(1, controller.signal);

        // Long-running loops sleep on one signal over and over, so a listener
        // per call would accumulate for the lifetime of the process.
        assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
});

describe("withTimeout", () => {
    it("reports the work finishing in time", async () => {
        assert.equal(await withTimeout(sleep(1), 60_000), true);
    });

    it("reports the wait running out", async () => {
        // The work outlives the test, and withTimeout deliberately leaves it
        // running, so the signal is the only thing that can clear its timer.
        // Without it the timer holds the worker open for its full duration.
        const controller = new AbortController();

        try {
            assert.equal(await withTimeout(sleep(60_000, controller.signal), 20), false);
        } finally {
            controller.abort();
        }
    });

    it("gives up waiting without disturbing the work", async () => {
        let finished = false;
        const work = sleep(80).then(() => {
            finished = true;
        });

        assert.equal(await withTimeout(work, 20), false);
        assert.equal(finished, false);

        await work;
        assert.equal(finished, true);
    });

    it("passes a failure through rather than reporting a timeout", async () => {
        const work = Promise.reject(new Error("work failed"));

        await assert.rejects(() => withTimeout(work, 60_000), /work failed/);
    });

    it("leaves no timer behind once the work wins", async () => {
        const countTimers = () =>
            process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

        const before = countTimers();
        await withTimeout(sleep(1), 60_000);

        assert.equal(countTimers(), before);
    });
});
