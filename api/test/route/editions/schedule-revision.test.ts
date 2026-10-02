import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Location } from "../../../src/entity/Location.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { SessionHostInvite } from "../../../src/entity/SessionHostInvite.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildSuperAdmin,
    buildTeamMember,
    buildVenue,
    editionVersion,
} from "../../setup/fixtures.js";
import { jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

/**
 * A missed bump is a silent, permanent divergence.
 *
 * The consumer keeps serving what it last fetched and nothing ever tells it
 * otherwise. Every test here reads the stored revision either side of one
 * request rather than asserting on a served document, because the document is
 * exactly what stays wrong.
 */
describe("schedule revision", () => {
    let managerToken: string;
    let inviteeToken: string;

    let editionId: string;
    let draftScheduleId: string;
    let sessionId: string;
    let sessionTypeId: string;
    let trackId: string;
    let hostId: string;
    let hostUserId: string;
    let openFieldId: string;
    let confidentialFieldId: string;
    let unreachableTrackId: string;
    let unreachableFieldId: string;
    let submittedSessionId: string;

    before(async () => {
        [managerToken, inviteeToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Revision Manager",
            emailAddress: "revision-manager@example.test",
            teamName: "Revision Managers",
        });
        const speaker = new User({
            externalId: "testhost",
            displayName: "Revision Speaker",
            emailAddress: "revision-speaker@example.test",
        });
        const invitee = new User({
            externalId: "stranger",
            displayName: "Revision Invitee",
            emailAddress: "revision-invitee@example.test",
        });

        const edition = buildEdition({
            name: "Revision Edition",
            // Only the configured fields may appear in a patch, and these
            // tests need notes (organizer-only) and track (a relationship).
            sessionFieldOptions: {
                title: {},
                sessionType: {},
                abstract: { requirement: "required" },
                notes: { requirement: "optional" },
                track: { requirement: "optional" },
            },
        });
        const sessionType = SessionType.default(ref(edition));
        const track = new Track({
            name: "Served Track",
            externalKey: "served",
            description: "",
            color: "#101010",
            internal: false,
            edition: ref(edition),
        });
        const unreachableTrack = new Track({
            name: "Unserved Track",
            externalKey: "unserved",
            description: "",
            color: "#202020",
            internal: false,
            edition: ref(edition),
        });
        const venue = buildVenue(edition);
        const location = new Location({
            position: 0,
            name: "Revision Hall",
            externalKey: null,
            edition: ref(edition),
            venue: ref(venue),
        });

        const publication = new Schedule({ edition: ref(edition), sequence: 1 });
        publication.publish(edition, Temporal.Now.instant());
        const draft = new Schedule({ edition: ref(edition), sequence: 2 });

        const session = buildSession(edition, sessionType, {
            title: "Served Session",
            abstract: "A session the publication serves",
            track: ref(track),
        });
        session.state = "confirmed";
        const host = buildHost(edition, speaker);
        session.hosts.add(host);

        // Never slotted and never confirmed, so no transition of it touches the
        // publication.
        const submittedSession = buildSession(edition, sessionType, {
            title: "Submitted Session",
            abstract: "Still waiting",
        });

        const slot = new Slot({
            startsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T10:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 0 }),
            teardownTime: Temporal.Duration.from({ minutes: 0 }),
            schedule: ref(publication),
            session: ref(session),
            location: ref(location),
        });

        const buildField = (title: string, key: string, position: number, confidential: boolean) =>
            new CustomField({
                position,
                externalKey: key,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title,
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential,
                edition: ref(edition),
            });

        const openField = buildField("Needs a projector?", "open", 0, false);
        const confidentialField = buildField("Any access needs?", "private", 1, true);
        // Scoped to the track no served session is on, so it applies to no
        // session in the publication and nobody answers it. A custom field
        // reaches a document only through an answer.
        const unreachableField = buildField("Unanswered", "unanswered", 2, false);
        unreachableField.tracks.add(unreachableTrack);

        await fork
            .persist([
                manager,
                team,
                speaker,
                invitee,
                edition,
                sessionType,
                track,
                unreachableTrack,
                location,
                publication,
                draft,
                session,
                submittedSession,
                host,
                slot,
                openField,
                confidentialField,
                unreachableField,
                new Response({
                    value: "Yes",
                    customField: ref(openField),
                    host: null,
                    session: ref(session),
                }),
                new Response({
                    value: "None",
                    customField: ref(confidentialField),
                    host: null,
                    session: ref(session),
                }),
            ])
            .flush();

        editionId = edition.id;
        draftScheduleId = draft.id;
        sessionId = session.id;
        sessionTypeId = sessionType.id;
        trackId = track.id;
        hostId = host.id;
        hostUserId = speaker.id;
        openFieldId = openField.id;
        confidentialFieldId = confidentialField.id;
        unreachableTrackId = unreachableTrack.id;
        unreachableFieldId = unreachableField.id;
        submittedSessionId = submittedSession.id;
    });

    const readRevision = async (): Promise<number> =>
        (await em.fork().findOne(EditionRevision, { editionId }))?.revision ?? 0;

    const expectBump = async (act: () => Promise<void>): Promise<void> => {
        const previous = await readRevision();
        await act();
        assert.equal(await readRevision(), previous + 1, "expected the revision to move");
    };

    const expectNoBump = async (act: () => Promise<void>): Promise<void> => {
        const previous = await readRevision();
        await act();
        assert.equal(await readRevision(), previous, "expected the revision to stay put");
    };

    type SessionPatch = {
        notes?: string;
        withTrack?: boolean;
        openValue?: string;
        sessionTypeOverride?: string;
    };

    const patchSession = ({
        notes = "",
        withTrack = true,
        openValue = "Yes",
        sessionTypeOverride,
    }: SessionPatch) =>
        jsonApi.patch(`/editions/${editionId}/sessions/${sessionId}`, managerToken, {
            data: {
                type: "session",
                id: sessionId,
                attributes: {
                    title: "Served Session",
                    abstract: "A session the publication serves",
                    notes,
                },
                relationships: {
                    sessionType: {
                        data: { type: "session_type", id: sessionTypeOverride ?? sessionTypeId },
                    },
                    track: withTrack ? { data: { type: "track", id: trackId } } : { data: null },
                    responses: {
                        data: [
                            { type: "response", lid: "a0" },
                            { type: "response", lid: "a1" },
                        ],
                    },
                },
                meta: { selfService: false },
            },
            included: [
                {
                    type: "response",
                    lid: "a0",
                    attributes: { value: openValue },
                    relationships: {
                        customField: { data: { type: "custom_field", id: openFieldId } },
                    },
                },
                {
                    type: "response",
                    lid: "a1",
                    attributes: { value: "None" },
                    relationships: {
                        customField: { data: { type: "custom_field", id: confidentialFieldId } },
                    },
                },
            ],
        });

    it("bumps when a co-host accepts an invite", async () => {
        const invite = await jsonApi.post(
            `/editions/${editionId}/sessions/${sessionId}/host-invites`,
            managerToken,
            {
                data: {
                    type: "session_host_invite",
                    attributes: { emailAddress: "revision-invitee@example.test" },
                },
            },
        );
        assert.equal(invite.status, 201);

        const stored = await em.fork().findOneOrFail(SessionHostInvite, { session: sessionId });

        await expectBump(async () => {
            const accepted = await jsonApi.post(
                `/session-host-invites/${stored.code}/acceptance`,
                inviteeToken,
            );
            assert.equal(accepted.status, 204);
        });
    });

    it("bumps when a host is removed", async () => {
        await expectBump(async () => {
            const removal = await jsonApi.delete(
                `/editions/${editionId}/sessions/${sessionId}/relationships/hosts`,
                managerToken,
                { data: [{ type: "host", id: hostId }] },
            );
            assert.equal(removal.status, 204);
        });
    });

    it("bumps on a purge, despite the cascade that takes the host row with the account", async () => {
        const adminToken = await fetchAccessToken("admin");
        const adminFork = em.fork();
        adminFork.persist(
            buildSuperAdmin({
                displayName: "Revision Admin",
                emailAddress: "revision-admin@example.test",
            }),
        );
        await adminFork.flush();

        await expectBump(async () => {
            const purge = await jsonApi.post("/user-purges", adminToken, {
                data: {
                    type: "user_purge",
                    attributes: { emailAddress: "revision-speaker@example.test" },
                    meta: { dryRun: false },
                },
            });
            assert.equal(purge.status, 200);
        });

        assert.equal(await em.fork().count(User, { id: hostUserId }), 0);
    });

    it("bumps when a track is deleted, despite the null-out rather than a cascade", async () => {
        await expectBump(async () => {
            const deleted = await jsonApi.delete(
                `/editions/${editionId}/tracks/${trackId}`,
                managerToken,
            );
            assert.equal(deleted.status, 204);
        });
    });

    it("bumps when a custom field is deleted, despite the cascade to its answers", async () => {
        await expectBump(async () => {
            const deleted = await jsonApi.delete(
                `/editions/${editionId}/custom-fields/${openFieldId}`,
                managerToken,
            );
            assert.equal(deleted.status, 204);
        });

        assert.equal(await em.fork().count(Response, { customField: openFieldId }), 0);
    });

    it("does not bump when only organizer-only notes change", async () => {
        await expectNoBump(async () => {
            const patched = await patchSession({
                notes: "Organizers only, and in no document",
            });
            assert.equal(patched.status, 200);
        });
    });

    it("bumps when confidential flips in either direction", async () => {
        const setConfidential = (id: string, key: string, title: string, confidential: boolean) =>
            jsonApi.patch(`/editions/${editionId}/custom-fields/${id}`, managerToken, {
                data: {
                    type: "custom_field",
                    id,
                    attributes: {
                        externalKey: key,
                        target: "per_proposal",
                        requirement: "always_optional",
                        options: { type: "single_line_text" },
                        title,
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential,
                    },
                    relationships: { sessionTypes: { data: [] }, tracks: { data: [] } },
                },
            });

        // Withdrawing an answer a consumer already holds is the direction a
        // visible-field check would miss, since confidential is not itself
        // served.
        await expectBump(async () => {
            const hidden = await setConfidential(openFieldId, "open", "Needs a projector?", true);
            assert.equal(hidden.status, 200);
        });

        await expectBump(async () => {
            const revealed = await setConfidential(
                confidentialFieldId,
                "private",
                "Any access needs?",
                false,
            );
            assert.equal(revealed.status, 200);
        });
    });

    it("bumps deletes of rows no publication serves", async () => {
        await expectBump(async () => {
            const field = await jsonApi.delete(
                `/editions/${editionId}/custom-fields/${unreachableFieldId}`,
                managerToken,
            );
            assert.equal(field.status, 204);
        });

        await expectBump(async () => {
            const track = await jsonApi.delete(
                `/editions/${editionId}/tracks/${unreachableTrackId}`,
                managerToken,
            );
            assert.equal(track.status, 204);
        });
    });

    it("bumps an edit to a row no publication serves", async () => {
        await expectBump(async () => {
            const patched = await jsonApi.patch(
                `/editions/${editionId}/tracks/${unreachableTrackId}`,
                managerToken,
                {
                    data: {
                        type: "track",
                        id: unreachableTrackId,
                        attributes: {
                            name: "Unserved, renamed",
                            externalKey: "unserved",
                            description: "",
                            color: "#202020",
                            internal: false,
                        },
                    },
                },
            );
            assert.equal(patched.status, 200);
        });
    });

    it("bumps a session leaving confirmed but not a transition either side of it", async () => {
        await expectBump(async () => {
            const canceled = await jsonApi.post(
                `/editions/${editionId}/sessions/${sessionId}/transitions`,
                managerToken,
                { data: { type: "session_transition", attributes: { state: "canceled" } } },
            );
            assert.equal(canceled.status, 201);
        });

        await expectNoBump(async () => {
            const rejected = await jsonApi.post(
                `/editions/${editionId}/sessions/${submittedSessionId}/transitions`,
                managerToken,
                { data: { type: "session_transition", attributes: { state: "rejected" } } },
            );
            assert.equal(rejected.status, 201);
        });
    });

    it("bumps an edition date change but not a submission-form change", async () => {
        const patchEdition = async (attributes: Record<string, unknown>) =>
            jsonApi.patch(`/editions/${editionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: editionId,
                    attributes,
                    meta: { version: await editionVersion(em, editionId) },
                },
            });

        await expectBump(async () => {
            const patched = await patchEdition({ endDate: "2027-10-04" });
            assert.equal(patched.status, 200);
        });

        await expectNoBump(async () => {
            const patched = await patchEdition({
                sessionFieldOptions: {
                    title: {},
                    sessionType: {},
                    abstract: { requirement: "required" },
                    notes: { requirement: "optional" },
                    track: { requirement: "optional" },
                    description: { requirement: "optional" },
                },
            });
            assert.equal(patched.status, 200);
        });
    });

    it("leaves no bump behind when the transaction rolls back", async () => {
        await expectNoBump(async () => {
            // The rename would bump, but the external key collides with the
            // other track and the unique violation unwinds the whole
            // transaction, bump included.
            const rejected = await jsonApi.patch(
                `/editions/${editionId}/tracks/${trackId}`,
                managerToken,
                {
                    data: {
                        type: "track",
                        id: trackId,
                        attributes: {
                            name: "Renamed",
                            externalKey: "unserved",
                            description: "",
                            color: "#404040",
                            internal: false,
                        },
                    },
                },
            );
            assert.equal(rejected.status, 409);
        });
    });

    it("bumps a session update that changes only an answer", async () => {
        await expectBump(async () => {
            const patched = await patchSession({ openValue: "No, the room has one" });
            assert.equal(patched.status, 200);
        });
    });

    it("bumps a session update that changes only its track", async () => {
        await expectBump(async () => {
            const patched = await patchSession({ withTrack: false });
            assert.equal(patched.status, 200);
        });
    });

    it("bumps a session update that changes only its session type", async () => {
        const fork = em.fork();
        const alternative = new SessionType({
            name: "Alternative Type",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ minutes: 45 }),
            internal: false,
            selectionDefault: false,
            edition: ref(fork.getReference(Edition, editionId)),
        });
        await fork.persist(alternative).flush();

        await expectBump(async () => {
            const patched = await patchSession({ sessionTypeOverride: alternative.id });
            assert.equal(patched.status, 200);
        });
    });

    it("bumps the edition counter exactly once on publication", async () => {
        await expectBump(async () => {
            const published = await jsonApi.post(
                `/editions/${editionId}/schedules/${draftScheduleId}/publication`,
                managerToken,
                { data: { type: "schedule_publication", attributes: { preliminary: false } } },
            );
            assert.equal(published.status, 204);
        });
    });
});
