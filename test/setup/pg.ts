import pg from "pg";
import { orm } from "../../src/util/mikro-orm.js";
import { sleep } from "../../src/util/time.js";

/**
 * Opens a connection to this worker's clone outside the ORM's pool.
 *
 * An advisory lock belongs to the session that took it, and a probe of
 * pg_stat_activity has to exclude its own backend, so a test observing either
 * needs a connection the code under test is not using.
 */
export const connectDirectly = async (): Promise<pg.Client> => {
    const config = orm.config;
    const client = new pg.Client({
        host: config.get("host"),
        port: config.get("port"),
        user: config.get("user"),
        password: config.get("password"),
        database: config.get("dbName"),
    });
    await client.connect();

    return client;
};

/** Polls for two seconds, and reports whether the condition ever held. */
export const waitFor = async (condition: () => Promise<boolean> | boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 100; ++attempt) {
        if (await condition()) {
            return true;
        }

        await sleep(20);
    }

    return false;
};
