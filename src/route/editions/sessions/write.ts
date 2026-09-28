import assert from "node:assert";
import { buildDataResponseObject, buildErrorResponseObject } from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    ForeignKeyConstraintViolationException,
    type Loaded,
    LockMode,
    ref,
} from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../../../entity/Edition.js";
import { Job } from "../../../entity/Job.js";
import { Response } from "../../../entity/Response.js";
import { Session } from "../../../entity/Session.js";
import { SessionTransition } from "../../../entity/SessionTransition.js";
import { SessionType } from "../../../entity/SessionType.js";
import { Track } from "../../../entity/Track.js";
import type { User } from "../../../entity/User.js";
import { restrictedHostResourceSchema } from "../../../json-api/host.js";
import { serialize } from "../../../json-api/index.js";
import { responseResourceSchema } from "../../../json-api/response.js";
import { sessionWithTransitionsResourceSchema } from "../../../json-api/session.js";
import { sessionTypeResourceSchema } from "../../../json-api/session-type.js";
import { trackResourceSchema } from "../../../json-api/track.js";
import { bumpEditionRevision, reachesIntegration } from "../../../support/edition-revision.js";
import {
    type FileDescriptorInput,
    FileUploadHandler,
    type ImageFileDescriptor,
} from "../../../support/file-upload.js";
import { assertHostProfileComplete, hostsSession, resolveHost } from "../../../support/hosts.js";
import { pinEdition, takeEdition } from "../../../support/locking.js";
import {
    assertStoredResponsesComplete,
    updateResponses,
    visibleResponsesFingerprint,
} from "../../../support/responses.js";
import { resolveTeaserImageConstraints } from "../../../support/session-fields.js";
import { visibleFingerprint } from "../../../support/visible-changes.js";
import { JWT_PAYLOAD, requiredUser, userProvidesRole } from "../../../util/auth.js";
import {
    type ForeignKeyViolation,
    referenceGone,
    translateForeignKeyViolations,
} from "../../../util/constraint-violation.js";
import { assertExists, patchObject } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import {
    createUuidPathParameter,
    imageRefusalCodes,
    noContentResponseObject,
} from "../../../util/openapi.js";
import { publishJob } from "../../../worker/util.js";
import { EDITION } from "../resolve-edition-layer.js";
import { serializeSessionDocument } from "./document.js";
import {
    createPartialRuntimeSchemaExtractor,
    createRuntimeSchemaExtractor,
    createSessionRequestContent,
    type PartialSchemaExtractorResult,
    type SessionRelationshipsSchema,
    updateSessionRequestContent,
} from "./schemas.js";

const verifySessionAccess = (edition: Edition, isManager: boolean): void => {
    if (!isManager && edition.deadlinePassed) {
        throw new JsonApiError({
            status: "403",
            code: "deadline_passed",
            title: "Deadline passed",
            detail: "You cannot create or edit sessions after the deadline",
        });
    }
};

/**
 * Finds a session type the caller may choose, which findTrack mirrors for tracks.
 *
 * Both hide what a submitter may not choose, and are shared by the two routes
 * because that rule is the part which must not drift; what an absent member
 * means differs between them and is composed at each.
 */
const findSessionType = async (
    edition: Edition,
    id: string,
    isManager: boolean,
): Promise<SessionType> => {
    const sessionType = await em.findOne(SessionType, {
        edition,
        id,
        ...(isManager ? {} : { internal: false }),
    });
    assertExists(sessionType, "Session type", id);

    return sessionType;
};

const findTrack = async (edition: Edition, id: string, isManager: boolean): Promise<Track> => {
    const track = await em.findOne(Track, {
        edition,
        id,
        ...(isManager ? {} : { internal: false }),
    });
    assertExists(track, "Track", id);

    return track;
};

type ResolvedSessionRelationships = {
    sessionType: SessionType;
    track: Track | null;
};

const resolveSessionRelationships = async (
    edition: Edition,
    relationships: z.output<SessionRelationshipsSchema>,
    isManager: boolean,
): Promise<ResolvedSessionRelationships> => {
    const sessionType = await findSessionType(
        edition,
        relationships.sessionType.data.id,
        isManager,
    );
    const trackIdentifier = relationships.track?.data ?? null;

    if (trackIdentifier === null) {
        return { sessionType, track: null };
    }

    return { sessionType, track: await findTrack(edition, trackIdentifier.id, isManager) };
};

/**
 * Returns the descriptor the session stores, or null to clear it, queuing the copy an upload needs.
 *
 * Runs before the transaction on the create path, where the copy ops are what
 * the handler flushes; the caller does the persisting either way.
 */
const attachTeaserImage = (
    fileUploadHandler: FileUploadHandler,
    edition: Edition,
    session: Session,
    teaserImage: FileDescriptorInput | null,
): ImageFileDescriptor | null =>
    fileUploadHandler.add(
        { attribute: "teaserImage" },
        `${edition.id}/sessions/${session.id}/teaser-image`,
        teaserImage,
        resolveTeaserImageConstraints(edition),
    );

const queueTeaserImageJob = async (
    em: EntityManager,
    session: Session,
    teaserImage: FileDescriptorInput | null | undefined,
): Promise<void> => {
    if (!teaserImage) {
        return;
    }

    assert(session.teaserImage, "attach returned no descriptor");
    await publishJob(
        new Job({
            payload: {
                type: "process_teaser_image",
                sessionId: session.id,
                key: session.teaserImage.key,
            },
        }),
        em,
    );
};

/**
 * The references a session write names, keyed by the constraint that catches it.
 *
 * A row can go away between the unlocked read above and the flush below.
 */
const sessionReferenceViolations = (
    sessionTypeId: string | undefined,
    trackId: string | undefined,
): Record<string, ForeignKeyViolation> => ({
    ...(sessionTypeId !== undefined && {
        session_session_type_id_foreign: referenceGone("Session type", sessionTypeId),
    }),
    ...(trackId !== undefined && {
        session_track_id_foreign: referenceGone("Track", trackId),
    }),
});

export const createSessionHandler = createExtractHandler(
    createRuntimeSchemaExtractor(),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ attributes, relationships, meta, includedTypes }, user, jwtPayload, edition) => {
    const isManager = userProvidesRole(jwtPayload, user, "manager");
    verifySessionAccess(edition, isManager);

    if (!(meta.selfService || isManager)) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You can only submit your own sessions",
        });
    }

    const { sessionType, track } = await resolveSessionRelationships(
        edition,
        relationships,
        isManager,
    );

    const { teaserImage } = attributes;
    const session = new Session({
        title: attributes.title,
        abstract: attributes.abstract ?? "",
        description: attributes.description ?? "",
        notes: attributes.notes ?? "",
        duration: attributes.duration ?? null,
        setupTime: attributes.setupTime ?? null,
        teardownTime: attributes.teardownTime ?? null,
        teaserImage: null,
        edition: ref(edition),
        sessionType: ref(sessionType),
        track: track ? ref(track) : null,
    });

    const fileUploadHandler = new FileUploadHandler(user);

    if (teaserImage) {
        session.teaserImage = attachTeaserImage(fileUploadHandler, edition, session, teaserImage);
    }

    await translateForeignKeyViolations(
        () =>
            em.transactional(async (em) => {
                if (meta.selfService) {
                    // Read afresh under the lock: the deadline and the profile
                    // gate read the edition, which has to be what a concurrent
                    // edition write commits.
                    const locked = await takeEdition(em, edition.id, { refresh: true });
                    verifySessionAccess(locked, isManager);
                    const host = await resolveHost(em, ref(locked), user);
                    await assertHostProfileComplete(em, locked, host);
                    session.hosts.add(host);
                } else {
                    await pinEdition(em, edition);
                }

                em.persist(session);

                await queueTeaserImageJob(em, session, teaserImage);

                await updateResponses({
                    target: { type: "session", session },
                    em,
                    edition,
                    includedResponses: includedTypes.response,
                    responseIdentifiers: relationships.responses.data,
                    existingResponses: new Map(),
                    fileUploadHandler,
                });
                await fileUploadHandler.runCopyOps(em);
            }),
        sessionReferenceViolations(
            relationships.sessionType.data.id,
            relationships.track?.data?.id,
        ),
    );

    return [
        StatusCode.CREATED,
        serialize("session", session, {
            context: {
                session: {
                    actor: {
                        isManager,
                        hostsSessions: meta.selfService ? new Set([session.id]) : new Set(),
                    },
                },
            },
        }),
    ];
});

const assertSessionUpdatable = (
    session: Loaded<Session, "hosts">,
    edition: Edition,
    user: Loaded<User, "teams">,
    isManager: boolean,
): void => {
    if (!(isManager || hostsSession(session, user))) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You are not allowed to edit this session",
        });
    }

    if (!isManager) {
        const editable =
            (session.state === "submitted" && !edition.deadlinePassed) ||
            session.state === "accepted";

        if (!editable) {
            throw new JsonApiError({
                status: "403",
                code: "not_editable",
                title: "Not editable",
                detail: "Sessions can only be edited while submitted before the deadline, or while accepted",
            });
        }
    }
};

type BumpIfVisiblyChangedOptions = {
    em: EntityManager;
    edition: Edition;
    session: Session;
    beforeSession: string;
    beforeResponses: string;
};

/**
 * Bumps the edition revision when the write changed something a consumer sees.
 *
 * Attributes are only part of it: the caller may also have re-pointed the
 * session type and track, swapped the teaser image, and rewritten answers, none
 * of which an attribute comparison would catch. Call with the session row held
 * FOR UPDATE, so the comparison reads no other transaction's state.
 */
const bumpIfVisiblyChanged = async ({
    em,
    edition,
    session,
    beforeSession,
    beforeResponses,
}: BumpIfVisiblyChangedOptions): Promise<void> => {
    const changed =
        visibleSessionFingerprint(session) !== beforeSession ||
        (await visibleResponsesFingerprint(em, { session })) !== beforeResponses;

    if (changed && reachesIntegration(session.state)) {
        await bumpEditionRevision(em, edition);
    }
};

const scopeOf = (session: Session): string =>
    `${session.sessionType.id}/${session.track?.id ?? ""}`;

type SettlePatchedResponsesOptions = {
    em: EntityManager;
    edition: Edition;
    session: Session;
    responses: NonNullable<PartialSchemaExtractorResult["relationships"]>["responses"];
    includedResponses: PartialSchemaExtractorResult["includedTypes"]["response"];
    fileUploadHandler: FileUploadHandler;
    scopeChanged: boolean;
};

/**
 * Writes the answers a patch sent, or judges the stored ones when it left `responses` out.
 *
 * Sent, the member replaces the whole answer set, so it has to name every
 * applicable question that is not frozen, and name by id every stored answer
 * it cannot change. Absent, the stored answers are what the resource already
 * holds, and they are only judged when the patch changes the type or track.
 */
const settlePatchedResponses = async ({
    em,
    edition,
    session,
    responses,
    includedResponses,
    fileUploadHandler,
    scopeChanged,
}: SettlePatchedResponsesOptions): Promise<void> => {
    if (responses !== undefined) {
        await updateResponses({
            target: { type: "session", session },
            em,
            edition,
            includedResponses,
            responseIdentifiers: responses.data,
            existingResponses: new Map(
                (await em.find(Response, { session })).map((response) => [
                    response.customField.id,
                    response,
                ]),
            ),
            fileUploadHandler,
        });
        return;
    }

    if (scopeChanged) {
        await assertStoredResponsesComplete({
            target: { type: "session", session },
            em,
            edition,
            storedCustomFieldIds: new Set(
                (await em.find(Response, { session })).map((response) => response.customField.id),
            ),
        });
    }
};

export const updateSessionHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    createPartialRuntimeSchemaExtractor("sessionId"),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(
    async (
        { sessionId },
        { attributes, relationships, includedTypes },
        user,
        jwtPayload,
        edition,
    ) => {
        const isManager = userProvidesRole(jwtPayload, user, "manager");

        const sessionType =
            relationships?.sessionType === undefined
                ? undefined
                : await findSessionType(edition, relationships.sessionType.data.id, isManager);

        // Absent leaves the stored track alone, which is also what an edition
        // that stopped asking for one sends.
        let track: Track | null | undefined;

        if (relationships?.track !== undefined) {
            const identifier = relationships.track.data;
            track = identifier === null ? null : await findTrack(edition, identifier.id, isManager);
        }

        const fileUploadHandler = new FileUploadHandler(user);

        const session = await translateForeignKeyViolations(
            () =>
                em.transactional(async (em) => {
                    const locked = await em.findOne(
                        Session,
                        {
                            id: sessionId,
                            edition,
                        },
                        { lockMode: LockMode.PESSIMISTIC_WRITE },
                    );
                    assertExists(locked, "Session", sessionId);
                    const session = await em.populate(locked, ["hosts"]);
                    assertSessionUpdatable(session, edition, user, isManager);

                    const beforeSession = visibleSessionFingerprint(session);
                    const beforeResponses = await visibleResponsesFingerprint(em, { session });
                    const beforeScope = scopeOf(session);

                    const { teaserImage, ...attributesRest } = attributes ?? {};
                    patchObject(session, {
                        ...attributesRest,
                        ...(sessionType !== undefined && { sessionType: ref(sessionType) }),
                        ...(track !== undefined && { track: track === null ? null : ref(track) }),
                    });

                    if (teaserImage !== undefined) {
                        session.teaserImage = attachTeaserImage(
                            fileUploadHandler,
                            edition,
                            session,
                            teaserImage,
                        );
                        await queueTeaserImageJob(em, session, teaserImage);
                    }

                    em.persist(session);

                    await settlePatchedResponses({
                        em,
                        edition,
                        session,
                        responses: relationships?.responses,
                        includedResponses: includedTypes.response,
                        fileUploadHandler,
                        scopeChanged: scopeOf(session) !== beforeScope,
                    });

                    await fileUploadHandler.runCopyOps(em);
                    await bumpIfVisiblyChanged({
                        em,
                        edition,
                        session,
                        beforeSession,
                        beforeResponses,
                    });

                    return session;
                }),
            sessionReferenceViolations(
                relationships?.sessionType?.data.id,
                relationships?.track?.data?.id,
            ),
        );

        return serializeSessionDocument(session, user, jwtPayload, isManager);
    },
);

/**
 * Leaves out what an integration never sees or this handler never changes.
 *
 * `notes` is absent because it is organizer-only, and `state` and `hosts`
 * because this handler changes neither. `createdAt` is immutable.
 */
const visibleSessionFingerprint = (session: Session): string =>
    visibleFingerprint([
        session.title,
        session.abstract,
        session.description,
        session.duration,
        session.setupTime,
        session.teardownTime,
        session.teaserImage,
        session.sessionType.id,
        session.track?.id ?? null,
    ]);

export const deleteSessionHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    extension(EDITION, true),
).handler(async ({ sessionId }, edition) => {
    try {
        await em.transactional(async (em) => {
            const session = await em.findOne(
                Session,
                {
                    id: sessionId,
                    edition,
                },
                {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                },
            );
            assertExists(session, "Session", sessionId);

            const transitionCount = await em.count(SessionTransition, { session });

            if (session.state !== "submitted" || transitionCount > 0) {
                throw new JsonApiError({
                    status: "409",
                    code: "not_deletable",
                    title: "Not deletable",
                    detail: "Only submitted sessions without history can be deleted; cancel or reject it instead",
                });
            }

            em.remove(session);
        });
    } catch (error) {
        if (error instanceof ForeignKeyConstraintViolationException) {
            throw new JsonApiError({
                status: "409",
                code: "entity_in_use",
                title: "Entity in use",
                detail: "The session is still in use",
            });
        }

        throw error;
    }

    return StatusCode.NO_CONTENT;
});

const documentedSchemaNote =
    "The documented attributes and relationships are the widest set: which built-in fields exist, " +
    "and whether each one is optional or required, follows the edition's `sessionFieldOptions`, " +
    "and a field the edition does not configure is rejected with session_fields_changed, as is a " +
    "create that leaves out one it does. Responses travel " +
    "as included `response` resources referenced by local id from the `responses` relationship.";

const updateResponsesNote =
    "On an update, a stored answer can instead be referenced by its id, which keeps it as it is " +
    "without its value being sent or validated again. Only an answer of this session can be " +
    "referenced that way, including one whose question no longer applies to it.";

export const addOpenapiSessionWritePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/sessions", {
        post: {
            tags: ["Sessions"],
            summary: "Create a session",
            description:
                "Submits a session to the edition. Requires an authenticated user; with " +
                "`meta.selfService` the caller becomes a host, which requires the profile the " +
                "edition asks them for to be complete; submitting for someone else requires the " +
                "manager role, and only managers may submit after the submission deadline or " +
                `pick an internal session type or track. ${documentedSchemaNote}`,
            operationId: "createSession",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: {
                required: true,
                content: createSessionRequestContent,
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: sessionWithTransitionsResourceSchema,
                    included: [
                        restrictedHostResourceSchema,
                        sessionTypeResourceSchema,
                        trackResourceSchema,
                        responseResourceSchema,
                    ],
                }),
                403: buildErrorResponseObject({
                    description: "Forbidden (forbidden, deadline_passed)",
                }),
                404: buildErrorResponseObject({
                    description:
                        "Edition, session type, track or uploaded file not found" +
                        " (missing_file, whose meta echoes the upload's key and the attribute or customFieldId it" +
                        " was sent for)",
                }),
                422: buildErrorResponseObject({
                    description:
                        "Unprocessable request (missing_responses, inapplicable_response, " +
                        "frozen_response, unknown_custom_field, duplicate_response, " +
                        "invalid_responses, incomplete_profile, session_fields_changed, " +
                        `${imageRefusalCodes})`,
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/sessions/{sessionId}", {
        patch: {
            tags: ["Sessions"],
            summary: "Update a session",
            description:
                "Updates the session. An attribute or relationship that is left out keeps its " +
                "stored value, while a `responses` relationship that is sent has to name every " +
                "question that applies to the session after the update. A frozen one takes no " +
                "new value from anyone: its stored answer has to be named by id, and one with " +
                "no stored answer is left out; anything else for it is refused with " +
                "frozen_response. A question that does not apply to the session after the " +
                "update is treated the same way, refused with inapplicable_response. When " +
                "`responses` is left out and the session type or track changes, the stored " +
                "answers have to cover every question that applies afterward, frozen ones " +
                "excepted, or the patch is refused with missing_responses. Requires an " +
                "authenticated user who hosts the session, or the manager role. Hosts may " +
                "only edit while the session is submitted and the deadline has not passed, or " +
                "while it is accepted. `meta.selfService` is accepted for symmetry with the " +
                "create route and ignored here, since hosting is read from the session. " +
                `${documentedSchemaNote} ${updateResponsesNote}`,
            operationId: "updateSession",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            requestBody: {
                required: true,
                content: updateSessionRequestContent,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: sessionWithTransitionsResourceSchema,
                    included: [
                        restrictedHostResourceSchema,
                        sessionTypeResourceSchema,
                        trackResourceSchema,
                        responseResourceSchema,
                    ],
                }),
                403: buildErrorResponseObject({
                    description: "Forbidden (forbidden, not_editable)",
                }),
                404: buildErrorResponseObject({
                    description:
                        "Edition, session, session type, track or uploaded file not found" +
                        " (missing_file, whose meta echoes the upload's key and the attribute or customFieldId it" +
                        " was sent for)",
                }),
                422: buildErrorResponseObject({
                    description:
                        "Unprocessable request (missing_responses, inapplicable_response, " +
                        "frozen_response, unknown_custom_field, unknown_response, " +
                        "duplicate_response, invalid_responses, session_fields_changed, " +
                        `${imageRefusalCodes})`,
                }),
            },
        },
        delete: {
            tags: ["Sessions"],
            summary: "Delete a session",
            description:
                "Deletes a session that is still submitted and has no transition history. Any " +
                "other session has to be canceled, rejected or withdrawn instead. Requires the " +
                "manager role.",
            operationId: "deleteSession",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
                409: buildErrorResponseObject({
                    description: "Conflict (not_deletable, entity_in_use)",
                }),
            },
        },
    });
};
