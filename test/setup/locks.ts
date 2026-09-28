import { setTimeout as delay } from "node:timers/promises";
import type { EntityManager } from "@mikro-orm/core";

type WaitForLockWaitersOptions = {
    count?: number;
    blockedBy?: number;
    timeoutMs?: number;
    pollIntervalMs?: number;
};

type WaiterRow = {
    waiting: number;
};

/**
 * Resolves once `count` other backends on this database are blocked on a lock.
 *
 * A test can then act at the moment contention exists rather than after an
 * arbitrary delay. The entity manager must not be inside a transaction, and
 * must not be one of the managers doing the blocking. With `blockedBy`, only
 * waiters that backend pid blocks count. A waiter whose lock was just released
 * is blocked by nobody, so it cannot satisfy this even while pg_stat_activity
 * still shows its wait.
 *
 * @throws {Error} if the waiters do not appear within `timeoutMs`
 */
export const waitForLockWaiters = async (
    em: EntityManager,
    { count = 1, blockedBy, timeoutMs = 5000, pollIntervalMs = 10 }: WaitForLockWaitersOptions = {},
): Promise<void> => {
    const deadline = performance.now() + timeoutMs;

    for (;;) {
        const rows = await em.getConnection().execute<WaiterRow[]>(
            `select count(*)::int as waiting
               from pg_stat_activity
              where datname = current_database()
                and wait_event_type = 'Lock'
                and pid <> pg_backend_pid()
                and (?::int is null or ?::int = any(pg_blocking_pids(pid)))`,
            [blockedBy ?? null, blockedBy ?? null],
        );

        if (rows[0].waiting >= count) {
            return;
        }

        if (performance.now() >= deadline) {
            throw new Error(
                `Timed out after ${timeoutMs}ms waiting for ${count} blocked backend(s), saw ${rows[0].waiting}`,
            );
        }

        await delay(pollIntervalMs);
    }
};

type ReleaseAfterLockWaitOptions = WaitForLockWaitersOptions & {
    whileHeld?: () => Promise<void>;
};

/**
 * Releases the held transaction whether or not the waiter ever appeared.
 *
 * A missed wait then fails as an assertion rather than hanging the suite on a
 * transaction that never closes. Returns the wait error, or null, for the
 * caller to throw once it has awaited its held work. `whileHeld` runs after the
 * wait and before the release, and a throw from it is returned the same way.
 */
export const releaseAfterLockWait = async (
    em: EntityManager,
    release: () => void,
    { whileHeld, ...options }: ReleaseAfterLockWaitOptions = {},
): Promise<unknown> => {
    try {
        await waitForLockWaiters(em, options);
        await whileHeld?.();

        return null;
    } catch (error) {
        return error;
    } finally {
        release();
    }
};
