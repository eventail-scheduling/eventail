/**
 * Per-worker database wiring, loaded via `--import` before any app code.
 *
 * Each worker gets an exclusive clone of the migrated template database (see
 * db-setup.ts), provisioned lazily through a module loader hook so pure unit
 * tests skip the cost. Clones are swept by the global teardown once all
 * workers have exited, not per worker.
 *
 * The clone is emptied before every test, so a suite may assume nothing about
 * what ran ahead of it and must seed whatever it needs.
 */

import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { after, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { writeWorkerTally } from "./contract-tally.js";
import { overrideDatabaseEnv, templateDbName, testDatabase, workerDbName } from "./db-admin.js";
import { truncateAll } from "./truncate.js";

overrideDatabaseEnv(workerDbName);

const ormModulePattern = /\/src\/util\/mikro-orm\.(?:ts|js)$/;
let ormModuleLoaded = false;

const provisionWorkerDb = (): void => {
    // Loader hooks are synchronous while pg only offers an async API, so the
    // admin work runs in a child process we can block on.
    const result = spawnSync(
        process.execPath,
        [
            fileURLToPath(new URL("./provision-db.mjs", import.meta.url)),
            JSON.stringify({ testDatabase, templateDbName, workerDbName }),
        ],
        { stdio: ["ignore", "inherit", "inherit"] },
    );

    if (result.status !== 0) {
        throw new Error("Failed to provision worker database", {
            cause: result.error ?? undefined,
        });
    }
};

registerHooks({
    load: (url, context, nextLoad) => {
        if (ormModulePattern.test(url) && !ormModuleLoaded) {
            ormModuleLoaded = true;
            provisionWorkerDb();
        }

        return nextLoad(url, context);
    },
});

// Registering here rather than per suite is what makes the isolation
// unforgettable: a new test file inherits the empty database without opting
// in. Root hooks run before the ones a suite registers, so a suite's own
// beforeEach seeds into a table this has just emptied.
beforeEach(async () => {
    if (!ormModuleLoaded) {
        return;
    }

    const { orm } = await import("../../src/util/mikro-orm.js");
    await truncateAll(orm);
});

// Runs before root-level after hooks registered by test files (root hooks run
// in registration order and this preload registers first), so test files must
// not do ORM work in theirs. The ORM's idle pool would otherwise keep the
// worker alive; the guard avoids provisioning a database when no test ever
// touched the ORM.
after(async () => {
    writeWorkerTally();

    if (!ormModuleLoaded) {
        return;
    }

    const { orm } = await import("../../src/util/mikro-orm.js");
    await orm.close(true);
});
