import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
    buildResourceSchemaObject,
} from "@jsonapi-serde/openapi";
import { JsonApiDocument, JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { type EntityManager, LockMode } from "@mikro-orm/postgresql";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../entity/Edition.js";
import { Host } from "../entity/Host.js";
import { Job, type JobState } from "../entity/Job.js";
import { Response } from "../entity/Response.js";
import { SessionHostInvite } from "../entity/SessionHostInvite.js";
import { TeamInvite } from "../entity/TeamInvite.js";
import { User } from "../entity/User.js";
import { bumpEditionRevision } from "../support/edition-revision.js";
import {
    coversUserDeletionReach,
    lockEditions,
    lockUserDeletionTargets,
    readUserDeletionEditionIds,
} from "../support/locking.js";
import { RequireAuthorizationLayer, requiredUser } from "../util/auth.js";
import { compareCodeUnits } from "../util/helpers.js";
import { em } from "../util/mikro-orm.js";
import { emailAddressSchema } from "../util/zod.js";

// Everything that was never sent, which is what a purge can still act on.
// `completed` is left to the cleaner's retention because deleting that row
// would not unsend the mail it stands for, while `discarded` and `canceled`
// still hold the address and the templated name, and POST /jobs/{id}/retry
// would send one after the purge reported holding nothing.
const unsentStates: readonly JobState[] = [
    "available",
    "running",
    "retryable",
    "scheduled",
    "discarded",
    "canceled",
];

const attributesSchema = z.strictObject({
    emailAddress: emailAddressSchema,
});

/**
 * Whether to report rather than erase.
 *
 * No default: an irreversible action should not run because a field was left
 * out. The report echoes it back as an attribute, where it describes the
 * resource that came back rather than directing the one going out.
 */
const purgeDirectiveSchema = z.strictObject({ dryRun: z.boolean() });

const resourceOptions = {
    type: "user_purge",
    attributesSchema,
    metaSchema: purgeDirectiveSchema,
} satisfies AnyParseResourceRequestOptions;

type PurgeReport = {
    dryRun: boolean;
    displayNames: string[];
    responses: number;
    teamMemberships: number;
    hostedSessions: number;
    teamInvites: number;
    sessionHostInvites: number;
    pendingMails: number;
};

// Counted against the pivot tables rather than the teams and sessions they
// point at, so two accounts sharing an address in one team report two
// memberships rather than one team.
const countPivotRows = async (
    em: EntityManager,
    table: string,
    userIds: string[],
): Promise<number> => {
    const rows = await em.execute<{ count: number }[]>(
        `SELECT COUNT(*)::int AS "count" FROM "${table}" WHERE "user_id" IN (?)`,
        [userIds],
    );

    return rows[0].count;
};

/**
 * Collects every edition up front, before any bump.
 *
 * The editions hold a host row of these accounts, and bumping flushes: the flush
 * runs the cascade that takes those host rows away. Sorted by id so two purges
 * sharing editions take the counter rows in one order instead of deadlocking.
 */
const findHostEditions = async (em: EntityManager, userIds: string[]): Promise<Edition[]> => {
    const hosts = await em.find(Host, { user: { $in: userIds } }, { populate: ["edition"] });
    const editions = new Map(
        hosts.map((host) => [host.edition.id, host.edition.unwrap()] as const),
    );

    return [...editions.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
};

const countHostedSessions = async (em: EntityManager, userIds: string[]): Promise<number> => {
    const rows = await em.execute<{ count: number }[]>(
        `SELECT COUNT(*)::int AS "count" FROM "session_hosts"
         INNER JOIN "host" ON "host"."id" = "session_hosts"."host_id"
         WHERE "host"."user_id" IN (?)`,
        [userIds],
    );

    return rows[0].count;
};

type PurgeCounts = Omit<PurgeReport, "dryRun" | "displayNames" | "pendingMails">;

/**
 * Collects the host addresses nothing but these accounts uses right now.
 *
 * A speaker may give an edition any address, a colleague's included, and mail to
 * one that another account, host row or invite still holds is theirs to keep. Any
 * invite row counts, a revoked one included, until the invite sweeper deletes it
 * once it expires. The match is exact and against current rows, so mail queued
 * to an address since changed is not found.
 */
const soleHostAddresses = async (
    em: EntityManager,
    emailAddress: string,
    userIds: string[],
): Promise<string[]> => {
    if (userIds.length === 0) {
        return [];
    }

    const rows = await em.execute<{ email_address: string }[]>(
        `select distinct "host"."email_address" from "host"
         where "host"."user_id" in (?) and "host"."email_address" <> ?
         and not exists (
             select 1 from "user" where "user"."email_address" = "host"."email_address"
             and "user"."id" not in (?)
         )
         and not exists (
             select 1 from "host" as "other" where "other"."email_address" = "host"."email_address"
             and "other"."user_id" not in (?)
         )
         and not exists (
             select 1 from "team_invite" where "team_invite"."email_address" = "host"."email_address"
         )
         and not exists (
             select 1 from "session_host_invite"
             where "session_host_invite"."email_address" = "host"."email_address"
         )`,
        [userIds, emailAddress, userIds, userIds],
    );

    return rows.map((row) => row.email_address);
};

const countPurgeTargets = async (
    em: EntityManager,
    emailAddress: string,
    userIds: string[],
): Promise<PurgeCounts> => {
    if (userIds.length === 0) {
        return {
            responses: 0,
            teamMemberships: 0,
            hostedSessions: 0,
            teamInvites: 0,
            sessionHostInvites: 0,
        };
    }

    const [responses, teamMemberships, hostedSessions, teamInvites, sessionHostInvites] =
        await Promise.all([
            em.count(Response, { host: { user: { $in: userIds } } }),
            countPivotRows(em, "team_users", userIds),
            countHostedSessions(em, userIds),
            em.count(TeamInvite, { emailAddress }),
            em.count(SessionHostInvite, { emailAddress }),
        ]);

    return { responses, teamMemberships, hostedSessions, teamInvites, sessionHostInvites };
};

/** What a purge read before locking changed before it held the locks. */
class PurgeRace extends Error {}

/**
 * Locks what purging this address reaches and returns its accounts, held.
 *
 * Throws `PurgeRace` when that changed between its reads and its locks, except
 * on a dry run, which deletes nothing.
 */
const lockPurgeSubject = async (
    em: EntityManager,
    emailAddress: string,
    dryRun: boolean,
): Promise<User[]> => {
    const readUserIds = (
        await em.execute<{ id: string }[]>(
            'select "id" from "user" where "email_address" = ? order by "id" asc',
            [emailAddress],
        )
    ).map((row) => row.id);

    const lockedEditionIds = await readUserDeletionEditionIds(em, {
        userIds: readUserIds,
        emailAddress,
    });
    await lockEditions(em, [...lockedEditionIds]);

    const lockedTargets = await lockUserDeletionTargets(em, {
        userIds: readUserIds,
        emailAddress,
    });

    // Row locks, so this serializes two purges of the same address
    // but cannot stop a sign-in provisioning a new account with it
    // mid-transaction. A subject who can still authenticate is a
    // procedural problem, not one a lock closes. It is also the only
    // one who could meet an invite to the address sent after the
    // check below, which the purge's deletes then lock after the users.
    const users = await em.find(
        User,
        { emailAddress },
        { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
    );
    const userIds = users.map((user) => user.id);

    // Anything committed between those reads and these locks, an
    // account taking the address, a host row, or a transition or
    // invite, leaves rows unlocked that the purge's deletes would lock
    // backward. The attempt is abandoned instead; the retry's reads
    // see them. Once the users are held nothing new can reference
    // them. A dry run deletes nothing, so no cascade of ours reaches
    // the rows the missing locks would cover.
    if (
        !dryRun &&
        (userIds.join() !== readUserIds.join() ||
            !(await coversUserDeletionReach(
                em,
                { userIds, emailAddress },
                lockedEditionIds,
                lockedTargets,
            )))
    ) {
        throw new PurgeRace();
    }

    return users;
};

const PURGE_ATTEMPTS = 3;

const createPurgeHandler = createExtractHandler(
    jsonApiResource(resourceOptions),
    requiredUser,
).handler(async ({ attributes, meta }, caller) => {
    const { emailAddress } = attributes;
    const { dryRun } = meta;

    const runPurge = async (): Promise<PurgeReport> =>
        em.transactional(async (em): Promise<PurgeReport> => {
            const users = await lockPurgeSubject(em, emailAddress, dryRun);
            const userIds = users.map((user) => user.id);

            if (userIds.includes(caller.id)) {
                throw new JsonApiError({
                    status: "403",
                    code: "own_account",
                    title: "Own account",
                    detail: "You cannot erase the address of your own account",
                });
            }

            const recipients = [
                emailAddress,
                ...(await soleHostAddresses(em, emailAddress, userIds)),
            ];
            const mailsWhere = {
                state: { $in: unsentStates },
                payload: { type: "send_email" as const, recipient: { $in: recipients } },
            };

            const counts = await countPurgeTargets(em, emailAddress, userIds);
            const pendingMails = await em.count(Job, mailsWhere);

            if (!dryRun) {
                // Invites key on the address alone and mail payloads carry it
                // inside JSON, so neither is reachable from the user row.
                await em.nativeDelete(TeamInvite, { emailAddress });
                await em.nativeDelete(SessionHostInvite, { emailAddress });
                // Locked in id order first, as the scheduler, the rescuer
                // and the cleaner lock jobs: the delete takes its rows in
                // whatever order its plan scans them.
                await em
                    .createQueryBuilder(Job)
                    .select("id")
                    .where(mailsWhere)
                    .orderBy({ id: "asc" })
                    .setLockMode(LockMode.PESSIMISTIC_WRITE)
                    .execute();
                await em.nativeDelete(Job, mailsWhere);

                for (const user of users) {
                    em.remove(user);
                }

                for (const hostEdition of await findHostEditions(em, userIds)) {
                    await bumpEditionRevision(em, hostEdition);
                }
            }

            return {
                ...counts,
                dryRun,
                displayNames: users.map((user) => user.displayName),
                pendingMails,
            };
        });

    let report: PurgeReport | null = null;

    for (let attempt = 1; report === null; attempt += 1) {
        try {
            report = await runPurge();
        } catch (error) {
            if (!(error instanceof PurgeRace)) {
                throw error;
            }

            if (attempt === PURGE_ATTEMPTS) {
                throw new JsonApiError({
                    status: "409",
                    code: "concurrent_change",
                    title: "Concurrent change",
                    detail: "What this address's accounts reach kept changing while it was purged; try again",
                });
            }
        }
    }

    return new JsonApiDocument({
        data: {
            type: "user_purge",
            id: emailAddress,
            attributes: report,
        },
    });
});

export const userPurgesRouter = new Router()
    .route("/", m.post(createPurgeHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "admin" } }));

const purgeResourceSchema = buildResourceSchemaObject({
    type: "user_purge",
    id: { type: "string", format: "email" },
    attributes: {
        type: "object",
        properties: {
            dryRun: { type: "boolean" },
            displayNames: { type: "array", items: { type: "string" } },
            responses: { type: "integer", minimum: 0 },
            teamMemberships: { type: "integer", minimum: 0 },
            hostedSessions: { type: "integer", minimum: 0 },
            teamInvites: { type: "integer", minimum: 0 },
            sessionHostInvites: { type: "integer", minimum: 0 },
            pendingMails: {
                description:
                    "Mails to this address, or to a host address only these accounts use, in any state but completed, which the purge deletes",
                type: "integer",
                minimum: 0,
            },
        },
        required: [
            "dryRun",
            "displayNames",
            "responses",
            "teamMemberships",
            "hostedSessions",
            "teamInvites",
            "sessionHostInvites",
            "pendingMails",
        ],
        additionalProperties: false,
    },
});

export const addOpenapiUserPurgePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/user-purges", {
        post: {
            tags: ["Users"],
            summary: "Erase everything held about an address",
            description:
                "Removes every account with the given address along with what the address alone " +
                "reaches: pending invites and unsent mail. Team memberships, session hosting and " +
                "the answers a host gave about themselves follow the account. Sessions remain, " +
                "lose the host, and keep the answers they carry about the proposal. " +
                "Set meta.dryRun to report what would be removed without removing it, and the " +
                "report echoes it back as an attribute. Requires the admin role.",
            operationId: "purgeUser",
            requestBody: {
                required: true,
                content: buildResourceRequestContentObject(resourceOptions),
            },
            responses: {
                200: buildDataResponseObject({
                    description: "What was removed, or would be when dryRun is set",
                    cardinality: "one",
                    resourceSchema: purgeResourceSchema,
                }),
                403: buildErrorResponseObject({
                    description:
                        "Forbidden (forbidden), or the address belongs to the caller's own account" +
                        " (own_account), which another admin has to erase",
                }),
                409: buildErrorResponseObject({
                    description:
                        "The address was added as a host in a further edition, taken by or" +
                        " from an account, invited again, or its accounts made transitions or" +
                        " sent invites while the purge ran, repeatedly, so it gave up rather" +
                        " than delete against a moving target (concurrent_change). Retryable.",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
