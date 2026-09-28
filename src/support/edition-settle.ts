import { JsonApiError } from "@jsonapi-serde/server/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import { LockMode } from "@mikro-orm/postgresql";
import { isAfter, isBefore } from "temporal-extra";
import type { Edition } from "../entity/Edition.js";
import { HostAvailability } from "../entity/HostAvailability.js";
import { LocationAvailability } from "../entity/LocationAvailability.js";
import { Schedule } from "../entity/Schedule.js";
import { Slot } from "../entity/Slot.js";
import { compareCodeUnits } from "../util/helpers.js";
import { clampToWindow, mergeIntervals } from "./availability.js";
import {
    changeDays,
    type EditionDates,
    editionWindow,
    keepsItsLength,
    reanchor,
    reanchorClamped,
    slotFitsWindow,
    slotsOverlap,
    startDateRange,
    type WindowChange,
} from "./edition-window.js";

export type SettledSession = {
    id: string;
    title: string;
    slotsRemoved: number;
    slotsLeft: number;
};

export type SettleReport = {
    sessions: SettledSession[];
    trimmedAvailability: number;
    droppedAvailability: number;
};

export const loadDraftSlots = async (em: EntityManager, edition: Edition): Promise<Slot[]> => {
    const schedules = await em.find(
        Schedule,
        { edition, publishedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
    );

    return em.find(Slot, { schedule: { $in: schedules } }, { populate: ["session"] });
};

/**
 * Drops every slot that overlaps one already kept in the same room.
 *
 * Two slots reading the same wall clock in an hour the clocks repeated settle
 * onto the one instant that hour becomes, so a room can end up holding both.
 * Every other rule here judges a slot on its own; this is the one that has to
 * look at its neighbors, and it is the same test that would have refused the
 * second of them at the time.
 */
const dropCollisions = (em: EntityManager, kept: Slot[]): Slot[] => {
    const byRoom = new Map<string, Slot[]>();
    const survivors: Slot[] = [];

    const ordered = [...kept].sort(
        (left, right) =>
            Temporal.Instant.compare(left.startsAt, right.startsAt) ||
            compareCodeUnits(left.id, right.id),
    );

    for (const slot of ordered) {
        const room = `${slot.schedule.id}:${slot.location.id}`;
        const neighbors = byRoom.get(room) ?? [];

        if (neighbors.some((neighbor) => slotsOverlap(slot, neighbor))) {
            em.remove(slot);
            continue;
        }

        neighbors.push(slot);
        byRoom.set(room, neighbors);
        survivors.push(slot);
    }

    return survivors;
};

export const settleSlots = (
    em: EntityManager,
    edition: Edition,
    slots: readonly Slot[],
    change: WindowChange,
): SettledSession[] => {
    const window = editionWindow(edition);
    const kept: Slot[] = [];

    for (const slot of slots) {
        const before = { startsAt: slot.startsAt, endsAt: slot.endsAt };
        const startsAt = reanchor(slot.startsAt, change);
        const endsAt = reanchor(slot.endsAt, change);
        const settled = startsAt && endsAt && keepsItsLength(before, { startsAt, endsAt });

        if (startsAt) {
            slot.startsAt = startsAt;
        }

        if (endsAt) {
            slot.endsAt = endsAt;
        }

        if (!(settled && slotFitsWindow(slot, window))) {
            em.remove(slot);
            continue;
        }

        kept.push(slot);
    }

    const survivors = dropCollisions(em, kept);
    const surviving = new Set(survivors.map((slot) => slot.id));

    for (const slot of survivors) {
        em.persist(slot);
    }

    const touched = new Map<string, SettledSession>();

    for (const slot of slots) {
        const session = slot.session.unwrap();
        const entry = touched.get(session.id) ?? {
            id: session.id,
            title: session.title,
            slotsRemoved: 0,
            slotsLeft: 0,
        };

        if (surviving.has(slot.id)) {
            entry.slotsLeft += 1;
        } else {
            entry.slotsRemoved += 1;
        }

        touched.set(session.id, entry);
    }

    return [...touched.values()].filter((session) => session.slotsRemoved > 0);
};

export type Availability = HostAvailability | LocationAvailability;

export const loadAvailability = async (
    em: EntityManager,
    edition: Edition,
): Promise<Availability[]> => {
    // Ordered so that two answers tying on their start always leave the same
    // one of them behind when they merge.
    const [hosts, locations] = await Promise.all([
        em.find(HostAvailability, { host: { edition } }, { orderBy: { id: "asc" } }),
        em.find(LocationAvailability, { location: { edition } }, { orderBy: { id: "asc" } }),
    ]);

    return [...hosts, ...locations];
};

type OwnedAvailability = { owner: string; availability: Availability };

const availabilityOwner = (availability: Availability): string =>
    availability instanceof HostAvailability
        ? `host:${availability.host.id}`
        : `location:${availability.location.id}`;

const mergeByOwner = (em: EntityManager, kept: readonly OwnedAvailability[]): void => {
    const byOwner = new Map<string, Availability[]>();

    for (const { owner, availability } of kept) {
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), availability]);
    }

    for (const owned of byOwner.values()) {
        const { kept: survivors, absorbed } = mergeIntervals(owned);

        for (const availability of survivors) {
            em.persist(availability);
        }

        for (const availability of absorbed) {
            em.remove(availability);
        }
    }
};

export const settleAvailability = (
    em: EntityManager,
    edition: Edition,
    availabilities: readonly Availability[],
    change: WindowChange,
): Pick<SettleReport, "trimmedAvailability" | "droppedAvailability"> => {
    const window = editionWindow(edition);
    const kept: OwnedAvailability[] = [];
    let trimmedAvailability = 0;
    let droppedAvailability = 0;

    for (const availability of availabilities) {
        const start = reanchorClamped(availability.startsAt, change);
        const end = reanchorClamped(availability.endsAt, change);

        // Either a span already back to front on the wall clock, or one lying
        // wholly inside an hour that no longer exists; clamping straightens
        // out neither.
        if (!isBefore(start.instant, end.instant)) {
            droppedAvailability += 1;
            em.remove(availability);
            continue;
        }

        availability.startsAt = start.instant;
        availability.endsAt = end.instant;

        const outcome = clampToWindow(availability, window);

        if (outcome === "dropped") {
            droppedAvailability += 1;
            em.remove(availability);
            continue;
        }

        // An edge that gave ground to an hour that does not exist has lost the
        // speaker time just as surely as the window cutting into it.
        if (outcome === "clamped" || start.clamped || end.clamped) {
            trimmedAvailability += 1;
        }

        kept.push({ owner: availabilityOwner(availability), availability });
    }

    mergeByOwner(em, kept);

    return { trimmedAvailability, droppedAvailability };
};

const startDateRequiredError = (next: EditionDates, previous: EditionDates): JsonApiError => {
    const range = startDateRange(previous, next);

    return new JsonApiError({
        status: "409",
        code: "start_date_required",
        title: "Start date required",
        detail: "Say which day the edition's first day becomes, and the schedule follows it",
        source: { pointer: "/data/meta/startDateBecomes" },
        meta: {
            previousStartDate: previous.startDate.toString(),
            earliest: range.earliest.toString(),
            latest: range.latest.toString(),
        },
    });
};

/**
 * Asks whenever the days move under what is scheduled.
 *
 * Nothing in the two date deltas says which way it was meant: both ends forward
 * by one is a convention that moved, and equally one that dropped a setup day
 * and gained a teardown day. A change of zone alone moves no days and so asks
 * nothing.
 */
export const resolveDays = (
    edition: Edition,
    previous: EditionDates,
    anythingToSettle: boolean,
    startsOn: Temporal.PlainDate | undefined,
): number => {
    const daysMoved = !(
        previous.startDate.equals(edition.startDate) && previous.endDate.equals(edition.endDate)
    );

    if (!daysMoved) {
        return 0;
    }

    if (startsOn) {
        const range = startDateRange(previous, edition);

        if (isBefore(startsOn, range.earliest) || isAfter(startsOn, range.latest)) {
            throw startDateRequiredError(edition, previous);
        }

        return changeDays(previous, startsOn);
    }

    if (anythingToSettle) {
        throw startDateRequiredError(edition, previous);
    }

    return 0;
};
