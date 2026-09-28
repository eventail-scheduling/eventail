import {
    coversUserDeletionReach,
    lockEditions,
    lockUserDeletionTargets,
    readUserDeletionEditionIds,
} from "../../support/locking.js";
import { appConfig } from "../../util/app-config.js";
import { instantAgo } from "../../util/time.js";
import { IntervalTask } from "../loop.js";
import { abortableFork } from "./util.js";

const config = appConfig.worker.userSweeper;

// Session hosting and team membership are the only references that keep a
// dormant account alive; a session transition nulls its actor out instead.
// Responses are absent on purpose: they hang off the host row, which only
// counts once a session references it, so answering an edition's questions
// without going on to host anything leaves the account dormant.
const referenceConditions = `
    NOT EXISTS (
        SELECT 1 FROM "session_hosts"
        INNER JOIN "host" ON "host"."id" = "session_hosts"."host_id"
        WHERE "host"."user_id" = "user"."id"
    )
    AND NOT EXISTS (
        SELECT 1 FROM "team_users" WHERE "team_users"."user_id" = "user"."id"
    )
`;

const selectStatement = `
    SELECT "id" FROM "user"
    WHERE "last_seen_at" < ?
    AND ${referenceConditions}
    ORDER BY "id" ASC
`;

/**
 * Holds the rows before deciding, since a subquery would not wait for them.
 *
 * Read committed evaluates a subquery against the snapshot its statement
 * opened with, and a row locked mid-statement is rechecked without one of its
 * own. A single delete would therefore decide that nobody hosts this account
 * and then wait out the very transaction making it a host, whose work the
 * cascade would take. Holding the rows first is what makes the delete's own
 * recheck mean anything: resolveHost takes the same lock before it writes. The
 * mode has to be this one, since a team membership only takes a key share on
 * the user, and nothing weaker conflicts with that.
 */
const holdStatement = `
    SELECT "id" FROM "user"
    WHERE "id" IN (?)
    AND "last_seen_at" < ?
    AND ${referenceConditions}
    ORDER BY "id" ASC
    FOR UPDATE
`;

const deleteStatement = `
    DELETE FROM "user"
    WHERE "id" IN (?)
    AND ${referenceConditions}
`;

export class UserSweeper extends IntervalTask {
    public constructor() {
        super({ interval: config.interval, failureMessage: "Failed to sweep dormant users" });
    }

    public async runOnce(signal?: AbortSignal): Promise<void> {
        const threshold = instantAgo(config.retentionPeriod);

        await abortableFork(signal).transactional(async (em) => {
            const candidateIds = (
                await em.execute<{ id: string }[]>(selectStatement, [threshold.toString()])
            ).map((candidate) => candidate.id);

            if (candidateIds.length === 0) {
                return;
            }

            const lockedEditionIds = await readUserDeletionEditionIds(em, {
                userIds: candidateIds,
                emailAddress: null,
            });
            await lockEditions(em, [...lockedEditionIds]);
            const lockedTargets = await lockUserDeletionTargets(em, {
                userIds: candidateIds,
                emailAddress: null,
            });

            const userIds = (
                await em.execute<{ id: string }[]>(holdStatement, [
                    candidateIds,
                    threshold.toString(),
                ])
            ).map((user) => user.id);

            if (userIds.length === 0) {
                return;
            }

            // A row committed between the reads and the locks would be locked
            // backward by the delete. The next run reads it before locking.
            if (
                !(await coversUserDeletionReach(
                    em,
                    { userIds, emailAddress: null },
                    lockedEditionIds,
                    lockedTargets,
                ))
            ) {
                return;
            }

            await em.execute(deleteStatement, [userIds]);
        });
    }
}
