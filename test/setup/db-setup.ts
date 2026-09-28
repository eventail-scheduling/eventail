/**
 * Global setup and teardown for the test run (--test-global-setup).
 *
 * The template is migrated once so each worker can clone it instead of
 * migrating from scratch (see worker-db.ts). The sweep in setup catches
 * leftovers from runs that died before teardown fired.
 *
 * The sweep matches every database named `test%`, so two concurrent runs on
 * the same instance clobber each other. Don't run the suite twice in
 * parallel.
 */

import { MikroORM } from "@mikro-orm/postgresql";
import {
    clearTally,
    contractFloorApplies,
    minimumCheckedResponses,
    readTally,
    resetTally,
} from "./contract-tally.js";
import { baseDbName, overrideDatabaseEnv, templateDbName, withAdminClient } from "./db-admin.js";

const dropTestDatabases = async (): Promise<void> => {
    await withAdminClient(async (client) => {
        const { rows } = await client.query<{ datname: string }>(
            "SELECT datname FROM pg_database WHERE datname LIKE $1",
            [`${baseDbName}%`],
        );

        for (const { datname } of rows) {
            await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
        }
    });
};

export const globalSetup = async (): Promise<void> => {
    resetTally();
    await dropTestDatabases();

    await withAdminClient(async (client) => {
        await client.query(`CREATE DATABASE "${templateDbName}"`);
    });

    // The config reads the env overrides at import time, so they must be set
    // before the dynamic import.
    overrideDatabaseEnv(templateDbName);
    const { default: config } = await import("../../src/mikro-orm.config.js");

    // Snapshot writes are for migration:create; migrating the throwaway
    // template must not dump a .snapshot-test_template.json into src/.
    const templateOrm = await MikroORM.init({
        ...config,
        migrations: { ...config.migrations, snapshot: false },
    });
    await templateOrm.migrator.up();
    await templateOrm.close(true);
};

export const globalTeardown = async (): Promise<void> => {
    // Undefined only while nothing has failed: node:test sets it before it runs
    // the teardown. A red or interrupted run loses the counts of workers that
    // never reached their after hook, so the floor would report a cause that is
    // not the one.
    const runIsGreen = process.exitCode === undefined;
    const checked = readTally();
    clearTally();
    await dropTestDatabases();

    if (runIsGreen && contractFloorApplies() && checked < minimumCheckedResponses) {
        const message =
            `The contract layer checked ${checked} responses, below the floor of` +
            ` ${minimumCheckedResponses}. Every reason it skips a response reads as a pass at` +
            " the call site, so a drop this large means it is resolving no operations rather" +
            " than that tests were removed.";

        // node:test reports nothing from a failing global teardown but the exit
        // status, so the reason has to reach stderr on its own.
        process.stderr.write(`${message}\n`);
        throw new Error(message);
    }
};
