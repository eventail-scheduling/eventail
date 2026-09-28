import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import { inspect } from "node:util";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { ref } from "@mikro-orm/core";
import { PendingUpload } from "../../src/entity/PendingUpload.js";
import { User } from "../../src/entity/User.js";
import { FileUploadHandler } from "../../src/support/file-upload.js";
import { appConfig } from "../../src/util/app-config.js";
import { em } from "../../src/util/mikro-orm.js";
import { s3Client } from "../../src/util/s3.js";
import { releaseAfterLockWait } from "../setup/locks.js";

describe("pending upload claiming", () => {
    before(async () => {
        try {
            await s3Client.createBucket({ Bucket: appConfig.s3.bucketName });
        } catch (error) {
            if (!(error instanceof Error && error.name === "BucketAlreadyOwnedByYou")) {
                throw error;
            }
        }
    });

    // Two transactions reaching the claim at once, held apart by a real lock
    // wait rather than by hoping the requests interleave: an unlocked read
    // lets both find the row, and the loser's delete then matches nothing.
    it("lets only one of two concurrent claims through", async () => {
        const key = `temp/${randomUUID()}.pdf`;
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: key,
            Body: "claim fixture",
            ContentType: "application/pdf",
        });

        const setupFork = em.fork();
        const user = new User({
            externalId: "claim-user",
            displayName: "Claim User",
            emailAddress: "claim@example.test",
        });
        await setupFork.persist([user, new PendingUpload({ key, user: ref(user) })]).flush();

        const claimed = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const createdKeys: string[] = [key];

        const runClaim = async (prefix: string, hold: boolean): Promise<void> => {
            const fork = em.fork();
            const claimant = await fork.findOneOrFail(User, { externalId: "claim-user" });

            await fork.transactional(async (em) => {
                const handler = new FileUploadHandler(claimant);
                handler.add({ attribute: "slides" }, prefix, { key, filename: "slides.pdf" });
                await handler.runCopyOps(em);
                createdKeys.push(`${prefix}/${key.split("/")[1] ?? ""}`);

                if (hold) {
                    claimed.resolve();
                    await release.promise;
                }
            });
        };

        const winner = runClaim("claim-test-first", true);
        await claimed.promise;

        const loser = runClaim("claim-test-second", false);
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            release.resolve();
        });

        await winner;

        if (waitError !== null) {
            throw waitError;
        }

        await assert.rejects(loser, (error: unknown) => {
            assert.ok(error instanceof JsonApiError, `loser threw ${inspect(error)}`);
            assert.equal(error.errors[0]?.status, "404");
            return true;
        });

        assert.equal(await em.fork().count(PendingUpload, { key }), 0);

        for (const created of createdKeys) {
            await s3Client
                .deleteObject({ Bucket: appConfig.s3.bucketName, Key: created })
                .catch(() => undefined);
        }
    });

    it("names the question a swept upload was sent for", async () => {
        const fork = em.fork();
        const user = new User({
            externalId: "swept-user",
            displayName: "Swept User",
            emailAddress: "swept@example.test",
        });
        await fork.persist(user).flush();

        const handler = new FileUploadHandler(user);
        const key = `temp/${randomUUID()}.pdf`;
        handler.add({ customFieldId: "field-slides" }, "swept-test", {
            key,
            filename: "slides.pdf",
        });

        await assert.rejects(
            fork.transactional((em) => handler.runCopyOps(em)),
            (error: unknown) => {
                assert.ok(error instanceof JsonApiError, `threw ${inspect(error)}`);
                assert.equal(error.errors[0]?.code, "missing_file");
                assert.deepEqual(error.errors[0]?.meta, { customFieldId: "field-slides", key });
                return true;
            },
        );
    });
});
