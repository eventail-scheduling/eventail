import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { User } from "../../src/entity/User.js";
import { em } from "../../src/util/mikro-orm.js";
import { buildSuperAdmin, buildTeamMember } from "../setup/fixtures.js";
import { jsonApi } from "../setup/json-api.js";
import { fetchAccessToken } from "../setup/token.js";

describe("authorization", () => {
    let viewerToken: string;
    let managerToken: string;
    let adminTeamToken: string;
    let superAdminToken: string;
    let strangerToken: string;
    let integrationToken: string;

    before(async () => {
        [
            viewerToken,
            managerToken,
            adminTeamToken,
            superAdminToken,
            strangerToken,
            integrationToken,
        ] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("speaker"),
            fetchAccessToken("testhost"),
            fetchAccessToken("admin"),
            fetchAccessToken("stranger"),
            fetchAccessToken("integration"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: viewer, team: viewerTeam } = buildTeamMember("testuser", "viewer", {
            displayName: "Viewer User",
            emailAddress: "viewer@example.test",
            teamName: "Viewers",
        });
        const { user: manager, team: managerTeam } = buildTeamMember("speaker", "manager", {
            displayName: "Manager User",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        const { user: adminTeamMember, team: adminTeam } = buildTeamMember("testhost", "admin", {
            displayName: "Admin Team User",
            emailAddress: "adminteam@example.test",
            teamName: "Admins",
        });
        const superAdmin = buildSuperAdmin();
        const stranger = new User({
            externalId: "stranger",
            displayName: "Stranger",
            emailAddress: "stranger@example.test",
        });

        await fork
            .persist([
                viewer,
                manager,
                adminTeamMember,
                superAdmin,
                stranger,
                viewerTeam,
                managerTeam,
                adminTeam,
            ])
            .flush();
    });

    const createEdition = (token: string, name: string) =>
        jsonApi.post("/editions", token, {
            data: {
                type: "edition",
                attributes: {
                    name,
                    startDate: "2028-05-01",
                    endDate: "2028-05-03",
                    timeZone: "Europe/Berlin",
                    submissionDeadline: null,
                },
            },
        });

    const dryRunPurge = (token: string) =>
        jsonApi.post("/user-purges", token, {
            data: {
                type: "user_purge",
                attributes: { emailAddress: "nobody@example.test" },
                meta: { dryRun: true },
            },
        });

    it("keeps team management and erasure from a manager", async () => {
        assert.equal((await jsonApi.get("/teams", managerToken)).status, 403);
        assert.equal((await dryRunPurge(managerToken)).status, 403);
    });

    it("lets an admin team member manage teams and erase users without the claim", async () => {
        assert.equal((await jsonApi.get("/teams", adminTeamToken)).status, 200);
        assert.equal((await dryRunPurge(adminTeamToken)).status, 200);
    });

    it("rejects an integration token on the user profile route", async () => {
        const response = await jsonApi.get("/user", integrationToken);

        assert.equal(response.status, 403);
        const document = (await response.json()) as { errors: { detail: string }[] };
        assert.equal(document.errors[0]?.detail, "Machine tokens cannot have a user profile");
    });

    it("denies a viewer team member the manager gate", async () => {
        const create = await createEdition(viewerToken, "Viewer Edition");
        assert.equal(create.status, 403);
    });

    it("lets an admin team member through the manager gate", async () => {
        const response = await createEdition(adminTeamToken, "Admin Team Edition");
        assert.equal(response.status, 201);

        const document = (await response.json()) as { data: { attributes: { name: string } } };
        assert.equal(document.data.attributes.name, "Admin Team Edition");
    });

    it("lets the superadmin claim through the manager gate without a team", async () => {
        const response = await createEdition(superAdminToken, "Superadmin Edition");
        assert.equal(response.status, 201);
    });

    it("lets a team-less user read editions but not create them", async () => {
        const list = await jsonApi.get("/editions", strangerToken);
        assert.equal(list.status, 200);

        const create = await createEdition(strangerToken, "Stranger Edition");
        assert.equal(create.status, 403);
    });
});
