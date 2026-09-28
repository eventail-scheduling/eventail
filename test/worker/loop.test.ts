import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sleep } from "../../src/util/time.js";
import { BackgroundLoop } from "../../src/worker/loop.js";

/**
 * A loop whose iteration the abort cannot cut short.
 *
 * The inner sleep deliberately ignores the signal, standing in for the
 * in-flight query an abort cannot cancel. That is the window in which a
 * careless stop() would report success while the loop is still running.
 */
class CountingLoop extends BackgroundLoop {
    public concurrent = 0;
    public peakConcurrent = 0;
    private iterations = 0;

    protected async run(signal: AbortSignal): Promise<void> {
        this.concurrent += 1;
        this.peakConcurrent = Math.max(this.peakConcurrent, this.concurrent);

        try {
            // The iteration ceiling only matters when a case fails: a loop this
            // class can no longer reach would otherwise run forever and stall
            // the runner instead of reporting the failure.
            while (!signal.aborted && this.iterations < 20) {
                this.iterations += 1;
                await sleep(30);
                await sleep(200, signal);
            }
        } finally {
            this.concurrent -= 1;
        }
    }
}

/**
 * Stops the loop after the assertions, even when one of them throws.
 *
 * A leaked loop sits in an unaborted sleep and stalls the whole runner rather
 * than failing here.
 */
const withLoop = async (assertions: (loop: CountingLoop) => Promise<void>): Promise<void> => {
    const loop = new CountingLoop();

    try {
        await assertions(loop);
    } finally {
        await loop.stop();
    }
};

const startAndReachWork = async (loop: CountingLoop): Promise<void> => {
    loop.start();
    await sleep(5);
};

describe("BackgroundLoop", () => {
    it("has left the loop by the time stop() resolves", async () => {
        await withLoop(async (loop) => {
            await startAndReachWork(loop);

            await loop.stop();

            assert.equal(loop.concurrent, 0);
        });
    });

    it("makes a second concurrent stop() wait for the same drain", async () => {
        await withLoop(async (loop) => {
            await startAndReachWork(loop);

            const first = loop.stop();
            const second = loop.stop();
            await second;

            assert.equal(loop.concurrent, 0, "the second stop() resolved while the loop still ran");
            await first;
        });
    });

    it("refuses to start a second loop while a stop is draining", async () => {
        await withLoop(async (loop) => {
            await startAndReachWork(loop);

            const stopping = loop.stop();
            loop.start();
            await stopping;

            assert.equal(loop.peakConcurrent, 1);
        });
    });

    it("runs one loop when started twice", async () => {
        await withLoop(async (loop) => {
            loop.start();
            loop.start();
            await sleep(5);

            assert.equal(loop.peakConcurrent, 1);
        });
    });

    it("starts again once a stop has fully drained", async () => {
        await withLoop(async (loop) => {
            await startAndReachWork(loop);
            await loop.stop();

            loop.start();
            await sleep(5);

            assert.equal(loop.concurrent, 1);
        });
    });

    it("does nothing when stopped before it ever started", async () => {
        await withLoop(async (loop) => {
            await loop.stop();

            assert.equal(loop.peakConcurrent, 0);
        });
    });

    it("refuses to start while a stop it never needed is still settling", async () => {
        await withLoop(async (loop) => {
            // stop() on a never-started loop still yields once, on its await of
            // a null loop promise. A start() slipping through that window would
            // be orphaned: the drain's cleanup clears the fields behind it, so
            // nothing could ever stop the loop it created.
            const stopping = loop.stop();
            loop.start();
            await stopping;

            assert.equal(loop.concurrent, 0);
        });
    });
});
