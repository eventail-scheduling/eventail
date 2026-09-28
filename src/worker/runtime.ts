import pg from "pg";
import { appConfig } from "../util/app-config.js";
import { logger } from "../util/logger.js";
import { orm } from "../util/mikro-orm.js";
import { withTimeout } from "../util/time.js";
import { WorkerLeader } from "./leader.js";
import { IntervalTask } from "./loop.js";
import { JobProcessor } from "./processor.js";

const config = appConfig.worker.runtime;

/**
 * Covers the window where a notification is missed, or none was ever sent.
 *
 * A trigger rather than a join: awaiting the claim loops here would hold
 * stop() hostage to whatever job is in flight, since this task's own stop
 * waits out the join before the processor is ever told to stop, leaving the
 * drain timeout no chance to engage.
 */
class FallbackPoll extends IntervalTask {
    private readonly processor: JobProcessor;

    public constructor(processor: JobProcessor) {
        super({ interval: config.fallbackInterval, failureMessage: "Fallback job poll failed" });
        this.processor = processor;
    }

    protected runOnce(): Promise<void> {
        this.processor.trigger();

        return Promise.resolve();
    }
}

type WorkerRuntimeOptions = {
    processor?: JobProcessor;
    /** Claim loops for the default processor; ignored when one is supplied. */
    concurrency?: number;
    /** Called once per connection, since the lock is scoped to that session. */
    createLeader?: (client: pg.Client) => WorkerLeader;
};

/**
 * Owns the worker's Postgres connection and what hangs off it.
 *
 * That is the job notification listener, and the leader whose advisory lock is
 * session scoped to this same connection.
 */
export class WorkerRuntime {
    private readonly processor: JobProcessor;
    private readonly createLeader: (client: pg.Client) => WorkerLeader;
    private readonly fallbackPoll: FallbackPoll;
    private client: pg.Client | null = null;
    private leader: WorkerLeader | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private shuttingDown = false;

    public constructor(options: WorkerRuntimeOptions = {}) {
        this.processor = options.processor ?? JobProcessor.default(options.concurrency);
        this.createLeader = options.createLeader ?? ((client) => new WorkerLeader(client));
        this.fallbackPoll = new FallbackPoll(this.processor);
    }

    public start(): void {
        this.shuttingDown = false;
        void this.connect();
        this.fallbackPoll.start();
    }

    public async stop(): Promise<void> {
        this.shuttingDown = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        await this.fallbackPoll.stop();

        const drained = await withTimeout(
            this.processor.stop(),
            config.drainTimeout.total("milliseconds"),
        );

        if (!drained) {
            logger.warn("Gave up waiting on running jobs; the rescuer will reclaim them");
        }

        await this.stopLeader();
        await this.closeClient();
    }

    private async connect(): Promise<void> {
        if (this.client || this.shuttingDown) {
            return;
        }

        // Held locally because a stop() landing mid-connect nulls the field,
        // which would otherwise turn the next line into a confusing TypeError
        // reported as a connection failure.
        const client = this.createClient();
        this.client = client;

        client.on("error", (error: Error) => {
            logger.error("Connection error", { error });
            void this.reconnect();
        });

        client.on("end", () => {
            logger.warn("Connection ended");
            void this.reconnect();
        });

        try {
            await client.connect();
            await client.query("LISTEN jobs_available");
        } catch (error) {
            logger.error("Failed to connect to database", { error });
            void this.reconnect();
            return;
        }

        client.on("notification", () => {
            this.processor.trigger();
        });

        if (this.client !== client) {
            return;
        }

        this.leader = this.createLeader(client);
        this.leader.start();
    }

    /**
     * Stops the leader before the connection goes.
     *
     * It then still has a working session to release its advisory lock through.
     * Both the error and the end event can land, so this has to tolerate being
     * called twice.
     */
    private async reconnect(): Promise<void> {
        // Closing the client during shutdown raises "end" here too. Leaving
        // that to stop() keeps the teardown in one order instead of two racing
        // ones.
        if (this.shuttingDown) {
            return;
        }

        await this.stopLeader();
        await this.closeClient();

        if (this.reconnectTimeout) {
            return;
        }

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            void this.connect();
        }, config.reconnectDelay.total("milliseconds"));
    }

    private async stopLeader(): Promise<void> {
        const leader = this.leader;
        this.leader = null;

        await leader?.stop();
    }

    private async closeClient(): Promise<void> {
        const client = this.client;
        this.client = null;

        if (!client) {
            return;
        }

        try {
            await client.query("UNLISTEN jobs_available");
            await client.end();
        } catch (error) {
            logger.warn("Failed to close connection", { error });
        }
    }

    private createClient(): pg.Client {
        const clientConfig = orm.config;

        return new pg.Client({
            host: clientConfig.get("host"),
            port: clientConfig.get("port"),
            user: clientConfig.get("user"),
            password: clientConfig.get("password"),
            database: clientConfig.get("dbName"),
            // The pool's own acquires are bounded by the same value. Without it
            // here a black-holed host leaves this waiting on the kernel's SYN
            // retries, and the notifications this client exists for are down
            // for that whole time with only the fallback poll behind them.
            connectionTimeoutMillis: appConfig.postgres.connectionTimeout,
        });
    }
}
