import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { Track } from "../../entity/Track.js";
import { serialize } from "../../json-api/index.js";
import { trackResourceSchema } from "../../json-api/track.js";
import { customFieldsScopedSolelyTo, scopeInUseError } from "../../support/custom-field-scope.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import { lockTrackSessions, takeEdition } from "../../support/locking.js";
import { assertSpeakersCanPick } from "../../support/speaker-choices.js";
import { visibleFingerprint } from "../../support/visible-changes.js";
import { JWT_PAYLOAD, RequireAuthorizationLayer, seesInternal, USER } from "../../util/auth.js";
import {
    externalKeyTaken,
    translateUniqueViolations,
    type UniqueViolation,
} from "../../util/constraint-violation.js";
import { assertExists, patchObject } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { colorSchema, descriptionSchema, nameSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const listTracksHandler = createExtractHandler(
    extension(EDITION, true),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
).handler(async (edition, user, jwtPayload) => {
    const tracks = await em.find(
        Track,
        {
            edition,
            ...(seesInternal(user, jwtPayload) ? {} : { internal: false }),
        },
        { orderBy: { name: "asc", id: "asc" } },
    );

    return serialize("track", tracks);
});

const showTrackHandler = createExtractHandler(
    pathParams(z.object({ trackId: z.uuid() })),
    extension(EDITION, true),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
).handler(async ({ trackId }, edition, user, jwtPayload) => {
    const track = await em.findOne(Track, {
        id: trackId,
        edition,
        ...(seesInternal(user, jwtPayload) ? {} : { internal: false }),
    });
    assertExists(track, "Track", trackId);

    return serialize("track", track);
});

const attributesSchema = z.strictObject({
    name: nameSchema,
    externalKey: nameSchema.nullable(),
    description: descriptionSchema,
    color: colorSchema,
    internal: z.boolean(),
});

const trackResourceOptions = {
    type: "track",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;

const trackContentObject = buildResourceRequestContentObject(trackResourceOptions);

const trackUniqueViolations: Record<string, UniqueViolation> = {
    track_edition_id_external_key_unique: externalKeyTaken(
        "Another track in this edition already uses this external key",
    ),
};

const createTrackHandler = createExtractHandler(
    jsonApiResource(trackResourceOptions),
    extension(EDITION, true),
).handler(async ({ attributes }, edition) => {
    const track = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                const created = new Track({
                    ...attributes,
                    edition: ref(edition),
                });
                em.persist(created);

                return created;
            }),
        trackUniqueViolations,
    );

    return [StatusCode.CREATED, serialize("track", track)];
});

const visibleTrackFingerprint = (track: Track): string =>
    visibleFingerprint([
        track.name,
        track.externalKey,
        track.description,
        track.color,
        track.internal,
    ]);

const updateTrackHandler = createExtractHandler(
    pathParams(z.object({ trackId: z.uuid() })),
    jsonApiResource(trackResourceOptions, "trackId"),
    extension(EDITION, true),
).handler(async ({ trackId }, { attributes }, edition) => {
    const track = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                // Exclusive, like the delete: two tracks turned internal at once
                // would each count the other as still offered.
                const lockedEdition = attributes.internal
                    ? await takeEdition(em, edition.id, {
                          mode: LockMode.PESSIMISTIC_WRITE,
                          refresh: true,
                      })
                    : null;
                const track = await em.findOne(
                    Track,
                    { id: trackId, edition },
                    { lockMode: LockMode.PESSIMISTIC_WRITE },
                );
                assertExists(track, "Track", trackId);
                const before = visibleTrackFingerprint(track);
                const wasInternal = track.internal;
                patchObject(track, attributes);
                em.persist(track);

                if (lockedEdition && !wasInternal) {
                    await em.flush();
                    await assertSpeakersCanPick(em, lockedEdition, "track");
                }

                if (visibleTrackFingerprint(track) !== before) {
                    await bumpEditionRevision(em, edition);
                }

                return track;
            }),
        trackUniqueViolations,
    );

    return serialize("track", track);
});

const deleteTrackHandler = createExtractHandler(
    pathParams(z.object({ trackId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ trackId }, edition) => {
    await em.transactional(async (em) => {
        // Exclusive: the scope check below reads without a lock, and two
        // deletes of a field's last two tracks would both pass it.
        const lockedEdition = await takeEdition(em, edition.id, {
            mode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
        });

        const track = await em.findOne(Track, { id: trackId, edition });
        assertExists(track, "Track", trackId);

        await lockTrackSessions(em, edition.id, track.id);

        const locked = await em.findOne(
            Track,
            { id: trackId, edition },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(locked, "Track", trackId);

        const scopedCustomFields = await customFieldsScopedSolelyTo(
            em,
            edition,
            "tracks",
            locked.id,
        );

        if (scopedCustomFields.length > 0) {
            throw scopeInUseError(scopedCustomFields, "track");
        }

        em.remove(locked);

        if (!locked.internal) {
            await em.flush();
            await assertSpeakersCanPick(em, lockedEdition, "track");
        }

        await bumpEditionRevision(em, edition);
    });

    return StatusCode.NO_CONTENT;
});

export const tracksRouter = new Router()
    .route("/", m.post(createTrackHandler))
    .route("/:trackId", m.patch(updateTrackHandler).delete(deleteTrackHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    .route("/", m.get(listTracksHandler))
    .route("/:trackId", m.get(showTrackHandler));

export const addOpenapiTrackPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/tracks", {
        get: {
            tags: ["Tracks"],
            summary: "List tracks",
            description:
                "Lists the tracks of an edition. Open to any authenticated subject; internal" +
                " tracks are only returned for team members and integration tokens.",
            operationId: "listTracks",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "Tracks of the edition",
                    cardinality: "many",
                    resourceSchema: trackResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        post: {
            tags: ["Tracks"],
            summary: "Create a track",
            description: "Creates a track in an edition. Requires the manager role.",
            operationId: "createTrack",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: trackContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created track",
                    cardinality: "one",
                    resourceSchema: trackResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Another track in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/tracks/{trackId}", {
        get: {
            tags: ["Tracks"],
            summary: "Show a track",
            description:
                "Retrieves a single track of an edition. Open to any authenticated subject," +
                " including integration tokens and subjects without a user record. An internal" +
                " track answers as not found unless the caller may see internal ones.",
            operationId: "showTrack",
            parameters: [createUuidPathParameter("editionId"), createUuidPathParameter("trackId")],
            responses: {
                200: buildDataResponseObject({
                    description: "The track",
                    cardinality: "one",
                    resourceSchema: trackResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition or track not found" }),
            },
        },
        patch: {
            tags: ["Tracks"],
            summary: "Update a track",
            description: "Updates a track of an edition. Requires the manager role.",
            operationId: "updateTrack",
            parameters: [createUuidPathParameter("editionId"), createUuidPathParameter("trackId")],
            requestBody: {
                required: true,
                content: trackContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated track",
                    cardinality: "one",
                    resourceSchema: trackResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or track not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Turning internal the last track speakers may pick while the edition requires one (nothing_to_pick). " +
                        "Another track in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
        delete: {
            tags: ["Tracks"],
            summary: "Delete a track",
            description:
                "Deletes a track of an edition. Sessions assigned to the track keep existing and" +
                " lose their track assignment. Requires the manager role.",
            operationId: "deleteTrack",
            parameters: [createUuidPathParameter("editionId"), createUuidPathParameter("trackId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or track not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Deleting the last track speakers may pick while the edition requires one (nothing_to_pick). " +
                        "Custom fields are scoped to this track and nothing else" +
                        " (scope_in_use). Deleting it would widen them to every track, so" +
                        " meta.customFields names each one with its title.",
                }),
            },
        },
    });
};
