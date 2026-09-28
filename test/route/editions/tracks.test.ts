import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { raceScopeEmptyingDeletes } from "../../setup/scope-race.js";
import { fetchAccessToken } from "../../setup/token.js";

type ScopeInUseDocument = {
    errors: { meta: { customFields: { id: string; title: string }[] } }[];
};

describe("tracks", () => {
    let managerToken: string;
    let viewerToken: string;
    let plainUserToken: string;
    let editionId: string;
    let internalTrackId: string;
    let trackId: string;

    before(async () => {
        [managerToken, viewerToken, plainUserToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const { user: viewer, team: viewerTeam } = buildTeamMember("testhost", "viewer");
        const plainUser = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({ name: "Track Edition" });
        const internalTrack = new Track({
            name: "Backstage",
            externalKey: "backstage",
            description: "Organizer only",
            color: "#010203",
            internal: true,
            edition: ref(edition),
        });
        const track = new Track({
            name: "Main Stage",
            externalKey: "stage",
            description: "Open to everyone",
            color: "#ff0000",
            internal: false,
            edition: ref(edition),
        });

        await fork
            .persist([manager, viewer, plainUser, team, viewerTeam, edition, internalTrack, track])
            .flush();

        editionId = edition.id;
        internalTrackId = internalTrack.id;
        trackId = track.id;
    });

    it("creates a track", async () => {
        const response = await jsonApi.post(`/editions/${editionId}/tracks`, managerToken, {
            data: {
                type: "track",
                attributes: {
                    name: "Main Track",
                    externalKey: "main",
                    description: "Everything on the main stage",
                    color: "#ff0000",
                    internal: false,
                },
            },
        });

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: {
                id: string;
                type: string;
                attributes: {
                    name: string;
                    externalKey: string | null;
                    description: string;
                    color: string;
                    internal: boolean;
                };
            };
        };
        assert.equal(document.data.type, "track");
        assert.deepEqual(document.data.attributes, {
            name: "Main Track",
            externalKey: "main",
            description: "Everything on the main stage",
            color: "#ff0000",
            internal: false,
        });
    });

    it("hides internal tracks from anyone on no team", async () => {
        const listFor = async (who: string, token: string): Promise<string[]> => {
            const response = await jsonApi.get(`/editions/${editionId}/tracks`, token);

            assert.equal(response.status, 200, `${who} could not list the tracks`);
            const document = (await response.json()) as { data: { id: string }[] };

            return document.data.map((resource) => resource.id).sort();
        };

        assert.deepEqual(
            await listFor("the manager", managerToken),
            [internalTrackId, trackId].sort(),
        );
        assert.deepEqual(
            await listFor("the viewer", viewerToken),
            [internalTrackId, trackId].sort(),
        );
        assert.deepEqual(await listFor("the stranger", plainUserToken), [trackId]);
    });

    it("patches a track", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/tracks/${trackId}`,
            managerToken,
            {
                data: {
                    type: "track",
                    id: trackId,
                    attributes: {
                        name: "Renamed Track",
                        externalKey: null,
                        description: "Now with a different color",
                        color: "#00ff00",
                        internal: false,
                    },
                },
            },
        );

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: {
                id: string;
                attributes: { name: string; externalKey: string | null; color: string };
            };
        };
        assert.equal(document.data.id, trackId);
        assert.equal(document.data.attributes.name, "Renamed Track");
        assert.equal(document.data.attributes.externalKey, null);
        assert.equal(document.data.attributes.color, "#00ff00");
    });

    describe("while the edition requires a track", () => {
        beforeEach(async () => {
            const fork = em.fork();
            const edition = await fork.findOneOrFail(Edition, editionId);
            edition.sessionFieldOptions = {
                ...edition.sessionFieldOptions,
                track: { requirement: "required" },
            };
            await fork.flush();
        });

        it("refuses to make the last track speakers may pick internal", async () => {
            const response = await jsonApi.patch(
                `/editions/${editionId}/tracks/${trackId}`,
                managerToken,
                {
                    data: {
                        type: "track",
                        id: trackId,
                        attributes: {
                            name: "Main Stage",
                            externalKey: "stage",
                            description: "Open to everyone",
                            color: "#ff0000",
                            internal: true,
                        },
                    },
                },
            );

            await expectJsonApiError(response, 409, "nothing_to_pick");
            assert.equal((await em.fork().findOneOrFail(Track, trackId)).internal, false);
        });

        it("refuses to delete the last track speakers may pick", async () => {
            const response = await jsonApi.delete(
                `/editions/${editionId}/tracks/${trackId}`,
                managerToken,
            );

            await expectJsonApiError(response, 409, "nothing_to_pick");
            assert.equal(await em.fork().count(Track, { id: trackId }), 1);
        });

        it("still edits a track that was internal already", async () => {
            const fork = em.fork();
            (await fork.findOneOrFail(Track, trackId)).internal = true;
            await fork.flush();

            const response = await jsonApi.patch(
                `/editions/${editionId}/tracks/${internalTrackId}`,
                managerToken,
                {
                    data: {
                        type: "track",
                        id: internalTrackId,
                        attributes: {
                            name: "Green Room",
                            externalKey: "backstage",
                            description: "Organizer only",
                            color: "#010203",
                            internal: true,
                        },
                    },
                },
            );

            assert.equal(response.status, 200);
        });

        it("still deletes a track that was internal already", async () => {
            const fork = em.fork();
            (await fork.findOneOrFail(Track, trackId)).internal = true;
            await fork.flush();

            const response = await jsonApi.delete(
                `/editions/${editionId}/tracks/${internalTrackId}`,
                managerToken,
            );

            assert.equal(response.status, 204);
        });
    });

    it("deletes a track", async () => {
        const response = await jsonApi.delete(
            `/editions/${editionId}/tracks/${internalTrackId}`,
            managerToken,
        );

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Track, { id: internalTrackId }), 0);
    });

    it("detaches sessions from a deleted track", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = SessionType.default(ref(edition));
        const track = new Track({
            name: "Doomed Track",
            externalKey: null,
            description: "",
            color: "#0000ff",
            internal: false,
            edition: ref(edition),
        });
        const confirmedSession = buildSession(edition, sessionType, {
            title: "Confirmed on doomed track",
            track: ref(track),
        });
        confirmedSession.state = "confirmed";
        const submittedSession = buildSession(edition, sessionType, {
            title: "Submitted on doomed track",
            track: ref(track),
        });
        await fork.persist([sessionType, track, confirmedSession, submittedSession]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/tracks/${track.id}`,
            managerToken,
        );
        assert.equal(response.status, 204);

        const readFork = em.fork();
        assert.equal(await readFork.count(Track, { id: track.id }), 0);
        const detachedConfirmed = await readFork.findOneOrFail(Session, confirmedSession.id);
        const detachedSubmitted = await readFork.findOneOrFail(Session, submittedSession.id);
        assert.equal(detachedConfirmed.track, null);
        assert.equal(detachedSubmitted.track, null);
    });

    it("refuses to delete a track a customField is scoped to and nothing else", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const track = new Track({
            name: "Scoped Track",
            externalKey: null,
            description: "",
            color: "#123456",
            internal: false,
            edition: ref(edition),
        });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Do you need a whiteboard?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.tracks.add(track);
        await fork.persist([track, customField]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/tracks/${track.id}`,
            managerToken,
        );

        await expectJsonApiError(response, 409, "scope_in_use");

        const readFork = em.fork();
        assert.equal(await readFork.count(Track, { id: track.id }), 1);
        const survivor = await readFork.findOneOrFail(
            CustomField,
            { id: customField.id },
            { populate: ["tracks"] },
        );
        assert.equal(survivor.tracks.length, 1);
    });

    it("names the blocking customFields in the conflict", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const track = new Track({
            name: "Named Track",
            externalKey: null,
            description: "",
            color: "#abcdef",
            internal: false,
            edition: ref(edition),
        });
        const customField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_required",
            options: { type: "single_line_text" },
            title: "Which power outlet do you need?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.tracks.add(track);
        await fork.persist([track, customField]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/tracks/${track.id}`,
            managerToken,
        );

        assert.equal(response.status, 409);
        const body = await response.json<ScopeInUseDocument>();
        assert.deepEqual(body.errors[0]?.meta.customFields, [
            { id: customField.id, title: "Which power outlet do you need?" },
        ]);
    });

    it("deletes a track a customField scopes alongside another", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const doomed = new Track({
            name: "Doomed Half",
            externalKey: null,
            description: "",
            color: "#111111",
            internal: false,
            edition: ref(edition),
        });
        const survivingTrack = new Track({
            name: "Surviving Half",
            externalKey: null,
            description: "",
            color: "#222222",
            internal: false,
            edition: ref(edition),
        });
        const customField = new CustomField({
            position: 2,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Scoped to both halves",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.tracks.add(doomed, survivingTrack);
        await fork.persist([doomed, survivingTrack, customField]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/tracks/${doomed.id}`,
            managerToken,
        );

        assert.equal(response.status, 204);

        const readFork = em.fork();
        assert.equal(await readFork.count(Track, { id: doomed.id }), 0);
        const survivor = await readFork.findOneOrFail(
            CustomField,
            { id: customField.id },
            { populate: ["tracks"] },
        );
        assert.deepEqual(
            survivor.tracks.map((track) => track.id),
            [survivingTrack.id],
        );
    });

    // Holding the revision counter parks the first after its delete and before
    // its commit.
    it("refuses the second of two deletes that would empty a field's scope", async () => {
        await em
            .fork()
            .execute('insert into "edition_revision" ("edition_id", "revision") values (?, 1)', [
                editionId,
            ]);

        await raceScopeEmptyingDeletes({
            editionId,
            managerToken,
            dimension: "tracks",
            ids: [internalTrackId, trackId],
            park: (em) =>
                em.execute('select 1 from "edition_revision" where "edition_id" = ? for update', [
                    editionId,
                ]),
        });
    });
});
