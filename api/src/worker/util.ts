import assert from "node:assert";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Job } from "../entity/Job.js";

export const notifyJobsAvailable = async (em: EntityManager): Promise<void> => {
    await em.execute("NOTIFY jobs_available");
};

/**
 * Queues a job in the caller's transaction.
 *
 * The row and the wake-up then commit with whatever prompted them.
 *
 * The entity manager is required, and that is the whole point. An optional one
 * would mean falling back to `transactional` on a manager already inside a
 * transaction, which nests a savepoint, and a savepoint that rolls back takes
 * the caller's earlier writes with it: they were flushed inside it and the unit
 * of work has already advanced its original-data snapshot, so the outer flush
 * computes no change set to redo them. The transaction then commits with those
 * writes silently missing.
 */
export const publishJob = async (job: Job, em: EntityManager): Promise<void> => {
    // Outside a transaction the NOTIFY would fire before the row commits.
    assert(em.isInTransaction(), "publishJob requires a transactional entity manager");
    em.persist(job);
    await notifyJobsAvailable(em);
};
