import assert from "node:assert";
import type { FindOneOptions, Loaded } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Edition } from "../entity/Edition.js";
import { Schedule } from "../entity/Schedule.js";
import type { EditionDates } from "./edition-window.js";

/**
 * Finds the current publication under a total order.
 *
 * Which publication counts as current is part of the integration contract, so
 * the order has to be total rather than rest on two rows never sharing an
 * instant.
 */
export const findCurrentSchedule = async <Populate extends string = never>(
    em: EntityManager,
    edition: Edition,
    options: Omit<FindOneOptions<Schedule, Populate>, "orderBy"> = {},
): Promise<Loaded<Schedule, Populate> | null> =>
    em.findOne(
        Schedule,
        { edition, publishedAt: { $ne: null } },
        { ...options, orderBy: { sequence: "desc" } },
    );

/**
 * Reads back the window a publication was announced for.
 *
 * A schedule stamps its own dates as it publishes, and the check constraint
 * makes the three non-null exactly when publishedAt is, so this narrowing holds
 * for any published schedule and fails loudly on a draft.
 */
export const stampedWindow = (schedule: Schedule): EditionDates => {
    assert(
        schedule.startDate && schedule.endDate && schedule.timeZone,
        "Published schedule carries no window",
    );

    return {
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        timeZone: schedule.timeZone,
    };
};
