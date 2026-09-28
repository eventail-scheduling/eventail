import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testClient } from "@taxum/testing";
import { router } from "../src/app.js";

describe("app", () => {
    it("responds to health checks", async () => {
        const response = await testClient(router).get("/health");

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "alive" });
    });

    it("rejects API requests without a token", async () => {
        const response = await testClient(router)
            .get("/timezones")
            .header("accept", "application/vnd.api+json");

        assert.equal(response.status, 401);
    });
});
