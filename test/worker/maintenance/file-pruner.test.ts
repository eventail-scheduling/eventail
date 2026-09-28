import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { NoSuchKey, NotFound } from "@aws-sdk/client-s3";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { FileDeletionCandidate } from "../../../src/entity/FileDeletionCandidate.js";
import { PendingUpload } from "../../../src/entity/PendingUpload.js";
import { Response } from "../../../src/entity/Response.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import { FilePruner } from "../../../src/worker/maintenance/file-pruner.js";
import { buildEdition, buildHost, buildSession } from "../../setup/fixtures.js";

const putObject = (key: string): Promise<unknown> =>
    s3Client.putObject({
        Bucket: appConfig.s3.bucketName,
        Key: key,
        Body: "prune fixture",
    });

const objectExists = async (key: string): Promise<boolean> => {
    try {
        await s3Client.headObject({ Bucket: appConfig.s3.bucketName, Key: key });
        return true;
    } catch (error) {
        if (error instanceof NoSuchKey || error instanceof NotFound) {
            return false;
        }

        throw error;
    }
};

describe("file pruner", () => {
    // The bucket is shared across test workers while the databases are not,
    // and the zero-age prunes below delete every object the local database
    // does not reference, so this suite runs against a bucket of its own.
    const sharedBucket = appConfig.s3.bucketName;
    const workerBucket = `${sharedBucket}-prune-${process.pid.toString()}`;

    before(async () => {
        try {
            await s3Client.createBucket({ Bucket: workerBucket });
        } catch (error) {
            // A recycled pid can find its bucket still there; the after hook
            // empties it either way.
            if (!(error instanceof Error && error.name === "BucketAlreadyOwnedByYou")) {
                throw error;
            }
        }

        appConfig.s3.bucketName = workerBucket;
    });

    after(async () => {
        appConfig.s3.bucketName = sharedBucket;

        try {
            const listing = await s3Client.listObjectsV2({ Bucket: workerBucket });
            const keys = (listing.Contents ?? []).flatMap((object) =>
                object.Key === undefined ? [] : [{ Key: object.Key }],
            );

            if (keys.length > 0) {
                await s3Client.deleteObjects({ Bucket: workerBucket, Delete: { Objects: keys } });
            }

            await s3Client.deleteBucket({ Bucket: workerBucket });
        } catch (error) {
            // The before hook failing ahead of the bucket's creation already
            // reports its own error; a second one here only muddies it.
            if (!(error instanceof Error && error.name === "NoSuchBucket")) {
                throw error;
            }
        }
    });

    const orphanKey = "prune-test/orphan.png";
    const tempKey = "temp/prune-test-abandoned.png";
    const teaserKey = "prune-test/teaser.png";
    const responseKey = "prune-test/response.pdf";
    const avatarKey = "prune-test/avatar.webp";
    const avatarThumbnailKey = "prune-test/avatar-thumb.webp";

    beforeEach(async () => {
        await Promise.all(
            [orphanKey, tempKey, teaserKey, responseKey, avatarKey, avatarThumbnailKey].map(
                putObject,
            ),
        );

        const fork = em.fork();
        const edition = buildEdition({ name: "Prune Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, {
            title: "Teasered Session",
            teaserImage: { key: teaserKey, filename: "teaser.png", thumbnailKey: teaserKey },
        });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "file" },
            title: "Upload your slides",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const response = Response.sessionResponse(ref(customField), ref(session), {
            key: responseKey,
            filename: "response.pdf",
        });
        const user = new User({
            externalId: "prune-host",
            displayName: "Prune Host",
            emailAddress: "prune-host@example.test",
        });
        const host = buildHost(edition, user);
        host.avatar = {
            key: avatarKey,
            filename: "avatar.png",
            thumbnailKey: avatarThumbnailKey,
        };

        await fork
            .persist([edition, sessionType, session, customField, response, user, host])
            .flush();
    });

    const countCandidates = (key: string) => em.fork().count(FileDeletionCandidate, { key });

    it("marks an orphan first and deletes it one run later", async () => {
        // Zero minimum age so a mark from the previous run is already due.
        const pruner = new FilePruner({ minimumAge: Temporal.Duration.from({ seconds: 0 }) });

        await pruner.runOnce();

        assert.equal(await objectExists(orphanKey), true);
        assert.equal(await objectExists(tempKey), false);
        assert.equal(await countCandidates(orphanKey), 1);

        await pruner.runOnce();

        assert.equal(await objectExists(orphanKey), false);
        assert.equal(await objectExists(teaserKey), true);
        assert.equal(await objectExists(responseKey), true);
        assert.equal(await objectExists(avatarKey), true);
        assert.equal(await objectExists(avatarThumbnailKey), true);
        assert.equal(await countCandidates(orphanKey), 0);
    });

    it("spares a marked orphan until the grace period has passed", async () => {
        const pruner = new FilePruner({ minimumAge: Temporal.Duration.from({ hours: 1 }) });

        await pruner.runOnce();
        await pruner.runOnce();

        assert.equal(await objectExists(orphanKey), true);
        assert.equal(await countCandidates(orphanKey), 1);
    });

    it("clears the mark when the key gains a reference", async () => {
        const pruner = new FilePruner({ minimumAge: Temporal.Duration.from({ seconds: 0 }) });

        await pruner.runOnce();
        assert.equal(await countCandidates(orphanKey), 1);

        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, { title: "Teasered Session" });
        session.teaserImage = { key: orphanKey, filename: "orphan.png", thumbnailKey: orphanKey };
        await fork.flush();

        await pruner.runOnce();

        assert.equal(await objectExists(orphanKey), true);
        assert.equal(await countCandidates(orphanKey), 0);
    });

    it("spares temp uploads younger than the minimum age", async () => {
        await new FilePruner({ minimumAge: Temporal.Duration.from({ hours: 1 }) }).runOnce();

        assert.equal(await objectExists(tempKey), true);
    });

    it("sweeps pending upload rows once they age out", async () => {
        const fork = em.fork();
        const user = new User({
            externalId: "pruner-user",
            displayName: "Pruner User",
            emailAddress: "pruner@example.test",
        });
        await fork
            .persist([user, new PendingUpload({ key: "temp/pruner-fixture.png", user: ref(user) })])
            .flush();

        await new FilePruner({ minimumAge: Temporal.Duration.from({ hours: 1 }) }).runOnce();
        assert.equal(await em.fork().count(PendingUpload), 1);

        await new FilePruner({ minimumAge: Temporal.Duration.from({ seconds: 0 }) }).runOnce();
        assert.equal(await em.fork().count(PendingUpload), 0);
    });
});
