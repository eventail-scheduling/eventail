import assert from "node:assert";
import path from "node:path";
import { NoSuchKey, NotFound } from "@aws-sdk/client-s3";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { z } from "zod";
import { PendingUpload } from "../entity/PendingUpload.js";
import type { User } from "../entity/User.js";
import { appConfig } from "../util/app-config.js";
import { compareCodeUnits } from "../util/helpers.js";
import { s3Client } from "../util/s3.js";
import type { ResolvedImageConstraints } from "./image-constraints.js";
import { assertImageBytesWithinConstraints, assertImageUploadHead } from "./image-probe.js";

// The allow-list deliberately contains no type a browser would execute
// same-origin (text/html, image/svg+xml, JavaScript).
export const extensionsByContentType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/rtf": ".rtf",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
    "application/vnd.oasis.opendocument.presentation": ".odp",
} as const;

export type UploadContentType = keyof typeof extensionsByContentType;

export const uploadContentTypes = Object.keys(extensionsByContentType) as [
    UploadContentType,
    ...UploadContentType[],
];

const tempKeyPattern =
    /^temp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

const uploadedFileSchema = z.strictObject({
    key: z.string().min(1).max(255).regex(tempKeyPattern, "Invalid temporary upload key"),
    filename: z
        .string()
        .min(1)
        .max(255)
        .regex(
            /^[^\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u,
            "Must not contain control or directional characters",
        ),
});

/**
 * Names a fresh upload by its temporary key and its filename.
 *
 * A stored key is never accepted. Attaching copies an upload to a new key, and
 * an image's stored key is re-pointed again when its derivative job lands. A
 * write keeps a stored file by leaving the attribute out or, for an answer, by
 * naming the stored answer by its id.
 */
export const fileDescriptorInputSchema = uploadedFileSchema;
export type FileDescriptorInput = z.output<typeof fileDescriptorInputSchema>;

export type FileDescriptor = {
    key: string;
    filename: string;
};

// thumbnailKey starts as a copy of key at attach and is re-pointed by the
// processing job, so both URLs always exist and no consumer branches on a
// missing thumbnail; thumbnailKey === key is the job's not-yet-processed
// marker. The key itself stays storage-only, but that comparison ships as
// `processing`.
export type ImageFileDescriptor = FileDescriptor & {
    thumbnailKey: string;
};

export type SerializedImageFileDescriptor = FileDescriptor & {
    url: string;
    thumbnailUrl: string;
    processing: boolean;
};

/**
 * States `processing` rather than leaving a consumer to infer it.
 *
 * A consumer could infer it from the two urls matching. Stating it lets an
 * integration skip downloading an original it would replace seconds later, and
 * lets a manage surface say the image is still processing instead of rendering
 * the unprocessed original.
 */
export const serializeImageFileDescriptor = (
    descriptor: ImageFileDescriptor | null,
): SerializedImageFileDescriptor | null =>
    descriptor
        ? {
              key: descriptor.key,
              filename: descriptor.filename,
              url: `${appConfig.s3.publicBaseUrl}/${descriptor.key}`,
              thumbnailUrl: `${appConfig.s3.publicBaseUrl}/${descriptor.thumbnailKey}`,
              processing: descriptor.thumbnailKey === descriptor.key,
          }
        : null;

/** Names the field an upload was sent for, so a refusal can point the sender back at it. */
export type UploadField = { attribute: string } | { customFieldId: string };

type CopyOp = {
    field: UploadField;
    source: FileDescriptorInput;
    targetKey: string;
    imageConstraints: ResolvedImageConstraints | null;
    contentType?: string;
};

export class FileUploadHandler {
    private copyOps: CopyOp[] = [];

    public constructor(private readonly user: User) {}

    /**
     * Queues a copy rather than making one, so the key is not written yet.
     *
     * The descriptor names a path that exists only once `runCopyOps` has run,
     * which has to be in the same transaction and ahead of bumpEditionRevision,
     * since claiming the pending uploads locks rows the order places before the
     * counter. Handing over image constraints is also what validates the bytes
     * and sends the object with a public cache policy rather than a private
     * one. Who may read it is the bucket policy's call, by path.
     */
    public add(
        field: UploadField,
        pathPrefix: string,
        newDescriptor: FileDescriptorInput | null,
        imageConstraints: ResolvedImageConstraints,
    ): ImageFileDescriptor | null;
    public add(
        field: UploadField,
        pathPrefix: string,
        newDescriptor: FileDescriptorInput | null,
    ): FileDescriptor | null;
    public add(
        field: UploadField,
        pathPrefix: string,
        newDescriptor: FileDescriptorInput | null,
        imageConstraints: ResolvedImageConstraints | null = null,
    ): FileDescriptor | ImageFileDescriptor | null {
        if (newDescriptor === null) {
            return null;
        }

        const filename = path.basename(newDescriptor.key);
        const filePath = `${pathPrefix}/${filename}`;
        this.copyOps.push({
            field,
            source: newDescriptor,
            targetKey: filePath,
            imageConstraints,
        });

        if (imageConstraints) {
            return {
                key: filePath,
                filename: newDescriptor.filename,
                thumbnailKey: filePath,
            };
        }

        return {
            key: filePath,
            filename: newDescriptor.filename,
        };
    }

    public async runCopyOps(em: EntityManager): Promise<void> {
        // Key order so two requests carrying the same pair of uploads cannot
        // take them in opposite orders and deadlock on each other.
        const ordered = [...this.copyOps].sort((left, right) =>
            compareCodeUnits(left.source.key, right.source.key),
        );

        for (const move of ordered) {
            await this.claimPendingUpload(em, move);
            await this.validateSource(move);
        }

        for (const moveOp of this.copyOps) {
            const contentType = moveOp.contentType;

            await s3Client.copyObject({
                Bucket: appConfig.s3.bucketName,
                CopySource: `${appConfig.s3.bucketName}/${moveOp.source.key}`,
                Key: moveOp.targetKey,
                // Re-declared metadata pins the validated content type; a
                // non-image served from the bucket must download, not render.
                MetadataDirective: "REPLACE",
                ContentType: contentType,
                ContentDisposition: contentType?.startsWith("image/") ? undefined : "attachment",
                // Every upload mints a fresh uuid key, so stored URLs never
                // change content and can cache forever.
                CacheControl: moveOp.imageConstraints
                    ? "public, max-age=31536000, immutable"
                    : "private, max-age=31536000, immutable",
            });
        }

        this.copyOps = [];
    }

    /**
     * Consumes the row inside the caller's transaction.
     *
     * A rolled back write then leaves the upload attachable again, and a key
     * cannot be attached twice. The lock is what makes the second claim true
     * under concurrency: an unlocked read lets two simultaneous attaches both
     * find the row, and the loser's delete then quietly matches nothing.
     */
    private async claimPendingUpload(em: EntityManager, move: CopyOp): Promise<void> {
        const pendingUpload = await em.findOne(
            PendingUpload,
            { key: move.source.key, user: this.user },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );

        if (!pendingUpload) {
            throw missingFileError(move);
        }

        em.remove(pendingUpload);
    }

    private async validateSource(move: CopyOp): Promise<void> {
        try {
            if (move.imageConstraints) {
                const result = await s3Client.getObject({
                    Bucket: appConfig.s3.bucketName,
                    Key: move.source.key,
                });

                move.contentType = result.ContentType;

                try {
                    assertImageUploadHead(
                        { contentType: result.ContentType, contentLength: result.ContentLength },
                        appConfig.s3.maxFileSize,
                    );
                } catch (error) {
                    (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
                    throw error;
                }

                const bytes = await result.Body?.transformToByteArray();
                assert(bytes, "Object body missing");
                assertImageBytesWithinConstraints(bytes, result.ContentType, move.imageConstraints);

                return;
            }

            const headResult = await s3Client.headObject({
                Bucket: appConfig.s3.bucketName,
                Key: move.source.key,
            });

            move.contentType = headResult.ContentType;
        } catch (error) {
            // GetObject signals a missing key as NoSuchKey, HeadObject as
            // NotFound.
            if (error instanceof NoSuchKey || error instanceof NotFound) {
                throw missingFileError(move);
            }

            throw error;
        }
    }
}

/**
 * Gives one answer to three different failures.
 *
 * An object that is missing, was never yours, or has already been attached all
 * read the same, so a caller cannot probe for keys belonging to anyone else.
 * The field and key are echoed from the request, so they tell the caller nothing new.
 */
const missingFileError = (move: CopyOp): JsonApiError =>
    new JsonApiError({
        status: "404",
        code: "missing_file",
        title: "Missing file",
        detail: "The uploaded file is no longer available; choose it again",
        meta: { ...move.field, key: move.source.key },
    });
