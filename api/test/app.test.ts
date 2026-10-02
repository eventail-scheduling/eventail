import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { testClient } from "@taxum/testing";
import { router } from "../src/app.js";
import { contractVersion } from "../src/util/contract-version.js";

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

    it("carries the contract version before the caller has a token", async () => {
        const response = await testClient(router)
            .get("/timezones")
            .header("accept", "application/vnd.api+json");

        assert.equal(response.status, 401);
        // The literal name, not the constant: a test reading the name from the
        // same constant the header is set from passes through a rename, which
        // is the change that breaks every client.
        assert.equal(response.headers.get("Eventail-Contract-Version"), String(contractVersion));
    });

    it("carries it on a refusal that a layer throws rather than returns", async () => {
        // The body limit throws, and the header is applied to a returned
        // response, so without a catch above it this 413 unwinds bare.
        const response = await testClient(router)
            .post("/editions")
            .header("content-type", "application/vnd.api+json")
            .header("content-length", String(50 * 1024 * 1024))
            .body("{}");

        assert.equal(response.status, 413);
        assert.equal(response.headers.get("Eventail-Contract-Version"), String(contractVersion));
    });
});
