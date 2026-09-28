import type { SlottableSession } from "#/queries/session.js";

const noMargin = Temporal.Duration.from({ minutes: 0 });

/** How long a slot runs and how long it holds its room either side. */
export type SlotShape = {
    length: Temporal.Duration;
    setupTime: Temporal.Duration;
    teardownTime: Temporal.Duration;
};

/**
 * Reads what the session asks for, which a slot may have been given more or less of.
 *
 * Read live rather than from the slot, so a speaker who has since shortened
 * their session shows the length they now want rather than the one this slot was
 * placed at. A session that named no margin takes none, and one that named no
 * length takes its type's.
 */
export const sessionShape = (session: SlottableSession): SlotShape => ({
    length: session.duration ?? session.sessionType.defaultDuration,
    setupTime: session.setupTime ?? noMargin,
    teardownTime: session.teardownTime ?? noMargin,
});
