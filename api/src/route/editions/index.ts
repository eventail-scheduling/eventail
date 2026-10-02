import assert from "node:assert";
import { jsonApiQuery, jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseQueryOptions,
    type AnyParseResourceRequestOptions,
    createQueryParser,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import { type AnyEntity, LockMode, type Ref, ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { pathParam } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder, ResponseObject } from "openapi3-ts/oas31";
import { isAfter } from "temporal-extra";
import { z } from "zod";
import { zt } from "zod-temporal";
import { CustomField } from "../../entity/CustomField.js";
import { Edition } from "../../entity/Edition.js";
import { EditionRevision } from "../../entity/EditionRevision.js";
import { Location } from "../../entity/Location.js";
import { Schedule } from "../../entity/Schedule.js";
import { Session } from "../../entity/Session.js";
import { SessionType } from "../../entity/SessionType.js";
import { Slot } from "../../entity/Slot.js";
import { Track } from "../../entity/Track.js";
import { Venue } from "../../entity/Venue.js";
import {
    editionDocumentMetaSchemaObject,
    editionResourceFields,
    editionResourceSchema,
    settledEditionDocumentMetaSchemaObject,
} from "../../json-api/edition.js";
import { serialize } from "../../json-api/index.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import {
    loadAvailability,
    loadDraftSlots,
    resolveDays,
    settleAvailability,
    settleSlots,
} from "../../support/edition-settle.js";
import type { WindowChange } from "../../support/edition-window.js";
import { uploadContentTypes } from "../../support/file-upload.js";
import { imageSlotContentTypes } from "../../support/image-probe.js";
import { lockEditionSchedules } from "../../support/locking.js";
import {
    profileFieldOptionsSchema,
    serializedProfileFieldSpecs,
} from "../../support/profile-fields.js";
import {
    serializedSessionFieldSpecs,
    sessionFieldOptionsSchema,
} from "../../support/session-fields.js";
import { assertSpeakersCanPick } from "../../support/speaker-choices.js";
import { visibleFingerprint } from "../../support/visible-changes.js";
import { appConfig } from "../../util/app-config.js";
import { RequireAuthorizationLayer } from "../../util/auth.js";
import { assertExists, patchObject } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { timeZonesIds } from "../../util/time.js";
import { nameSchema } from "../../util/zod.js";
import { confirmRemindersHandler } from "./confirm-reminders.js";
import { customFieldsRouter, reorderCustomFieldsHandler } from "./custom-fields.js";
import { hostsRouter } from "./hosts.js";
import { locationsRouter, reorderLocationsHandler } from "./locations.js";
import { meRouter } from "./me/index.js";
import { resolveEditionLayer } from "./resolve-edition-layer.js";
import { mintResponseFileHandler } from "./response-files.js";
import { schedulesRouter } from "./schedules/index.js";
import { sessionTypesRouter } from "./session-types.js";
import { sessionsRouter } from "./sessions/index.js";
import { tracksRouter } from "./tracks.js";
import { reorderVenuesHandler, venuesRouter } from "./venues.js";

const listEditionsQueryOptions = {
    fields: {
        allowed: {
            edition: editionResourceFields,
        },
    },
} satisfies AnyParseQueryOptions;

const listEditionsHandler = createExtractHandler(
    jsonApiQuery(createQueryParser(listEditionsQueryOptions)),
).handler(async (query) => {
    const editions = await em.findAll(Edition, {
        orderBy: { startDate: "desc", id: "desc" },
    });

    return serialize("edition", editions, {
        ...query,
        meta: editionDocumentMeta,
    });
});

const showEditionHandler = createExtractHandler(pathParam(z.uuid())).handler(async (editionId) => {
    const edition = await em.findOne(Edition, editionId);
    assertExists(edition, "Edition", editionId);

    return serialize("edition", edition, {
        meta: editionDocumentMeta,
    });
});

const editionDocumentMeta = {
    sessionFieldSpecs: serializedSessionFieldSpecs,
    profileFieldSpecs: serializedProfileFieldSpecs,
    maxFileSize: appConfig.s3.maxFileSize,
    fileContentTypes: uploadContentTypes,
    imageContentTypes: imageSlotContentTypes,
};

const attributesShape = {
    name: nameSchema,
    startDate: zt.plainDate(),
    endDate: zt.plainDate(),
    timeZone: z.string().refine((value) => timeZonesIds.includes(value), "Invalid timezone"),
    submissionDeadline: zt.instant().nullable(),
    sessionFieldOptions: sessionFieldOptionsSchema.optional(),
    profileFieldOptions: profileFieldOptionsSchema.optional(),
} satisfies Record<string, z.ZodType>;

const createAttributesSchema = z.strictObject(attributesShape);
const updateAttributesSchema = z.strictObject(attributesShape).partial();

/**
 * Points at a date the request actually carried.
 *
 * A patch may send either end alone, and a client that maps pointers onto form
 * fields highlights nothing when the pointer names a member it never sent.
 */
const assertDateOrder = (edition: Edition, submitted: PropertyKey[]): void => {
    if (!isAfter(edition.startDate, edition.endDate)) {
        return;
    }

    const blamed = submitted.includes("startDate") ? "startDate" : "endDate";

    throw new JsonApiError({
        status: "422",
        code: "invalid_date_range",
        title: "Invalid date range",
        detail: "The edition has to start on or before the day it ends",
        source: { pointer: `/data/attributes/${blamed}` },
    });
};

const createRelationshipsSchema = z.object({
    templateEdition: z.optional(relationshipSchema(resourceIdentifierSchema("edition", z.uuid()))),
});

const createEditionResourceOptions = {
    type: "edition",
    attributesSchema: createAttributesSchema,
    relationshipsSchema: createRelationshipsSchema.optional(),
} satisfies AnyParseResourceRequestOptions;

const createEditionContentObject = buildResourceRequestContentObject(createEditionResourceOptions);

const createEditionHandler = createExtractHandler(
    jsonApiResource(createEditionResourceOptions),
).handler(async ({ attributes, relationships }) => {
    const edition = new Edition(attributes);
    assertDateOrder(edition, Object.keys(attributes));
    const schedule = new Schedule({ edition: ref(edition), sequence: 1 });

    await em.transactional(async (em) => {
        let extraEntities: AnyEntity[] = [SessionType.default(ref(edition))];

        if (relationships?.templateEdition) {
            const template = await em.findOne(Edition, relationships.templateEdition.data.id);
            assertExists(template, "Edition", relationships.templateEdition.data.id);

            if (!attributes.sessionFieldOptions) {
                edition.sessionFieldOptions = structuredClone(template.sessionFieldOptions);
            }

            if (!attributes.profileFieldOptions) {
                edition.profileFieldOptions = structuredClone(template.profileFieldOptions);
            }

            extraEntities = await createTemplateCopies(em, ref(edition), template);
        }

        em.persist([edition, schedule, ...extraEntities]);
    });

    return [StatusCode.CREATED, serialize("edition", edition, { meta: editionDocumentMeta })];
});

const createTemplateCopies = async (
    em: EntityManager,
    edition: Ref<Edition>,
    template: Edition,
): Promise<AnyEntity[]> => {
    const entities: AnyEntity[] = [];

    const venueCopies = new Map<string, Venue>();

    for (const venue of await em.find(Venue, { edition: template })) {
        const copy = venue.copyToEdition(edition);
        venueCopies.set(venue.id, copy);
        entities.push(copy);
    }

    for (const location of await em.find(Location, { edition: template })) {
        const mappedVenue = venueCopies.get(location.venue.id);
        assert(mappedVenue);
        entities.push(location.copyToEdition(edition, ref(mappedVenue)));
    }

    const sessionTypeCopies = new Map<string, SessionType>();

    for (const sessionType of await em.find(SessionType, { edition: template })) {
        const copy = sessionType.copyToEdition(edition);
        sessionTypeCopies.set(sessionType.id, copy);
        entities.push(copy);
    }

    const trackCopies = new Map<string, Track>();

    for (const track of await em.find(Track, { edition: template })) {
        const copy = track.copyToEdition(edition);
        trackCopies.set(track.id, copy);
        entities.push(copy);
    }

    const customFields = await em.find(
        CustomField,
        { edition: template },
        { populate: ["sessionTypes", "tracks"] },
    );

    for (const customField of customFields) {
        const copy = customField.copyToEdition(edition);

        for (const sessionType of customField.sessionTypes) {
            const mappedSessionType = sessionTypeCopies.get(sessionType.id);
            assert(mappedSessionType);
            copy.sessionTypes.add(mappedSessionType);
        }

        for (const track of customField.tracks) {
            const mappedTrack = trackCopies.get(track.id);
            assert(mappedTrack);
            copy.tracks.add(mappedTrack);
        }

        entities.push(copy);
    }

    return entities;
};

const updateDirectiveSchema = z.strictObject({
    version: z.int().positive(),
    startDateBecomes: zt.plainDate().optional(),
});

const updateEditionResourceOptions = {
    type: "edition",
    attributesSchema: updateAttributesSchema,
    metaSchema: updateDirectiveSchema,
} satisfies AnyParseResourceRequestOptions;

const updateEditionContentObject = buildResourceRequestContentObject(updateEditionResourceOptions);

const visibleEditionFingerprint = (edition: Edition): string =>
    visibleFingerprint([
        edition.name,
        edition.startDate,
        edition.endDate,
        edition.timeZone,
        edition.submissionDeadline,
    ]);

const updateEditionHandler = createExtractHandler(
    pathParam(z.uuid()),
    jsonApiResource(updateEditionResourceOptions, "editionId"),
).handler(async (editionId, { attributes, meta }) => {
    const result = await em.transactional(async (em) => {
        const edition = await em.findOne(Edition, editionId, {
            lockMode: LockMode.PESSIMISTIC_WRITE,
        });
        assertExists(edition, "Edition", editionId);

        if (edition.version !== meta.version) {
            throw new JsonApiError({
                status: "409",
                code: "edition_changed",
                title: "Edition changed",
                detail: "Someone else has changed this edition; reload and try again",
            });
        }

        const previousStartDate = edition.startDate;
        const previousEndDate = edition.endDate;
        const previousTimeZone = edition.timeZone;
        const before = visibleEditionFingerprint(edition);
        const trackWasRequired = edition.sessionFieldOptions.track?.requirement === "required";

        patchObject(edition, attributes);
        assertDateOrder(edition, Object.keys(attributes));

        if (!trackWasRequired) {
            await assertSpeakersCanPick(em, edition, "track");
        }

        em.persist(edition);

        const previousDates = {
            startDate: previousStartDate,
            endDate: previousEndDate,
            timeZone: previousTimeZone,
        };
        // Asked of the inputs rather than of the window's two edges, because
        // two zones can agree at both edges and disagree in between: they need
        // only share a base offset and change over on different dates, and
        // every slot in the days between reads an hour out.
        const windowChanged = !(
            previousStartDate.equals(edition.startDate) &&
            previousEndDate.equals(edition.endDate) &&
            previousTimeZone === edition.timeZone
        );

        if (!windowChanged) {
            if (visibleEditionFingerprint(edition) !== before) {
                await bumpEditionRevision(em, edition);
            }

            return { edition, settled: null };
        }

        const slots = await loadDraftSlots(em, edition);
        const availabilities = await loadAvailability(em, edition);
        const change: WindowChange = {
            previous: previousDates,
            next: edition,
            days: resolveDays(
                edition,
                previousDates,
                slots.length + availabilities.length > 0,
                meta.startDateBecomes,
            ),
        };

        const sessions = settleSlots(em, edition, slots, change);
        const availability = settleAvailability(em, edition, availabilities, change);

        if (visibleEditionFingerprint(edition) !== before) {
            await bumpEditionRevision(em, edition);
        }

        return { edition, settled: { sessions, ...availability } };
    });

    return serialize("edition", result.edition, {
        meta: { ...editionDocumentMeta, ...(result.settled && { settled: result.settled }) },
    });
});

const deleteEditionHandler = createExtractHandler(pathParam(z.uuid())).handler(
    async (editionId) => {
        await em.transactional(async (em) => {
            const edition = await em.findOne(Edition, editionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            assertExists(edition, "Edition", editionId);

            await lockEditionSchedules(em, edition);

            // The edition cascade cannot take slots and sessions: Postgres
            // runs each cascaded table delete as its own statement, so the
            // slot and session foreign keys would reject the purge while
            // their referenced rows die later in the chain. Deleting them
            // first leaves a tree the cascade handles.
            await em.nativeDelete(Slot, { schedule: { edition } });
            await em.nativeDelete(Session, { edition });
            em.remove(edition);

            // The counter row has no foreign key to ride the cascade (see
            // EditionRevision), so it goes explicitly, and only after the
            // flush: the edition and its cascade take their locks first, and
            // the counter row stays the innermost lock as everywhere else.
            await em.flush();
            em.remove(ref(EditionRevision, edition.id));
        });

        return StatusCode.NO_CONTENT;
    },
);

const requireManagerLayer = new RequireAuthorizationLayer({ user: { role: "manager" } });

export const editionsRouter = new Router()
    .nest("/:editionId/locations", locationsRouter)
    .nest("/:editionId/custom-fields", customFieldsRouter)
    .nest("/:editionId/hosts", hostsRouter)
    .nest("/:editionId/schedules", schedulesRouter)
    .nest("/:editionId/session-types", sessionTypesRouter)
    .nest("/:editionId/sessions", sessionsRouter)
    .nest("/:editionId/tracks", tracksRouter)
    .nest("/:editionId/venues", venuesRouter)
    .nest("/:editionId/me", meRouter)
    .route(
        "/:editionId/confirm-reminders",
        m.post(confirmRemindersHandler).layer(requireManagerLayer),
    )
    .route(
        "/:editionId/responses/:responseId/file",
        m
            .get(mintResponseFileHandler)
            .layer(new RequireAuthorizationLayer({ user: true, integration: true })),
    )
    .route(
        "/:editionId/relationships/custom-fields",
        m.patch(reorderCustomFieldsHandler).layer(requireManagerLayer),
    )
    .route(
        "/:editionId/relationships/locations",
        m.patch(reorderLocationsHandler).layer(requireManagerLayer),
    )
    .route(
        "/:editionId/relationships/venues",
        m.patch(reorderVenuesHandler).layer(requireManagerLayer),
    )
    .layer(resolveEditionLayer)
    // Reads carry no role layer on purpose: the edition list and detail are
    // open to any authenticated IdP subject, including ones without a user row.
    .route("/", m.get(listEditionsHandler))
    .route("/", m.post(createEditionHandler).layer(requireManagerLayer))
    .route("/:editionId", m.get(showEditionHandler))
    .route(
        "/:editionId",
        m.patch(updateEditionHandler).delete(deleteEditionHandler).layer(requireManagerLayer),
    );

const confirmRemindersContentObject = buildResourceRequestContentObject({
    type: "confirm_reminder_dispatch",
});

const confirmRemindersResponseObject: ResponseObject = {
    description: "Reminder dispatch counts",
    content: {
        "application/vnd.api+json": {
            schema: {
                type: "object",
                properties: {
                    meta: {
                        type: "object",
                        properties: {
                            remindedSessions: {
                                type: "integer",
                                minimum: 0,
                                description: "Accepted sessions a reminder went out for",
                            },
                            skippedSessions: {
                                type: "integer",
                                minimum: 0,
                                description:
                                    "Accepted sessions left alone, either within the reminder" +
                                    " cooldown or without a host",
                            },
                        },
                        required: ["remindedSessions", "skippedSessions"],
                    },
                },
                required: ["meta"],
            },
        },
    },
};

export const addOpenapiEditionPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions", {
        get: {
            tags: ["Editions"],
            summary: "List editions",
            description:
                "Lists all editions, most recent start date first. Open to any authenticated" +
                " subject, including integration tokens and subjects without a user record.",
            operationId: "listEditions",
            parameters: buildQueryParameters(listEditionsQueryOptions),
            responses: {
                200: buildDataResponseObject({
                    description: "All editions",
                    cardinality: "many",
                    resourceSchema: editionResourceSchema,
                    meta: editionDocumentMetaSchemaObject,
                }),
            },
        },
        post: {
            tags: ["Editions"],
            summary: "Create an edition",
            description:
                "Creates an edition with an empty draft schedule and a default session type." +
                " With a template edition relationship, its locations, session types, tracks and" +
                " custom fields are copied into the new edition. Requires the manager role.",
            operationId: "createEdition",
            requestBody: {
                required: true,
                content: createEditionContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created edition",
                    cardinality: "one",
                    resourceSchema: editionResourceSchema,
                    meta: editionDocumentMetaSchemaObject,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Template edition not found" }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}", {
        get: {
            tags: ["Editions"],
            summary: "Retrieve an edition",
            description:
                "Retrieves a single edition. Open to any authenticated subject, including" +
                " integration tokens and subjects without a user record.",
            operationId: "showEdition",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "The edition",
                    cardinality: "one",
                    resourceSchema: editionResourceSchema,
                    meta: editionDocumentMetaSchemaObject,
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        patch: {
            tags: ["Editions"],
            summary: "Update an edition",
            description:
                "Updates an edition. A change of dates or timezone moves the slots of the" +
                " draft schedule and the availability given for the edition by the same number" +
                " of days, each keeping the local time it was entered at. How far they travel" +
                " comes from meta.startDateBecomes, the day the edition's current first day" +
                " turns into, which is required whenever the dates change and the edition has" +
                " anything scheduled or any availability. A change of timezone alone moves no" +
                " days and needs none." +
                " Slots that no longer fit afterwards are deleted, leaving their sessions" +
                " unscheduled, and availability is trimmed back to the edition or dropped;" +
                " meta.settled on the response says what went. Published schedules keep the" +
                " times they were published with. Requires the manager role.",
            operationId: "updateEdition",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: updateEditionContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated edition",
                    cardinality: "one",
                    resourceSchema: editionResourceSchema,
                    meta: settledEditionDocumentMetaSchemaObject,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Requiring a track while no track is offered to speakers (nothing_to_pick). " +
                        "The dates changed with something scheduled or some availability given," +
                        " and meta.startDateBecomes was absent or fell outside the range that" +
                        " may be chosen (start_date_required). That range reaches back before" +
                        " the new first day, since leaving the schedule where it is means the" +
                        " old first day keeps its date. The error meta carries both it and the" +
                        " current first day. Also when meta.version names an older write than" +
                        " the edition has taken (edition_changed).",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
        delete: {
            tags: ["Editions"],
            summary: "Delete an edition",
            description:
                "Deletes an edition and everything below it: sessions, schedules and their" +
                " slots, locations, tracks, session types, custom fields and responses." +
                " Requires the manager role.",
            operationId: "deleteEdition",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/confirm-reminders", {
        post: {
            tags: ["Editions"],
            summary: "Send confirmation reminders",
            description:
                "Mails a confirmation reminder to the hosts of every accepted session of the" +
                " edition that is outside the reminder cooldown. Requires the manager role.",
            operationId: "sendConfirmReminders",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: confirmRemindersContentObject,
            },
            responses: {
                200: confirmRemindersResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });
};
