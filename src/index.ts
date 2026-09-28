import { serve } from "@taxum/core/server";
import { router } from "./app.js";
import { appConfig } from "./util/app-config.js";
import { logger } from "./util/logger.js";
import { orm } from "./util/mikro-orm.js";
import { WorkerRuntime } from "./worker/runtime.js";

let worker: WorkerRuntime | undefined;

if (!appConfig.worker.disableBuiltIn) {
    // Deliberately not passing the configured concurrency: the built-in
    // worker shares its process and pool with the API and exists for installs
    // small enough that one claim loop is plenty. Scaling means standalone
    // workers.
    if (appConfig.worker.runtime.concurrency > 1) {
        logger.warn(
            "worker.runtime.concurrency applies to standalone workers;" +
                " the built-in worker runs a single claim loop",
        );
    }

    worker = new WorkerRuntime();
    worker.start();
}

await serve(router, {
    trustProxy: true,
    port: appConfig.port,
    catchCtrlC: true,
    shutdownTimeout: 5000,
    onListen: (address) => {
        logger.info(`Server started on port ${address.port}`);
    },
});

await worker?.stop();
await orm.close();

process.exit(0);
