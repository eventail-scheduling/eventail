import type { Schedule, Slot } from "#/queries/schedule.js";

/**
 * Keys a slot by everything publishing would announce.
 *
 * Its own id is left out: publishing copies each slot into the next draft under
 * a fresh id, so comparing those would call every draft changed. The stableId is
 * what the API keeps across a publication precisely so a consumer reads a moved
 * slot as the same one, which makes it the identity to compare on.
 */
const announced = (slot: Slot): string =>
    [
        slot.stableId,
        slot.startsAt.toString(),
        slot.endsAt.toString(),
        slot.setupTime.toString(),
        slot.teardownTime.toString(),
        slot.location.id,
        slot.session.id,
    ].join("|");

const slotsDiffer = (draft: Schedule, publication: Schedule): boolean => {
    if (draft.slots.length !== publication.slots.length) {
        return true;
    }

    const published = new Set(publication.slots.map(announced));

    return draft.slots.some((slot) => !published.has(announced(slot)));
};

/** The window a publication announced, which the edition is free to have left. */
type EditionWindow = {
    startDate: Temporal.PlainDate;
    endDate: Temporal.PlainDate;
    timeZone: string;
};

const windowDiffers = (publication: Schedule, edition: EditionWindow): boolean =>
    publication.startDate?.equals(edition.startDate) !== true ||
    publication.endDate?.equals(edition.endDate) !== true ||
    publication.timeZone !== edition.timeZone;

/**
 * Reports whether publishing would announce anything the current publication does not.
 *
 * Three ways it can, and the slots are only the first. A publication also stamps
 * the window it was announced for, which an edition can leave behind without
 * moving a single slot: widening the dates, or renaming the zone to another that
 * agrees at every edge, leaves every instant where it was and the publication
 * still saying the old thing. And a preliminary publication has a final one
 * still to come, which is the one part of this a slot cannot express, since
 * publishing is the only thing that writes that flag.
 *
 * Used to disable publishing rather than to refuse it, and deliberately not used
 * to gate reverting: this is a comparison written by hand, and a miss here would
 * withhold a publication, where the same miss on reverting would take away a way
 * back.
 */
export const hasUnpublishedChanges = (
    draft: Schedule,
    publication: Schedule | null,
    edition: EditionWindow,
): boolean =>
    publication === null ||
    publication.preliminary ||
    windowDiffers(publication, edition) ||
    slotsDiffer(draft, publication);
