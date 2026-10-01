import type { SlottableSession } from "#/queries/session.js";
import type { ScheduleAxis } from "./geometry.js";
import { type Candidate, closedRanges, type MinuteSpan, occupiedRange } from "./placement.js";

type SessionHost = SlottableSession["hosts"][number];

/**
 * Merges the minutes down the axis at which any of these people is not free.
 *
 * The union of each host's closed time rather than the intersection: a session
 * needs everyone on it, so one person being elsewhere is enough to be worth
 * saying. A host who named no availability is treated as free throughout, the
 * same reading `closedRanges` gives a room that named none.
 *
 * Never a refusal, for the reason findCollisions gives. An organizer may know
 * something a speaker's calendar does not.
 */
export const unavailableRanges = (
    axis: ScheduleAxis,
    hosts: readonly SessionHost[],
): MinuteSpan[] => {
    const closed = hosts.flatMap((host) => closedRanges(axis, host.availabilities));

    if (closed.length === 0) {
        return [];
    }

    const ordered = [...closed].sort((left, right) => left.from - right.from);
    const merged: MinuteSpan[] = [];

    for (const span of ordered) {
        const last = merged.at(-1);

        // Touching counts as overlapping: two bands meeting on a minute are one
        // band, and drawn separately they leave a hairline nothing means.
        if (!last || span.from > last.to) {
            merged.push({ ...span });
            continue;
        }

        last.to = Math.max(last.to, span.to);
    }

    return merged;
};

/**
 * Names who among them is missing for this stretch, for a sentence rather than ink.
 *
 * The shading says when; this says who, which is the part an organizer acts on.
 */
export const hostsUnavailableDuring = (
    axis: ScheduleAxis,
    hosts: readonly SessionHost[],
    span: MinuteSpan,
): string[] =>
    hosts
        .filter((host) =>
            closedRanges(axis, host.availabilities).some(
                (closed) => closed.from < span.to && closed.to > span.from,
            ),
        )
        .map((host) => host.displayName);

/**
 * Phrases the people this stretch would take from somewhere else.
 *
 * Nothing when everyone on it is free, so a caller can render on presence
 * alone. Joined with "and" rather than counted, because two names fit and a
 * count sends the reader looking for who.
 */
export const missingHostsNote = (
    axis: ScheduleAxis,
    hosts: readonly SessionHost[],
    span: MinuteSpan,
): string | undefined => {
    const missing = hostsUnavailableDuring(axis, hosts, span);

    return missing.length === 0 ? undefined : `${missing.join(" and ")} not free`;
};

/**
 * Answers missingHostsNote for where a gesture points, and stays silent on a refusal.
 *
 * Measured against the stretch the slot would hold a room for rather than its
 * body, which is the reading a collision already takes: against the body alone a
 * ghost's own shoulder could sit inside a warning band while nothing said so.
 *
 * Silent while a drop is refused. That refusal is why nothing will happen here
 * at all, and who is free matters only somewhere it can.
 */
export const candidateMissingNote = (
    axis: ScheduleAxis,
    hosts: readonly SessionHost[] | undefined,
    candidate: Candidate | null,
    refused: boolean,
): string | undefined =>
    hosts === undefined || candidate === null || refused
        ? undefined
        : missingHostsNote(axis, hosts, occupiedRange(candidate.span, candidate.shoulders));
