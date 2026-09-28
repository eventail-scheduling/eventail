import { Client, type ClientConfig } from "pg";

type TestDatabase = Required<Pick<ClientConfig, "host" | "port" | "user">> & {
    password: string;
};

/** Coordinates of the tmpfs-backed `postgres-test` instance in compose.yml. */
export const testDatabase: TestDatabase = {
    host: "localhost",
    port: 12008,
    user: "dev",
    password: "dev",
};

export const baseDbName = "test";
export const templateDbName = `${baseDbName}_template`;
export const workerDbName = `${baseDbName}_${process.pid}`;

/**
 * Points the app's ORM at one of the test databases, whatever the shell holds.
 *
 * Overriding every connection value rather than only the name keeps a sourced
 * deployment env from pointing the test ORM at a remote database.
 */
export const overrideDatabaseEnv = (database: string): void => {
    process.env.POSTGRES_HOSTNAME = testDatabase.host;
    process.env.POSTGRES_PORT = String(testDatabase.port);
    process.env.POSTGRES_USERNAME = testDatabase.user;
    process.env.POSTGRES_PASSWORD = testDatabase.password;
    process.env.POSTGRES_DATABASE = database;
};

type AdminAction = (client: Client) => Promise<void>;

export const withAdminClient = async (action: AdminAction): Promise<void> => {
    const client = new Client({
        ...testDatabase,
        database: "postgres",
    });

    try {
        await client.connect();
    } catch (error) {
        throw new Error(
            `Cannot reach the postgres-test instance at ${testDatabase.host}:${testDatabase.port}. Is it running? (docker compose up -d postgres-test)`,
            { cause: error },
        );
    }

    try {
        await action(client);
    } finally {
        await client.end();
    }
};
