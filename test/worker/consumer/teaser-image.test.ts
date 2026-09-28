import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { probeImage } from "../../../src/support/image-probe.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import { processTeaserImageJobConsumer } from "../../../src/worker/consumer/teaser-image.js";
import { UnrecoverableJobError } from "../../../src/worker/processor.js";
import { buildEdition, buildSession } from "../../setup/fixtures.js";
import { waitForLockWaiters } from "../../setup/locks.js";
import { createPng } from "../../setup/png.js";

describe("teaser image processing", () => {
    let editionId: string;
    let sessionId: string;
    let ingestKey: string;
    const createdKeys: string[] = [];

    before(async () => {
        try {
            await s3Client.createBucket({ Bucket: appConfig.s3.bucketName });
        } catch (error) {
            if (!(error instanceof Error && error.name === "BucketAlreadyOwnedByYou")) {
                throw error;
            }
        }
    });

    after(async () => {
        for (const key of createdKeys) {
            await s3Client.deleteObject({ Bucket: appConfig.s3.bucketName, Key: key });
        }
    });

    beforeEach(async () => {
        const fork = em.fork();
        const edition = buildEdition({
            name: "Processing Edition",
            sessionFieldOptions: {
                teaserImage: { requirement: "optional", maxWidth: 800, maxHeight: 450 },
            },
        });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Processed Session" });
        session.state = "confirmed";

        ingestKey = `${edition.id}/sessions/${session.id}/teaser-image/${randomUUID()}.png`;
        createdKeys.push(ingestKey);
        session.teaserImage = {
            key: ingestKey,
            filename: "teaser.png",
            thumbnailKey: ingestKey,
        };

        await fork.persist([edition, sessionType, session]).flush();

        editionId = edition.id;
        sessionId = session.id;
    });

    const putIngestObject = (body: Buffer | string) =>
        s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: body,
            ContentType: "image/png",
        });

    const loadDescriptor = async () => {
        const session = await em.fork().findOneOrFail(Session, sessionId);
        assert.ok(session.teaserImage);

        return session.teaserImage;
    };

    it("re-encodes into the constraint box and swaps the keys", async () => {
        await putIngestObject(createPng(1600, 900));

        await processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: ingestKey,
        });

        const descriptor = await loadDescriptor();
        assert.notEqual(descriptor.key, ingestKey);
        assert.notEqual(descriptor.thumbnailKey, descriptor.key);
        assert.match(descriptor.key, /\.webp$/);
        assert.match(descriptor.thumbnailKey, /\.webp$/);
        assert.equal(descriptor.filename, "teaser.png");
        createdKeys.push(descriptor.key, descriptor.thumbnailKey);

        const fullSize = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: descriptor.key,
        });
        assert.equal(fullSize.ContentType, "image/webp");
        const fullSizeProbe = probeImage(
            (await fullSize.Body?.transformToByteArray()) ?? new Uint8Array(),
        );
        assert.deepEqual(
            { width: fullSizeProbe?.width, height: fullSizeProbe?.height },
            { width: 800, height: 450 },
        );

        const thumbnail = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: descriptor.thumbnailKey,
        });
        const thumbnailProbe = probeImage(
            (await thumbnail.Body?.transformToByteArray()) ?? new Uint8Array(),
        );
        assert.deepEqual(
            { width: thumbnailProbe?.width, height: thumbnailProbe?.height },
            { width: 640, height: 360 },
        );

        const revision = await em.fork().findOneOrFail(EditionRevision, { editionId });
        assert.equal(revision.revision, 1);
    });

    // Attach checked the ratio and minimum against a PNG's stored shape, since
    // it reads orientation from JPEG alone, so turning it here would store a
    // shape nothing checked.
    it("keeps a PNG in the shape attach checked, whatever its EXIF orientation says", async () => {
        const sharp = (await import("sharp")).default;
        await putIngestObject(
            await sharp(createPng(1600, 900)).png().withMetadata({ orientation: 6 }).toBuffer(),
        );

        await processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: ingestKey,
        });

        const descriptor = await loadDescriptor();
        createdKeys.push(descriptor.key, descriptor.thumbnailKey);
        const fullSize = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: descriptor.key,
        });
        const probe = probeImage((await fullSize.Body?.transformToByteArray()) ?? new Uint8Array());
        assert.deepEqual(
            { width: probe?.width, height: probe?.height },
            { width: 800, height: 450 },
        );
    });

    it("turns a JPEG by its EXIF orientation, as attach measured it", async () => {
        const sharp = (await import("sharp")).default;
        await putIngestObject(
            await sharp(createPng(900, 1600)).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
        );

        await processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: ingestKey,
        });

        const descriptor = await loadDescriptor();
        createdKeys.push(descriptor.key, descriptor.thumbnailKey);
        const fullSize = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: descriptor.key,
        });
        const probe = probeImage((await fullSize.Body?.transformToByteArray()) ?? new Uint8Array());
        assert.deepEqual(
            { width: probe?.width, height: probe?.height },
            { width: 800, height: 450 },
        );
    });

    it("swaps the keys without bumping for an unconfirmed session", async () => {
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, sessionId);
        session.state = "submitted";
        await fork.flush();

        await putIngestObject(createPng(1600, 900));

        await processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: ingestKey,
        });

        const descriptor = await loadDescriptor();
        assert.notEqual(descriptor.key, ingestKey);
        createdKeys.push(descriptor.key, descriptor.thumbnailKey);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 0);
    });

    it("leaves a replaced descriptor alone", async () => {
        await putIngestObject(createPng(1600, 900));

        await processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: `${editionId}/sessions/${sessionId}/teaser-image/${randomUUID()}.png`,
        });

        const descriptor = await loadDescriptor();
        assert.equal(descriptor.key, ingestKey);
        assert.equal(descriptor.thumbnailKey, ingestKey);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 0);
    });

    it("clears the descriptor for undecodable input instead of retrying", async () => {
        await putIngestObject("definitely not a png");

        await assert.rejects(
            processTeaserImageJobConsumer({
                type: "process_teaser_image",
                sessionId,
                key: ingestKey,
            }),
            UnrecoverableJobError,
        );

        const session = await em.fork().findOneOrFail(Session, sessionId);
        assert.equal(session.teaserImage, null);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 1);
    });

    it("leaves a newer descriptor alone when it lands mid-flight", async () => {
        const replacementKey = `${editionId}/sessions/${sessionId}/teaser-image/${randomUUID()}.webp`;
        await putIngestObject("definitely not a png");

        // Replaced after the consumer's unlocked read has already passed the
        // key check, so only the locked re-check can stop the clear.
        const holder = em.fork();
        await holder.begin();
        const held = await holder.findOneOrFail(
            Session,
            { id: sessionId },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        held.teaserImage = {
            key: replacementKey,
            filename: "newer.png",
            thumbnailKey: replacementKey,
        };
        await holder.flush();

        const running = processTeaserImageJobConsumer({
            type: "process_teaser_image",
            sessionId,
            key: ingestKey,
        });

        await waitForLockWaiters(em.fork());
        await holder.commit();

        await assert.rejects(running, UnrecoverableJobError);

        const descriptor = await loadDescriptor();
        assert.equal(descriptor.key, replacementKey);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 0);
    });

    it("clears without bumping for an unconfirmed session", async () => {
        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, sessionId);
        session.state = "submitted";
        await fork.flush();

        await putIngestObject("definitely not a png");

        await assert.rejects(
            processTeaserImageJobConsumer({
                type: "process_teaser_image",
                sessionId,
                key: ingestKey,
            }),
            UnrecoverableJobError,
        );

        const reloaded = await em.fork().findOneOrFail(Session, sessionId);
        assert.equal(reloaded.teaserImage, null);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 0);
    });
});
