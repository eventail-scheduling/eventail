import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { zt } from "zod-temporal";
import type { Edition } from "../../../entity/Edition.js";
import { Schedule } from "../../../entity/Schedule.js";
import { settledSlotsDocumentMetaSchemaObject } from "../../../json-api/edition.js";
import { serialize } from "../../../json-api/index.js";
import { scheduleResourceSchema } from "../../../json-api/schedule.js";
import { bumpEditionRevision } from "../../../support/edition-revision.js";
import { resolveDays, settleSlots } from "../../../support/edition-settle.js";
import type { WindowChange } from "../../../support/edition-window.js";
import { takeEdition } from "../../../support/locking.js";
import { findCurrentSchedule, stampedWindow } from "../../../support/schedules.js";
import { assertExists } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../../util/openapi.js";
import { EDITION } from "../resolve-edition-layer.js";

const assertUnpublished = (schedule: Schedule): void => {
    if (schedule.publishedAt) {
        throw new JsonApiError({
            status: "409",
            code: "already_published",
            title: "Already published",
            detail: "This schedule has already been published",
        });
    }
};

export const loadUnpublishedSchedule = async (
    scheduleId: string,
    edition: Edition,
    em: EntityManager,
): Promise<Schedule> => {
    const schedule = await em.findOne(
        Schedule,
        {
            id: scheduleId,
            edition,
        },
        {
            lockMode: LockMode.PESSIMISTIC_WRITE,
        },
    );
    assertExists(schedule, "Schedule", scheduleId);
    assertUnpublished(schedule);

    return schedule;
};

const publicationAttributesSchema = z.strictObject({
    preliminary: z.boolean(),
});

const publicationResourceOptions = {
    type: "schedule_publication",
    attributesSchema: publicationAttributesSchema,
} satisfies AnyParseResourceRequestOptions;
const publicationContentObject = buildResourceRequestContentObject(publicationResourceOptions);

const assertPhaseIsMonotonic = async (
    edition: Edition,
    preliminary: boolean,
    em: EntityManager,
): Promise<void> => {
    if (!preliminary) {
        return;
    }

    const existingFinal = await em.findOne(Schedule, {
        edition,
        publishedAt: { $ne: null },
        preliminary: false,
    });

    if (existingFinal) {
        throw new JsonApiError({
            status: "409",
            code: "already_final",
            title: "Already final",
            detail: "This edition has a final publication, which a preliminary one cannot follow",
        });
    }
};

export const publishScheduleHandler = createExtractHandler(
    pathParams(z.object({ scheduleId: z.uuid() })),
    jsonApiResource(publicationResourceOptions),
    extension(EDITION, true),
).handler(async ({ scheduleId }, { attributes }, staleEdition) => {
    await em.transactional(async (em) => {
        // Exclusive so two publishes serialize: assertPhaseIsMonotonic reads the
        // last publication without locking it, so two under a shared lock would
        // both pass. Taken before the schedule lock because the successor draft's
        // insert takes FOR KEY SHARE on the edition at flush time, which is the
        // same two rows in the opposite order.
        const edition = await takeEdition(em, staleEdition.id, {
            mode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
        });

        const schedule = await loadUnpublishedSchedule(scheduleId, edition, em);
        await assertPhaseIsMonotonic(edition, attributes.preliminary, em);
        await em.populate(schedule, ["slots"]);
        schedule.publish(edition, Temporal.Now.instant(), attributes.preliminary);

        const nextSchedule = new Schedule({
            edition: schedule.edition,
            sequence: schedule.sequence + 1,
        });

        for (const slot of schedule.slots) {
            nextSchedule.slots.add(slot.copyToSchedule(ref(nextSchedule)));
        }

        em.persist([schedule, nextSchedule]);
        await bumpEditionRevision(em, edition);
    });

    return StatusCode.NO_CONTENT;
});

/**
 * The same directive an edition patch takes, asked in the same place.
 *
 * resolveDays points its refusal at /data/meta/startDateBecomes, so moving this
 * to an attribute would leave the error naming a member the request does not
 * have.
 */
const reversionDirectiveSchema = z
    .strictObject({ startDateBecomes: zt.plainDate().optional() })
    .optional();

const reversionResourceOptions = {
    type: "schedule_reversion",
    attributesSchema: z.strictObject({}),
    metaSchema: reversionDirectiveSchema,
} satisfies AnyParseResourceRequestOptions;

const reversionContentObject = buildResourceRequestContentObject(reversionResourceOptions);

/**
 * Refills the working draft from the last publication rather than emptying it.
 *
 * The draft is refilled in place instead of replaced, because publishing already
 * creates the next draft and only the highest sequence is the working one; a
 * second unpublished schedule would orphan the one being discarded. A
 * publication stamps the window it was announced for, so slots that predate an
 * edition move settle against the same window change an edition patch applies.
 */
export const revertScheduleHandler = createExtractHandler(
    pathParams(z.object({ scheduleId: z.uuid() })),
    jsonApiResource(reversionResourceOptions),
    extension(EDITION, true),
).handler(async ({ scheduleId }, { meta }, staleEdition) => {
    const result = await em.transactional(async (em) => {
        // Exclusive because the publication this copies from is read below
        // without a lock of its own, and the slots written here are derived
        // from it.
        const edition = await takeEdition(em, staleEdition.id, {
            mode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
        });
        const schedule = await loadUnpublishedSchedule(scheduleId, edition, em);
        await em.populate(schedule, ["slots"]);

        for (const slot of schedule.slots) {
            em.remove(slot);
        }

        const published = await findCurrentSchedule(em, edition, {
            populate: ["slots.session"],
        });

        if (!published) {
            return { schedule, settled: { sessions: [] } };
        }

        const previous = stampedWindow(published);
        const copies = published.slots.getItems().map((slot) => slot.copyToSchedule(ref(schedule)));

        // Added before settling rather than after it. Collection.add persists
        // whatever it is handed, so adding a slot that settling has already
        // removed takes it back off the remove stack and inserts it; settling
        // instead has the last word, and its remove empties the collection too.
        for (const slot of copies) {
            schedule.slots.add(slot);
        }

        const change: WindowChange = {
            previous,
            next: edition,
            days: resolveDays(edition, previous, copies.length > 0, meta?.startDateBecomes),
        };

        return { schedule, settled: { sessions: settleSlots(em, edition, copies, change) } };
    });

    return serialize("schedule", result.schedule, { meta: { settled: result.settled } });
});

export const addOpenapiScheduleLifecyclePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/schedules/{scheduleId}/publication", {
        post: {
            tags: ["Schedules"],
            summary: "Publish a schedule",
            description:
                "Publishes a draft schedule and copies its slots into a fresh draft, which becomes the schedule further edits go to. Answers with no content: read the successor from the schedules list, or from /schedules/latest. A publication is either preliminary or final, and a preliminary one cannot follow a final one. Requires the manager role.",
            operationId: "publishSchedule",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
            ],
            requestBody: {
                required: true,
                content: publicationContentObject,
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or schedule not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Schedule already published (already_published), or a preliminary publication was requested after a final one (already_final)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/schedules/{scheduleId}/reversion", {
        post: {
            tags: ["Schedules"],
            summary: "Revert a draft schedule to the last publication",
            description:
                "Discards the draft's slots and refills it from the current publication, which is left untouched. An edition with nothing published yet gets an empty draft. Slots settle against the window the publication was announced for, so a slot the edition has since moved away from is dropped and reported in meta.settled; when the days moved, startDateBecomes says where the first day lands, exactly as it does on an edition patch. Requires the manager role.",
            operationId: "revertSchedule",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
            ],
            requestBody: {
                required: true,
                content: reversionContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: scheduleResourceSchema,
                    meta: settledSlotsDocumentMetaSchemaObject,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or schedule not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Schedule already published (already_published), or the edition moved since the publication and startDateBecomes was not given (start_date_required)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
