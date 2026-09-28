import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceSchemaObject,
} from "@jsonapi-serde/openapi";
import { JsonApiDocument, JsonApiError } from "@jsonapi-serde/server/common";
import type { FilterQuery, Loaded } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { createExtractHandler } from "@taxum/core/routing";
import { create } from "content-disposition";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../../entity/Edition.js";
import { Response } from "../../entity/Response.js";
import { Slot } from "../../entity/Slot.js";
import type { User } from "../../entity/User.js";
import type { FileDescriptor } from "../../support/file-upload.js";
import { visibleResponseFilter } from "../../support/responses.js";
import { findCurrentSchedule } from "../../support/schedules.js";
import { appConfig } from "../../util/app-config.js";
import {
    caller,
    hasGlobalReadAccess,
    JWT_PAYLOAD,
    type JwtPayload,
    userProvidesRole,
} from "../../util/auth.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter } from "../../util/openapi.js";
import { s3Client } from "../../util/s3.js";
import { EDITION } from "./resolve-edition-layer.js";

const EXPIRES_IN = 300;

const fileNotFoundError = (): JsonApiError =>
    new JsonApiError({
        status: "404",
        code: "file_not_found",
        title: "File not found",
        detail: "The response does not exist, is not visible to you, or holds no file",
    });

const visibleToUserFilter = (
    user: Loaded<User, "teams">,
    jwtPayload: JwtPayload,
): FilterQuery<Response> => {
    // visibleResponseFilter presumes the route already established read
    // access to the surrounding session, which this standalone route has not:
    // without global read access a caller is clamped to its own sessions'
    // responses and its own host responses, confidential included. Narrower
    // than the session routes in one spot: a co-host reads other hosts'
    // non-confidential per_host responses there but cannot mint them here.
    const ownResponses: FilterQuery<Response> = {
        $or: [{ session: { hosts: { user } } }, { host: { user } }],
    };

    return hasGlobalReadAccess(jwtPayload, user)
        ? visibleResponseFilter({
              seesEveryResponse: userProvidesRole(jwtPayload, user, "manager"),
              callerUser: user,
          })
        : ownResponses;
};

/**
 * Clamps an integration to the answers its schedule document already carried.
 *
 * `/schedules/current` is the only schedule route an integration reaches, and
 * it serves slots for confirmed sessions alone, so a key it was never handed is
 * one it may not resolve. Neither hop is a mapped relation, since `Slot.session`
 * has no inverse and a host does not collect its sessions, so both sets are read
 * here rather than expressed as a filter.
 */
const publishedResponseFilter = async (edition: Edition): Promise<FilterQuery<Response>> => {
    const schedule = await findCurrentSchedule(em, edition);

    if (!schedule) {
        throw fileNotFoundError();
    }

    const slots = await em.find(
        Slot,
        { schedule, session: { state: "confirmed" } },
        { populate: ["session.hosts"] },
    );

    return {
        customField: { confidential: false },
        $or: [
            { session: { $in: slots.map((slot) => slot.session.id) } },
            {
                host: {
                    $in: slots.flatMap((slot) => slot.session.unwrap().hosts.getIdentifiers()),
                },
            },
        ],
    };
};

export const mintResponseFileHandler = createExtractHandler(
    pathParams(z.object({ responseId: z.uuid() })),
    caller,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ responseId }, caller, jwtPayload, edition) => {
    const filter =
        caller === "integration"
            ? await publishedResponseFilter(edition)
            : visibleToUserFilter(caller, jwtPayload);

    const response = await em.findOne(Response, {
        $and: [{ id: responseId, customField: { edition } }, filter],
    });

    if (!response) {
        throw fileNotFoundError();
    }

    const customField = await response.customField.loadOrFail();

    if (customField.options.type !== "file" || response.value === null) {
        throw fileNotFoundError();
    }

    const descriptor = response.value as FileDescriptor;
    const url = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
            Bucket: appConfig.s3.bucketName,
            Key: descriptor.key,
            ResponseContentDisposition: create(descriptor.filename),
        }),
        { expiresIn: EXPIRES_IN },
    );

    return new JsonApiDocument({
        data: {
            id: response.id,
            type: "signed_get",
            attributes: {
                url,
                expiresIn: EXPIRES_IN,
            },
        },
    });
});

const signedGetResourceSchema = buildResourceSchemaObject({
    type: "signed_get",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            url: {
                description: "Presigned URL the file can be fetched from without credentials",
                type: "string",
                format: "uri",
            },
            expiresIn: {
                description: "Seconds the signature stays valid",
                type: "integer",
            },
        },
        required: ["url", "expiresIn"],
        additionalProperties: false,
    },
});

export const addOpenapiResponseFilePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/responses/{responseId}/file", {
        get: {
            tags: ["Custom Fields"],
            summary: "Mint a download URL for a file response",
            description:
                "Answers with a short-lived presigned URL for the file a response holds. The" +
                " response has to be visible to the caller under the usual confidentiality" +
                " rules; anything else, including a response that holds no file, answers 404." +
                " An integration is held to what /schedules/current already served it:" +
                " non-confidential answers on confirmed sessions slotted in the current" +
                " publication, and the per-host answers of those sessions' hosts.",
            operationId: "mintResponseFileUrl",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("responseId"),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: signedGetResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description:
                        "Edition not found, or the response or its file is not available" +
                        " (file_not_found)",
                }),
            },
        },
    });
};
