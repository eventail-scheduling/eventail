import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("me sessions", () => {
    let hostToken: string;
    let managerToken: string;
    let editionId: string;
    let ownSessionId: string;

    before(async () => {
        [hostToken, managerToken] = await Promise.all([
            fetchAccessToken("testhost"),
            fetchAccessToken("testuser"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const edition = buildEdition({
            name: "My Sessions Edition",
            startDate: Temporal.PlainDate.from("2027-11-01"),
            endDate: Temporal.PlainDate.from("2027-11-03"),
        });
        const sessionType = new SessionType({
            name: "Talk",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ minutes: 30 }),
            internal: false,
            selectionDefault: true,
            edition: ref(edition),
        });

        const own = buildSession(edition, sessionType, { title: "Mine" });
        own.hosts.add(buildHost(edition, host));
        const foreign = buildSession(edition, sessionType, { title: "Someone else's" });
        foreign.hosts.add(buildHost(edition, stranger));

        await fork
            .persist([host, stranger, manager, team, edition, sessionType, own, foreign])
            .flush();

        editionId = edition.id;
        ownSessionId = own.id;
    });

    it("returns only the sessions the caller hosts", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/me/sessions`, hostToken);
        const document = (await response.json()) as { data: { id: string }[] };

        assert.equal(response.status, 200);
        assert.deepEqual(
            document.data.map((session) => session.id),
            [ownSessionId],
        );
    });

    it("does not widen for a manager, who sees only their own", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/me/sessions`, managerToken);
        const document = (await response.json()) as { data: unknown[] };

        assert.equal(response.status, 200);
        assert.deepEqual(document.data, []);
    });

    it("includes the session type so a list can name it", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/me/sessions`, hostToken);
        const document = (await response.json()) as {
            included?: { type: string }[];
        };

        assert.ok(document.included?.some((resource) => resource.type === "session_type"));
    });
});
