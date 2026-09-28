import { jsonApiRelationships, jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildRelationshipsRequestContentObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseResourceRequestOptions,
    relationshipSchema,
    resourceIdentifierSchema,
} from "@jsonapi-serde/server/request";
import type { EntityManager } from "@mikro-orm/core";
import { LockMode, ref } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { isAfter } from "temporal-extra";
import { z } from "zod";
import { zt } from "zod-temporal";
import {
    CustomField,
    type CustomFieldTarget,
    customFieldRequirements,
    customFieldTargets,
} from "../../entity/CustomField.js";
import type { Edition } from "../../entity/Edition.js";
import { Response } from "../../entity/Response.js";
import { SessionType } from "../../entity/SessionType.js";
import { Track } from "../../entity/Track.js";
import { customFieldResourceSchema } from "../../json-api/custom-field.js";
import { serialize } from "../../json-api/index.js";
import {
    type CustomFieldOptions,
    choiceItems,
    customFieldOptionsSchema,
    referencedChoiceItemIds,
} from "../../support/custom-fields.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import { lockEditions, pinEdition, pinScope } from "../../support/locking.js";
import { visibleFingerprint } from "../../support/visible-changes.js";
import { RequireAuthorizationLayer } from "../../util/auth.js";
import {
    externalKeyTaken,
    type ForeignKeyViolation,
    translateForeignKeyViolations,
    translateUniqueViolations,
    type UniqueViolation,
} from "../../util/constraint-violation.js";
import { assertExists, omit, patchObject } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { descriptionSchema, nameSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

const listCustomFieldsHandler = createExtractHandler(extension(EDITION, true)).handler(
    async (edition) => {
        const customFields = await em.find(
            CustomField,
            { edition },
            {
                orderBy: { target: "asc", position: "asc" },
                populate: ["sessionTypes", "tracks"],
            },
        );

        return serialize("custom_field", customFields);
    },
);

const showCustomFieldHandler = createExtractHandler(
    pathParams(z.object({ customFieldId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ customFieldId }, edition) => {
    const customField = await em.findOne(
        CustomField,
        { id: customFieldId, edition },
        {
            populate: ["sessionTypes", "tracks"],
        },
    );
    assertExists(customField, "Custom field", customFieldId);

    return serialize("custom_field", customField);
});

const attributesSchema = z
    .object({
        externalKey: nameSchema.nullable(),
        target: z.enum(customFieldTargets),
        requirement: z.enum(customFieldRequirements),
        options: customFieldOptionsSchema,
        title: nameSchema,
        helperText: descriptionSchema,
        deadline: zt.instant().nullable(),
        freezeAfter: zt.instant().nullable(),
        confidential: z.boolean(),
    })
    .check((context) => {
        const { deadline, freezeAfter, requirement } = context.value;

        if (requirement === "required_after_deadline" && deadline === null) {
            context.issues.push({
                code: "custom",
                message: "Required for required_after_deadline custom fields",
                path: ["deadline"],
                input: deadline,
            });
        }

        if (requirement !== "required_after_deadline" && deadline !== null) {
            context.issues.push({
                code: "custom",
                message: "Only allowed for required_after_deadline custom fields",
                path: ["deadline"],
                input: deadline.toString(),
            });
        }

        // Freezing at or before the requirement deadline would exempt the custom
        // field from ever becoming required.
        if (deadline && freezeAfter && !isAfter(freezeAfter, deadline)) {
            context.issues.push({
                code: "custom",
                message: "Must be after the deadline",
                path: ["freezeAfter"],
                input: freezeAfter.toString(),
            });
        }
    });

type Identified = {
    id: string;
};

const refuseRepeatedIds = (context: z.core.ParsePayload<Identified[]>): void => {
    const seen = new Set<string>();

    context.value.forEach((item, index) => {
        if (seen.has(item.id)) {
            context.issues.push({
                code: "custom",
                message: "Must be unique",
                path: [index, "id"],
                input: item.id,
            });
        }

        seen.add(item.id);
    });
};

const relationshipsSchema = z.strictObject({
    sessionTypes: relationshipSchema(
        z.array(resourceIdentifierSchema("session_type", z.uuid())).check(refuseRepeatedIds),
    ),
    tracks: relationshipSchema(
        z.array(resourceIdentifierSchema("track", z.uuid())).check(refuseRepeatedIds),
    ),
});

const assertRemovedChoiceItemsHaveNoResponses = async (
    em: EntityManager,
    customField: CustomField,
    options: CustomFieldOptions,
): Promise<void> => {
    const remainingIds = new Set(choiceItems(options).map((item) => item.id));
    const removed = choiceItems(customField.options).filter((item) => !remainingIds.has(item.id));

    if (removed.length === 0) {
        return;
    }

    const removedIds = new Set(removed.map((item) => item.id));
    const responses = await em.find(Response, { customField }, { fields: ["value"] });
    const strandedIds = new Set(
        responses.flatMap((response) =>
            referencedChoiceItemIds(customField.options, response.value).filter((id) =>
                removedIds.has(id),
            ),
        ),
    );

    if (strandedIds.size === 0) {
        return;
    }

    const labels = removed
        .filter((item) => strandedIds.has(item.id))
        .map((item) => `"${item.label}"`);

    throw new JsonApiError({
        status: "409",
        code: "entity_in_use",
        title: "Entity in use",
        detail: `These options already carry responses and cannot be removed: ${labels.join(", ")}`,
    });
};

type CustomFieldScopeRelationships = z.output<typeof relationshipsSchema>;

const assertScopingApplies = (
    target: CustomFieldTarget,
    relationships: CustomFieldScopeRelationships,
): void => {
    if (target !== "per_host") {
        return;
    }

    const populated = [
        relationships.sessionTypes.data.length > 0
            ? { member: "sessionTypes", label: "session types" }
            : null,
        relationships.tracks.data.length > 0 ? { member: "tracks", label: "tracks" } : null,
    ].filter((entry) => entry !== null);

    if (populated.length === 0) {
        return;
    }

    throw new JsonApiError(
        populated.map(({ member, label }) => ({
            status: "422",
            code: "inapplicable_relationship",
            title: "Inapplicable relationship",
            detail: `A per_host custom field applies to every host, so it cannot be limited by ${label}`,
            source: { pointer: `/data/relationships/${member}` },
        })),
    );
};

/**
 * Answers for a scoping row that went away after a handler's read checked it.
 *
 * A create's reads do not hold their rows, so one can be deleted before the
 * pivot insert lands. Postgres names the constraint rather than the row, so this
 * answers for the relationship where the read answers per identifier.
 */
const customFieldReferenceViolations: Record<string, ForeignKeyViolation> = {
    custom_field_session_types_session_type_id_foreign: {
        title: "Not found",
        detail: "A session type named by this relationship was removed before the change saved",
        pointer: "/data/relationships/sessionTypes",
    },
    custom_field_tracks_track_id_foreign: {
        title: "Not found",
        detail: "A track named by this relationship was removed before the change saved",
        pointer: "/data/relationships/tracks",
    },
};

const assertAllRelationshipsFound = (
    found: Identified[],
    requested: Identified[],
    member: string,
    label: string,
): void => {
    if (found.length === requested.length) {
        return;
    }

    const foundIds = new Set(found.map((entity) => entity.id));

    throw new JsonApiError(
        requested
            .map((identifier, index) => ({ identifier, index }))
            .filter(({ identifier }) => !foundIds.has(identifier.id))
            .map(({ identifier, index }) => ({
                status: "404",
                code: "not_found",
                title: "Not found",
                detail: `This ${label} does not belong to this edition`,
                source: { pointer: `/data/relationships/${member}/data/${index.toString()}` },
                meta: { id: identifier.id },
            })),
    );
};

const customFieldResourceOptions = {
    type: "custom_field",
    attributesSchema,
    relationshipsSchema,
} satisfies AnyParseResourceRequestOptions;

const customFieldContentObject = buildResourceRequestContentObject(customFieldResourceOptions);

const nextPosition = async (
    em: EntityManager,
    edition: Edition,
    target: CustomFieldTarget,
): Promise<number> => {
    const highest = await em.findOne(
        CustomField,
        { edition, target },
        { orderBy: { position: "desc" } },
    );

    return highest === null ? 0 : highest.position + 1;
};

const customFieldUniqueViolations: Record<string, UniqueViolation> = {
    custom_field_edition_id_target_external_key_unique: externalKeyTaken(
        "Another custom field with this target in this edition already uses this external key",
    ),
};

const createCustomFieldHandler = createExtractHandler(
    jsonApiResource(customFieldResourceOptions),
    extension(EDITION, true),
).handler(async ({ attributes, relationships }, edition) => {
    assertScopingApplies(attributes.target, relationships);

    const sessionTypes = await em.find(SessionType, {
        id: { $in: relationships.sessionTypes.data.map((data) => data.id) },
        edition,
    });
    const tracks = await em.find(Track, {
        id: { $in: relationships.tracks.data.map((data) => data.id) },
        edition,
    });
    assertAllRelationshipsFound(
        sessionTypes,
        relationships.sessionTypes.data,
        "sessionTypes",
        "session type",
    );
    assertAllRelationshipsFound(tracks, relationships.tracks.data, "tracks", "track");

    const customField = await translateForeignKeyViolations(
        () =>
            translateUniqueViolations(
                () =>
                    em.transactional(async (em) => {
                        await lockEditions(em, [edition.id]);

                        const created = new CustomField({
                            ...attributes,
                            position: await nextPosition(em, edition, attributes.target),
                            edition: ref(edition),
                        });
                        created.sessionTypes.add(sessionTypes);
                        created.tracks.add(tracks);
                        em.persist(created);

                        return created;
                    }),
                customFieldUniqueViolations,
            ),
        customFieldReferenceViolations,
    );

    return [StatusCode.CREATED, serialize("custom_field", customField)];
});

/**
 * Includes `confidential`, which is not served but decides whether answers are.
 *
 * Flipping it to true withdraws answers a consumer already holds, and leaving
 * that unannounced keeps them serving withdrawn data. Scoping is absent because
 * an integration cannot read it.
 */
const visibleCustomFieldFingerprint = (customField: CustomField): string =>
    visibleFingerprint([
        customField.externalKey,
        customField.target,
        customField.title,
        customField.options,
        customField.confidential,
    ]);

const updateCustomFieldHandler = createExtractHandler(
    pathParams(z.object({ customFieldId: z.uuid() })),
    jsonApiResource(customFieldResourceOptions, "customFieldId"),
    extension(EDITION, true),
).handler(async ({ customFieldId }, { attributes, relationships }, edition) => {
    const customField = await translateForeignKeyViolations(
        () =>
            translateUniqueViolations(
                () =>
                    em.transactional(async (em) => {
                        await pinEdition(em, edition);
                        await pinScope(
                            em,
                            edition,
                            relationships.sessionTypes.data.map((data) => data.id),
                            relationships.tracks.data.map((data) => data.id),
                        );

                        const locked = await em.findOne(
                            CustomField,
                            {
                                id: customFieldId,
                                edition,
                            },
                            {
                                // The write lock also pairs with loadCustomFields'
                                // PESSIMISTIC_READ to exclude a response writer and a
                                // confidential flip both skipping the bump; see the
                                // comment there before weakening either.
                                lockMode: LockMode.PESSIMISTIC_WRITE,
                            },
                        );
                        assertExists(locked, "Custom field", customFieldId);
                        const customField = await em.populate(locked, ["sessionTypes", "tracks"]);

                        if (customField.target !== attributes.target) {
                            throw new JsonApiError({
                                status: "409",
                                code: "conflict",
                                title: "Conflict",
                                detail: "Supplied target does not match stored target",
                                source: { pointer: "/data/attributes/target" },
                            });
                        }

                        if (customField.options.type !== attributes.options.type) {
                            throw new JsonApiError({
                                status: "409",
                                code: "conflict",
                                title: "Conflict",
                                detail: "Supplied option type does not match stored type",
                                source: { pointer: "/data/attributes/options/type" },
                            });
                        }

                        assertScopingApplies(customField.target, relationships);
                        await assertRemovedChoiceItemsHaveNoResponses(
                            em,
                            customField,
                            attributes.options,
                        );

                        const before = visibleCustomFieldFingerprint(customField);
                        patchObject(customField, omit(attributes, ["target"]));

                        const sessionTypes = await em.find(SessionType, {
                            id: { $in: relationships.sessionTypes.data.map((data) => data.id) },
                            edition,
                        });
                        const tracks = await em.find(Track, {
                            id: { $in: relationships.tracks.data.map((data) => data.id) },
                            edition,
                        });
                        assertAllRelationshipsFound(
                            sessionTypes,
                            relationships.sessionTypes.data,
                            "sessionTypes",
                            "session type",
                        );
                        assertAllRelationshipsFound(
                            tracks,
                            relationships.tracks.data,
                            "tracks",
                            "track",
                        );

                        customField.sessionTypes.removeAll();
                        customField.sessionTypes.add(sessionTypes);
                        customField.tracks.removeAll();
                        customField.tracks.add(tracks);

                        em.persist(customField);

                        if (visibleCustomFieldFingerprint(customField) !== before) {
                            await bumpEditionRevision(em, edition);
                        }

                        return customField;
                    }),
                customFieldUniqueViolations,
            ),
        customFieldReferenceViolations,
    );

    return serialize("custom_field", customField);
});

const deleteCustomFieldHandler = createExtractHandler(
    pathParams(z.object({ customFieldId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ customFieldId }, edition) => {
    await em.transactional(async (em) => {
        await lockEditions(em, [edition.id]);

        const customField = await em.findOne(
            CustomField,
            {
                id: customFieldId,
                edition,
            },
            {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            },
        );
        assertExists(customField, "Custom field", customFieldId);
        em.remove(customField);
        await bumpEditionRevision(em, edition);
    });

    return StatusCode.NO_CONTENT;
});

const incompleteOrderError = (customFields: CustomField[]): JsonApiError =>
    new JsonApiError({
        status: "422",
        code: "incomplete_order",
        title: "Incomplete order",
        detail: "The order must name every custom field of the edition exactly once",
        meta: {
            customFieldIds: customFields.map((customField) => customField.id),
        },
    });

export const reorderCustomFieldsHandler = createExtractHandler(
    jsonApiRelationships("custom_field", z.uuid()),
    extension(EDITION, true),
).handler(async (customFieldIds, edition) => {
    await em.transactional(async (em) => {
        await lockEditions(em, [edition.id]);

        // Locked here in id order, which is the order a session save shares
        // them in: the batched update renumbering them at flush takes its rows
        // in whatever order its plan scans them.
        const customFields = await em.find(
            CustomField,
            { edition },
            { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
        );
        const supplied = new Set(customFieldIds);

        if (supplied.size !== customFieldIds.length || supplied.size !== customFields.length) {
            throw incompleteOrderError(customFields);
        }

        const byId = new Map(customFields.map((customField) => [customField.id, customField]));
        const positions = new Map<CustomFieldTarget, number>();

        for (const customFieldId of customFieldIds) {
            const customField = byId.get(customFieldId);

            if (!customField) {
                throw incompleteOrderError(customFields);
            }

            const next = positions.get(customField.target) ?? 0;
            customField.position = next;
            positions.set(customField.target, next + 1);
            em.persist(customField);
        }
    });

    return StatusCode.NO_CONTENT;
});

export const customFieldsRouter = new Router()
    .route("/", m.post(createCustomFieldHandler))
    .route("/:customFieldId", m.patch(updateCustomFieldHandler).delete(deleteCustomFieldHandler))
    .layer(new RequireAuthorizationLayer({ user: { role: "manager" } }))
    // The reads sit past the manager layer on purpose: submitters render their
    // forms from the full definition.
    .route("/", m.get(listCustomFieldsHandler))
    .route("/:customFieldId", m.get(showCustomFieldHandler));

export const addOpenapiCustomFieldPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/custom-fields", {
        get: {
            tags: ["CustomFields"],
            summary: "List custom fields",
            description:
                "Lists the custom fields of an edition. Open to any authenticated subject." +
                " Scoping is served in full, as bare resource identifiers: a caller who may not" +
                " see a session type or track can still tell whether it is the one their session" +
                " is on, and no resource for it is ever included.",
            operationId: "listCustomFields",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "CustomFields of the edition",
                    cardinality: "many",
                    resourceSchema: customFieldResourceSchema,
                }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        post: {
            tags: ["CustomFields"],
            summary: "Create a custom field",
            description:
                "Creates a custom field in an edition. The referenced session types and tracks must" +
                " belong to the same edition. Requires the manager role.",
            operationId: "createCustomField",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: customFieldContentObject,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "The created custom field",
                    cardinality: "one",
                    resourceSchema: customFieldResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition not found, or a session type or track id outside this edition",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Another custom field with this target in this edition already uses" +
                        " this external key (external_key_taken)",
                }),
                422: buildErrorResponseObject({
                    description:
                        "Invalid request body, or scoping on a per_host custom field" +
                        " (inapplicable_relationship)",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/relationships/custom-fields", {
        patch: {
            tags: ["CustomFields"],
            summary: "Reorder custom fields",
            description:
                "Sets the order of the custom fields of an edition. The list must name every" +
                " custom field of the edition exactly once; positions are then assigned per target" +
                " in the order given. Requires the manager role.",
            operationId: "reorderCustomFields",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: buildRelationshipsRequestContentObject("custom_field", z.uuid()),
            },
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
                422: buildErrorResponseObject({
                    description:
                        "The list does not match the edition's custom fields exactly" +
                        " (incomplete_order); the current ids are in the error meta",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/custom-fields/{customFieldId}", {
        get: {
            tags: ["CustomFields"],
            summary: "Show a custom field",
            description:
                "Retrieves a single custom field of an edition. Open to any authenticated" +
                " subject, including integration tokens and subjects without a user record." +
                " Scoping is served in full, as bare resource identifiers.",
            operationId: "showCustomField",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("customFieldId"),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "The custom field",
                    cardinality: "one",
                    resourceSchema: customFieldResourceSchema,
                }),
                404: buildErrorResponseObject({
                    description: "Edition or custom field not found",
                }),
            },
        },
        patch: {
            tags: ["CustomFields"],
            summary: "Update a custom field",
            description:
                "Updates a custom field of an edition. The target and the option type are immutable" +
                " and must match the stored values. Requires the manager role.",
            operationId: "updateCustomField",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("customFieldId"),
            ],
            requestBody: {
                required: true,
                content: customFieldContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "The updated custom field",
                    cardinality: "one",
                    resourceSchema: customFieldResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition or custom field not found, or a session type or track id" +
                        " outside this edition",
                }),
                409: buildErrorResponseObject({
                    description:
                        "Target or option type does not match the stored value (conflict), a" +
                        " removed choice option carries a response (entity_in_use), or another" +
                        " custom field with this target in this edition already uses this" +
                        " external key (external_key_taken)",
                }),
                422: buildErrorResponseObject({
                    description:
                        "Invalid request body, or scoping on a per_host custom field" +
                        " (inapplicable_relationship)",
                }),
            },
        },
        delete: {
            tags: ["CustomFields"],
            summary: "Delete a custom field",
            description:
                "Deletes a custom field of an edition together with its responses. Requires the" +
                " manager role.",
            operationId: "deleteCustomField",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("customFieldId"),
            ],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Manager role required" }),
                404: buildErrorResponseObject({ description: "Edition or custom field not found" }),
            },
        },
    });
};
