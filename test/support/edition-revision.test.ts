import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { Edition } from "../../src/entity/Edition.js";
import { EditionRevision } from "../../src/entity/EditionRevision.js";
import { bumpEditionRevision } from "../../src/support/edition-revision.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildEdition } from "../setup/fixtures.js";
import { waitForLockWaiters } from "../setup/locks.js";

describe("bumpEditionRevision", () => {
    let editionId: string;

    beforeEach(async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Counter Edition" });
        await fork.persist(edition).flush();
        editionId = edition.id;
    });

    const readRevision = async (): Promise<number | null> => {
        const row = await em.fork().findOne(EditionRevision, { editionId });
        return row ? row.revision : null;
    };

    it("creates the counter row at 1 on the first bump", async () => {
        await em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, editionId);
            await bumpEditionRevision(em, edition);
        });

        assert.equal(await readRevision(), 1);
    });

    it("keeps both increments of two concurrent bumps", async () => {
        const secondBlocked = Promise.withResolvers<void>();

        // The first bump holds its transaction open until the second is
        // provably blocked on the counter row, so the interleaving a
        // read-modify-write implementation loses is the one under test rather
        // than an accidental serialization.
        const first = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, editionId);
            await bumpEditionRevision(em, edition);
            await secondBlocked.promise;
        });

        const second = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, editionId);
            await bumpEditionRevision(em, edition);
        });

        await waitForLockWaiters(em.fork());
        secondBlocked.resolve();
        await Promise.all([first, second]);

        assert.equal(await readRevision(), 2);
    });
});
