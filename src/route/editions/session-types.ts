import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { ForeignKeyConstraintViolationException, LockMode, ref } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { SessionType } from "../../entity/SessionType.js";
import { serialize } from "../../json-api/index.js";
import { sessionTypeResourceSchema } from "../../json-api/session-type.js";
import { customFieldsScopedSolelyTo, scopeInUseError } from "../../support/custom-field-scope.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import { takeEdition } from "../../support/locking.js";
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
import { durationSchema, nameSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const listSessionTypesHandler = createExtractHandler(
    extension(EDITION, true),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
).handler(async (edition, user, jwtPayload) => {
    const sessionTypes = await em.find(
        SessionType,
        {
            edition,
            ...(seesInternal(user, jwtPayload) ? {} : { internal: false }),
        },
        { orderBy: { name: "asc", id: "asc" } },
    );

    return serialize("session_type", sessionTypes);
});

const showSessionTypeHandler = createExtractHandler(
    pathParams(z.object({ sessionTypeId: z.uuid() })),
    extension(EDITION, true),
    extension(USER, true),
    extension(JWT_PAYLOAD, true),
).handler(async ({ sessionTypeId }, edition, user, jwtPayload) => {
    const sessionType = await em.findOne(SessionType, {
        id: sessionTypeId,
        edition,
        ...(seesInternal(user, jwtPayload) ? {} : { internal: false }),
    });
    assertExists(sessionType, "Session type", sessionTypeId);

    return serialize("session_type", sessionType);
});

const attributesSchema = z.strictObject({
    name: nameSchema,
    externalKey: nameSchema.nullable(),
    defaultDuration: durationSchema.refine(
        (duration) => duration.total("minutes") >= 1,
        "Must be at least a minute",
    ),
    internal: z.boolean(),
});

const sessionTypeResourceOptions = {
    type: "session_type",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;

const sessionTypeContentObject = buildResourceRequestContentObject(sessionTypeResourceOptions);

const sessionTypeUniqueViolations: Record<string, UniqueViolation> = {
    session_type_edition_id_external_key_unique: externalKeyTaken(
        "Another session type in this edition already uses this external key",
    ),
};

/**
 * Answers a second default that got past the edition lock.
 *
 * Every promotion takes the edition first, so two never overlap and this does
 * not fire today. It stays as the backstop for a writer that sets the default
 * without that lock, which the partial unique index would otherwise turn into
 * a 500.
 */
const defaultPromotionViolations: Record<string, UniqueViolation> = {
    unique_selection_default_per_edition: {
        code: "default_promotion_conflict",
        title: "Default promotion conflict",
        detail: "Another session type became the default while this one was being promoted",
        pointer: "/data/id",
    },
};

const createSessionTypeHandler = createExtractHandler(
    jsonApiResource(sessionTypeResourceOptions),
    extension(EDITION, true),
).handler(async ({ attributes }, edition) => {
    const sessionType = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                const created = new SessionType({
                    ...attributes,
                    selectionDefault: false,
                    edition: ref(edition),
                });
                em.persist(created);

                return created;
            }),
        sessionTypeUniqueViolations,
    );

    return [StatusCode.CREATED, serialize("session_type", sessionType)];
});

const visibleSessionTypeFingerprint = (sessionType: SessionType): string =>
    visibleFingerprint([sessionType.name, sessionType.externalKey, sessionType.internal]);

const updateSessionTypeHandler = createExtractHandler(
    pathParams(z.object({ sessionTypeId: z.uuid() })),
    jsonApiResource(sessionTypeResourceOptions, "sessionTypeId"),
    extension(EDITION, true),
).handler(async ({ sessionTypeId }, { attributes }, edition) => {
    const sessionType = await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                // Exclusive, like the delete: two types turned internal at once
                // would each count the other as still offered.
                const lockedEdition = attributes.internal
                    ? await takeEdition(em, edition.id, {
                          mode: LockMode.PESSIMISTIC_WRITE,
                          refresh: true,
                      })
                    : null;
                const sessionType = await em.findOne(
                    SessionType,
                    { id: sessionTypeId, edition },
                    { lockMode: LockMode.PESSIMISTIC_WRITE },
                );
                assertExists(sessionType, "Session type", sessionTypeId);
                const before = visibleSessionTypeFingerprint(sessionType);
                const wasInternal = sessionType.internal;
                patchObject(sessionType, attributes);
                em.persist(sessionType);

                if (lockedEdition && !wasInternal) {
                    await em.flush();
                    await assertSpeakersCanPick(em, lockedEdition, "sessionType");
                }

                if (visibleSessionTypeFingerprint(sessionType) !== before) {
                    await bumpEditionRevision(em, edition);
                }

                return sessionType;
            }),
        sessionTypeUniqueViolations,
    );

    return serialize("session_type", sessionType);
});

const defaultPromotionResourceOptions = {
    type: "session_type_default_promotion",
} satisfies AnyParseResourceRequestOptions;

const defaultPromotionContentObject = buildResourceRequestContentObject(
    defaultPromotionResourceOptions,
);

const promoteSessionTypeToDefaultHandler = createExtractHandler(
    pathParams(z.object({ sessionTypeId: z.uuid() })),
    jsonApiResource(defaultPromotionResourceOptions, "sessionTypeId"),
    extension(EDITION, true),
).handler(async ({ sessionTypeId }, _resource, edition) => {
    await translateUniqueViolations(
        () =>
            em.transactional(async (em) => {
                // Exclusive: which row is the default is read before it is
                // replaced, and the custom field update pins session types
                // behind the edition.
                await takeEdition(em, edition.id, { mode: LockMode.PESSIMISTIC_WRITE });

                const sessionType = await em.findOne(
                    SessionType,
                    { id: sessionTypeId, edition },
                    { lockMode: LockMode.PESSIMISTIC_WRITE },
                );
                assertExists(sessionType, "Session type", sessionTypeId);

                const previousDefault = await em.findOne(
                    SessionType,
                    {
                        edition,
                        selectionDefault: true,
                        id: { $ne: sessionType.id },
                    },
                    { lockMode: LockMode.PESSIMISTIC_WRITE },
                );

                if (previousDefault) {
                    previousDefault.selectionDefault = false;
                    em.persist(previousDefault);
                    // Flushed before the promotion; the partial unique index on
                    // the selection default would reject the flush if the
                    // promoting update happened to run first.
                    await em.flush();
                }

                sessionType.selectionDefault = true;
                em.persist(sessionType);
            }),
        defaultPromotionViolations,
    );

    return StatusCode.NO_CONTENT;
});

const deleteSessionTypeHandler = createExtractHandler(
    pathParams(z.object({ sessionTypeId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ sessionTypeId }, edition) => {
    try {
        await em.transactional(async (em) => {
            // Exclusive: the scope check below reads without a lock, and two
            // deletes of a field's last two session types would both pass it.
            const lockedEdition = await takeEdition(em, edition.id, {
                mode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            });

            const sessionType = await em.findOne(
                SessionType,
                {
                    id: sessionTypeId,
                    edition,
                },
                {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                },
            );
            assertExists(sessionType, "Session type", sessionTypeId);

            if (sessionType.selectionDefault) {
                throw new JsonApiError({
                    status: "409",
                    code: "default_session_type",
                    title: "Default session type",
                    detail: "The default session type cannot be deleted",
                });
            }

            const scopedCustomFields = await customFieldsScopedSolelyTo(
                em,
                edition,
                "sessionTypes",
                sessionType.id,
            );

            if (scopedCustomFields.length > 0) {
                throw scopeInUseError(scopedCustomFields, "session type");
            }

            em.remove(sessionType);

            if (!sessionType.internal) {
                await em.flush();
                await assertSpeakersCanPick(em, lockedEdition, "sessionType");
            }
        });
    } catch (error) {
        if (error instanceof ForeignKeyConstraintViolationException) {
            throw new JsonApiError({
                status: "409",
                code: "entity_in_use",
                title: "Entity in use",
                detail: "The session type is still in use",
            });
        }

        throw error;
    }

    return StatusCode.NO_CONTENT;
});

export const sessionTypesRouter = new Router()
    .route("/", m.post(createSessionTypeHandler))
    .route("/:sessionTypeId", m.patch(updateSessionTypeHandler).delete(deleteSessionTypeHandler))
    .route("/:sessionTypeId/default-promotion", m.post(promoteSessionTypeToDefaultHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    .route("/", m.get(listSessionTypesHandler))
    .route("/:sessionTypeId", m.get(showSessionTypeHandler));

export const addOpenapiSessionTypePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/session-types", {
        get: {
            tags: ["Session Types"],
            summary: "List session types",
            description:
                "Lists the session types of an edition. Open to any authenticated subject;" +
                " internal session types are only returned for team members and integration" +
                " tokens.",
            operationId: "listSessionTypes",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "Session types of the edition",
                    cardinality: "many",
                    resourceSchema: sessionTypeResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        post: {
            tags: ["Session Types"],
            summary: "Create a session type",
            description:
                "Creates a session type in an edition. The new session type is never the" +
                " selection default. Requires the manager role.",
            operationId: "createSessionType",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: sessionTypeContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created session type",
                    cardinality: "one",
                    resourceSchema: sessionTypeResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                409: buildErrorResponseObject({
                    description:
                        "Another session type in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/session-types/{sessionTypeId}", {
        get: {
            tags: ["SessionTypes"],
            summary: "Show a session type",
            description:
                "Retrieves a single session type of an edition. Open to any authenticated" +
                " subject, including integration tokens and subjects without a user record. An" +
                " internal session type answers as not found unless the caller may see" +
                " internal ones.",
            operationId: "showSessionType",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionTypeId"),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "The session type",
                    cardinality: "one",
                    resourceSchema: sessionTypeResourceSchema,
                }),
                404: buildErrorResponseObject({
                    description: "Edition or session type not found",
                }),
            },
        },
        patch: {
            tags: ["Session Types"],
            summary: "Update a session type",
            description: "Updates a session type of an edition. Requires the manager role.",
            operationId: "updateSessionType",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionTypeId"),
            ],
            requestBody: {
                required: true,
                content: sessionTypeContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated session type",
                    cardinality: "one",
                    resourceSchema: sessionTypeResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description: "Edition or session type not found",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Turning internal the last session type speakers may pick (nothing_to_pick). " +
                        "Another session type in this edition already uses this external key" +
                        " (external_key_taken)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
        delete: {
            tags: ["Session Types"],
            summary: "Delete a session type",
            description:
                "Deletes a session type of an edition. The selection default cannot be deleted." +
                " Requires the manager role.",
            operationId: "deleteSessionType",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionTypeId"),
            ],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description: "Edition or session type not found",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Deleting the last session type speakers may pick (nothing_to_pick). " +
                        "Session type is the selection default (default_session_type), still" +
                        " in use by a session (entity_in_use), or the only one some custom" +
                        " fields are scoped to (scope_in_use, whose meta.customFields names" +
                        " each one with its title)",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/session-types/{sessionTypeId}/default-promotion", {
        post: {
            tags: ["Session Types"],
            summary: "Promote a session type to the default",
            description:
                "Makes the session type the selection default of its edition and demotes the" +
                " previous default. Requires the manager role.",
            operationId: "promoteSessionTypeDefault",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionTypeId"),
            ],
            requestBody: {
                required: true,
                content: defaultPromotionContentObject,
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description: "Edition or session type not found",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Another session type became the default while this one was being" +
                        " promoted (default_promotion_conflict)",
                }),
                422: buildErrorResponseObject({ description: "Invalid request body" }),
            },
        },
    });
};
