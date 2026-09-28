/**
 * Provisions the per-worker database clone. Runs as a child process because
 * the module loader hooks in worker-db.ts are synchronous and block on it,
 * while pg only offers an async API.
 */

import { Client } from "pg";

const { testDatabase, templateDbName, workerDbName } = JSON.parse(process.argv[2]);

const client = new Client({
    ...testDatabase,
    database: "postgres",
});

try {
    await client.connect();
} catch {
    console.error(
        `Cannot reach the postgres-test instance at ${testDatabase.host}:${testDatabase.port}. Is it running? (docker compose up -d postgres-test)`,
    );
    process.exit(1);
}

try {
    // Guards against intra-run pid reuse: clones outlive their workers, so a
    // new worker can inherit the pid (and clone) of a finished one.
    await client.query(`DROP DATABASE IF EXISTS "${workerDbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${workerDbName}" TEMPLATE "${templateDbName}"`);
} finally {
    await client.end();
}
