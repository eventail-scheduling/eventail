import { LogLevel } from "logforth";
import { ConfigResolver } from "stilla";
import { z } from "zod";
import { zt } from "zod-temporal";
import { fileSizeSchema, jmesPathSchema } from "./zod.js";

const logLevels = {
    trace: LogLevel.Trace,
    debug: LogLevel.Debug,
    info: LogLevel.Info,
    warn: LogLevel.Warn,
    error: LogLevel.Error,
    fatal: LogLevel.Fatal,
} as const;
type LogLevelName = keyof typeof logLevels;
const logLevelNames = Object.keys(logLevels) as [LogLevelName, ...LogLevelName[]];

const portSchema = z.int().min(1).max(65_535);

const positiveDurationSchema = zt
    .duration()
    .refine((duration) => duration.sign > 0, "Must be positive");
const nonNegativeDurationSchema = zt
    .duration()
    .refine((duration) => duration.sign >= 0, "Must not be negative");

// Interval consumers call total("milliseconds"), which throws on calendar
// units; fields read through instantAgo may keep them.
const intervalDurationSchema = positiveDurationSchema.refine(
    (duration) =>
        duration.years === 0 &&
        duration.months === 0 &&
        duration.weeks === 0 &&
        duration.days === 0,
    "Must use time units only",
);

const configSchema = z.object({
    port: portSchema.default(3000),
    log: z.object({
        level: z
            .enum(logLevelNames)
            .default("info")
            .transform((name) => logLevels[name]),
    }),
    postgres: z.object({
        hostname: z.string(),
        port: portSchema.optional(),
        database: z.string(),
        username: z.string(),
        password: z.string(),
        /**
         * At least two, which is what booting needs on its own.
         *
         * The migration runs in a transaction of its own while the advisory
         * lock serializing instances is held on another connection, so a pool
         * of one deadlocks against itself before the app ever serves anything.
         */
        poolSize: z.int().min(2),

        /**
         * How long anything here waits for a connection, in ms.
         *
         * `pg-pool` parks an acquirer with no timer at all unless this is set,
         * so once every connection is held the API accepts requests and answers
         * none of them, while `/health` keeps saying alive because it touches
         * no database. Ten seconds is far past a healthy wait and far short of
         * forever.
         *
         * It bounds opening a connection as well as waiting for a free one, and
         * the worker's own LISTEN client takes it too, so a database that has
         * gone away is answered the same way everywhere.
         */
        connectionTimeout: z.int().positive().default(10_000),
    }),
    jwt: z.object({
        issuer: z.string(),
        audience: z.string(),
        // Asymmetric only: JWKS verification never uses shared-secret HS*.
        algorithms: z
            .array(
                z.enum([
                    "RS256",
                    "RS384",
                    "RS512",
                    "PS256",
                    "PS384",
                    "PS512",
                    "ES256",
                    "ES384",
                    "ES512",
                    "EdDSA",
                ]),
            )
            .nonempty(),
        superAdminPredicate: jmesPathSchema,
        integrationPredicate: jmesPathSchema,
        debug: z.boolean(),
    }),
    userInfo: z.object({
        emailAddressPath: jmesPathSchema.optional(),
        displayNamePath: jmesPathSchema.optional(),
        cacheTtl: intervalDurationSchema,
    }),
    cors: z.object({
        origin: z.string(),
    }),
    s3: z.object({
        client: z.object({
            endpoint: z.string(),
            credentials: z
                .object({
                    accessKeyId: z.string(),
                    secretAccessKey: z.string(),
                })
                .optional(),
            region: z.string().optional(),
            forcePathStyle: z.boolean().optional(),
        }),
        /**
         * Passed to the SDK, which arms none of these on its own.
         *
         * Every default in the AWS client is 0, meaning disabled, so a store
         * that accepts a connection and then goes quiet holds the caller for as
         * long as it likes. Some of these calls run inside a write transaction,
         * holding its locks and a pool connection until they return.
         *
         * These bound one attempt, not one call: `maxAttempts` is left at the
         * SDK's default, so a stalling store is retried and the hold is several
         * times the sum below plus the backoff between.
         *
         * `socketTimeout` must stay under 6000: at or above it the handler
         * defers arming the socket timer by 3s and clears that deferral once
         * response headers arrive, so a read whose headers come back promptly
         * and whose body then stalls is left with no timer at all. Under 6000
         * it arms immediately and covers the body, which is where the two
         * reads of stored bytes spend their time.
         */
        requestHandler: z
            .object({
                connectionTimeout: z.int().positive().default(3_000),
                socketTimeout: z.int().positive().max(5_999).default(5_000),
            })
            .prefault({}),
        bucketName: z.string().min(1),
        maxFileSize: fileSizeSchema,
        publicBaseUrl: z.url().transform((url) => url.replace(/\/+$/, "")),
    }),
    frontend: z.object({
        baseUrl: z.url(),
    }),
    worker: z.object({
        disableBuiltIn: z.boolean().optional(),
        leader: z.object({
            electionInterval: intervalDurationSchema,
            pollInterval: intervalDurationSchema,
        }),
        runtime: z.object({
            fallbackInterval: intervalDurationSchema,
            reconnectDelay: intervalDurationSchema,
            drainTimeout: intervalDurationSchema,
            maxAttempts: z.int().positive(),
            concurrency: z.int().positive(),
        }),
        scheduler: z.object({
            interval: intervalDurationSchema,
            limit: z.int().positive(),
        }),
        cleaner: z.object({
            interval: intervalDurationSchema,
            canceledJobRetentionPeriod: nonNegativeDurationSchema,
            completedJobRetentionPeriod: nonNegativeDurationSchema,
            discardedJobRetentionPeriod: nonNegativeDurationSchema,
        }),
        inviteSweeper: z.object({
            interval: intervalDurationSchema,
        }),
        userSweeper: z.object({
            interval: intervalDurationSchema,
            retentionPeriod: positiveDurationSchema,
        }),
        filePruner: z.object({
            interval: intervalDurationSchema,
            minimumAge: positiveDurationSchema,
        }),
        rescuer: z.object({
            interval: intervalDurationSchema,
            limit: z.int().positive(),
            rescueAfter: nonNegativeDurationSchema,
        }),
    }),
    email: z.object({
        sender: z.email(),
        confirmReminderCooldown: positiveDurationSchema,
        smtp: z
            .object({
                host: z.string().min(1).optional(),
                port: portSchema.optional(),
                auth: z
                    .object({
                        user: z.string(),
                        pass: z.string(),
                    })
                    .optional(),
                authMethod: z.string().optional(),
                secure: z.boolean().optional(),
                tls: z
                    .object({
                        rejectUnauthorized: z.boolean().optional(),
                        servername: z.string().min(1).optional(),
                    })
                    .optional(),
                ignoreTLS: z.boolean().optional(),
                requireTLS: z.boolean().optional(),
                opportunisticTLS: z.boolean().optional(),
                name: z.string().min(1).optional(),
                localAddress: z.string().min(1).optional(),
                connectionTimeout: z.int().positive().optional(),
                greetingTimeout: z.int().positive().optional(),
                socketTimeout: z.int().positive().optional(),
                dnsTimeout: z.int().positive().optional(),
                pool: z.boolean().optional(),
                maxConnections: z.int().positive().optional(),
                maxMessages: z.int().positive().optional(),
            })
            // Defaulted rather than optional: every setting inside is optional
            // already, so an empty block means "take nodemailer's defaults",
            // while an absent one would reach createTransport as undefined and
            // throw before the process finished booting.
            .default({}),
    }),
});

const configResolver = ConfigResolver.default(configSchema);

export const appConfig = await configResolver.resolve();
