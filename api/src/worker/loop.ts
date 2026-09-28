import { logger } from "../util/logger.js";
import { sleep } from "../util/time.js";

/**
 * Awaiting stop() means nothing of this loop is still running.
 *
 * start() refuses while a stop is in flight. Without both, a subclass would need
 * its own stale-loop guard against a second start() overlapping a draining loop.
 */
export abstract class BackgroundLoop {
    private controller: AbortController | null = null;
    private loopPromise: Promise<void> | null = null;
    private stopping: Promise<void> | null = null;

    public start(): void {
        if (this.controller || this.stopping) {
            return;
        }

        this.controller = new AbortController();
        this.loopPromise = this.run(this.controller.signal);
    }

    public async stop(): Promise<void> {
        // Concurrent callers share one drain; capturing the fields instead
        // would let the second caller return before the loop had left.
        this.stopping ??= this.drain();
        await this.stopping;
    }

    protected abstract run(signal: AbortSignal): Promise<void>;

    private async drain(): Promise<void> {
        this.controller?.abort();

        try {
            await this.loopPromise;
        } finally {
            this.controller = null;
            this.loopPromise = null;
            this.stopping = null;
        }
    }
}

type IntervalTaskOptions = {
    interval: Temporal.Duration;
    failureMessage: string;
};

export abstract class IntervalTask extends BackgroundLoop {
    private readonly interval: Temporal.Duration;
    private readonly failureMessage: string;

    protected constructor(options: IntervalTaskOptions) {
        super();
        this.interval = options.interval;
        this.failureMessage = options.failureMessage;
    }

    protected async run(signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            try {
                await this.runOnce(signal);
            } catch (error) {
                logger.error(this.failureMessage, { error });
            }

            await sleep(this.interval.total("milliseconds"), signal);
        }
    }

    /**
     * Subclasses that a test drives directly widen this to public.
     *
     * Production code never reaches it any other way than the loop above.
     */
    protected abstract runOnce(signal: AbortSignal): Promise<void>;
}
