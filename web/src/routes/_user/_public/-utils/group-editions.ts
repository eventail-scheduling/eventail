import { isAfter, isBefore } from "temporal-extra";
import type { ListEdition } from "#/queries/edition.js";

export type EditionGroup = {
    key: string;
    heading: string;
    editions: ListEdition[];
};

/** Files each edition by the date where it takes place, which may not be the viewer's. */
export const groupEditions = (editions: ListEdition[], now: Temporal.Instant): EditionGroup[] => {
    const running: ListEdition[] = [];
    const upcoming: ListEdition[] = [];
    const past: ListEdition[] = [];

    for (const edition of editions) {
        const today = now.toZonedDateTimeISO(edition.timeZone).toPlainDate();

        if (isAfter(edition.startDate, today)) {
            upcoming.push(edition);
        } else if (isBefore(edition.endDate, today)) {
            past.push(edition);
        } else {
            running.push(edition);
        }
    }

    const byStartDateAscending = (left: ListEdition, right: ListEdition): number =>
        Temporal.PlainDate.compare(left.startDate, right.startDate);

    running.sort(byStartDateAscending);
    upcoming.sort(byStartDateAscending);
    past.sort((left, right) => byStartDateAscending(right, left));

    return [
        { key: "running", heading: "Happening now", editions: running },
        { key: "upcoming", heading: "Upcoming", editions: upcoming },
        { key: "past", heading: "Past", editions: past },
    ].filter((group) => group.editions.length > 0);
};
