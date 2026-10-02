import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Location } from "../../../src/entity/Location.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildTeamMember, buildVenue } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type ShownResource = {
    data: {
        id: string;
        attributes?: Record<string, unknown>;
        relationships?: { tracks?: { data: { id: string }[] } };
    };
};

describe("config reads", () => {
    let integrationToken: string;
    let managerToken: string;
    let editionId: string;
    let locationId: string;
    let internalTrackId: string;
    let internalSessionTypeId: string;
    let customFieldId: string;

    before(async () => {
        [integrationToken, managerToken] = await Promise.all([
            fetchAccessToken("integration"),
            fetchAccessToken("testuser"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Config Manager",
            emailAddress: "config@example.test",
            teamName: "Config Managers",
        });
        const edition = buildEdition({ name: "Config Edition" });
        const venue = buildVenue(edition);
        const location = new Location({
            position: 0,
            name: "Green Room",
            externalKey: null,
            edition: ref(edition),
            venue: ref(venue),
        });
        // Internal marks where something belongs, not who may read it: a
        // rehearsal is real data a shift-scheduling consumer needs.
        const internalTrack = new Track({
            name: "Rehearsals",
            externalKey: null,
            description: "",
            color: "#445566",
            internal: true,
            edition: ref(edition),
        });
        const internalSessionType = new SessionType({
            name: "Rehearsal",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ minutes: 30 }),
            internal: true,
            selectionDefault: false,
            edition: ref(edition),
        });
        const customField = new CustomField({
            position: 0,
            externalKey: "equipment",
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Which equipment do you need?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.tracks.add(internalTrack);

        await fork
            .persist([
                manager,
                team,
                edition,
                location,
                internalTrack,
                internalSessionType,
                customField,
            ])
            .flush();

        editionId = edition.id;
        locationId = location.id;
        internalTrackId = internalTrack.id;
        internalSessionTypeId = internalSessionType.id;
        customFieldId = customField.id;
    });

    const show = (path: string, token: string) =>
        jsonApi.get(`/editions/${editionId}/${path}`, token);

    const readShown = async (path: string, token: string): Promise<ShownResource> => {
        const response = await show(path, token);
        assert.equal(response.status, 200);

        return (await response.json()) as ShownResource;
    };

    it("serves a location by id", async () => {
        const document = await readShown(`locations/${locationId}`, integrationToken);

        assert.equal(document.data.id, locationId);
        assert.equal(document.data.attributes?.name, "Green Room");
    });

    it("serves a track by id", async () => {
        const document = await readShown(`tracks/${internalTrackId}`, integrationToken);

        assert.equal(document.data.id, internalTrackId);
        assert.equal(document.data.attributes?.name, "Rehearsals");
    });

    it("serves a session type by id", async () => {
        const document = await readShown(
            `session-types/${internalSessionTypeId}`,
            integrationToken,
        );

        assert.equal(document.data.id, internalSessionTypeId);
        assert.equal(document.data.attributes?.name, "Rehearsal");
    });

    it("serves a custom field by id, with its scoping", async () => {
        const document = await readShown(`custom-fields/${customFieldId}`, integrationToken);

        assert.equal(document.data.id, customFieldId);
        assert.deepEqual(
            document.data.relationships?.tracks?.data.map((track) => track.id),
            [internalTrackId],
        );
    });

    it("answers an unknown id of any of them as not found", async () => {
        for (const collection of ["locations", "tracks", "session-types", "custom-fields"]) {
            await expectJsonApiError(
                await show(`${collection}/${randomUUID()}`, integrationToken),
                404,
                "not_found",
            );
        }
    });

    it("scopes each of them to its own edition", async () => {
        const fork = em.fork();
        const otherEdition = buildEdition({ name: "Other Config Edition" });
        await fork.persist(otherEdition).flush();

        const paths = [
            `locations/${locationId}`,
            `tracks/${internalTrackId}`,
            `session-types/${internalSessionTypeId}`,
            `custom-fields/${customFieldId}`,
        ];

        for (const path of paths) {
            await expectJsonApiError(
                await jsonApi.get(`/editions/${otherEdition.id}/${path}`, integrationToken),
                404,
                "not_found",
            );
        }
    });

    it("serves the same records to the organizing team", async () => {
        const document = await readShown(`tracks/${internalTrackId}`, managerToken);

        assert.equal(document.data.id, internalTrackId);
    });
});
