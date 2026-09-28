export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }

        const onAbort = () => {
            clearTimeout(timeout);
            resolve();
        };

        const timeout = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        signal?.addEventListener("abort", onAbort, { once: true });
    });

/**
 * Stops waiting on the work, which keeps running when the wait runs out.
 *
 * A signal cannot cancel a query already in flight, so giving up here stops the
 * waiting alone.
 */
export const withTimeout = async (work: Promise<unknown>, ms: number): Promise<boolean> => {
    const controller = new AbortController();

    try {
        return await Promise.race([
            work.then(() => true),
            sleep(ms, controller.signal).then(() => false),
        ]);
    } finally {
        // Leaves no pending timer to hold the process open once the race is
        // decided, which is the whole point during a shutdown.
        controller.abort();
    }
};

/**
 * Counts back from now in the system time zone, where a day can last 23 or 25 hours.
 *
 * Instant arithmetic rejects calendar units, and configured durations such as
 * retention periods and cooldowns may carry days or more.
 */
export const instantAgo = (duration: Temporal.Duration): Temporal.Instant =>
    Temporal.Now.zonedDateTimeISO().subtract(duration).toInstant();

export const timeZonesIds = Intl.supportedValuesOf("timeZone");
