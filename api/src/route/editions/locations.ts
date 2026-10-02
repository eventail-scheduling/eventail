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
    clientResourceIdentifierSchema,
    createQueryParser,
    type IncludedTypeSchemas,
    type IncludedTypesContainer,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import type { Loaded } from "@mikro-orm/core";
import {
    ForeignKeyConstraintViolationException,
    LockMode,
    type QueryOrderMap,
    ref,
} from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { zt } from "zod-temporal";
import type { Edition } from "../../entity/Edition.js";
import { Location } from "../../entity/Location.js";
import { LocationAvailability } from "../../entity/LocationAvailability.js";
import type { User } from "../../entity/User.js";
import { Venue } from "../../entity/Venue.js";
import { serialize } from "../../json-api/index.js";
import {
    locationResourceFields,
    locationResourceSchema,
    seesLocationAvailability,
    withVisibleLocationFields,
} from "../../json-api/location.js";
import {
    locationAvailabilityResourceFields,
    locationAvailabilityResourceSchema,
} from "../../json-api/location-availability.js";
import { loadRelation, type RelationQuery, relationLoadMode } from "../../json-api/query.js";
import {
    findIntervalProblem,
    intervalProblemError,
    maxAvailabilities,
    mergeIntervals,
} from "../../support/availability.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import { editionWindow } from "../../support/edition-window.js";
import { pinEdition, takeEdition } from "../../support/locking.js";
import { visibleFingerprint } from "../../support/visible-changes.js";
import { JWT_PAYLOAD, type JwtPayload, RequireAuthorizationLayer, USER } from "../../util/auth.js";
import {
    externalKeyTaken,
    referenceGone,
    translateForeignKeyViolations,
    translateUniqueViolations,
    type UniqueViolation,
} from "../../util/constraint-violation.js";
import { assertExists, patchObject } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { nameSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const locationQueryOptions = {
    fields: {
        allowed: {
            location: locationResourceFields,
            location_availability: locationAvailabilityResourceFields,
        },
    },
    include: {
        allowed: ["availabilities"],
    },
} as const satisfies AnyParseQueryOptions;

const parseLocationQuery = createQueryParser(locationQueryOptions);

type LocationQuery = ReturnType<typeof parseLocationQuery>;
type LocationInclude = LocationQuery["include"][number];

const visibleIncludes = (
    query: LocationQuery,
    user: Loaded<User, "teams"> | null,
    jwtPayload: JwtPayload,
): LocationInclude[] =>
    seesLocationAvailability(user, jwtPayload)
        ? query.include
        : query.include.filter((field) => field !== "availabilities");

const availabilityOrder: QueryOrderMap<Location> = { availabilities: { startsAt: "asc" } };

const loadAvailabilities = async (locations: Location[], query: RelationQuery): Promise<void> => {
    await loadRelation(relationLoadMode(query, "location", "availabilities", "availabilities"), {
        full: () => em.populate(locations, ["availabilities"], { orderBy: availabilityOrder }),
        linkage: () =>
            em.populate(locations, ["availabilities"], {
                fields: ["*", "availabilities.id"],
                orderBy: availabilityOrder,
            }),
    });
};

const listLocationsHandler = createExtractHandler(
    jsonApiQuery(parseLocationQuery),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async (query, user, jwtPayload, edition) => {
    const include = visibleIncludes(query, user, jwtPayload);
    const fields = withVisibleLocationFields(user, jwtPayload, query.fields);
    const locations = await em.find(Location, { edition }, { orderBy: { position: "asc" } });
    await loadAvailabilities(locations, { include, fields });

    return serialize("location", locations, { ...query, include, fields });
});

const showLocationHandler = createExtractHandler(
    pathParams(z.object({ locationId: z.uuid() })),
    jsonApiQuery(parseLocationQuery),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ locationId }, query, user, jwtPayload, edition) => {
    const include = visibleIncludes(query, user, jwtPayload);
    const fields = withVisibleLocationFields(user, jwtPayload, query.fields);
    const location = await em.findOne(Location, { id: locationId, edition });
    assertExists(location, "Location", locationId);
    await loadAvailabilities([location], { include, fields });

    return serialize("location", location, { ...query, include, fields });
});

const attributesSchema = z.strictObject({
    name: nameSchema,
    externalKey: nameSchema.nullable(),
});

const relationshipsSchema = z.strictObject({
    venue: relationshipSchema(resourceIdentifierSchema("venue", z.uuid())),
    availabilities: relationshipSchema(
        z.array(clientResourceIdentifierSchema("location_availability")).max(maxAvailabilities),
    ),
});

const includedTypeSchemas = {
    location_availability: {
        attributesSchema: z.strictObject({
            startsAt: zt.instant(),
            endsAt: zt.instant(),
        }),
    },
} satisfies IncludedTypeSchemas;

type IncludedTypes = IncludedTypesContainer<typeof includedTypeSchemas>;

const locationResourceOptions = {
    type: "location",
    attributesSchema,
    relationshipsSchema,
    includedTypeSchemas,
} satisfies AnyParseResourceRequestOptions;

const locationContentObject = buildResourceRequestContentObject(locationResourceOptions);

const locationUniqueViolations: Record<string, UniqueViolation> = {
    location_edition_id_external_key_unique: externalKeyTaken(
        "Another location in this edition already uses this external key",
    ),
};

type AvailabilityReplacement = {
    em: EntityManager;
    location: Location;
    edition: Edition;
    lids: string[];
    included: IncludedTypes["location_availability"];
};

const replaceAvailabilities = ({
    em,
    location,
    edition,
    lids,
    included,
}: AvailabilityReplacement): void => {
    const intervals = lids.map((lid) => {
        const { attributes } = included.get(lid);

        return { startsAt: attributes.startsAt, endsAt: attributes.endsAt };
    });

    const problem = findIntervalProblem(intervals, editionWindow(edition));

    if (problem) {
        throw intervalProblemError(problem, lids[problem.index]);
    }

    const { kept } = mergeIntervals(intervals);

    location.availabilities.set(
        kept.map((interval) => new LocationAvailability({ ...interval, location: ref(location) })),
    );
    em.persist(location);
};

const findVenue = async (em: EntityManager, edition: Edition, venueId: string): Promise<Venue> => {
    const venue = await em.findOne(Venue, { id: venueId, edition });
    assertExists(venue, "Venue", venueId);

    return venue;
};

const nextPosition = async (em: EntityManager, edition: Edition): Promise<number> => {
    const highest = await em.findOne(Location, { edition }, { orderBy: { position: "desc" } });

    return highest === null ? 0 : highest.position + 1;
};

const createLocationHandler = createExtractHandler(
    jsonApiResource(locationResourceOptions),
    extension(EDITION, true),
).handler(async ({ attributes, relationships, includedTypes }, edition) => {
    const location = await translateForeignKeyViolations(
        () =>
            translateUniqueViolations(
                () =>
                    em.transactional(async (em) => {
                        const locked = await takeEdition(em, edition.id, {
                            mode: LockMode.PESSIMISTIC_WRITE,
                            refresh: true,
                        });

                        const created = new Location({
                            ...attributes,
                            position: await nextPosition(em, locked),
                            edition: ref(locked),
                            venue: ref(await findVenue(em, locked, relationships.venue.data.id)),
                        });
                        replaceAvailabilities({
                            em,
                            location: created,
                            edition: locked,
                            lids: relationships.availabilities.data.map((data) => data.lid),
                            included: includedTypes.location_availability,
                        });

                        return created;
                    }),
                locationUniqueViolations,
            ),
        { location_venue_id_foreign: referenceGone("Venue", relationships.venue.data.id) },
    );

    return [StatusCode.CREATED, serialize("location", location, { include: ["availabilities"] })];
});

const updateLocationHandler = createExtractHandler(
    pathParams(z.object({ locationId: z.uuid() })),
    jsonApiResource(locationResourceOptions, "locationId"),
    extension(EDITION, true),
).handler(async ({ locationId }, { attributes, relationships, includedTypes }, edition) => {
    const location = await translateForeignKeyViolations(
        () =>
            translateUniqueViolations(
                () =>
                    em.transactional(async (em) => {
                        const locked = await takeEdition(em, edition.id, { refresh: true });

                        const location = await em.findOne(
                            Location,
                            { id: locationId, edition: locked },
                            { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ["availabilities"] },
                        );
                        assertExists(location, "Location", locationId);
                        const before = visibleFingerprint([
                            location.name,
                            location.externalKey,
                            location.venue.id,
                        ]);
                        patchObject(location, attributes);
                        location.venue = ref(
                            await findVenue(em, locked, relationships.venue.data.id),
                        );
                        replaceAvailabilities({
                            em,
                            location,
                            edition: locked,
                            lids: relationships.availabilities.data.map((data) => data.lid),
                            included: includedTypes.location_availability,
                        });

                        const after = visibleFingerprint([
                            location.name,
                            location.externalKey,
                            location.venue.id,
                        ]);

                        if (after !== before) {
                            await bumpEditionRevision(em, locked);
                        }

                        return location;
                    }),
                locationUniqueViolations,
            ),
        { location_venue_id_foreign: referenceGone("Venue", relationships.venue.data.id) },
    );

    return serialize("location", location, { include: ["availabilities"] });
});

const deleteLocationHandler = createExtractHandler(
    pathParams(z.object({ locationId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ locationId }, edition) => {
    try {
        await em.transactional(async (em) => {
            await pinEdition(em, edition);

            const location = await em.findOne(
                Location,
                { id: locationId, edition },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );
            assertExists(location, "Location", locationId);
            em.remove(location);
        });
    } catch (error) {
        if (error instanceof ForeignKeyConstraintViolationException) {
            throw new JsonApiError({
                status: "409",
                code: "entity_in_use",
                title: "Entity in use",
                detail: "The location is still in use",
            });
        }

        throw error;
    }

    return StatusCode.NO_CONTENT;
});

const incompleteOrderError = (locations: Location[]): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "incomplete_order",
        title: "Incomplete order",
        detail: "The order must name every location of the edition exactly once",
        meta: {
            locationIds: locations.map((location) => location.id),
        },
    });

export const reorderLocationsHandler = createExtractHandler(
    jsonApiRelationships("location", z.uuid()),
    extension(EDITION, true),
).handler(async (locationIds, edition) => {
    await em.transactional(async (em) => {
        const locked = await takeEdition(em, edition.id, { mode: LockMode.PESSIMISTIC_WRITE });
        const locations = await em.find(Location, { edition });
        const supplied = new Set(locationIds);

        if (supplied.size !== locationIds.length || supplied.size !== locations.length) {
            throw incompleteOrderError(locations);
        }

        const byId = new Map(locations.map((location) => [location.id, location]));

        for (const [position, locationId] of locationIds.entries()) {
            const location = byId.get(locationId);

            if (!location) {
                throw incompleteOrderError(locations);
            }

            location.position = position;
            em.persist(location);
        }

        // The column order reaches an integration, which draws the grid it
        // renders in it, so this is a visible change like a rename is.
        await bumpEditionRevision(em, locked);
    });

    return StatusCode.NO_CONTENT;
});

export const locationsRouter = new Router()
    .route("/", m.post(createLocationHandler))
    .route("/:locationId", m.patch(updateLocationHandler).delete(deleteLocationHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    .route("/", m.get(listLocationsHandler))
    .route("/:locationId", m.get(showLocationHandler));

const availabilityErrorDescription =
    "Invalid request body, an availability ending before it starts (reversed_interval)," +
    " one reaching outside the days of the edition (outside_edition), or one whose times" +
    " carry anything finer than a minute (sub_minute_interval)";

export const addOpenapiLocationPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/relationships/locations", {
        patch: {
            tags: ["Locations"],
            summary: "Reorder locations",
            description:
                "Sets the order of the locations of an edition, which is the order they are" +
                " drawn as columns on a schedule. The list must name every location of the" +
                " edition exactly once; positions are then assigned in the order given." +
                " Requires the manager role.",
            operationId: "reorderLocations",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: buildRelationshipsRequestContentObject("location", z.uuid()),
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                422: buildErrorResponseObject({
                    description:
                        "The list does not match the edition's locations exactly" +
                        " (incomplete_order); the current ids are in the error meta",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/locations", {
        get: {
            tags: ["Locations"],
            summary: "List locations",
            description:
                "Lists all locations of an edition. Open to any authenticated subject, including" +
                " integration tokens and subjects without a user record. Availability is served" +
                " to managers alone, and dropped from the include and the field set for" +
                " everyone else.",
            operationId: "listLocations",
            parameters: [
                createUuidPathParameter("editionId"),
                ...buildQueryParameters(locationQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "Locations of the edition",
                    cardinality: "many",
                    resourceSchema: locationResourceSchema,
                    included: [locationAvailabilityResourceSchema],
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        post: {
            tags: ["Locations"],
            summary: "Create a location",
            description:
                "Creates a location in an edition. The availabilities given become the whole of" +
                " what the location has, and overlapping or touching ones are merged. Requires" +
                " the manager role.",
            operationId: "createLocation",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: locationContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created location",
                    cardinality: "one",
                    resourceSchema: locationResourceSchema,
                    included: [locationAvailabilityResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or venue not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Another location in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: availabilityErrorDescription }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/locations/{locationId}", {
        get: {
            tags: ["Locations"],
            summary: "Show a location",
            description:
                "Retrieves a single location of an edition. Open to any authenticated subject," +
                " including integration tokens and subjects without a user record. Availability" +
                " is served to managers alone, and dropped from the include and the field set" +
                " for everyone else.",
            operationId: "showLocation",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("locationId"),
                ...buildQueryParameters(locationQueryOptions),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "The location",
                    cardinality: "one",
                    resourceSchema: locationResourceSchema,
                    included: [locationAvailabilityResourceSchema],
                }),
                404: buildErrorResponseObject({ description: "Edition or location not found" }),
            },
        },
        patch: {
            tags: ["Locations"],
            summary: "Update a location",
            description:
                "Updates a location of an edition. The availabilities given replace every one the" +
                " location had, so an empty array leaves it usable throughout the edition, and" +
                " overlapping or touching ones are merged. Requires the manager role.",
            operationId: "updateLocation",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("locationId"),
            ],
            requestBody: {
                required: true,
                content: locationContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated location",
                    cardinality: "one",
                    resourceSchema: locationResourceSchema,
                    included: [locationAvailabilityResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description: "Edition, location or venue not found",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Another location in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: availabilityErrorDescription }),
            },
        },
        delete: {
            tags: ["Locations"],
            summary: "Delete a location",
            description:
                "Deletes a location of an edition. Fails while slots still reference it." +
                " Requires the manager role.",
            operationId: "deleteLocation",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("locationId"),
            ],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or location not found" }),
                409: buildErrorResponseObject({ description: "Location in use (entity_in_use)" }),
            },
        },
    });
};
