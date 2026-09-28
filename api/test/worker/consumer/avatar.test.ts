import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Host } from "../../../src/entity/Host.js";
import { User } from "../../../src/entity/User.js";
import { probeImage } from "../../../src/support/image-probe.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import { processAvatarJobConsumer } from "../../../src/worker/consumer/avatar.js";
import { buildEdition } from "../../setup/fixtures.js";
import { createPng } from "../../setup/png.js";

// Only what this consumer decides. Fetching, decoding, the stale-key checks
// and what happens to undecodable input belong to the shared pipeline and are
// measured through the teaser image, which reaches the same code.
describe("avatar processing", () => {
    let editionId: string;
    let hostId: string;
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
        const edition = buildEdition({ name: "Avatar Edition" });
        const user = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "testhost@example.test",
        });
        const host = new Host({
            displayName: "Test Host",
            emailAddress: "testhost@example.test",
            biography: "",
            edition: ref(edition),
            user: ref(user),
        });

        ingestKey = `${edition.id}/hosts/${host.id}/avatar/${randomUUID()}.png`;
        createdKeys.push(ingestKey);
        host.avatar = { key: ingestKey, filename: "face.png", thumbnailKey: ingestKey };

        await fork.persist([edition, user, host]).flush();

        editionId = edition.id;
        hostId = host.id;
    });

    const process = () =>
        processAvatarJobConsumer({ type: "process_avatar", hostId, key: ingestKey });

    const loadAvatar = async () => {
        const host = await em.fork().findOneOrFail(Host, hostId);
        assert.ok(host.avatar);

        return host.avatar;
    };

    const measure = async (key: string) => {
        const object = await s3Client.getObject({ Bucket: appConfig.s3.bucketName, Key: key });
        const probed = probeImage((await object.Body?.transformToByteArray()) ?? new Uint8Array());

        return { width: probed?.width, height: probed?.height, contentType: object.ContentType };
    };

    it("squares an oversized upload down to the size an avatar may be", async () => {
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: createPng(1024, 1024),
            ContentType: "image/png",
        });

        await process();

        const avatar = await loadAvatar();
        createdKeys.push(avatar.key, avatar.thumbnailKey);

        assert.deepEqual(await measure(avatar.key), {
            width: 512,
            height: 512,
            contentType: "image/webp",
        });
    });

    it("keeps a thumbnail larger than the smallest an avatar may be", async () => {
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: createPng(1024, 1024),
            ContentType: "image/png",
        });

        await process();

        const avatar = await loadAvatar();
        createdKeys.push(avatar.key, avatar.thumbnailKey);

        assert.notEqual(avatar.thumbnailKey, avatar.key);
        assert.deepEqual(await measure(avatar.thumbnailKey), {
            width: 128,
            height: 128,
            contentType: "image/webp",
        });
    });

    it("leaves an avatar smaller than the ceiling at the size it came in", async () => {
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: createPng(200, 200),
            ContentType: "image/png",
        });

        await process();

        const avatar = await loadAvatar();
        createdKeys.push(avatar.key, avatar.thumbnailKey);

        assert.deepEqual(await measure(avatar.key), {
            width: 200,
            height: 200,
            contentType: "image/webp",
        });
    });

    it("turns a square by its EXIF orientation", async () => {
        const sharp = (await import("sharp")).default;
        const red = { r: 255, g: 0, b: 0 };
        const blue = { r: 0, g: 0, b: 255 };
        const leftRed = await sharp({
            create: { width: 100, height: 200, channels: 3, background: red },
        })
            .png()
            .toBuffer();
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: await sharp({
                create: { width: 200, height: 200, channels: 3, background: blue },
            })
                .composite([{ input: leftRed, left: 0, top: 0 }])
                .jpeg()
                .withMetadata({ orientation: 6 })
                .toBuffer(),
            ContentType: "image/jpeg",
        });

        await process();

        const avatar = await loadAvatar();
        createdKeys.push(avatar.key, avatar.thumbnailKey);

        const stored = await s3Client.getObject({
            Bucket: appConfig.s3.bucketName,
            Key: avatar.key,
        });
        const { data, info } = await sharp(
            (await stored.Body?.transformToByteArray()) ?? new Uint8Array(),
        )
            .raw()
            .toBuffer({ resolveWithObject: true });
        const topRight = (10 * info.width + (info.width - 10)) * info.channels;
        const [redChannel, , blueChannel] = data.subarray(topRight, topRight + 3);

        // Orientation 6 turns the stored left edge to the top, so the red half
        // lands on top and the top right corner is red only once turned.
        assert.ok(redChannel > blueChannel);
    });

    // A host carries no state saying whether anything serves them, so there is
    // nothing to wait for before saying the program moved.
    it("moves the revision whatever the host is doing this edition", async () => {
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: ingestKey,
            Body: createPng(200, 200),
            ContentType: "image/png",
        });

        await process();

        const avatar = await loadAvatar();
        createdKeys.push(avatar.key, avatar.thumbnailKey);

        const revision = await em.fork().findOneOrFail(EditionRevision, { editionId });
        assert.equal(revision.revision, 1);
    });
});
