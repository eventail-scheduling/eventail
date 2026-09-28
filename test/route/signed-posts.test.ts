import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { PendingUpload } from "../../src/entity/PendingUpload.js";
import { User } from "../../src/entity/User.js";
import { em } from "../../src/util/mikro-orm.js";
import { jsonApi } from "../setup/json-api.js";
import { fetchAccessToken } from "../setup/token.js";

type SignedPostDocument = {
    data: {
        id: string;
        type: string;
        attributes: {
            key: string;
            url: string;
            fields: Record<string, string>;
            expiresIn: number;
        };
    };
};

describe("signed-posts", () => {
    let userToken: string;

    before(async () => {
        userToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        await fork
            .persist(
                new User({
                    externalId: "testuser",
                    displayName: "Test User",
                    emailAddress: "user@example.test",
                }),
            )
            .flush();
    });

    const md5Hash = "9e107d9d372bb6826bd81d3542a419d6";

    const createSignedPost = (contentType: string) =>
        jsonApi.post("/signed-posts", userToken, {
            data: {
                type: "signed_post",
                attributes: { contentType, md5Hash },
            },
        });

    it("returns a presigned post for an allowed content type", async () => {
        const response = await createSignedPost("image/png");

        assert.equal(response.status, 200);
        const document = (await response.json()) as SignedPostDocument;
        assert.equal(document.data.type, "signed_post");

        const attributes = document.data.attributes;
        assert.equal(attributes.key, `temp/${document.data.id}.png`);
        assert.ok(attributes.url.startsWith("http"));
        assert.equal(attributes.expiresIn, 300);

        assert.equal(attributes.fields.key, attributes.key);
        assert.equal(attributes.fields["Content-Type"], "image/png");
        assert.equal(
            attributes.fields["Content-MD5"],
            Buffer.from(md5Hash, "hex").toString("base64"),
        );
        assert.ok(attributes.fields.Policy);
        assert.ok(attributes.fields["X-Amz-Signature"]);
    });

    // The cap counts rows rather than requests, so filling the table stands in
    // for the loop it exists to stop. One slot short of it, rather than well
    // under, so the refusal is pinned where it begins.
    it("refuses a signature once too many uploads are waiting to be attached", async () => {
        const fork = em.fork();
        const user = await fork.findOneOrFail(User, { externalId: "testuser" });

        for (let index = 0; index < 49; index += 1) {
            fork.persist(new PendingUpload({ key: `temp/waiting-${index}.png`, user: ref(user) }));
        }

        await fork.flush();

        const lastAllowed = await createSignedPost("image/png");
        assert.equal(lastAllowed.status, 200);

        const refused = await createSignedPost("image/png");
        assert.equal(refused.status, 429);
        const document = (await refused.json()) as { errors: { code: string }[] };
        assert.equal(document.errors[0]?.code, "pending_upload_quota_reached");
    });

    // Attaching an upload removes its row, which is what makes the cap a cap on
    // what is outstanding rather than on what a person may ever upload.
    it("gives the slot back when a waiting upload is consumed", async () => {
        const fork = em.fork();
        const user = await fork.findOneOrFail(User, { externalId: "testuser" });

        for (let index = 0; index < 50; index += 1) {
            fork.persist(new PendingUpload({ key: `temp/waiting-${index}.png`, user: ref(user) }));
        }

        await fork.flush();
        assert.equal((await createSignedPost("image/png")).status, 429);

        fork.remove(await fork.findOneOrFail(PendingUpload, { key: "temp/waiting-0.png" }));
        await fork.flush();

        assert.equal((await createSignedPost("image/png")).status, 200);
    });

    it("rejects a content type outside the upload allow list", async () => {
        const response = await createSignedPost("application/x-msdownload");

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { code: string; source: { pointer: string } }[];
        };
        assert.equal(document.errors[0]?.code, "invalid_value");
        assert.equal(document.errors[0]?.source.pointer, "/data/attributes/contentType");
    });
});
