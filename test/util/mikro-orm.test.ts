import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Edition } from "../../src/entity/Edition.js";
import { em } from "../../src/util/mikro-orm.js";

describe("mikro-orm", () => {
    it("reads and writes against the worker database clone", async () => {
        const fork = em.fork();

        const edition = new Edition({
            name: "Test Edition",
            startDate: Temporal.PlainDate.from("2027-06-01"),
            endDate: Temporal.PlainDate.from("2027-06-03"),
            timeZone: "Europe/Berlin",
            submissionDeadline: null,
        });
        await fork.persist(edition).flush();

        const found = await em.fork().findOne(Edition, { name: "Test Edition" });

        assert.ok(found);
        assert.equal(found.timeZone, "Europe/Berlin");
        assert.ok(found.startDate.equals(Temporal.PlainDate.from("2027-06-01")));
    });
});
