import type { EntityManager } from "@mikro-orm/postgresql";
import { em } from "../../util/mikro-orm.js";
import { sleep } from "../../util/time.js";

const BATCH_BACKOFF_MIN = 50;
const BATCH_BACKOFF_MAX = 1_000;

/**
 * Waits a moment between batches, and says whether to carry on.
 *
 * False once the signal is dead, since the next batch would otherwise throw on
 * its own pre-query check and be logged as a failure.
 */
export const backoffBetweenBatches = async (signal?: AbortSignal): Promise<boolean> => {
    const delay = Math.random() * (BATCH_BACKOFF_MAX - BATCH_BACKOFF_MIN) + BATCH_BACKOFF_MIN;
    await sleep(delay, signal);

    return !signal?.aborted;
};

/**
 * Forks an entity manager whose queries stop when the task does.
 *
 * Every maintenance task is an idempotent batch, so canceling one mid-flight
 * costs a rollback and nothing else; the next leader runs it again. Job
 * consumers get the opposite treatment, since abandoning one halfway is how a
 * mail gets sent twice.
 */
export const abortableFork = (signal?: AbortSignal): EntityManager =>
    em.fork({ signal, inflightQueryAbortStrategy: "cancel query" });
