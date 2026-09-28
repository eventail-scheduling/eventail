import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import type { ScheduleAxis } from "./geometry.js";
import { overlaps, slotOccupies, slotSpan } from "./placement.js";

/** One end of a clash: the other slot, and who is expected at both. */
export type Collision = {
    slot: Slot;
    hostNames: string[];
    /**
     * The two sessions do not themselves overlap; only their margins do.
     *
     * Worth saying out loud, because the clock times a reader can see do not
     * overlap either, and a clash between 9:45 and 10:00 reads as a mistake
     * until someone says the word setup.
     */
    marginOnly: boolean;
};

/**
 * Finds the slots wanting the same person at the same time, keyed by slot id.
 *
 * Both ends of a clash are keyed, so a block is marked wherever it is read from
 * rather than only the later one. Never a refusal: an organizer may know
 * something the schedule does not, and the API places these happily.
 *
 * Measured against the stretch a slot holds a room for, margins included, which
 * is the same reading `already_occupied` applies to a room. A speaker setting up
 * is no more free than one on stage.
 */
export const findCollisions = (
    axis: ScheduleAxis,
    slots: Slot[],
    sessions: SlottableSession[],
): ReadonlyMap<string, Collision[]> => {
    const hostsBySession = new Map(sessions.map((session) => [session.id, session.hosts]));
    const collisions = new Map<string, Collision[]>();

    const record = (slot: Slot, other: Slot, hostNames: string[], marginOnly: boolean) => {
        const existing = collisions.get(slot.id);
        const entry = { slot: other, hostNames, marginOnly };

        if (existing) {
            existing.push(entry);

            return;
        }

        collisions.set(slot.id, [entry]);
    };

    for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        const hosts = hostsBySession.get(slot.session.id);

        if (!hosts || hosts.length === 0) {
            continue;
        }

        const occupies = slotOccupies(axis, slot);

        for (let other = index + 1; other < slots.length; other += 1) {
            const candidate = slots[other];
            const candidateHosts = hostsBySession.get(candidate.session.id);

            if (!(candidateHosts && overlaps(occupies, slotOccupies(axis, candidate)))) {
                continue;
            }

            const shared = hosts.filter((host) =>
                candidateHosts.some((candidateHost) => candidateHost.id === host.id),
            );

            if (shared.length === 0) {
                continue;
            }

            const hostNames = shared.map((host) => host.displayName);
            const marginOnly = !overlaps(slotSpan(axis, slot), slotSpan(axis, candidate));
            record(slot, candidate, hostNames, marginOnly);
            record(candidate, slot, hostNames, marginOnly);
        }
    }

    return collisions;
};

/**
 * Names who is double booked at this slot, each once however many clashes.
 *
 * A host on three overlapping sessions appears in two entries here, and reading
 * their name twice would say something the schedule does not.
 */
export const collidingHostNames = (entries: Collision[]): string[] => [
    ...new Set(entries.flatMap((entry) => entry.hostNames)),
];

/** Joins each slot's clashes into one label to hang on its block, keyed by slot id. */
export const collisionWarnings = (
    collisions: ReadonlyMap<string, Collision[]>,
): ReadonlyMap<string, string> =>
    new Map(
        [...collisions].map(([slotId, entries]) => [
            slotId,
            collidingHostNames(entries).join(", "),
        ]),
    );

/** Counts clashes rather than the blocks carrying one. */
export const collisionCount = (collisions: ReadonlyMap<string, Collision[]>): number => {
    let total = 0;

    for (const entries of collisions.values()) {
        total += entries.length;
    }

    return total / 2;
};
