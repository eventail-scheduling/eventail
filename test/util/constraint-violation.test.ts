import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type ForeignKeyViolation,
    referenceGone,
    translateForeignKeyViolations,
    translateUniqueViolations,
    type UniqueViolation,
} from "../../src/util/constraint-violation.js";
import { em } from "../../src/util/mikro-orm.js";

const violations: Record<string, UniqueViolation> = {
    translate_immediate_unique: {
        code: "immediate_taken",
        title: "Immediate taken",
        detail: "An immediate constraint rejected this",
        pointer: "/data/attributes/slot",
    },
    translate_deferred_unique: {
        code: "deferred_taken",
        title: "Deferred taken",
        detail: "A deferred constraint rejected this",
        pointer: "/data/attributes/slot",
    },
};

const tables = ["translate_immediate", "translate_deferred", "translate_unmapped"];

const insertColliding = (table: string): Promise<void> =>
    translateUniqueViolations(
        () =>
            em.fork().transactional(async (em) => {
                await em.execute(`insert into ${table} (id, slot) values (1, 1)`);
                await em.execute(`insert into ${table} (id, slot) values (2, 1)`);
            }),
        violations,
    );

const captureFrom = async (run: () => Promise<unknown>): Promise<unknown> => {
    try {
        await run();
    } catch (error) {
        return error;
    }

    assert.fail("expected a rejection");
};

describe("unique violation", () => {
    beforeEach(async () => {
        const fork = em.fork();

        for (const table of tables) {
            await fork.execute(`drop table if exists ${table}`);
        }

        await fork.execute(
            "create table translate_immediate (id int primary key, slot int not null," +
                " constraint translate_immediate_unique unique (slot))",
        );
        await fork.execute(
            "create table translate_deferred (id int primary key, slot int not null," +
                " constraint translate_deferred_unique unique (slot)" +
                " deferrable initially deferred)",
        );
        await fork.execute(
            "create table translate_unmapped (id int primary key, slot int not null," +
                " constraint translate_unmapped_unique unique (slot))",
        );
    });

    after(async () => {
        const fork = em.fork();

        for (const table of tables) {
            await fork.execute(`drop table if exists ${table}`);
        }
    });

    it("translates a constraint that fails on the statement", async () => {
        const captured = await captureFrom(() => insertColliding("translate_immediate"));

        assert.ok(captured instanceof JsonApiError);
        assert.equal(captured.errors[0].code, "immediate_taken");
        assert.equal(captured.errors[0].source?.pointer, "/data/attributes/slot");
    });

    it("translates a constraint that fails on commit", async () => {
        const captured = await captureFrom(() => insertColliding("translate_deferred"));

        assert.ok(captured instanceof JsonApiError);
        assert.equal(captured.errors[0].code, "deferred_taken");
    });

    it("rethrows a unique violation it has no mapping for", async () => {
        const captured = await captureFrom(() => insertColliding("translate_unmapped"));

        // Asserting the driver's own error survives, not merely that it was
        // left untranslated: a helper that threw while looking up the mapping
        // would satisfy the weaker check.
        assert.ok(!(captured instanceof JsonApiError));
        assert.equal((captured as { code?: unknown }).code, "23505");
        assert.equal(
            (captured as { constraint?: unknown }).constraint,
            "translate_unmapped_unique",
        );
    });

    it("rethrows an error that is not a unique violation", async () => {
        const captured = await captureFrom(() =>
            translateUniqueViolations(
                () =>
                    em
                        .fork()
                        .execute("insert into translate_immediate (id, slot) values (3, null)"),
                violations,
            ),
        );

        assert.ok(!(captured instanceof JsonApiError));
        assert.equal((captured as { code?: unknown }).code, "23502");
    });
});

const referenceViolations: Record<string, ForeignKeyViolation> = {
    translate_fk_mapped: referenceGone("Location", "11111111-1111-1111-1111-111111111111"),
};

const fkTables = ["translate_fk_child", "translate_fk_unmapped_child", "translate_fk_parent"];

const insertDangling = (table: string): Promise<unknown> =>
    translateForeignKeyViolations(
        () => em.fork().execute(`insert into ${table} (id, parent_id) values (1, 99)`),
        referenceViolations,
    );

describe("foreign key violation", () => {
    beforeEach(async () => {
        const fork = em.fork();

        for (const table of fkTables) {
            await fork.execute(`drop table if exists ${table}`);
        }

        await fork.execute("create table translate_fk_parent (id int primary key)");
        // No ON DELETE clause, which is what every foreign key in the schema
        // that this helper covers is written as.
        await fork.execute(
            "create table translate_fk_child (id int primary key, parent_id int," +
                " constraint translate_fk_mapped foreign key (parent_id)" +
                " references translate_fk_parent (id))",
        );
        await fork.execute(
            "create table translate_fk_unmapped_child (id int primary key, parent_id int," +
                " constraint translate_fk_unmapped foreign key (parent_id)" +
                " references translate_fk_parent (id))",
        );
    });

    after(async () => {
        const fork = em.fork();

        for (const table of fkTables) {
            await fork.execute(`drop table if exists ${table}`);
        }
    });

    it("answers what the preceding existence check would have answered", async () => {
        const captured = await captureFrom(() => insertDangling("translate_fk_child"));

        assert.ok(captured instanceof JsonApiError);
        assert.equal(captured.errors[0].status, "404");
        assert.equal(captured.errors[0].code, "not_found");
        assert.equal(captured.errors[0].title, "Location not found");
        assert.equal(
            captured.errors[0].detail,
            "Location with ID '11111111-1111-1111-1111-111111111111' not found",
        );
    });

    it("rethrows a foreign key violation it has no mapping for", async () => {
        const captured = await captureFrom(() => insertDangling("translate_fk_unmapped_child"));

        assert.ok(!(captured instanceof JsonApiError));
        assert.equal((captured as { code?: unknown }).code, "23503");
        assert.equal((captured as { constraint?: unknown }).constraint, "translate_fk_unmapped");
    });

    it("rethrows an error that is not a foreign key violation", async () => {
        const captured = await captureFrom(() =>
            translateForeignKeyViolations(
                () =>
                    em
                        .fork()
                        .execute("insert into translate_fk_child (id, parent_id) values (null, 1)"),
                referenceViolations,
            ),
        );

        assert.ok(!(captured instanceof JsonApiError));
        assert.equal((captured as { code?: unknown }).code, "23502");
    });
});
