import assert from "node:assert";
import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseResourceRequestOptions,
    clientResourceIdentifierSchema,
    type IncludedTypeSchemas,
    type IncludedTypesContainer,
    relationshipSchema,
} from "@jsonapi-serde/server/request";
import { ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { type Extractor, extension } from "@taxum/core/extract";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { ContentObject, OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { zt } from "zod-temporal";
import { Edition } from "../../../entity/Edition.js";
import type { Host } from "../../../entity/Host.js";
import { HostAvailability } from "../../../entity/HostAvailability.js";
import { Job } from "../../../entity/Job.js";
import { Response } from "../../../entity/Response.js";
import { ownHostResourceSchema } from "../../../json-api/host.js";
import { hostAvailabilityResourceSchema } from "../../../json-api/host-availability.js";
import { serialize } from "../../../json-api/index.js";
import { responseResourceSchema } from "../../../json-api/response.js";
import {
    findIntervalProblem,
    intervalProblemError,
    maxAvailabilities,
    mergeIntervals,
} from "../../../support/availability.js";
import { bumpEditionRevision } from "../../../support/edition-revision.js";
import { editionWindow } from "../../../support/edition-window.js";
import { type FileDescriptorInput, FileUploadHandler } from "../../../support/file-upload.js";
import { resolveHost } from "../../../support/hosts.js";
import { pinEdition, takeEdition } from "../../../support/locking.js";
import {
    asksForAvailability,
    avatarConstraints,
    createProfileFieldAttributeSchemas,
} from "../../../support/profile-fields.js";
import {
    includedResponseSchemas,
    type ResponseIdentifier,
    responseIdentifierSchema,
    updateResponses,
    visibleResponsesFingerprint,
} from "../../../support/responses.js";
import { visibleFingerprint } from "../../../support/visible-changes.js";
import { RequireAuthorizationLayer, requiredUser } from "../../../util/auth.js";
import { patchObject } from "../../../util/helpers.js";
import { em } from "../../../util/mikro-orm.js";
import { createUuidPathParameter, imageRefusalCodes } from "../../../util/openapi.js";
import { publishJob } from "../../../worker/util.js";
import { EDITION } from "../resolve-edition-layer.js";

const includedTypeSchemas = {
    response: includedResponseSchemas,
    host_availability: {
        attributesSchema: z.strictObject({
            startsAt: zt.instant(),
            endsAt: zt.instant(),
        }),
    },
} satisfies IncludedTypeSchemas;

type IncludedTypes = IncludedTypesContainer<typeof includedTypeSchemas>;

/**
 * A relationship left out is a collection left alone.
 *
 * Availability that is sent replaces what was there, so an empty array clears
 * it. Answers that are sent have to name every question the host is asked,
 * keeping a stored answer by its id or replacing it by lid, and every stored
 * answer to a frozen question by its id, so an empty array is refused unless
 * nothing is asked or stored.
 */
const relationshipsSchema = z.strictObject({
    responses: z.optional(relationshipSchema(z.array(responseIdentifierSchema))),
    availabilities: z.optional(
        relationshipSchema(
            z.array(clientResourceIdentifierSchema("host_availability")).max(maxAvailabilities),
        ),
    ),
});

/**
 * Varies only the attributes by edition.
 *
 * Availability is accepted as a shape whatever the edition asks for and refused
 * in the handler instead, so a host sending one to an edition that stopped
 * asking is told that rather than told the key does not exist.
 */
const buildHostResourceOptions = (edition: Edition) =>
    ({
        type: "host",
        attributesSchema: z.optional(z.strictObject(createProfileFieldAttributeSchemas(edition))),
        relationshipsSchema: z.optional(relationshipsSchema),
        includedTypeSchemas,
    }) satisfies AnyParseResourceRequestOptions;

type ParsedHostRequest = {
    attributes?: Record<string, unknown>;
    relationships?: {
        responses?: { data: ResponseIdentifier[] };
        availabilities?: { data: { lid: string }[] };
    };
    includedTypes: IncludedTypes;
};

const editionExtractor = extension(EDITION, true);

const runtimeHostExtractor: Extractor<ParsedHostRequest> = async (req) => {
    const edition = await editionExtractor(req);
    const extractor = jsonApiResource(buildHostResourceOptions(edition));

    return (await extractor(req)) as ParsedHostRequest;
};

type AvailabilityReplacement = {
    em: EntityManager;
    host: Host;
    edition: Edition;
    lids: string[];
    included: IncludedTypes["host_availability"];
};

const replaceAvailabilities = ({
    em,
    host,
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

    host.availabilities.set(
        kept.map((interval) => new HostAvailability({ ...interval, host: ref(host) })),
    );
    em.persist(host);
};

const publishedFingerprint = async (em: EntityManager, host: Host): Promise<string> =>
    visibleFingerprint([
        host.displayName,
        host.biography,
        host.avatar,
        await visibleResponsesFingerprint(em, { host }),
    ]);

/**
 * Queues the copy that puts the avatar somewhere permanent.
 *
 * An avatar cannot be assigned the way the other attributes are: what arrives
 * points at the upload area, and only the handler copies it somewhere permanent
 * and measures it against the constraints. Encoding is queued for a fresh upload;
 * clearing the avatar needs none.
 */
const attachAvatar = async (
    em: EntityManager,
    host: Host,
    edition: Edition,
    avatar: FileDescriptorInput | null,
    fileUploadHandler: FileUploadHandler,
): Promise<void> => {
    host.avatar = fileUploadHandler.add(
        { attribute: "avatar" },
        `${edition.id}/hosts/${host.id}/avatar`,
        avatar,
        avatarConstraints,
    );

    if (avatar) {
        assert(host.avatar, "attach returned no descriptor");
        await publishJob(
            new Job({ payload: { type: "process_avatar", hostId: host.id, key: host.avatar.key } }),
            em,
        );
    }
};

const showMeHostHandler = createExtractHandler(requiredUser, extension(EDITION, true)).handler(
    async (user, edition) => {
        const host = await em.transactional(async (em) => {
            await pinEdition(em, edition);

            const host = await resolveHost(em, ref(edition), user);
            await em.populate(host, ["responses", "availabilities"]);

            return host;
        });

        return serialize("host", host, { include: ["responses", "availabilities"] });
    },
);

const updateMeHostHandler = createExtractHandler(
    runtimeHostExtractor,
    requiredUser,
    extension(EDITION, true),
).handler(async ({ attributes, relationships, includedTypes }, user, staleEdition) => {
    const fileUploadHandler = new FileUploadHandler(user);

    const host = await em.transactional(async (em) => {
        // Read afresh under the lock: availability is checked against the
        // edition's days, which have to be the ones a concurrent move commits,
        // not the ones the request resolved.
        const edition = await takeEdition(em, staleEdition.id, { refresh: true });

        const host = await resolveHost(em, ref(edition), user);
        await em.populate(host, ["responses", "availabilities"]);
        const before = await publishedFingerprint(em, host);

        const { avatar, ...rest } = attributes ?? {};
        patchObject(host, rest);

        if (avatar !== undefined) {
            await attachAvatar(
                em,
                host,
                edition,
                avatar as FileDescriptorInput | null,
                fileUploadHandler,
            );
        }

        if (relationships?.responses) {
            const existingResponses = new Map(
                (await em.find(Response, { host, customField: { edition } })).map((response) => [
                    response.customField.id,
                    response,
                ]),
            );
            await updateResponses({
                target: { type: "host", host },
                em,
                edition,
                includedResponses: includedTypes.response,
                responseIdentifiers: relationships.responses.data,
                existingResponses,
                fileUploadHandler,
            });
        }

        if (relationships?.availabilities) {
            if (!asksForAvailability(edition)) {
                throw new JsonApiError({
                    status: "422",
                    code: "availability_not_asked",
                    title: "Availability not asked for",
                    detail: "This edition does not ask a host when they are available",
                });
            }

            replaceAvailabilities({
                em,
                host,
                edition,
                lids: relationships.availabilities.data.map((data) => data.lid),
                included: includedTypes.host_availability,
            });
        }

        await fileUploadHandler.runCopyOps(em);

        if ((await publishedFingerprint(em, host)) !== before) {
            await bumpEditionRevision(em, edition);
        }

        return host;
    });

    return serialize("host", host, { include: ["responses", "availabilities"] });
});

export const meHostRouter = new Router()
    .route("/", m.get(showMeHostHandler).patch(updateMeHostHandler))
    .layer(new RequireAuthorizationLayer({ user: true }));

/**
 * Documents the widest request a client may send.
 *
 * Requirement levels are per edition, so no single schema describes every one.
 * This shape enables every profile field as far as it can be enabled; requests
 * keep using the runtime schema.
 */
const documentedContent: ContentObject = buildResourceRequestContentObject(
    buildHostResourceOptions(
        new Edition({
            name: "Documentation",
            startDate: Temporal.PlainDate.from("2000-01-01"),
            endDate: Temporal.PlainDate.from("2000-12-31"),
            timeZone: "UTC",
            submissionDeadline: null,
            profileFieldOptions: {
                displayName: {},
                emailAddress: {},
                biography: { requirement: "optional" },
                avatar: { requirement: "optional" },
                availability: { requirement: "optional" },
            },
        }),
    ),
);

export const addOpenapiMeHostPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/me/host", {
        get: {
            tags: ["Hosts"],
            summary: "Show the caller's own host record",
            description:
                "Retrieves the caller's host record for this edition, with their answers to " +
                "per-host custom fields and the times they said they are available. The record " +
                "is created on first read, prefilled from the caller's user record, so this " +
                "never reports that a host is missing.",
            operationId: "showMeHost",
            parameters: [createUuidPathParameter("editionId")],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: ownHostResourceSchema,
                    included: [responseResourceSchema, hostAvailabilityResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition not found" }),
            },
        },
        patch: {
            tags: ["Hosts"],
            summary: "Update the caller's own host record",
            description:
                "Updates the caller's host record. Which attributes are accepted follows the " +
                "edition's profile field configuration, and every one of them is optional: an " +
                "attribute that is left out keeps its stored value, while one that is sent has " +
                "to satisfy the requirement the organizer set, so a field marked required may " +
                "be left untouched but not emptied. Whether a required field was ever answered " +
                "is checked where it matters, not here. The same holds one level up for the " +
                "relationships: leaving `responses` or `availabilities` out keeps that " +
                "collection as it stands, and sending either one replaces it entirely. The two " +
                "differ in what a replacement may contain. A set of answers has to name every " +
                "question the edition still asks, so an empty one is refused unless it asks " +
                "none; availabilities carry no such rule here: an empty set is accepted " +
                "whether the edition asks for availability optionally or requires it, and " +
                "reads as free throughout, though where it requires them a host with none " +
                "is refused once they submit a session or accept an invite. Availabilities " +
                "are only accepted while the edition asks for them at all. In the `responses` " +
                "relationship, an answer already stored on this record can be named by its id, " +
                "which keeps it as it is without its value being sent or checked again. A " +
                "frozen question is no longer asked, but a stored answer to it has to be " +
                "named by id: leaving it out, or sending a value for it, is refused with " +
                "frozen_response.",
            operationId: "updateMeHost",
            parameters: [createUuidPathParameter("editionId")],
            requestBody: { content: documentedContent, required: true },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: ownHostResourceSchema,
                    included: [responseResourceSchema, hostAvailabilityResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition or uploaded file not found" +
                        " (missing_file, whose meta echoes the upload's key and the attribute or customFieldId it" +
                        " was sent for)",
                }),
                422: buildErrorResponseObject({
                    description:
                        "The record does not satisfy the edition's configuration (availability_not_asked," +
                        " outside_edition, reversed_interval, sub_minute_interval, missing_responses," +
                        " frozen_response, unknown_custom_field, unknown_response, duplicate_response," +
                        ` invalid_responses), the request body is invalid, or an image is refused` +
                        ` (${imageRefusalCodes})`,
                }),
            },
        },
    });
};
