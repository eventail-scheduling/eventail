import {
    jsonApiQuery,
    jsonApiRelationships,
    jsonApiResource,
} from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
    buildRelationshipsRequestContentObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseQueryOptions,
    type AnyParseResourceRequestOptions,
    createQueryParser,
} from "@jsonapi-serde/server/request";
import { ForeignKeyConstraintViolationException, LockMode, ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../../entity/Edition.js";
import { Venue } from "../../entity/Venue.js";
import { serialize } from "../../json-api/index.js";
import { venueResourceFields, venueResourceSchema } from "../../json-api/venue.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import { pinEdition, takeEdition } from "../../support/locking.js";
import { visibleFingerprint } from "../../support/visible-changes.js";
import { RequireAuthorizationLayer } from "../../util/auth.js";
import {
    externalKeyTaken,
    translateUniqueViolations,
    type UniqueViolation,
} from "../../util/constraint-violation.js";
import { assertExists, patchObject } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { nameSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const venueQueryOptions = {
    fields: {
        allowed: {
            venue: venueResourceFields,
        },
    },
} as const satisfies AnyParseQueryOptions;

const parseVenueQuery = createQueryParser(venueQueryOptions);

const listVenuesHandler = createExtractHandler(
    jsonApiQuery(parseVenueQuery),
    extension(EDITION, true),
).handler(async (query, edition) => {
    const venues = await em.find(Venue, { edition }, { orderBy: { position: "asc" } });

    return serialize("venue", venues, query);
});

const showVenueHandler = createExtractHandler(
    pathParams(z.object({ venueId: z.uuid() })),
    jsonApiQuery(parseVenueQuery),
    extension(EDITION, true),
).handler(async ({ venueId }, query, edition) => {
    const venue = await em.findOne(Venue, { id: venueId, edition });
    assertExists(venue, "Venue", venueId);

    return serialize("venue", venue, query);
});

const ADDRESS_MAX_LENGTH = 500;

const addressSchema = z.string().trim().min(1).max(ADDRESS_MAX_LENGTH);

const attributesSchema = z.strictObject({
    name: nameSchema,
    address: addressSchema.nullable(),
    externalKey: nameSchema.nullable(),
});

const venueResourceOptions = {
    type: "venue",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;

const venueContentObject = buildResourceRequestContentObject(venueResourceOptions);

const venueUniqueViolations: Record<string, UniqueViolation> = {
    venue_edition_id_external_key_unique: externalKeyTaken(
        "Another venue in this edition already uses this external key",
    ),
};

const nextPosition = async (em: EntityManager, edition: Edition): Promise<number> => {
    const highest = await em.findOne(Venue, { edition }, { orderBy: { position: "desc" } });

    return highest === null ? 0 : highest.position + 1;
};

const createVenueHandler = createExtractHandler(
    jsonApiResource(venueResourceOptions),
    extension(EDITION, true),
).handler(async ({ attributes }, edition) => {
    const venue = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                const locked = await takeEdition(em, edition.id, {
                    mode: LockMode.PESSIMISTIC_WRITE,
                    refresh: true,
                });

                const created = new Venue({
                    ...attributes,
                    position: await nextPosition(em, locked),
                    edition: ref(locked),
                });
                em.persist(created);

                return created;
            }),
        venueUniqueViolations,
    );

    return [StatusCode.CREATED, serialize("venue", venue)];
});

const updateVenueHandler = createExtractHandler(
    pathParams(z.object({ venueId: z.uuid() })),
    jsonApiResource(venueResourceOptions, "venueId"),
    extension(EDITION, true),
).handler(async ({ venueId }, { attributes }, edition) => {
    const venue = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                const locked = await takeEdition(em, edition.id, { refresh: true });

                const venue = await em.findOne(
                    Venue,
                    { id: venueId, edition: locked },
                    { lockMode: LockMode.PESSIMISTIC_WRITE },
                );
                assertExists(venue, "Venue", venueId);
                const before = visibleFingerprint([venue.name, venue.address, venue.externalKey]);
                patchObject(venue, attributes);

                if (visibleFingerprint([venue.name, venue.address, venue.externalKey]) !== before) {
                    await bumpEditionRevision(em, locked);
                }

                return venue;
            }),
        venueUniqueViolations,
    );

    return serialize("venue", venue);
});

const deleteVenueHandler = createExtractHandler(
    pathParams(z.object({ venueId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ venueId }, edition) => {
    try {
        await em.transactional(async (em) => {
            await pinEdition(em, edition);

            const venue = await em.findOne(
                Venue,
                { id: venueId, edition },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );
            assertExists(venue, "Venue", venueId);
            em.remove(venue);
        });
    } catch (error) {
        if (error instanceof ForeignKeyConstraintViolationException) {
            throw new JsonApiError({
                status: "409",
                code: "entity_in_use",
                title: "Entity in use",
                detail: "The venue is still in use",
            });
        }

        throw error;
    }

    return StatusCode.NO_CONTENT;
});

const incompleteOrderError = (venues: Venue[]): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "incomplete_order",
        title: "Incomplete order",
        detail: "The order must name every venue of the edition exactly once",
        meta: {
            venueIds: venues.map((venue) => venue.id),
        },
    });

export const reorderVenuesHandler = createExtractHandler(
    jsonApiRelationships("venue", z.uuid()),
    extension(EDITION, true),
).handler(async (venueIds, edition) => {
    await em.transactional(async (em) => {
        const locked = await takeEdition(em, edition.id, { mode: LockMode.PESSIMISTIC_WRITE });
        const venues = await em.find(Venue, { edition });
        const supplied = new Set(venueIds);

        if (supplied.size !== venueIds.length || supplied.size !== venues.length) {
            throw incompleteOrderError(venues);
        }

        const byId = new Map(venues.map((venue) => [venue.id, venue]));

        for (const [position, venueId] of venueIds.entries()) {
            const venue = byId.get(venueId);

            if (!venue) {
                throw incompleteOrderError(venues);
            }

            venue.position = position;
            em.persist(venue);
        }

        await bumpEditionRevision(em, locked);
    });

    return StatusCode.NO_CONTENT;
});

export const venuesRouter = new Router()
    .route("/", m.post(createVenueHandler))
    .route("/:venueId", m.patch(updateVenueHandler).delete(deleteVenueHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    .route("/", m.get(listVenuesHandler))
    .route("/:venueId", m.get(showVenueHandler));

export const addOpenapiVenuePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/relationships/venues", {
        patch: {
            tags: ["Venues"],
            summary: "Reorder venues",
            description:
                "Sets the order of the venues of an edition. The list must name every venue of" +
                " the edition exactly once; positions are then assigned in the order given." +
                " Requires the manager role.",
            operationId: "reorderVenues",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: buildRelationshipsRequestContentObject("venue", z.uuid()),
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                422: buildErrorResponseObject({
                    description:
                        "The list does not match the edition's venues exactly" +
                        " (incomplete_order); the current ids are in the error meta",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/venues", {
        get: {
            tags: ["Venues"],
            summary: "List venues",
            description:
                "Lists all venues of an edition. Open to any authenticated subject, including" +
                " integration tokens and subjects without a user record.",
            operationId: "listVenues",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(venueQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "Venues of the edition",
                    cardinality: "many",
                    resourceSchema: venueResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        post: {
            tags: ["Venues"],
            summary: "Create a venue",
            description: "Creates a venue in an edition. Requires the manager role.",
            operationId: "createVenue",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: venueContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created venue",
                    cardinality: "one",
                    resourceSchema: venueResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Another venue in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/venues/{venueId}", {
        get: {
            tags: ["Venues"],
            summary: "Show a venue",
            description:
                "Retrieves a single venue of an edition. Open to any authenticated subject," +
                " including integration tokens and subjects without a user record.",
            operationId: "showVenue",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("venueId"),
                ...buildQueryParameters(venueQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "The venue",
                    cardinality: "one",
                    resourceSchema: venueResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition or venue not found" }),
            },
        },
        patch: {
            tags: ["Venues"],
            summary: "Update a venue",
            description: "Updates a venue of an edition. Requires the manager role.",
            operationId: "updateVenue",
            parameters: [createUuidPathParameter("editionId"), createUuidPathParameter("venueId")],
            requestBody: {
                required: true,
                content: venueContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated venue",
                    cardinality: "one",
                    resourceSchema: venueResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or venue not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Another venue in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
        delete: {
            tags: ["Venues"],
            summary: "Delete a venue",
            description:
                "Deletes a venue of an edition. Fails while locations still reference it." +
                " Requires the manager role.",
            operationId: "deleteVenue",
            parameters: [createUuidPathParameter("editionId"), createUuidPathParameter("venueId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or venue not found" }),
                409: buildErrorResponseObject({ description: "Venue in use (entity_in_use)" }),
            },
        },
    });
};
