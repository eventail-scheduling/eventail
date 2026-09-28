import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
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
});
