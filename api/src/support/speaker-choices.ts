import { JsonApiError } from "@jsonapi-serde/server/common";
import type { EntityManager } from "@mikro-orm/core";
import type { Edition } from "../entity/Edition.js";
import { SessionType } from "../entity/SessionType.js";
import { Track } from "../entity/Track.js";

type PickedField = "sessionType" | "track";

const nothingToPickError = (field: PickedField, label: string): JsonApiError =>
    new JsonApiError({
        status: "409",
        code: "nothing_to_pick",
        title: "Nothing to pick",
        detail: `Speakers could not submit: the ${label} is required and none is offered to them`,
        meta: { field },
    });

/**
 * Refuses a configuration that leaves speakers a required choice with nothing to pick.
 *
 * Counts stored rows, so a caller changing a session type or track flushes first. The
 * session type is always required; the track only when the edition makes it so.
 */
export const assertSpeakersCanPick = async (
    em: EntityManager,
    edition: Edition,
    field: PickedField,
): Promise<void> => {
    if (field === "sessionType") {
        if ((await em.count(SessionType, { edition, internal: false })) === 0) {
            throw nothingToPickError("sessionType", "session type");
        }

        return;
    }

    if (
        edition.sessionFieldOptions.track?.requirement === "required" &&
        (await em.count(Track, { edition, internal: false })) === 0
    ) {
        throw nothingToPickError("track", "track");
    }
};
