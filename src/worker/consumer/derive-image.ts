import { randomUUID } from "node:crypto";
import path from "node:path";
import { NoSuchKey } from "@aws-sdk/client-s3";
import { type EntityName, type FilterQuery, LockMode, type Ref } from "@mikro-orm/core";
import sharp from "sharp";
import type { Edition } from "../../entity/Edition.js";
import { bumpEditionRevision } from "../../support/edition-revision.js";
import type { ImageFileDescriptor } from "../../support/file-upload.js";
import { maxImageDimension } from "../../support/image-constraints.js";
import { probeImage } from "../../support/image-probe.js";
import { appConfig } from "../../util/app-config.js";
import { logger } from "../../util/logger.js";
import { em } from "../../util/mikro-orm.js";
import { s3Client } from "../../util/s3.js";
import { UnrecoverableJobError } from "../processor.js";

const FULL_SIZE_QUALITY = 95;
const THUMBNAIL_QUALITY = 80;

type ImageOwner = {
    id: string;
};

type ResizeBox = {
    width: number;
    height: number;
};

type DerivativeBoxes = {
    fullSize: ResizeBox;
    thumbnail: ResizeBox;
};

/**
 * Where a processed image lives and what decides its size.
 *
 * That is all that differs between one kind of image and the next.
 */
type ImageTarget<TEntity extends ImageOwner> = {
    entity: EntityName<TEntity>;
    id: string;
    /** The key the job was enqueued for, which is how a stale one is spotted. */
    key: string;
    read: (entity: TEntity) => ImageFileDescriptor | null;
    write: (entity: TEntity, descriptor: ImageFileDescriptor | null) => void;
    editionOf: (entity: TEntity) => Ref<Edition>;
    boxes: (edition: Edition) => DerivativeBoxes;
    /** Whether the edition serves this image at all in its current state. */
    bumps: (entity: TEntity) => boolean;
    label: string;
};

const encodeWebp = async (bytes: Uint8Array, box: ResizeBox, quality: number): Promise<Buffer> => {
    // Not the organizer's maximum: that is a downscale target, and attach
    // deliberately accepts anything up to maxImageDimension per axis, so
    // binding the decoder to it would reject every oversized upload this
    // exists to shrink. sharp's default already equals this square; stating it
    // keeps the two in step if the axis cap ever moves.
    const image = sharp(bytes, { limitInputPixels: maxImageDimension * maxImageDimension });
    const { width, height, orientation } = await image.metadata();
    const turnsSideways = orientation !== undefined && orientation >= 5 && orientation <= 8;
    const probed = probeImage(bytes);
    // Turned sideways only where attach saw it turned too, or where turning
    // keeps the shape. The attach probe reads fewer orientations than sharp
    // does, and turning one it missed would store a shape the ratio and
    // minimum were never checked against.
    const sawTurned =
        probed !== null && probed.width === height && probed.height === width && width !== height;
    const oriented = !turnsSideways || width === height || sawTurned ? image.rotate() : image;

    return oriented
        .resize({ ...box, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
};

const putProcessedObject = async (key: string, body: Buffer): Promise<void> => {
    await s3Client.putObject({
        Bucket: appConfig.s3.bucketName,
        Key: key,
        Body: body,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
    });
};

const fetchBytes = async (key: string): Promise<Uint8Array> => {
    try {
        const result = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: key,
        });
        const body = await result.Body?.transformToByteArray();

        if (!body) {
            throw new UnrecoverableJobError("Stored object has no body");
        }

        return body;
    } catch (error) {
        if (error instanceof NoSuchKey) {
            throw new UnrecoverableJobError("Stored object is gone", { cause: error });
        }

        throw error;
    }
};

const processImage = async (
    key: string,
    filename: string,
    boxes: DerivativeBoxes,
): Promise<ImageFileDescriptor> => {
    const bytes = await fetchBytes(key);
    let fullSize: Buffer;

    try {
        fullSize = await encodeWebp(bytes, boxes.fullSize, FULL_SIZE_QUALITY);
    } catch (error) {
        throw new UnrecoverableJobError("Image failed to decode", { cause: error });
    }

    // Deliberately outside the verdict above: these are the bytes that just
    // decoded, so a failure here is the encoder or the machine giving out,
    // and taking the retry path keeps it from discarding a sound image.
    const thumbnail = await encodeWebp(bytes, boxes.thumbnail, THUMBNAIL_QUALITY);

    const prefix = path.dirname(key);
    const fullSizeKey = `${prefix}/${randomUUID()}.webp`;
    const thumbnailKey = `${prefix}/${randomUUID()}.webp`;
    await putProcessedObject(fullSizeKey, fullSize);
    await putProcessedObject(thumbnailKey, thumbnail);

    return { key: fullSizeKey, filename, thumbnailKey };
};

const applyDescriptor = async <TEntity extends ImageOwner>(
    target: ImageTarget<TEntity>,
    edition: Edition,
    descriptor: ImageFileDescriptor | null,
): Promise<void> => {
    await em.fork().transactional(async (em) => {
        // No edition populate here: a locking populate joins the edition into
        // the FOR UPDATE after the owning row, locking backward against the
        // order in support/locking.ts. The bump only needs the id.
        const locked = await em.findOne(target.entity, { id: target.id } as FilterQuery<TEntity>, {
            lockMode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
        });

        if (!locked || target.read(locked)?.key !== target.key) {
            return;
        }

        target.write(locked, descriptor);

        if (target.bumps(locked)) {
            await bumpEditionRevision(em, edition);
        }
    });
};

/**
 * Refuses work whose key no longer matches the stored descriptor.
 *
 * The stale checks compare against the key the job carries rather than a
 * processed flag: every upload enqueues its own job naming the key it stored,
 * so a mismatch means a later upload won the slot and this job's work belongs
 * to a descriptor that no longer exists. The unreferenced objects are the
 * pruner's to collect.
 */
export const deriveStoredImage = async <TEntity extends ImageOwner>(
    target: ImageTarget<TEntity>,
): Promise<void> => {
    const owner = await em
        .fork()
        .findOne(target.entity, { id: target.id } as FilterQuery<TEntity>, {
            populate: ["edition"] as never,
        });
    const current = owner && target.read(owner);

    if (!owner || current?.key !== target.key) {
        return;
    }

    const edition = await target.editionOf(owner).loadOrFail();
    let processed: ImageFileDescriptor;

    try {
        processed = await processImage(target.key, current.filename, target.boxes(edition));
    } catch (error) {
        // Content-MD5 is pinned on the presigned upload, so bytes that cannot
        // be decoded were crafted rather than corrupted in transit. Dropping
        // the descriptor clears the pending marker and leaves the object
        // unreferenced, which is what the pruner collects. A merely exhausted
        // retry never lands here: those keep the image, since the file is fine
        // and the infrastructure is not.
        if (error instanceof UnrecoverableJobError) {
            logger.warn(`Discarding an unprocessable ${target.label}`, {
                id: target.id,
                key: target.key,
                error,
            });
            await applyDescriptor(target, edition, null);
        }

        throw error;
    }

    await applyDescriptor(target, edition, processed);
};
