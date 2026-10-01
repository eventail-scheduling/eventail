type ClockAnchor = {
    serverEpochMilliseconds: number;
    performanceMilliseconds: number;
};

let anchor: ClockAnchor | null = null;
const listeners = new Set<() => void>();

/**
 * Anchors the server clock to a reading of it, taken over one round trip.
 *
 * The reading is taken to have been made halfway through the trip, and the
 * clock runs on from there by this page's monotonic clock, which the local
 * wall clock being wrong or being set does not move.
 */
export const syncServerClock = (
    serverTime: Temporal.Instant,
    sentAt: DOMHighResTimeStamp,
    receivedAt: DOMHighResTimeStamp,
): void => {
    anchor = {
        serverEpochMilliseconds: serverTime.epochMilliseconds + (receivedAt - sentAt) / 2,
        performanceMilliseconds: receivedAt,
    };

    for (const listener of listeners) {
        listener();
    }
};

/**
 * Calls back whenever a new reading lands, until the returned function is called.
 *
 * A timer set against the old reading can be far off after a machine sleeps,
 * since the monotonic clock may not run meanwhile, so whatever waits on
 * `serverNow` checks again when the reading taken on wake arrives.
 */
export const onServerClockSync = (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
};

/**
 * Tells the server's time, for comparing against an instant the server set.
 *
 * Falls back to the local clock until the first reading lands.
 */
export const serverNow = (): Temporal.Instant => {
    if (anchor === null) {
        return Temporal.Now.instant();
    }

    return Temporal.Instant.fromEpochMilliseconds(
        Math.floor(
            anchor.serverEpochMilliseconds + performance.now() - anchor.performanceMilliseconds,
        ),
    );
};
