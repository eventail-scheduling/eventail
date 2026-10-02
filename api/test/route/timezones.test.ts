import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { testClient } from "@taxum/testing";
import { router } from "../../src/app.js";
import { jsonApi } from "../setup/json-api.js";
import { fetchAccessToken } from "../setup/token.js";

describe("timezones", () => {
    let token: string;

    beforeEach(async () => {
        token = await fetchAccessToken("testuser");
    });

    it("lists the supported time zones", async () => {
        const response = await jsonApi.get("/timezones", token);

        assert.equal(response.status, 200);
        const document = (await response.json()) as { data: { id: string; type: string }[] };
        assert.ok(document.data.length > 0);
        assert.ok(document.data.every((resource) => resource.type === "timezone"));
        assert.ok(document.data.some((resource) => resource.id === "Europe/Berlin"));
    });

    it("refuses a caller that accepts only plain JSON", async () => {
        // The check runs off an extension the handler puts on the response,
        // which @taxum/core dropped while rebuilding it in the cors layer
        // until 1.3.2, so this passed as a 200 and nobody noticed.
        const response = await testClient(router)
            .get("/timezones")
            .header("accept", "application/json")
            .header("authorization", `Bearer ${token}`);

        assert.equal(response.status, 406);
    });
});
