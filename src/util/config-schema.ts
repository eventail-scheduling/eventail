import { LogLevel } from "logforth";
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

const intervalDescription = "An ISO 8601 duration in time units only.";
const intervalExamples = ["PT30S", "PT6H"];

export const configSchema = z.object({
    port: portSchema.default(3000).meta({ description: "The port the API listens on." }),
    log: z
        .object({
            level: z
                .enum(logLevelNames)
                .default("info")
                .transform((name) => logLevels[name]),
        })
        .prefault({})
        .meta({
            description:
                "Logging to standard output: JSON lines when NODE_ENV is production, readable text " +
                "otherwise.",
        }),
    postgres: z
        .object({
            hostname: z.string(),
            port: portSchema
                .optional()
                .meta({ description: "Defaults to the PostgreSQL port, 5432." }),
            database: z.string(),
            username: z.string(),
            password: z.string(),
            poolSize: z
                .int()
                .min(2)
                .default(10)
                .meta({
                    description:
                        "The most connections the pool opens in each process; a process running " +
                        "jobs holds one more outside it, to hear about new jobs. At least 2, " +
                        "since booting holds a lock on one connection while migrating on " +
                        "another, so a pool of one cannot boot. A standalone worker needs its " +
                        "worker.runtime.concurrency plus 2.",
                }),
            // `pg-pool` waits forever without this, so a full pool would leave every
            // request hanging while `/health`, which touches no database, says alive.
            connectionTimeout: z
                .int()
                .positive()
                .default(10_000)
                .meta({
                    description:
                        "Milliseconds to wait for a database connection, both when opening one " +
                        "and when waiting for a free one from the pool.",
                }),
        })
        .meta({ description: "The PostgreSQL database." }),
    jwt: z
        .object({
            issuer: z.string().meta({
                description:
                    "The OpenID Connect issuer. Its discovery document is fetched at startup, so " +
                    "the API does not start while the issuer is unreachable.",
            }),
            audience: z.string().meta({
                description: "The audience access tokens must carry.",
            }),
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
                .nonempty()
                .default(["RS256"])
                .meta({
                    description:
                        "The signature algorithms accepted on access tokens. Asymmetric only: " +
                        "tokens are verified against the issuer's published keys, so shared-secret " +
                        "HS256 and its siblings are not supported.",
                }),
            superAdminPredicate: jmesPathSchema.meta({
                description:
                    "A JMESPath expression evaluated against the verified token; a truthy result " +
                    "makes the caller a super admin. Guard a claim that may be absent, as in the " +
                    "second example. An expression that fails to evaluate counts as false.",
                examples: [
                    "sub == 'a' || sub == 'b'",
                    "contains(realm_access.roles || `[]`, 'superadmin')",
                ],
            }),
            integrationPredicate: jmesPathSchema.meta({
                description:
                    "A JMESPath expression evaluated against the verified token; a truthy result " +
                    "makes the caller the trusted integration that reads the published schedule. " +
                    "Written like superAdminPredicate.",
                examples: ["sub == 'integration'"],
            }),
            debug: z
                .boolean()
                .default(false)
                .meta({
                    description:
                        "Puts the reason a token was rejected into the 401 response. For debugging " +
                        "only: it tells every client why verification failed.",
                }),
        })
        .meta({ description: "Verifying the access tokens the sign-in provider issues." }),
    userInfo: z
        .object({
            emailAddressPath: jmesPathSchema.optional().meta({
                description:
                    "A JMESPath expression picking the email address out of the provider's " +
                    "userinfo response. Left unset, people enter their address themselves.",
                examples: ["email"],
            }),
            displayNamePath: jmesPathSchema.optional().meta({
                description:
                    "A JMESPath expression picking the display name out of the provider's " +
                    "userinfo response. Left unset, people enter their name themselves.",
                examples: ["name", "join(' ', [given_name, family_name][?@])"],
            }),
            cacheTtl: intervalDurationSchema.prefault("PT5M").meta({
                description: `How long a userinfo response is reused. ${intervalDescription}`,
                examples: intervalExamples,
            }),
        })
        .prefault({})
        .meta({
            description:
                "Reading a person's name and email address from the sign-in provider's userinfo " +
                "endpoint.",
        }),
    cors: z
        .object({
            origin: z.string().meta({
                description:
                    "The web app's origin exactly as a browser sends it: lowercase scheme and " +
                    "host, plus the port only when it is not the default, with no path or " +
                    "trailing slash.",
                examples: ["https://eventail.example.com"],
            }),
        })
        .meta({ description: "Cross-origin requests from the web app." }),
    s3: z
        .object({
            client: z
                .object({
                    endpoint: z.string().meta({ description: "The store's URL." }),
                    credentials: z
                        .object({
                            accessKeyId: z.string(),
                            secretAccessKey: z.string(),
                        })
                        .optional()
                        .meta({
                            description:
                                "Left unset, the AWS default credential chain applies, such as " +
                                "AWS_* environment variables or an instance role. An empty value " +
                                "counts as set.",
                        }),
                    region: z
                        .string()
                        .optional()
                        .meta({
                            description:
                                "Falls back to AWS_REGION, then the region of the AWS profile in the " +
                                "shared config files, then EC2 instance metadata; AWS_DEFAULT_REGION " +
                                "is not read. Something has to set it even for stores without " +
                                "regions; us-east-1 works for those.",
                        }),
                    forcePathStyle: z
                        .boolean()
                        .optional()
                        .meta({
                            description:
                                "Addresses the bucket as a path on the endpoint rather than as a " +
                                "subdomain. Most self-hosted stores need this.",
                        }),
                })
                .meta({ description: "Connecting to the S3-compatible object store." }),
            // The AWS client arms none of these by default, so a store that goes quiet
            // would hold its caller, some of them inside a write transaction, forever.
            requestHandler: z
                .object({
                    connectionTimeout: z.int().positive().default(3_000).meta({
                        description: "Milliseconds to wait for a connection to the store.",
                    }),
                    socketTimeout: z
                        .int()
                        .positive()
                        .max(5_999)
                        .default(5_000)
                        .meta({
                            description:
                                "Milliseconds a request may go without data. Must stay below " +
                                "6000, above which the client stops covering a stalled " +
                                "response body.",
                        }),
                })
                .prefault({})
                .meta({
                    description:
                        "Timeouts for each attempt at a request to the store. A stalling store " +
                        "is retried, so one request can take several times these.",
                }),
            bucketName: z.string().min(1),
            maxFileSize: fileSizeSchema.meta({
                description: "The largest upload accepted, with a unit from B to TB.",
                examples: ["10mb", "1.5GB"],
            }),
            publicBaseUrl: z
                .url()
                .transform((url) => url.replace(/\/+$/, ""))
                .meta({
                    description:
                        "The publicly reachable base URL of the bucket. Image URLs are this plus " +
                        "the object key.",
                }),
        })
        .meta({
            description:
                "The S3-compatible bucket holding uploads. Browsers upload to it directly, so it " +
                "needs a CORS rule allowing POST from the web app's origin, and public images " +
                "need a bucket policy.",
        }),
    frontend: z
        .object({
            baseUrl: z.url().meta({
                description: "The web app's URL, used for the links in mails.",
            }),
        })
        .meta({ description: "The web app." }),
    worker: z
        .object({
            disableBuiltIn: z
                .boolean()
                .optional()
                .meta({
                    description:
                        "Stops the API process from running jobs itself. Set it when standalone " +
                        "workers run, and only then: without either, no jobs run and no mail goes out.",
                }),
            leader: z
                .object({
                    electionInterval: intervalDurationSchema.prefault("PT1M").meta({
                        description: `How often a process that is not the leader tries to become it. ${intervalDescription}`,
                        examples: intervalExamples,
                    }),
                    pollInterval: intervalDurationSchema.prefault("PT1M").meta({
                        description: `How often the leader checks that it still is. ${intervalDescription}`,
                        examples: intervalExamples,
                    }),
                })
                .prefault({})
                .meta({
                    description:
                        "Electing the one process that runs the maintenance tasks below, however " +
                        "many workers run.",
                }),
            runtime: z
                .object({
                    fallbackInterval: intervalDurationSchema.prefault("PT30S").meta({
                        description: `How often to look for jobs without being notified of one, covering missed notifications. ${intervalDescription}`,
                        examples: intervalExamples,
                    }),
                    reconnectDelay: intervalDurationSchema.prefault("PT5S").meta({
                        description: `How long to wait before reconnecting after the database connection drops. ${intervalDescription}`,
                        examples: intervalExamples,
                    }),
                    drainTimeout: intervalDurationSchema.prefault("PT15S").meta({
                        description: `How long shutting down waits for running jobs to finish. ${intervalDescription}`,
                        examples: intervalExamples,
                    }),
                    maxAttempts: z.int().positive().default(25).meta({
                        description: "How often a failing job is tried before it is given up.",
                    }),
                    concurrency: z
                        .int()
                        .positive()
                        .default(1)
                        .meta({
                            description:
                                "Jobs a standalone worker runs at once; the built-in worker always " +
                                "runs one. Needs postgres.poolSize of at least this plus 2.",
                        }),
                })
                .prefault({})
                .meta({ description: "Claiming and running jobs." }),
            scheduler: z
                .object({
                    interval: intervalDurationSchema.prefault("PT5S").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                    limit: z.int().positive().default(1_000).meta({
                        description: "Jobs handled per batch.",
                    }),
                })
                .prefault({})
                .meta({ description: "Makes scheduled jobs and jobs due for a retry available." }),
            cleaner: z
                .object({
                    interval: intervalDurationSchema.prefault("PT30S").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                    canceledJobRetentionPeriod: nonNegativeDurationSchema.prefault("PT24H"),
                    completedJobRetentionPeriod: nonNegativeDurationSchema.prefault("PT24H"),
                    discardedJobRetentionPeriod: nonNegativeDurationSchema.prefault("P7D"),
                })
                .prefault({})
                .meta({
                    description:
                        "Deletes finished jobs once their retention period, an ISO 8601 duration, " +
                        "has passed.",
                }),
            inviteSweeper: z
                .object({
                    interval: intervalDurationSchema.prefault("PT1H").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                })
                .prefault({})
                .meta({ description: "Deletes expired invites." }),
            userSweeper: z
                .object({
                    interval: intervalDurationSchema.prefault("PT6H").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                    retentionPeriod: positiveDurationSchema.prefault("P180D").meta({
                        description:
                            "How long an account may go without its owner opening the web app. An " +
                            "ISO 8601 duration.",
                        examples: ["P365D"],
                    }),
                })
                .prefault({})
                .meta({
                    description:
                        "Deletes accounts nobody has used for the retention period, unless they " +
                        "host a session or belong to a team.",
                }),
            filePruner: z
                .object({
                    interval: intervalDurationSchema.prefault("PT24H").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                    minimumAge: positiveDurationSchema.prefault("PT24H").meta({
                        description:
                            "The least time an object stays unreferenced before it is deleted, " +
                            "counted from when the pruner first finds it so; unfinished uploads " +
                            "count from when they were uploaded. The deletion itself waits for " +
                            "the next run after that. An ISO 8601 duration.",
                    }),
                })
                .prefault({})
                .meta({
                    description:
                        "Deletes objects in the bucket that nothing refers to anymore, and uploads " +
                        "that were never finished.",
                }),
            rescuer: z
                .object({
                    interval: intervalDurationSchema.prefault("PT30S").meta({
                        description: intervalDescription,
                        examples: intervalExamples,
                    }),
                    limit: z.int().positive().default(1_000).meta({
                        description: "Jobs handled per batch.",
                    }),
                    rescueAfter: nonNegativeDurationSchema.prefault("PT1H").meta({
                        description:
                            "How long a job may run before it counts as stuck. An ISO 8601 duration.",
                    }),
                })
                .prefault({})
                .meta({
                    description:
                        "Makes a job that has been running longer than rescueAfter available again, " +
                        "taking its worker to be gone, or gives it up after " +
                        "worker.runtime.maxAttempts. A job still running then runs twice, so " +
                        "rescueAfter has to exceed the longest job.",
                }),
        })
        .prefault({})
        .meta({
            description:
                "Background jobs and maintenance. The API runs a worker itself unless " +
                "disableBuiltIn is set; standalone workers run the same image with ./worker.js.",
        }),
    email: z
        .object({
            sender: z.email().meta({ description: "The From address of every mail." }),
            confirmReminderCooldown: positiveDurationSchema.prefault("P3D").meta({
                description:
                    "How long after one reminder to confirm a session the next may be sent. An " +
                    "ISO 8601 duration.",
            }),
            smtp: z
                .object({
                    host: z.string().min(1).optional(),
                    port: portSchema.optional(),
                    auth: z
                        .object({
                            user: z.string(),
                            pass: z.string(),
                        })
                        .optional()
                        .meta({ description: "Left unset, no authentication is sent." }),
                    authMethod: z.string().optional(),
                    secure: z
                        .boolean()
                        .optional()
                        .meta({
                            description:
                                "Speaks TLS from the start. Unset, only port 465 does; elsewhere " +
                                "TLS depends on the server offering STARTTLS, unless requireTLS " +
                                "demands it or ignoreTLS skips it.",
                        }),
                    tls: z
                        .object({
                            rejectUnauthorized: z.boolean().optional(),
                            servername: z.string().min(1).optional(),
                        })
                        .optional()
                        .meta({ description: "TLS options passed to Node.js." }),
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
                .default({})
                .meta({
                    description:
                        "The mail server, passed to nodemailer's SMTP transport; its " +
                        "documentation covers each option. Timeouts are in milliseconds.",
                }),
        })
        .meta({ description: "Sending mail." }),
});
