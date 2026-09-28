import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { Host } from "../../../src/entity/Host.js";
import { Job } from "../../../src/entity/Job.js";
import { PendingUpload } from "../../../src/entity/PendingUpload.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import { buildEdition } from "../../setup/fixtures.js";
import { jsonApi } from "../../setup/json-api.js";
import { createPng } from "../../setup/png.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("me host avatar", () => {
    let token: string;
    let editionId: string;
    const createdKeys: string[] = [];

    before(async () => {
        token = await fetchAccessToken("testuser");

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
        const user = new User({
            externalId: "testuser",
            displayName: "Test User",
            emailAddress: "testuser@example.test",
        });
        const edition = buildEdition({
            name: "Avatar Edition",
            profileFieldOptions: {
                displayName: {},
                emailAddress: {},
                avatar: { requirement: "optional" },
            },
        });
        await fork.persist([user, edition]).flush();

        editionId = edition.id;
    });

    const uploadAvatar = async (): Promise<string> => {
        const key = `temp/${randomUUID()}.png`;
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: key,
            Body: createPng(256, 256),
            ContentType: "image/png",
        });
        createdKeys.push(key);

        const fork = em.fork();
        await fork
            .persist(
                new PendingUpload({
                    key,
                    user: ref(await fork.findOneOrFail(User, { externalId: "testuser" })),
                }),
            )
            .flush();

        return key;
    };

    const patchAvatar = (avatar: Record<string, string> | null) =>
        jsonApi.patch(`/editions/${editionId}/me/host`, token, {
            data: { type: "host", attributes: { avatar } },
        });

    const avatarJobs = async (): Promise<number> =>
        (await em.fork().find(Job, {})).filter((job) => job.payload.type === "process_avatar")
            .length;

    it("queues processing for an uploaded avatar, and nothing when it is cleared", async () => {
        const key = await uploadAvatar();

        const uploaded = await patchAvatar({ key, filename: "me.png" });

        assert.equal(uploaded.status, 200);
        const host = await em.fork().findOneOrFail(Host, { edition: editionId });
        const storedKey = `${editionId}/hosts/${host.id}/avatar/${path.basename(key)}`;
        createdKeys.push(storedKey);
        assert.equal(host.avatar?.key, storedKey);
        assert.equal(await avatarJobs(), 1);

        const cleared = await patchAvatar(null);

        assert.equal(cleared.status, 200);
        assert.equal((await em.fork().findOneOrFail(Host, host.id)).avatar, null);
        assert.equal(await avatarJobs(), 1);
    });
});
