import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Location } from "../../../src/entity/Location.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import type { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { Venue } from "../../../src/entity/Venue.js";
import { bumpEditionRevision } from "../../../src/support/edition-revision.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildTeamMember,
    buildVenue,
} from "../../setup/fixtures.js";
import { expectJsonApiError, expectNoAttributes, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("schedules", () => {
    let managerToken: string;
    let viewerToken: string;
    let outsiderToken: string;
    let integrationToken: string;
    let editionId: string;
    let draftScheduleId: string;
    let sessionId: string;
    let locationId: string;
    let venueId: string;

    before(async () => {
        [managerToken, viewerToken, outsiderToken, integrationToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
            fetchAccessToken("integration"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team: managerTeam } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        const { user: viewer, team: viewerTeam } = buildTeamMember("testhost", "viewer", {
            displayName: "Test Viewer",
            emailAddress: "viewer@example.test",
            teamName: "Viewers",
        });
        const outsider = new User({
            externalId: "stranger",
            displayName: "Test Outsider",
            emailAddress: "outsider@example.test",
        });

        const edition = buildEdition({
            name: "Schedule Edition",
            startDate: Temporal.PlainDate.from("2027-11-01"),
            endDate: Temporal.PlainDate.from("2027-11-03"),
        });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Schedulable Session" });
        session.state = "accepted";
        const venue = buildVenue(edition);
        const location = new Location({
            position: 0,
            name: "Main Hall",
            externalKey: null,
            edition: ref(edition),
            venue: ref(venue),
        });
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });

        await fork
            .persist([
                manager,
                viewer,
                outsider,
                managerTeam,
                viewerTeam,
                edition,
                sessionType,
                session,
                venue,
                location,
                schedule,
            ])
            .flush();

        editionId = edition.id;
        draftScheduleId = schedule.id;
        sessionId = session.id;
        locationId = location.id;
        venueId = venue.id;
    });

    const listSchedules = (token: string) => jsonApi.get(`/editions/${editionId}/schedules`, token);

    const showSchedule = (token: string, scheduleId: string) =>
        jsonApi.get(`/editions/${editionId}/schedules/${scheduleId}`, token);

    const createSlot = async (): Promise<string> => {
        const response = await jsonApi.post(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-02T09:00:00Z",
                        endsAt: "2027-11-02T10:00:00Z",
                        setupTime: "PT15M",
                        teardownTime: "PT15M",
                    },
                    relationships: {
                        session: { data: { type: "session", id: sessionId } },
                        location: { data: { type: "location", id: locationId } },
                    },
                },
            },
        );

        assert.equal(response.status, 201);

        return ((await response.json()) as { data: { id: string } }).data.id;
    };

    const publishSchedule = async (): Promise<void> => {
        const response = await jsonApi.post(
            `/editions/${editionId}/schedules/${draftScheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );

        assert.equal(response.status, 204);
    };

    it("shows the manager the draft schedule", async () => {
        const list = await listSchedules(managerToken);
        assert.equal(list.status, 200);
        const listDocument = (await list.json()) as {
            data: { id: string; attributes: { publishedAt: string | null } }[];
        };
        assert.deepEqual(
            listDocument.data.map((resource) => resource.id),
            [draftScheduleId],
        );
        assert.equal(listDocument.data[0].attributes.publishedAt, null);

        const detail = await showSchedule(managerToken, draftScheduleId);
        assert.equal(detail.status, 200);
        const detailDocument = (await detail.json()) as { data: { id: string } };
        assert.equal(detailDocument.data.id, draftScheduleId);

        const latest = await showSchedule(managerToken, "latest");
        assert.equal(latest.status, 200);
        const latestDocument = (await latest.json()) as { data: { id: string } };
        assert.equal(latestDocument.data.id, draftScheduleId);
    });

    it("shows a viewer the draft schedule", async () => {
        const list = await listSchedules(viewerToken);
        assert.equal(list.status, 200);
        const listDocument = (await list.json()) as { data: { id: string }[] };
        assert.deepEqual(
            listDocument.data.map((resource) => resource.id),
            [draftScheduleId],
        );

        const detail = await showSchedule(viewerToken, draftScheduleId);
        assert.equal(detail.status, 200);
    });

    it("shows a viewer the draft through the latest route", async () => {
        const latest = await showSchedule(viewerToken, "latest");
        assert.equal(latest.status, 200);
        const document = (await latest.json()) as { data: { id: string } };
        assert.equal(document.data.id, draftScheduleId);
    });

    it("denies users without a viewer role", async () => {
        const list = await listSchedules(outsiderToken);
        assert.equal(list.status, 403);

        const detail = await showSchedule(outsiderToken, draftScheduleId);
        assert.equal(detail.status, 403);

        const current = await showSchedule(outsiderToken, "current");
        assert.equal(current.status, 403);

        const latest = await showSchedule(outsiderToken, "latest");
        assert.equal(latest.status, 403);
    });

    it("hides unpublished schedules from the integration", async () => {
        const current = await showSchedule(integrationToken, "current");
        assert.equal(current.status, 404);
    });

    // The current schedule document carries everything an integration reads,
    // so no other schedule route is part of its surface.
    it("turns an integration away from every schedule route but current", async () => {
        assert.equal((await listSchedules(integrationToken)).status, 403);
        assert.equal((await showSchedule(integrationToken, draftScheduleId)).status, 403);
        assert.equal((await showSchedule(integrationToken, "latest")).status, 403);
    });

    it("carries the window on a publication and not on a draft", async () => {
        const draft = await showSchedule(managerToken, draftScheduleId);
        assert.equal(draft.status, 200);
        const draftDocument = (await draft.json()) as {
            data: { attributes: { startDate: string | null; timeZone: string | null } };
        };
        assert.equal(draftDocument.data.attributes.startDate, null);
        assert.equal(draftDocument.data.attributes.timeZone, null);

        await publishSchedule();

        const current = await showSchedule(integrationToken, "current");
        assert.equal(current.status, 200);
        const currentDocument = (await current.json()) as {
            data: {
                attributes: { startDate: string; endDate: string; timeZone: string };
            };
        };
        assert.deepEqual(currentDocument.data.attributes.startDate, "2027-11-01");
        assert.deepEqual(currentDocument.data.attributes.endDate, "2027-11-03");
        assert.deepEqual(currentDocument.data.attributes.timeZone, "Europe/Berlin");
    });

    it("moves a slot to another time and location", async () => {
        const movableSlotId = await createSlot();

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sideRoom = new Location({
            position: 1,
            name: "Side Room",
            externalKey: null,
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        await fork.persist(sideRoom).flush();

        const update = await jsonApi.patch(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots/${movableSlotId}`,
            managerToken,
            {
                data: {
                    type: "slot",
                    id: movableSlotId,
                    attributes: {
                        startsAt: "2027-11-02T13:00:00Z",
                        endsAt: "2027-11-02T14:30:00Z",
                        setupTime: "PT5M",
                        teardownTime: "PT5M",
                    },
                    relationships: {
                        location: { data: { type: "location", id: sideRoom.id } },
                    },
                },
            },
        );

        assert.equal(update.status, 200);
        const updateDocument = (await update.json()) as {
            data: {
                attributes: { startsAt: string; endsAt: string };
                relationships: { location: { data: { id: string } } };
            };
        };
        assert.equal(updateDocument.data.attributes.startsAt, "2027-11-02T13:00:00Z");
        assert.equal(updateDocument.data.attributes.endsAt, "2027-11-02T14:30:00Z");
        assert.equal(updateDocument.data.relationships.location.data.id, sideRoom.id);

        const storedSlot = await em.fork().findOneOrFail(Slot, movableSlotId);
        assert.equal(storedSlot.startsAt.toString(), "2027-11-02T13:00:00Z");
        assert.equal(storedSlot.location.id, sideRoom.id);

        // Conflict detection must see the moved window including its setup
        // and teardown margins: this candidate only brushes the margins.
        const conflicting = await jsonApi.post(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-02T14:32:00Z",
                        endsAt: "2027-11-02T15:00:00Z",
                        setupTime: "PT0S",
                        teardownTime: "PT0S",
                    },
                    relationships: {
                        session: { data: { type: "session", id: sessionId } },
                        location: { data: { type: "location", id: sideRoom.id } },
                    },
                },
            },
        );
        await expectJsonApiError(conflicting, 409, "already_occupied");

        // Touching windows are not a conflict: starting exactly at the
        // teardown edge must succeed.
        const backToBack = await jsonApi.post(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-02T14:35:00Z",
                        endsAt: "2027-11-02T15:00:00Z",
                        setupTime: "PT0S",
                        teardownTime: "PT0S",
                    },
                    relationships: {
                        session: { data: { type: "session", id: sessionId } },
                        location: { data: { type: "location", id: sideRoom.id } },
                    },
                },
            },
        );
        assert.equal(backToBack.status, 201);
    });

    it("deletes a slot", async () => {
        const movableSlotId = await createSlot();

        const response = await jsonApi.delete(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots/${movableSlotId}`,
            managerToken,
        );

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Slot, { id: movableSlotId }), 0);
    });

    // Kept rather than dropped, so an accidental cancel does not cost the
    // organizer where the session was. Moving it is what the API refuses.
    it("keeps the draft slot when the session leaves a slottable state", async () => {
        const create = await jsonApi.post(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-01T09:00:00Z",
                        endsAt: "2027-11-01T10:00:00Z",
                        setupTime: "PT15M",
                        teardownTime: "PT15M",
                    },
                    relationships: {
                        session: { data: { type: "session", id: sessionId } },
                        location: { data: { type: "location", id: locationId } },
                    },
                },
            },
        );

        assert.equal(create.status, 201);
        const createDocument = (await create.json()) as { data: { id: string } };
        const slotId = createDocument.data.id;

        const revert = await jsonApi.post(
            `/editions/${editionId}/sessions/${sessionId}/transitions`,
            managerToken,
            {
                data: {
                    type: "session_transition",
                    attributes: { state: "submitted" },
                },
            },
        );

        assert.equal(revert.status, 201);
        assert.equal(await em.fork().count(Slot, { id: slotId }), 1);

        const move = await jsonApi.patch(
            `/editions/${editionId}/schedules/${draftScheduleId}/slots/${slotId}`,
            managerToken,
            {
                data: {
                    type: "slot",
                    id: slotId,
                    attributes: {
                        startsAt: "2027-11-01T11:00:00Z",
                        endsAt: "2027-11-01T12:00:00Z",
                    },
                },
            },
        );

        await expectJsonApiError(move, 409, "session_not_slottable");
    });

    it("shows the integration published schedules only", async () => {
        await publishSchedule();

        const current = await showSchedule(integrationToken, "current");
        assert.equal(current.status, 200);
        const currentDocument = (await current.json()) as { data: { id: string } };
        assert.equal(currentDocument.data.id, draftScheduleId);

        // Publishing rolls the working draft forward, so the manager's latest
        // is the successor rather than the schedule just published.
        const managerLatest = await showSchedule(managerToken, "latest");
        assert.equal(managerLatest.status, 200);
        const managerLatestDocument = (await managerLatest.json()) as {
            data: { id: string; attributes: { publishedAt: string | null } };
        };
        assert.notEqual(managerLatestDocument.data.id, draftScheduleId);
        assert.equal(managerLatestDocument.data.attributes.publishedAt, null);

        const integrationDocument = (await (
            await showSchedule(integrationToken, "current")
        ).json()) as {
            data: { attributes: { preliminary: boolean } };
        };
        assert.equal(integrationDocument.data.attributes.preliminary, false);
    });

    // Each route means one schedule for everyone: current is the publication,
    // latest the draft.
    it("separates the publication from the draft for a user", async () => {
        await publishSchedule();

        const current = await showSchedule(managerToken, "current");
        assert.equal(current.status, 200);
        const currentDocument = (await current.json()) as {
            data: { id: string; attributes: { publishedAt: string | null } };
        };
        assert.equal(currentDocument.data.id, draftScheduleId);
        assert.notEqual(currentDocument.data.attributes.publishedAt, null);

        const latest = await showSchedule(managerToken, "latest");
        assert.equal(latest.status, 200);
        const latestDocument = (await latest.json()) as {
            data: { id: string; attributes: { publishedAt: string | null } };
        };
        assert.notEqual(latestDocument.data.id, currentDocument.data.id);
        assert.equal(latestDocument.data.attributes.publishedAt, null);
    });

    describe("published slot linkage", () => {
        let linkageEditionId: string;
        let confirmedSlotId: string;
        let draftSlotId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Slot Linkage Edition" });
            const sessionType = SessionType.default(ref(edition));
            const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
            schedule.publish(edition, Temporal.Now.instant());
            const linkageVenue = buildVenue(edition, { name: "Linkage Venue" });
            const location = new Location({
                position: 2,
                name: "Linkage Room",
                externalKey: null,
                edition: ref(edition),
                venue: ref(linkageVenue),
            });

            const confirmedSession = buildSession(edition, sessionType, {
                title: "Confirmed session",
            });
            confirmedSession.state = "confirmed";
            const draftSession = buildSession(edition, sessionType, { title: "Draft session" });

            const atHour = (hour: number) =>
                Temporal.Instant.from(`2027-11-02T${String(hour).padStart(2, "0")}:00:00Z`);

            const buildSlot = (session: Session, hour: number) =>
                new Slot({
                    startsAt: atHour(hour),
                    endsAt: atHour(hour + 1),
                    setupTime: Temporal.Duration.from({ minutes: 0 }),
                    teardownTime: Temporal.Duration.from({ minutes: 0 }),
                    schedule: ref(schedule),
                    session: ref(session),
                    location: ref(location),
                });

            const confirmedSlot = buildSlot(confirmedSession, 9);
            const draftSlot = buildSlot(draftSession, 7);

            // A host and answers on both sides, so hydrating the document
            // populates collections rather than walking empty ones. The
            // read-only guard only catches a change set the graph can produce.
            const speaker = new User({
                externalId: "linkage-speaker",
                displayName: "Linkage Speaker",
                emailAddress: "linkage@example.test",
            });
            const host = buildHost(edition, speaker);
            confirmedSession.hosts.add(host);

            const proposalField = new CustomField({
                position: 0,
                externalKey: "linkage-proposal",
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "boolean" },
                title: "Needs a projector?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            const hostField = new CustomField({
                position: 0,
                externalKey: "linkage-host",
                target: "per_host",
                requirement: "always_optional",
                options: { type: "boolean" },
                title: "Vegetarian?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            const sessionResponse = Response.sessionResponse(
                ref(proposalField),
                ref(confirmedSession),
                true,
            );
            const hostResponse = Response.hostResponse(ref(hostField), ref(host), true);

            await fork
                .persist([
                    edition,
                    sessionType,
                    schedule,
                    location,
                    confirmedSession,
                    draftSession,
                    confirmedSlot,
                    draftSlot,
                    speaker,
                    host,
                    proposalField,
                    hostField,
                    sessionResponse,
                    hostResponse,
                ])
                .flush();

            linkageEditionId = edition.id;
            confirmedSlotId = confirmedSlot.id;
            draftSlotId = draftSlot.id;
        });

        const readCurrentSlotIds = async (token: string): Promise<string[]> => {
            const response = await jsonApi.get(
                `/editions/${linkageEditionId}/schedules/current`,
                token,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: { relationships?: { slots?: { data: { id: string }[] } } };
            };

            return document.data.relationships?.slots?.data.map((slot) => slot.id) ?? [];
        };

        const readSlotIds = async (token: string): Promise<string[]> => {
            const response = await jsonApi.get(`/editions/${linkageEditionId}/schedules`, token);
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: { relationships?: { slots?: { data: { id: string }[] } } }[];
            };

            return document.data.flatMap(
                (resource) => resource.relationships?.slots?.data.map((slot) => slot.id) ?? [],
            );
        };

        // The adapter resolves a room's venue from the document alone, so
        // linkage without the resource would leave it with an id and no name.
        it("carries the venue of every location it serves", async () => {
            const response = await jsonApi.get(
                `/editions/${linkageEditionId}/schedules/current` +
                    "?include=slots.location,slots.location.venue",
                integrationToken,
            );

            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                included?: {
                    type: string;
                    id: string;
                    attributes?: Record<string, unknown>;
                    relationships?: { venue?: { data?: { type: string; id: string } } };
                }[];
            };

            const included = document.included ?? [];
            const location = included.find((resource) => resource.type === "location");
            assert.ok(location);

            const linkage = location.relationships?.venue?.data;
            assert.ok(linkage);
            assert.equal(linkage.type, "venue");

            const venue = included.find(
                (resource) => resource.type === "venue" && resource.id === linkage.id,
            );
            assert.ok(venue, "the venue a location names must be served with it");
            assert.equal(venue.attributes?.name, "Linkage Venue");
        });

        // The read runs in a read-only transaction, so MikroORM's unconditional
        // post-callback flush turns any change set into a 25006 and the request
        // fails. A 200 here is therefore the assertion that hydrating the whole
        // document dirties nothing.
        it("builds the whole document without writing", async () => {
            const response = await jsonApi.get(
                `/editions/${linkageEditionId}/schedules/current` +
                    "?include=slots.location,slots.session.track,slots.session.sessionType" +
                    ",slots.session.responses.customField,slots.session.hosts.responses.customField",
                integrationToken,
            );

            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: { meta?: Record<string, unknown> };
                included?: { type: string; attributes?: Record<string, unknown> }[];
            };

            // Proof the flush had a populated graph to walk rather than an
            // empty one: hosts and responses are the collections whose
            // hydration propagates to an inverse side.
            const types = new Set((document.included ?? []).map((resource) => resource.type));
            assert.ok(types.has("slot"));
            assert.ok(types.has("session"));
            assert.ok(types.has("host"));
            assert.ok(types.has("response"));
            assert.ok(types.has("custom_field"));

            // Hosts reach an integration only through this document, so this
            // is the one place the email narrowing is observable.
            const hosts = (document.included ?? []).filter((resource) => resource.type === "host");
            assert.ok(hosts.every((host) => host.attributes?.emailAddress === undefined));
        });

        // A conditional miss finds the schedule bare first, which leaves it in
        // the identity map unpopulated. The full read has to re-query rather
        // than hand back that partial entity, or the document loses its slots.
        it("rebuilds the whole document after a validator misses", async () => {
            const url =
                `/editions/${linkageEditionId}/schedules/current` +
                "?include=slots.location,slots.session.track,slots.session.sessionType" +
                ",slots.session.responses.customField,slots.session.hosts.responses.customField";

            const unconditional = await jsonApi.get(url, integrationToken);
            assert.equal(unconditional.status, 200);
            const expected = (await unconditional.json()) as unknown;

            const missed = await jsonApi
                .get(url, integrationToken)
                .header("if-none-match", 'W/"00000000-0000-7000-8000-000000000000:999"');
            assert.equal(missed.status, 200);

            assert.deepEqual(await missed.json(), expected);
        });

        it("hides the submission form configuration on a session type", async () => {
            const readSessionType = async (token: string): Promise<Record<string, unknown>> => {
                const response = await jsonApi.get(
                    `/editions/${linkageEditionId}/schedules/current?include=slots.session.sessionType`,
                    token,
                );
                assert.equal(response.status, 200);
                const document = (await response.json()) as {
                    included?: { type: string; attributes?: Record<string, unknown> }[];
                };
                const sessionType = document.included?.find(
                    (resource) => resource.type === "session_type",
                );
                assert.ok(sessionType?.attributes);

                return sessionType.attributes;
            };

            const forIntegration = await readSessionType(integrationToken);
            assert.equal(forIntegration.defaultDuration, undefined);
            assert.equal(forIntegration.selectionDefault, undefined);
            assert.ok(forIntegration.name);

            const forManager = await readSessionType(managerToken);
            assert.ok(forManager.defaultDuration);
            assert.equal(forManager.selectionDefault, true);
        });

        it("keeps slots of unconfirmed sessions out of the integration's linkage", async () => {
            // Ids alone would tell an integration how many slots a published
            // schedule holds for sessions it cannot read.
            assert.deepEqual(await readCurrentSlotIds(integrationToken), [confirmedSlotId]);
        });

        it("serves the organizing team every slot of the same schedule", async () => {
            const slotIds = await readSlotIds(managerToken);

            assert.ok(slotIds.includes(confirmedSlotId));
            assert.ok(slotIds.includes(draftSlotId));
        });

        // The identifiers are one per slot per schedule, so a client drawing a
        // picker out of this list pays for the whole program to render a few
        // dates. Naming fields is what stops them being read at all, which is
        // why this asserts on the document rather than on a query count.
        it("leaves the slots out for a caller that names its fields", async () => {
            const response = await jsonApi.get(
                `/editions/${linkageEditionId}/schedules?fields%5Bschedule%5D=publishedAt`,
                managerToken,
            );
            assert.equal(response.status, 200);

            const document = (await response.json()) as {
                data: {
                    attributes: Record<string, unknown>;
                    relationships?: Record<string, unknown>;
                }[];
            };

            assert.ok(document.data.length > 0);

            for (const resource of document.data) {
                assert.deepEqual(Object.keys(resource.attributes), ["publishedAt"]);
                assert.equal(resource.relationships, undefined);
            }
        });
    });

    describe("document shape", () => {
        let documentEditionId: string;

        type ScheduleDocument = {
            data: {
                meta?: Record<string, unknown>;
                attributes?: Record<string, unknown>;
                relationships?: Record<string, unknown>;
            };
            included?: {
                type: string;
                attributes?: Record<string, unknown>;
                meta?: Record<string, unknown>;
            }[];
        };

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Document Edition" });
            const sessionType = SessionType.default(ref(edition));
            const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
            schedule.publish(edition, Temporal.Now.instant());

            await fork.persist([edition, sessionType, schedule]).flush();
            documentEditionId = edition.id;
        });

        const readCurrent = async (token: string, query = ""): Promise<ScheduleDocument> => {
            const response = await jsonApi.get(
                `/editions/${documentEditionId}/schedules/current${query}`,
                token,
            );
            assert.equal(response.status, 200);

            return (await response.json()) as ScheduleDocument;
        };

        const readEdition = (document: ScheduleDocument) =>
            document.included?.find((resource) => resource.type === "edition");

        // A consumer cannot interpret a single slot instant without the
        // edition's timeZone, so it is in the document whether asked for or not.
        it("includes the edition without being asked", async () => {
            const document = await readCurrent(integrationToken);

            assert.ok(Object.keys(document.data.relationships ?? {}).includes("edition"));
            assert.equal(readEdition(document)?.attributes?.timeZone, "Europe/Berlin");
        });

        // The ETag is the whole freshness contract; a revision in the body
        // would invite consumers to compare numbers instead.
        it("exposes no revision", async () => {
            const document = await readCurrent(integrationToken);

            assert.equal(document.data.meta, undefined);
        });

        it("hides the submission form configuration from an integration", async () => {
            const integrationEdition = readEdition(await readCurrent(integrationToken));
            assert.equal(integrationEdition?.attributes?.sessionFieldOptions, undefined);
            assert.equal(integrationEdition?.attributes?.profileFieldOptions, undefined);
            assert.equal(integrationEdition?.attributes?.timeZone, "Europe/Berlin");

            const managerEdition = readEdition(await readCurrent(managerToken));
            assert.ok(managerEdition?.attributes?.sessionFieldOptions);
            assert.ok(managerEdition?.attributes?.profileFieldOptions);
        });

        it("leaves the edition's write counter out for an integration", async () => {
            const integrationEdition = readEdition(await readCurrent(integrationToken));
            assert.ok(integrationEdition);
            assert.equal(integrationEdition.meta, undefined);
            assert.equal(
                typeof readEdition(await readCurrent(managerToken))?.meta?.version,
                "number",
            );
        });

        it("ignores a fieldset that requests the form configuration", async () => {
            const document = await readCurrent(
                integrationToken,
                "?fields[edition]=sessionFieldOptions",
            );

            expectNoAttributes([readEdition(document)]);
        });
    });

    describe("conditional requests", () => {
        let conditionalEditionId: string;
        let currentId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Conditional Edition" });
            const sessionType = SessionType.default(ref(edition));

            const superseded = new Schedule({ edition: ref(edition), sequence: 1 });
            superseded.publish(edition, Temporal.Instant.from("2027-10-01T09:00:00Z"));

            const current = new Schedule({ edition: ref(edition), sequence: 2 });
            current.publish(edition, Temporal.Instant.from("2027-10-02T09:00:00Z"));

            await fork.persist([edition, sessionType, superseded, current]).flush();

            conditionalEditionId = edition.id;
            currentId = current.id;
        });

        const fetchValidator = async (): Promise<string> => {
            const response = await readCurrent(integrationToken);
            assert.equal(response.status, 200);
            const validator = response.headers.get("etag");
            assert.ok(validator);

            return validator;
        };

        const bumpCounter = () =>
            em.fork().transactional(async (em) => {
                const edition = await em.findOneOrFail(Edition, conditionalEditionId);
                await bumpEditionRevision(em, edition);
            });

        const readCurrent = (token: string, ifNoneMatch?: string) => {
            const request = jsonApi.get(
                `/editions/${conditionalEditionId}/schedules/current`,
                token,
            );

            return ifNoneMatch === undefined
                ? request
                : request.header("if-none-match", ifNoneMatch);
        };

        it("answers with an opaque weak validator", async () => {
            const validator = await fetchValidator();

            assert.match(validator, /^W\/"[0-9a-f]{64}"$/);
        });

        it("answers 304 without a body when the validator still holds", async () => {
            const validator = await fetchValidator();
            const response = await readCurrent(integrationToken, validator);

            assert.equal(response.status, 304);
            assert.equal(response.headers.get("etag"), validator);
            assert.equal((await response.text()).length, 0);
            // A poller sees mostly these, and a 304 has no body to carry a
            // version in, which is why the contract version is a header.
            assert.equal(response.headers.get("Eventail-Contract-Version"), "2");
        });

        it("lets an integration store the validator it was given", async () => {
            const first = await readCurrent(integrationToken);
            assert.equal(first.headers.get("cache-control"), "private, no-cache");

            const conditional = await readCurrent(integrationToken, await fetchValidator());
            assert.equal(conditional.status, 304);
            assert.equal(conditional.headers.get("cache-control"), "private, no-cache");
        });

        it("answers 304 for a validator stripped of its weak marker", async () => {
            const validator = await fetchValidator();
            const response = await readCurrent(integrationToken, validator.replace(/^W\//, ""));

            assert.equal(response.status, 304);
        });

        it("answers 304 for a validator inside a list", async () => {
            const validator = await fetchValidator();
            const response = await readCurrent(
                integrationToken,
                `W/"${"0".repeat(64)}", ${validator}`,
            );

            assert.equal(response.status, 304);
        });

        it("answers 304 for a wildcard", async () => {
            const response = await readCurrent(integrationToken, "*");

            assert.equal(response.status, 304);
        });

        it("answers 200 with a fresh validator when the counter moved", async () => {
            const stale = await fetchValidator();
            await bumpCounter();

            const response = await readCurrent(integrationToken, stale);

            assert.equal(response.status, 200);
            const fresh = response.headers.get("etag");
            assert.ok(fresh);
            assert.notEqual(fresh, stale);
        });

        it("gives a manager no validator and never answers 304", async () => {
            const plain = await readCurrent(managerToken);
            assert.equal(plain.status, 200);
            assert.equal(plain.headers.get("etag"), null);

            const conditional = await readCurrent(managerToken, await fetchValidator());
            assert.equal(conditional.status, 200);
            const document = (await conditional.json()) as { data: { id: string } };
            assert.equal(document.data.id, currentId);
        });

        // The split between the manager and integration representations of
        // one URL is keyed on Authorization; a cache must be told.
        it("varies on authorization for every response shape", async () => {
            const integrationResponse = await readCurrent(integrationToken);
            assert.equal(integrationResponse.status, 200);
            assert.match(integrationResponse.headers.get("vary") ?? "", /authorization/i);

            const notModified = await readCurrent(integrationToken, await fetchValidator());
            assert.equal(notModified.status, 304);
            assert.match(notModified.headers.get("vary") ?? "", /authorization/i);

            const managerResponse = await readCurrent(managerToken);
            assert.equal(managerResponse.status, 200);
            assert.match(managerResponse.headers.get("vary") ?? "", /authorization/i);
        });

        it("resolves current by sequence even when timestamps disagree", async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Tiebreak Edition" });
            const sessionType = SessionType.default(ref(edition));
            const older = new Schedule({ edition: ref(edition), sequence: 1 });
            older.publish(edition, Temporal.Instant.from("2027-10-02T09:00:00Z"));
            const newer = new Schedule({ edition: ref(edition), sequence: 2 });
            newer.publish(edition, Temporal.Instant.from("2027-10-01T09:00:00Z"));
            await fork.persist([edition, sessionType, older, newer]).flush();

            const response = await jsonApi.get(
                `/editions/${edition.id}/schedules/current`,
                integrationToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as { data: { id: string } };
            assert.equal(document.data.id, newer.id);
        });

        it("puts no validator on the draft route", async () => {
            const response = await jsonApi.get(
                `/editions/${conditionalEditionId}/schedules/latest`,
                managerToken,
            );

            assert.equal(response.status, 200);
            assert.equal(response.headers.get("etag"), null);
        });
    });
});
