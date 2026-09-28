import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseResourceRequestOptions,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { isAfter } from "temporal-extra";
import { z } from "zod";
import { zt } from "zod-temporal";
import type { Edition } from "../../../entity/Edition.js";
import { Location } from "../../../entity/Location.js";
import type { Schedule } from "../../../entity/Schedule.js";
import { Session, slottableStates } from "../../../entity/Session.js";
import { Slot } from "../../../entity/Slot.js";
import { serialize } from "../../../json-api/index.js";
import { slotResourceSchema } from "../../../json-api/slot.js";
import { editionWindow, slotFitsWindow, slotsOverlap } from "../../../support/edition-window.js";
import { takeEdition } from "../../../support/locking.js";
import {
    referenceGone,
    translateForeignKeyViolations,
} from "../../../util/constraint-violation.js";
import { assertExists, patchObject } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../../util/openapi.js";
import { durationSchema } from "../../../util/zod.js";
import { EDITION } from "../resolve-edition-layer.js";
import { loadUnpublishedSchedule } from "./lifecycle.js";

const slotAttributesSchema = z.strictObject({
    startsAt: zt.instant(),
    endsAt: zt.instant(),
    setupTime: durationSchema,
    teardownTime: durationSchema,
});

const slotRelationshipsSchema = z.strictObject({
    session: relationshipSchema(resourceIdentifierSchema("session", z.uuid())),
    location: relationshipSchema(resourceIdentifierSchema("location", z.uuid())),
});

const assertSlottableSession = (session: Session): void => {
    if (!slottableStates.includes(session.state)) {
        throw new JsonApiError({
            status: "409",
            code: "session_not_slottable",
            title: "Session not slottable",
            detail: "Only accepted or confirmed sessions can be scheduled",
        });
    }
};

const assertAvailableSlot = async (slot: Slot, em: EntityManager): Promise<void> => {
    const neighbors = await em.find(Slot, {
        id: { $ne: slot.id },
        schedule: slot.schedule,
        location: slot.location,
    });

    if (neighbors.some((neighbor) => slotsOverlap(slot, neighbor))) {
        throw new JsonApiError({
            status: "409",
            code: "already_occupied",
            title: "Already occupied",
            detail: "This slot is already occupied",
        });
    }
};

type LockedSlot = {
    schedule: Schedule;
    slot: Slot;
};

/**
 * Takes the schedule lock before the slot's, which every slot writer does.
 *
 * Reverting and the edition's settle both hold the schedule and then remove its
 * slots, so a writer taking the slot first would deadlock against them.
 */
const loadSlotForWrite = async (
    scheduleId: string,
    slotId: string,
    edition: Edition,
    em: EntityManager,
): Promise<LockedSlot> => {
    const schedule = await loadUnpublishedSchedule(scheduleId, edition, em);
    const slot = await em.findOne(
        Slot,
        { id: slotId, schedule },
        {
            lockMode: LockMode.PESSIMISTIC_WRITE,
        },
    );
    assertExists(slot, "Slot", slotId);

    return { schedule, slot };
};

/**
 * Judges the slot rather than the body that arrived.
 *
 * An update may send one end and leave the other stored, so the two are only
 * comparable once merged, which a schema never sees.
 */
const assertForwardInterval = (slot: Slot): void => {
    if (isAfter(slot.endsAt, slot.startsAt)) {
        return;
    }

    throw new JsonApiError({
        status: "422",
        code: "reversed_interval",
        title: "Reversed interval",
        detail: "A slot has to end after it starts",
        source: { pointer: "/data/attributes/endsAt" },
    });
};

const assertWithinEdition = (slot: Slot, edition: Edition): void => {
    if (!slotFitsWindow(slot, editionWindow(edition))) {
        throw new JsonApiError({
            status: "422",
            code: "outside_edition",
            title: "Outside the edition",
            detail: "A slot has to lie within the days of the edition",
        });
    }
};

const createSlotResourceOptions = {
    type: "slot",
    attributesSchema: slotAttributesSchema,
    relationshipsSchema: slotRelationshipsSchema,
} satisfies AnyParseResourceRequestOptions;
const createSlotContentObject = buildResourceRequestContentObject(createSlotResourceOptions);

export const createSlotHandler = createExtractHandler(
    pathParams(z.object({ editionId: z.uuid(), scheduleId: z.uuid() })),
    jsonApiResource(createSlotResourceOptions),
).handler(async ({ editionId, scheduleId }, { attributes, relationships }) => {
    const slot = await translateForeignKeyViolations(
        () =>
            em.transactional(async (em) => {
                const edition = await takeEdition(em, editionId, { refresh: true });
                const schedule = await loadUnpublishedSchedule(scheduleId, edition, em);
                const session = await em.findOne(Session, {
                    edition: schedule.edition,
                    id: relationships.session.data.id,
                });
                assertExists(session, "Session", relationships.session.data.id);
                assertSlottableSession(session);
                const location = await em.findOne(Location, {
                    edition: schedule.edition,
                    id: relationships.location.data.id,
                });
                assertExists(location, "Location", relationships.location.data.id);

                const slot = new Slot({
                    ...attributes,
                    schedule: ref(schedule),
                    location: ref(location),
                    session: ref(session),
                });
                assertForwardInterval(slot);
                assertWithinEdition(slot, edition);
                await assertAvailableSlot(slot, em);
                em.persist(slot);

                return slot;
            }),
        {
            slot_session_id_foreign: referenceGone("Session", relationships.session.data.id),
            slot_location_id_foreign: referenceGone("Location", relationships.location.data.id),
        },
    );

    return [StatusCode.CREATED, serialize("slot", slot)];
});

const updateSlotRelationshipsSchema = slotRelationshipsSchema.omit({ session: true });

const updateSlotResourceOptions = {
    type: "slot",
    idSchema: z.uuid(),
    attributesSchema: z.optional(slotAttributesSchema.partial()),
    relationshipsSchema: z.optional(updateSlotRelationshipsSchema.partial()),
} satisfies AnyParseResourceRequestOptions;
const updateSlotContentObject = buildResourceRequestContentObject(updateSlotResourceOptions);

export const updateSlotHandler = createExtractHandler(
    pathParams(z.object({ editionId: z.uuid(), scheduleId: z.uuid(), slotId: z.uuid() })),
    jsonApiResource(updateSlotResourceOptions, "slotId"),
).handler(async ({ editionId, scheduleId, slotId }, { attributes, relationships }) => {
    const locationIdentifier = relationships?.location?.data;

    const slot = await translateForeignKeyViolations(
        () =>
            em.transactional(async (em) => {
                const edition = await takeEdition(em, editionId, { refresh: true });
                const { schedule, slot } = await loadSlotForWrite(scheduleId, slotId, edition, em);
                assertSlottableSession(await slot.session.loadOrFail());

                let location: Location | undefined;

                if (relationships?.location !== undefined) {
                    const identifier = relationships.location.data;
                    const found = await em.findOne(Location, {
                        edition: schedule.edition,
                        id: identifier.id,
                    });
                    assertExists(found, "Location", identifier.id);
                    location = found;
                }

                patchObject(slot, {
                    ...attributes,
                    ...(location !== undefined && { location: ref(location) }),
                });

                assertForwardInterval(slot);
                assertWithinEdition(slot, edition);

                await assertAvailableSlot(slot, em);
                em.persist(slot);

                return slot;
            }),
        locationIdentifier === undefined
            ? {}
            : { slot_location_id_foreign: referenceGone("Location", locationIdentifier.id) },
    );

    return serialize("slot", slot);
});

export const deleteSlotHandler = createExtractHandler(
    pathParams(z.object({ scheduleId: z.uuid(), slotId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ scheduleId, slotId }, edition) => {
    await em.transactional(async (em) => {
        const { slot } = await loadSlotForWrite(scheduleId, slotId, edition, em);
        em.remove(slot);
    });

    return StatusCode.NO_CONTENT;
});

const slotConflictResponseObject = buildErrorResponseObject({
    description:
        "Schedule already published (already_published), session not accepted or confirmed (session_not_slottable), or location occupied for the requested time including setup and teardown (already_occupied)",
});

export const addOpenapiSlotPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/schedules/{scheduleId}/slots", {
        post: {
            tags: ["Slots"],
            summary: "Create a slot",
            description:
                "Adds a slot for a session to a draft schedule. Requires the manager role.",
            operationId: "createSlot",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
            ],
            requestBody: {
                required: true,
                content: createSlotContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: slotResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description: "Edition, schedule, session or location not found",
                }),
                409: slotConflictResponseObject,
                422: buildErrorResponseObject({
                    description: "Unprocessable request (outside_edition, reversed_interval)",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/schedules/{scheduleId}/slots/{slotId}", {
        patch: {
            tags: ["Slots"],
            summary: "Update a slot",
            description:
                "Patches the timing or the location of a slot in a draft schedule, leaving out what is not sent. The session a slot belongs to cannot be changed. Requires the manager role.",
            operationId: "updateSlot",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
                createUuidPathParameter("slotId"),
            ],
            requestBody: {
                required: true,
                content: updateSlotContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: slotResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition, schedule or location not found, or the slot does not belong to the schedule",
                }),
                409: slotConflictResponseObject,
                422: buildErrorResponseObject({
                    description: "Unprocessable request (outside_edition, reversed_interval)",
                }),
            },
        },
        delete: {
            tags: ["Slots"],
            summary: "Delete a slot",
            description: "Removes a slot from a draft schedule. Requires the manager role.",
            operationId: "deleteSlot",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("scheduleId"),
                createUuidPathParameter("slotId"),
            ],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition or schedule not found, or the slot does not belong to the schedule",
                }),
                409: buildErrorResponseObject({
                    description: "Schedule already published (already_published)",
                }),
            },
        },
    });
};
