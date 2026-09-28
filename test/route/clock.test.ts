import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { isAfter, isBefore } from "temporal-extra";
import { jsonApi } from "../setup/json-api.js";
import { fetchAccessToken } from "../setup/token.js";

describe("clock", () => {
    let token: string;

    beforeEach(async () => {
        token = await fetchAccessToken("testuser");
    });

    it("tells the time it read while answering", async () => {
        const before = Temporal.Now.instant();
        const response = await jsonApi.get("/clock/now", token);
        const after = Temporal.Now.instant();

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { id: string; type: string; attributes: { time: string } };
        };
        const time = Temporal.Instant.from(document.data.attributes.time);
        assert.equal(document.data.type, "clock");
        assert.ok(!(isBefore(time, before) || isAfter(time, after)));
    });
});
