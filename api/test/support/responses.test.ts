import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { IncludedResourceMap } from "@jsonapi-serde/server/request";
import { LockMode, ref } from "@mikro-orm/core";
import { CustomField } from "../../src/entity/CustomField.js";
import { Edition } from "../../src/entity/Edition.js";
import { EditionRevision } from "../../src/entity/EditionRevision.js";
import { Host } from "../../src/entity/Host.js";
import { User } from "../../src/entity/User.js";
import { bumpEditionRevision } from "../../src/support/edition-revision.js";
import { FileUploadHandler } from "../../src/support/file-upload.js";
import { updateResponses } from "../../src/support/responses.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildEdition, buildHost } from "../setup/fixtures.js";
import { releaseAfterLockWait } from "../setup/locks.js";

describe("response customField locking", () => {
    let editionId: string;
    let customFieldId: string;
    let hostId: string;
    let userId: string;

    beforeEach(async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Response Lock Edition" });
        const user = new User({
            externalId: "response-lock-user",
            displayName: "Response Lock User",
            emailAddress: "response-lock@example.test",
        });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Anything we should know?",
            helperText: "",
            deadline: null,
            freezeAfter: Temporal.Instant.from("2020-01-01T00:00:00Z"),
            confidential: false,
            edition: ref(edition),
        });

        const host = buildHost(edition, user);
        await fork.persist([edition, user, customField, host]).flush();

        editionId = edition.id;
        customFieldId = customField.id;
        hostId = host.id;
        userId = user.id;
    });

    it("blocks a customField edit until an in-flight response commits", async () => {
        const order: string[] = [];
        const editorMayStart = Promise.withResolvers<void>();
        const editorBlocked = Promise.withResolvers<void>();

        const responding = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, editionId);
            const host = await em.findOneOrFail(Host, hostId);
            const uploader = await em.findOneOrFail(User, userId);

            await updateResponses({
                target: { type: "host", host },
                em,
                edition,
                includedResponses: new IncludedResourceMap("response", new Map()),
                responseIdentifiers: [],
                existingResponses: new Map(),
                fileUploadHandler: new FileUploadHandler(uploader),
            });

            editorMayStart.resolve();
            await editorBlocked.promise;
            order.push("responding committed");
        });

        await editorMayStart.promise;

        const editing = em.fork().transactional(async (em) => {
            const customField = await em.findOneOrFail(CustomField, customFieldId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            order.push("editor acquired the customField");

            // The real confidential flip, bump included: with the order
            // pinned above, its bump can only commit after the response
            // writer, so a consumer acting on it always refetches a document
            // that already carries the writer's answer.
            customField.confidential = true;
            em.persist(customField);
            await bumpEditionRevision(em, await em.findOneOrFail(Edition, editionId));
        });

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            editorBlocked.resolve();
        });

        await Promise.all([responding, editing]);

        if (waitError !== null) {
            throw waitError;
        }

        assert.deepEqual(order, ["responding committed", "editor acquired the customField"]);

        const readFork = em.fork();
        assert.equal((await readFork.findOneOrFail(CustomField, customFieldId)).confidential, true);
        assert.equal((await readFork.findOneOrFail(EditionRevision, { editionId })).revision, 1);
    });
});
