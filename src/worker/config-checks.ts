/**
 * Fails at startup rather than queueing quietly on an undersized pool.
 *
 * Two spare connections cover the leader's maintenance tasks running alongside
 * the claim loops.
 */
export const assertConcurrencyFitsPool = (concurrency: number, poolSize: number): void => {
    if (concurrency > poolSize - 2) {
        throw new Error(
            `worker.runtime.concurrency (${concurrency}) needs a postgres pool of at least ` +
                `${concurrency + 2} connections, but the pool holds ${poolSize}`,
        );
    }
};
