import { randomUUID } from "node:crypto";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
    buildResourceSchemaObject,
} from "@jsonapi-serde/openapi";
import { JsonApiDocument, JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { PendingUpload } from "../entity/PendingUpload.js";
import { User } from "../entity/User.js";
import { extensionsByContentType, uploadContentTypes } from "../support/file-upload.js";
import { appConfig } from "../util/app-config.js";
import { RequireAuthorizationLayer, requiredUser } from "../util/auth.js";
import { assertExists } from "../util/helpers.js";
import { em } from "../util/mikro-orm.js";
import { s3Client } from "../util/s3.js";

const EXPIRES_IN = 300;

/**
 * How many uploads one person may have waiting to be attached.
 *
 * A signature costs nothing to ask for and each one buys another object of up
 * to `s3.maxFileSize` under `temp/`, which the pruner only clears by age. The
 * cap is the only thing between that and an unbounded bill.
 *
 * It counts what is outstanding rather than what a form asks for, and a row
 * outlives its form: replacing a picked file leaves the one before it, as do a
 * cancel, a failed upload to the store and an abandoned form, every one of them
 * until the pruner's window passes. So the honest ceiling is a day of somebody
 * reworking several sessions, not one submission.
 */
const MAX_PENDING_UPLOADS = 50;

const attributesSchema = z.strictObject({
    contentType: z.enum(uploadContentTypes),
    md5Hash: z.string().regex(/^[a-fA-F0-9]{32}$/, "Invalid MD5 hash"),
});

const createResourceOptions = {
    type: "signed_post",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;
const createContentObject = buildResourceRequestContentObject(createResourceOptions);

const createSignedPostHandler = createExtractHandler(
    jsonApiResource(createResourceOptions),
    requiredUser,
).handler(async ({ attributes }, user) => {
    const id = randomUUID();

    // Keyed off the validated content type rather than the client filename, so
    // the key's extension and the stored content type cannot disagree.
    const key = `temp/${id}${extensionsByContentType[attributes.contentType]}`;
    const base64Md5Hash = Buffer.from(attributes.md5Hash, "hex").toString("base64");

    const { url, fields } = await createPresignedPost(s3Client, {
        Bucket: appConfig.s3.bucketName,
        Key: key,
        Fields: {
            "Content-MD5": base64Md5Hash,
            "Content-Type": attributes.contentType,
        },
        Conditions: [
            { bucket: appConfig.s3.bucketName },
            { key },
            { "Content-MD5": base64Md5Hash },
            { "Content-Type": attributes.contentType },
            ["content-length-range", 0, appConfig.s3.maxFileSize],
        ],
        Expires: EXPIRES_IN,
    });

    // Signed first and recorded after, so a signature the quota refuses is
    // simply dropped. Recording first would leave a row behind whenever signing
    // throws, and that row counts toward the quota until the pruner's window
    // passes.
    await em.fork().transactional(async (em) => {
        // Serializes one uploader against themselves: without it two requests
        // both read a count below the cap and both insert.
        const locked = await em.findOne(
            User,
            { id: user.id },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(locked, "User", user.id);

        if ((await em.count(PendingUpload, { user })) >= MAX_PENDING_UPLOADS) {
            throw new JsonApiError({
                status: "429",
                code: "pending_upload_quota_reached",
                title: "Pending upload quota reached",
                detail: "Too many uploads are waiting to be attached; try again later",
            });
        }

        em.persist(new PendingUpload({ key, user: ref(user) }));
    });

    return new JsonApiDocument({
        data: {
            id,
            type: "signed_post",
            attributes: {
                key,
                url,
                fields,
                expiresIn: EXPIRES_IN,
            },
        },
    });
});

export const signedPostsRouter = new Router()
    .route("/", m.post(createSignedPostHandler))
    .layer(new RequireAuthorizationLayer({ user: true }));

const signedPostResourceSchema = buildResourceSchemaObject({
    type: "signed_post",
    id: { type: "string", format: "uuid" },
    attributes: {
        type: "object",
        properties: {
            key: {
                description: "Object key the upload is stored under",
                type: "string",
            },
            url: {
                description: "Endpoint the multipart form has to be posted to",
                type: "string",
                format: "uri",
            },
            fields: {
                description: "Form fields which have to be sent unchanged with the upload",
                type: "object",
                additionalProperties: { type: "string" },
            },
            expiresIn: {
                description: "Seconds the signature stays valid",
                type: "integer",
            },
        },
        required: ["key", "url", "fields", "expiresIn"],
        additionalProperties: false,
    },
});

export const addOpenapiSignedPostPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/signed-posts", {
        post: {
            tags: ["Signed Posts"],
            summary: "Create a signed post",
            description:
                "Creates a presigned S3 POST for a temporary upload. The signature pins the content type, which has to be one of the allowed image or document types, and the MD5 hash of the payload, and it caps the upload at the configured maximum file size. Open to any authenticated user with a profile.",
            operationId: "createSignedPost",
            requestBody: {
                required: true,
                content: createContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: signedPostResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
                429: buildErrorResponseObject({
                    description:
                        "Too many uploads are already waiting to be attached" +
                        " (pending_upload_quota_reached)",
                }),
            },
        },
    });
};
