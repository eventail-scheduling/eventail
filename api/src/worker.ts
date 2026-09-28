import "./worker/preflight.js";
import { appConfig } from "./util/app-config.js";
import { logger } from "./util/logger.js";
import { orm } from "./util/mikro-orm.js";
import { WorkerRuntime } from "./worker/runtime.js";

const worker = new WorkerRuntime({ concurrency: appConfig.worker.runtime.concurrency });
worker.start();
logger.info("Worker started");

let stopping = false;

const shutDown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) {
        return;
    }

    stopping = true;
    logger.info(`Received ${signal}, shutting down`);

    await worker.stop();
    await orm.close();

    process.exit(0);
};

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);
