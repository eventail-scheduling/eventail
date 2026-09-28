import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { Job } from "../../../src/entity/Job.js";
import { PendingUpload } from "../../../src/entity/PendingUpload.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import { s3Client } from "../../../src/util/s3.js";
import { buildEdition } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { createPng } from "../../setup/png.js";
import { fetchAccessToken } from "../../setup/token.js";

type SessionDocument = {
    data: {
        id: string;
        attributes: { teaserImage: unknown };
    };
};

type UploadedKey = {
    key: string;
};

describe("session teaser image", () => {
    let hostToken: string;
    let editionId: string;
    let sessionTypeId: string;
    const createdKeys: string[] = [];

    before(async () => {
        hostToken = await fetchAccessToken("testhost");

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
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });
        const edition = buildEdition({
            name: "Teaser Edition",
            sessionFieldOptions: {
                abstract: { requirement: "optional" },
                teaserImage: { requirement: "optional" },
            },
        });
        const sessionType = SessionType.default(ref(edition));

        await fork.persist([host, stranger, edition, sessionType]).flush();

        editionId = edition.id;
        sessionTypeId = sessionType.id;
    });

    const uploadTempObject = async (
        body: Buffer = createPng(800, 450),
        contentType = "image/png",
        extension = "png",
        owner = "testhost",
    ): Promise<UploadedKey> => {
        const key = `temp/${randomUUID()}.${extension}`;
        await s3Client.putObject({
            Bucket: appConfig.s3.bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
        });

        createdKeys.push(key);
        const fork = em.fork();
        await fork
            .persist(
                new PendingUpload({
                    key,
                    user: ref(await fork.findOneOrFail(User, { externalId: owner })),
                }),
            )
            .flush();

        return { key };
    };

    const createSession = (teaserImage: Record<string, string>) =>
        jsonApi.post(`/editions/${editionId}/sessions`, hostToken, {
            data: {
                type: "session",
                attributes: { title: "Teasered", abstract: "", teaserImage },
                relationships: {
                    sessionType: { data: { type: "session_type", id: sessionTypeId } },
                    responses: { data: [] },
                },
                meta: { selfService: true },
            },
        });

    const patchSession = (sessionId: string, teaserImage?: Record<string, string> | null) =>
        jsonApi.patch(`/editions/${editionId}/sessions/${sessionId}`, hostToken, {
            data: {
                type: "session",
                id: sessionId,
                attributes: {
                    title: "Teasered",
                    abstract: "",
                    ...(teaserImage !== undefined && { teaserImage }),
                },
                relationships: {
                    sessionType: { data: { type: "session_type", id: sessionTypeId } },
                    responses: { data: [] },
                },
                meta: { selfService: true },
            },
        });

    it("copies a temp upload and stores the descriptor", async () => {
        const { key: tempKey } = await uploadTempObject();

        const response = await createSession({ key: tempKey, filename: "teaser.png" });

        assert.equal(response.status, 201);
        const document = (await response.json()) as SessionDocument;
        const sessionId = document.data.id;
        const storedKey = `${editionId}/sessions/${sessionId}/teaser-image/${path.basename(tempKey)}`;
        createdKeys.push(storedKey);

        assert.deepEqual(document.data.attributes.teaserImage, {
            key: storedKey,
            filename: "teaser.png",
            url: `${appConfig.s3.publicBaseUrl}/${storedKey}`,
            thumbnailUrl: `${appConfig.s3.publicBaseUrl}/${storedKey}`,
            processing: true,
        });

        const session = await em.fork().findOneOrFail(Session, sessionId);
        assert.deepEqual(session.teaserImage, {
            key: storedKey,
            filename: "teaser.png",
            thumbnailKey: storedKey,
        });

        await s3Client.headObject({ Bucket: appConfig.s3.bucketName, Key: storedKey });
    });

    it("refuses an upload someone else was granted", async () => {
        const { key } = await uploadTempObject(undefined, undefined, undefined, "stranger");

        const response = await createSession({ key, filename: "teaser.png" });
        assert.equal(response.status, 404);
        const document = (await response.json()) as {
            errors: { code: string; meta: unknown }[];
        };
        assert.deepEqual(
            document.errors.map(({ code, meta }) => ({ code, meta })),
            [{ code: "missing_file", meta: { attribute: "teaserImage", key } }],
        );
    });

    it("refuses to attach the same upload twice", async () => {
        const { key: tempKey } = await uploadTempObject();
        const created = await createSession({ key: tempKey, filename: "teaser.png" });
        assert.equal(created.status, 201);
        const sessionId = ((await created.json()) as SessionDocument).data.id;
        createdKeys.push(
            `${editionId}/sessions/${sessionId}/teaser-image/${path.basename(tempKey)}`,
        );

        await expectJsonApiError(
            await createSession({ key: tempKey, filename: "teaser.png" }),
            404,
            "missing_file",
        );
    });

    it("keeps the stored file when the attribute is left out", async () => {
        const { key: tempKey } = await uploadTempObject();
        const created = await createSession({ key: tempKey, filename: "teaser.png" });
        assert.equal(created.status, 201);
        const sessionId = ((await created.json()) as SessionDocument).data.id;
        const storedKey = `${editionId}/sessions/${sessionId}/teaser-image/${path.basename(tempKey)}`;
        createdKeys.push(storedKey);

        const response = await patchSession(sessionId);

        assert.equal(response.status, 200);
        const document = (await response.json()) as SessionDocument;
        assert.deepEqual(document.data.attributes.teaserImage, {
            key: storedKey,
            filename: "teaser.png",
            url: `${appConfig.s3.publicBaseUrl}/${storedKey}`,
            thumbnailUrl: `${appConfig.s3.publicBaseUrl}/${storedKey}`,
            processing: true,
        });

        await s3Client.headObject({ Bucket: appConfig.s3.bucketName, Key: storedKey });
    });

    it("enqueues a processing job for an upload, but not for a save that leaves it out", async () => {
        const { key: tempKey } = await uploadTempObject();
        const created = await createSession({ key: tempKey, filename: "teaser.png" });
        assert.equal(created.status, 201);
        const sessionId = ((await created.json()) as SessionDocument).data.id;
        const storedKey = `${editionId}/sessions/${sessionId}/teaser-image/${path.basename(tempKey)}`;
        createdKeys.push(storedKey);

        const countJobs = async () =>
            (await em.fork().find(Job, {})).filter(
                (job) =>
                    job.payload.type === "process_teaser_image" && job.payload.key === storedKey,
            ).length;

        assert.equal(await countJobs(), 1);

        const kept = await patchSession(sessionId);
        assert.equal(kept.status, 200);
        assert.equal(await countJobs(), 1);
    });

    it("clears the image when sent null, and queues nothing for it", async () => {
        const { key: tempKey } = await uploadTempObject();
        const created = await createSession({ key: tempKey, filename: "teaser.png" });
        assert.equal(created.status, 201);
        const sessionId = ((await created.json()) as SessionDocument).data.id;
        createdKeys.push(
            `${editionId}/sessions/${sessionId}/teaser-image/${path.basename(tempKey)}`,
        );

        const cleared = await patchSession(sessionId, null);

        assert.equal(cleared.status, 200);
        assert.equal(((await cleared.json()) as SessionDocument).data.attributes.teaserImage, null);
        const jobs = (await em.fork().find(Job, {})).filter(
            (job) => job.payload.type === "process_teaser_image",
        );
        assert.equal(jobs.length, 1);
    });

    it("rejects an image below the minimum dimensions", async () => {
        const { key } = await uploadTempObject(createPng(100, 100));

        const response = await createSession({ key, filename: "small.png" });

        await expectJsonApiError(response, 422, "image_too_small");
    });

    it("rejects bytes that are not the declared image type", async () => {
        const { key } = await uploadTempObject(Buffer.from("just text"));

        const response = await createSession({ key, filename: "fake.png" });

        await expectJsonApiError(response, 422, "image_type_mismatch");
    });

    it("rejects a content type outside the image slot set", async () => {
        const { key } = await uploadTempObject(Buffer.from("%PDF-1.4"), "application/pdf", "pdf");

        const response = await createSession({ key, filename: "teaser.pdf" });

        await expectJsonApiError(response, 422, "unsupported_image_type");
    });

    it("rejects a file above the global size cap", async () => {
        const { key } = await uploadTempObject(Buffer.alloc(appConfig.s3.maxFileSize + 1));

        const response = await createSession({ key, filename: "huge.png" });

        await expectJsonApiError(response, 422, "image_file_too_large");
    });
});
