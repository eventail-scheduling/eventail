import { type MigrationGenerator, Migrator } from "@mikro-orm/migrations";
import { type Constructor, defineConfig, type Options } from "@mikro-orm/postgresql";
import { appConfig } from "./util/app-config.js";

let generator: Constructor<MigrationGenerator> | undefined;

if (process.env.NODE_ENV !== "production") {
    const { TSMigrationGenerator } = await import("@mikro-orm/migrations");
    const { format } = await import("sql-formatter");

    // Rollbacks happen by restoring a database backup, never by running down
    // migrations, so the generator only emits up().
    class CustomMigrationGenerator extends TSMigrationGenerator {
        public generateMigrationFile(
            className: string,
            diff: { up: string[]; down: string[] },
        ): string {
            return `import {Migration} from '@mikro-orm/migrations';\n\nexport class ${className} extends Migration {\n    public async up() : Promise<void> {\n${diff.up
                .map((sql) => this.createStatement(sql, 8))
                .join("\n")
                .replace(/(^\n+|\n+$)/g, "")}\n    }\n}\n`;
        }

        public createStatement(sql: string, padLeft: number): string {
            if (sql) {
                const sqlLines = format(sql, {
                    language: "postgresql",
                    keywordCase: "upper",
                    tabWidth: 4,
                }).split("\n");

                if (sqlLines.length < 2) {
                    return super.createStatement(sqlLines.join(""), padLeft).trimEnd();
                }

                const formattedSql = sqlLines
                    .map((line) => `${" ".repeat(padLeft + 4)}${line}`)
                    .join("\n");

                return (
                    `${" ".repeat(padLeft)}` +
                    `this.addSql(\`\n${formattedSql.replace(/[`\\]/g, "\\`")}\n` +
                    `${" ".repeat(padLeft)}\`);`
                );
            }

            return "";
        }
    }

    generator = CustomMigrationGenerator;
}

const extensions: Options["extensions"] = [Migrator];

if (process.env.NODE_ENV !== "production") {
    const { SeedManager } = await import("@mikro-orm/seeder");
    extensions.push(SeedManager);
}

export default defineConfig({
    entities: ["./entity/**/*.js"],
    entitiesTs: ["./src/entity/**/*.ts"],
    extensions,
    migrations: {
        path: "./migration",
        pathTs: "./src/migration",
        generator,
        disableForeignKeys: false,
    },
    seeder: {
        path: "./seeder",
        pathTs: "./src/seeder",
        defaultSeeder: "DevSeeder",
    },
    host: appConfig.postgres.hostname,
    port: appConfig.postgres.port,
    user: appConfig.postgres.username,
    password: appConfig.postgres.password,
    dbName: appConfig.postgres.database,
    pool: { max: appConfig.postgres.poolSize },
    // Spelled in pg-pool's own vocabulary, which is what `new Pool()` is handed.
    driverOptions: { connectionTimeoutMillis: appConfig.postgres.connectionTimeout },
});
