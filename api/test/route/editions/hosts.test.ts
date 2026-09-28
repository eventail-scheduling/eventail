import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Host } from "../../../src/entity/Host.js";
import { HostAvailability } from "../../../src/entity/HostAvailability.js";
import { Response } from "../../../src/entity/Response.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { appConfig } from "../../../src/util/app-config.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildSuperAdmin,
    buildTeamMember,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("hosts", () => {
    let viewerToken: string;
    let managerToken: string;
    let strangerToken: string;
    let integrationToken: string;
    let speakerToken: string;
    let superAdminToken: string;
    let editionId: string;
    let otherEditionId: string;
    let confirmedHostId: string;
    let plainResponseId: string;
    let confidentialResponseId: string;

    before(async () => {
        [
            viewerToken,
            managerToken,
            strangerToken,
            integrationToken,
            speakerToken,
            superAdminToken,
        ] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
            fetchAccessToken("integration"),
            fetchAccessToken("speaker"),
            fetchAccessToken("admin"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: viewer, team: viewerTeam } = buildTeamMember("testuser", "viewer", {
            displayName: "Test Viewer",
            emailAddress: "viewer@example.test",
            teamName: "Host Viewers",
        });
        const { user: manager, team: managerTeam } = buildTeamMember("testhost", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Host Managers",
        });
        // Built without buildTeamMember on purpose: the route gates on team
        // membership, not on any relationship to the edition.
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });
        // Team-less as well, so the route's own gate is the only thing the
        // superadmin claim has to get past.
        const superAdmin = buildSuperAdmin({ displayName: "Test Super Admin" });

        const edition = buildEdition({ name: "Host Edition" });
        const otherEdition = buildEdition({ name: "Other Host Edition" });
        const sessionType = SessionType.default(ref(edition));

        // A team role of their own, since the route refuses a plain user and
        // the reader-is-the-host case cannot be reached any other way.
        const { user: confirmedSpeaker, team: speakerTeam } = buildTeamMember("speaker", "viewer", {
            displayName: "Test Speaker",
            emailAddress: "speaker@example.test",
            teamName: "Host Speakers",
        });
        const confirmedHost = buildHost(edition, confirmedSpeaker);
        const confirmedSession = buildSession(edition, sessionType, {
            title: "Confirmed session",
        });
        confirmedSession.state = "confirmed";
        confirmedSession.hosts.add(confirmedHost);

        // Two hosts with no session at all, which the list must still carry, and
        // names chosen so the order is "Aaron", "Mia", "Test Speaker" rather
        // than whatever the ids happen to be.
        const bareUser = new User({
            externalId: "bare",
            displayName: "Bare User",
            emailAddress: "bare@example.test",
        });
        const bareHost = buildHost(edition, bareUser, {
            displayName: "Aaron Bare",
            emailAddress: "aaron@example.test",
        });
        const middleUser = new User({
            externalId: "middle",
            displayName: "Middle User",
            emailAddress: "middle@example.test",
        });
        const middleHost = buildHost(edition, middleUser, {
            displayName: "Mia Middle",
            emailAddress: "mia@example.test",
        });

        const availability = new HostAvailability({
            startsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T17:00:00Z"),
            host: ref(confirmedHost),
        });

        const plainCustomField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Shirt size?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const confidentialCustomField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Any dietary requirements?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: true,
            edition: ref(edition),
        });
        const plainResponse = Response.hostResponse(ref(plainCustomField), ref(confirmedHost), "L");
        const confidentialResponse = Response.hostResponse(
            ref(confidentialCustomField),
            ref(confirmedHost),
            "vegan",
        );

        await fork
            .persist([
                viewer,
                viewerTeam,
                manager,
                managerTeam,
                stranger,
                superAdmin,
                edition,
                otherEdition,
                sessionType,
                confirmedSpeaker,
                speakerTeam,
                confirmedHost,
                confirmedSession,
                bareUser,
                bareHost,
                middleUser,
                middleHost,
                availability,
                plainCustomField,
                confidentialCustomField,
                plainResponse,
                confidentialResponse,
            ])
            .flush();

        editionId = edition.id;
        otherEditionId = otherEdition.id;
        confirmedHostId = confirmedHost.id;
        plainResponseId = plainResponse.id;
        confidentialResponseId = confidentialResponse.id;
    });

    const showHost = (token: string, hostId: string) =>
        jsonApi.get(`/editions/${editionId}/hosts/${hostId}`, token);

    type HostDocument = {
        data: { attributes?: Record<string, unknown> };
        included?: { type: string; id: string }[];
    };

    const readHost = async (response: TestResponse): Promise<HostDocument> => {
        assert.equal(response.status, 200);

        return (await response.json()) as HostDocument;
    };

    const readResponseIds = (document: HostDocument): string[] =>
        (document.included ?? [])
            .filter((resource) => resource.type === "response")
            .map((resource) => resource.id);

    // An integration reads everything about an edition through the current
    // schedule document, so the host route is not part of its surface.
    it("turns away an integration", async () => {
        await expectJsonApiError(
            await showHost(integrationToken, confirmedHostId),
            403,
            "forbidden",
        );
    });

    it("turns away a user without a team membership", async () => {
        await expectJsonApiError(await showHost(strangerToken, confirmedHostId), 403, "forbidden");
    });

    it("serves confidential answers to managers but not viewers", async () => {
        const viewerResponseIds = readResponseIds(
            await readHost(await showHost(viewerToken, confirmedHostId)),
        );
        assert.ok(viewerResponseIds.includes(plainResponseId));
        assert.equal(viewerResponseIds.includes(confidentialResponseId), false);

        const managerResponseIds = readResponseIds(
            await readHost(await showHost(managerToken, confirmedHostId)),
        );
        assert.ok(managerResponseIds.includes(plainResponseId));
        assert.ok(managerResponseIds.includes(confidentialResponseId));
    });

    it("keeps a host scoped to its own edition", async () => {
        await expectJsonApiError(
            await jsonApi.get(`/editions/${otherEditionId}/hosts/${confirmedHostId}`, viewerToken),
            404,
            "not_found",
        );
    });

    it("answers an unknown host as not found", async () => {
        await expectJsonApiError(await showHost(viewerToken, randomUUID()), 404, "not_found");
    });

    it("serves a host their own confidential answers", async () => {
        const responseIds = readResponseIds(
            await readHost(await showHost(speakerToken, confirmedHostId)),
        );

        assert.ok(responseIds.includes(plainResponseId));
        assert.ok(responseIds.includes(confidentialResponseId));
    });

    it("serves a superadmin without a team membership", async () => {
        const document = await readHost(await showHost(superAdminToken, confirmedHostId));

        assert.equal(document.data.attributes?.emailAddress, "speaker@example.test");
        assert.ok(readResponseIds(document).includes(confidentialResponseId));
    });

    it("serializes the avatar once one is stored", async () => {
        const bare = await readHost(await showHost(viewerToken, confirmedHostId));
        assert.equal(bare.data.attributes?.avatar, null);

        const key = `${editionId}/hosts/${confirmedHostId}/avatar/${randomUUID()}.webp`;
        const thumbnailKey = `${editionId}/hosts/${confirmedHostId}/avatar/${randomUUID()}.webp`;
        const fork = em.fork();
        const host = await fork.findOneOrFail(Host, confirmedHostId);
        host.avatar = { key, filename: "avatar.png", thumbnailKey };
        await fork.flush();

        const document = await readHost(await showHost(viewerToken, confirmedHostId));
        assert.deepEqual(document.data.attributes?.avatar, {
            key,
            filename: "avatar.png",
            url: `${appConfig.s3.publicBaseUrl}/${key}`,
            thumbnailUrl: `${appConfig.s3.publicBaseUrl}/${thumbnailKey}`,
            processing: false,
        });
    });

    it("limits the email address to managers", async () => {
        const viewerDocument = await readHost(await showHost(viewerToken, confirmedHostId));
        assert.equal(viewerDocument.data.attributes?.emailAddress, undefined);
        assert.equal(viewerDocument.data.attributes?.displayName, "Test Speaker");

        const managerDocument = await readHost(await showHost(managerToken, confirmedHostId));
        assert.equal(managerDocument.data.attributes?.emailAddress, "speaker@example.test");
    });

    it("serves availabilities to a manager who asks and to nobody else", async () => {
        const availabilityCount = (document: HostDocument): number =>
            document.included?.filter((resource) => resource.type === "host_availability").length ??
            0;

        const asked = await jsonApi.get(
            `/editions/${editionId}/hosts/${confirmedHostId}?include=availabilities`,
            managerToken,
        );
        assert.equal(availabilityCount(await readHost(asked)), 1);

        // Not asked for, so absent even though the caller could have it. The
        // document still carries responses, so this counts rather than checking
        // that `included` is missing altogether.
        assert.equal(
            availabilityCount(await readHost(await showHost(managerToken, confirmedHostId))),
            0,
        );

        // Asked for by someone who may not read it. The path is dropped rather
        // than refused, so the document arrives without it.
        const viewer = await jsonApi.get(
            `/editions/${editionId}/hosts/${confirmedHostId}?include=availabilities`,
            viewerToken,
        );
        assert.equal(availabilityCount(await readHost(viewer)), 0);
    });

    type HostListDocument = {
        data: { id: string; attributes: Record<string, unknown>; meta: { sessionCount: number } }[];
        meta: { total: number };
        links?: Record<string, string | null>;
    };

    const listHosts = async (token: string, query = ""): Promise<HostListDocument> => {
        const response = await jsonApi.get(
            `/editions/${editionId}/hosts${query === "" ? "" : `?${query}`}`,
            token,
        );
        assert.equal(response.status, 200);

        return (await response.json()) as HostListDocument;
    };

    it("lists every host by name, counting the sessions each is on", async () => {
        const document = await listHosts(managerToken);

        assert.deepEqual(
            document.data.map((host) => [host.attributes.displayName, host.meta.sessionCount]),
            [
                ["Aaron Bare", 0],
                ["Mia Middle", 0],
                ["Test Speaker", 1],
            ],
        );
        assert.equal(document.meta.total, 3);
    });

    it("walks every host exactly once across pages", async () => {
        // A page of one, so the cursor is exercised at every boundary rather
        // than only where a single full page ends. The names are the assertion
        // because a keyset built on the wrong members repeats or skips a row
        // without ever erroring.
        const seen: string[] = [];
        let query = "page[size]=1";

        for (let page = 0; page < 4; page += 1) {
            const document = await listHosts(managerToken, query);
            seen.push(...document.data.map((host) => host.attributes.displayName as string));

            const next = document.links?.next;

            if (!next) {
                break;
            }

            query = new URL(next).searchParams.toString();
        }

        assert.deepEqual(seen, ["Aaron Bare", "Mia Middle", "Test Speaker"]);
    });

    it("keeps the address out of a viewer's list and out of what it can search", async () => {
        const document = await listHosts(viewerToken);
        assert.ok(document.data.every((host) => host.attributes.emailAddress === undefined));

        const searchedByViewer = await listHosts(viewerToken, "filter[search]=aaron@example.test");
        assert.equal(searchedByViewer.meta.total, 0);

        const searchedByManager = await listHosts(
            managerToken,
            "filter[search]=aaron@example.test",
        );
        assert.deepEqual(
            searchedByManager.data.map((host) => host.attributes.displayName),
            ["Aaron Bare"],
        );
    });

    it("searches the display name for everyone", async () => {
        const document = await listHosts(viewerToken, "filter[search]=mia");

        assert.deepEqual(
            document.data.map((host) => host.attributes.displayName),
            ["Mia Middle"],
        );
    });
});
