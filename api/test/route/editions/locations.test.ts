import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Location } from "../../../src/entity/Location.js";
import { LocationAvailability } from "../../../src/entity/LocationAvailability.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { Venue } from "../../../src/entity/Venue.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildSession, buildTeamMember, buildVenue } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type LocationAttributes = { name: string; externalKey: string | null };

type AvailabilityBlock = {
    type: "location_availability";
    lid: string;
    attributes: { startsAt: string; endsAt: string };
};

type LocationDocument = {
    data: {
        type: "location";
        id?: string;
        attributes: LocationAttributes;
        relationships: {
            venue: { data: { type: "venue"; id: string } };
            availabilities: { data: { type: string; lid: string }[] };
        };
    };
    included: AvailabilityBlock[];
};

type LocationDocumentValues = {
    id?: string;
    attributes: LocationAttributes;
    blocks?: AvailabilityBlock[];
};

type LocationResponseDocument = {
    data: {
        id: string;
        type: string;
        attributes: LocationAttributes;
        relationships?: Record<string, unknown>;
    };
    included?: { type: string; id: string; attributes: { startsAt: string; endsAt: string } }[];
};

type LocationListDocument = {
    data: LocationResponseDocument["data"][];
    included?: LocationResponseDocument["included"];
};

type ErrorWithMeta = {
    errors: { code: string; meta?: { lid?: string } }[];
};

const block = (lid: string, startsAt: string, endsAt: string): AvailabilityBlock => ({
    type: "location_availability",
    lid,
    attributes: { startsAt, endsAt },
});

const includedTimes = (document: LocationResponseDocument): [string, string][] =>
    (document.included ?? [])
        .filter((resource) => resource.type === "location_availability")
        .map((resource) => [resource.attributes.startsAt, resource.attributes.endsAt]);

describe("locations", () => {
    let managerToken: string;
    let hostToken: string;
    let editionId: string;
    let sessionTypeId: string;
    let locationId: string;
    let venueId: string;

    const locationDocument = ({
        id,
        attributes,
        blocks = [],
    }: LocationDocumentValues): LocationDocument => ({
        data: {
            type: "location",
            ...(id === undefined ? {} : { id }),
            attributes,
            relationships: {
                venue: { data: { type: "venue", id: venueId } },
                availabilities: { data: blocks.map(({ type, lid }) => ({ type, lid })) },
            },
        },
        included: blocks,
    });

    before(async () => {
        [managerToken, hostToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });

        const edition = buildEdition({ name: "Location Edition" });
        const sessionType = SessionType.default(ref(edition));
        const venue = buildVenue(edition);
        const location = new Location({
            position: 0,
            name: "Main Hall",
            externalKey: "main-hall",
            edition: ref(edition),
            venue: ref(venue),
        });

        await fork.persist([manager, team, host, edition, sessionType, venue, location]).flush();

        editionId = edition.id;
        sessionTypeId = sessionType.id;
        locationId = location.id;
        venueId = venue.id;
    });

    it("creates a location", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({ attributes: { name: "Room A", externalKey: "room-a" } }),
        );

        assert.equal(response.status, 201);
        const document = await response.json<LocationResponseDocument>();
        assert.equal(document.data.type, "location");
        // Position 1, because the edition already has the room the fixture made:
        // a new one goes to the right of what is there.
        assert.deepEqual(document.data.attributes, {
            name: "Room A",
            externalKey: "room-a",
            position: 1,
        });
        assert.deepEqual(includedTimes(document), []);
    });

    it("creates a location with availability", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({
                attributes: { name: "Room A", externalKey: "room-a" },
                blocks: [
                    block("morning", "2027-10-01T07:00:00Z", "2027-10-01T10:00:00Z"),
                    block("afternoon", "2027-10-01T12:00:00Z", "2027-10-01T15:00:00Z"),
                ],
            }),
        );

        assert.equal(response.status, 201);
        const document = await response.json<LocationResponseDocument>();
        assert.deepEqual(includedTimes(document), [
            ["2027-10-01T07:00:00Z", "2027-10-01T10:00:00Z"],
            ["2027-10-01T12:00:00Z", "2027-10-01T15:00:00Z"],
        ]);
        assert.equal(
            await em.fork().count(LocationAvailability, { location: document.data.id }),
            2,
        );
    });

    it("merges availability that overlaps or touches", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({
                attributes: { name: "Room A", externalKey: "room-a" },
                blocks: [
                    block("overlapping", "2027-10-01T09:00:00Z", "2027-10-01T12:00:00Z"),
                    block("morning", "2027-10-01T07:00:00Z", "2027-10-01T10:00:00Z"),
                    block("touching", "2027-10-01T12:00:00Z", "2027-10-01T15:00:00Z"),
                ],
            }),
        );

        assert.equal(response.status, 201);
        const document = await response.json<LocationResponseDocument>();
        assert.deepEqual(includedTimes(document), [
            ["2027-10-01T07:00:00Z", "2027-10-01T15:00:00Z"],
        ]);
    });

    it("refuses availability reaching outside the edition", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({
                attributes: { name: "Room A", externalKey: "room-a" },
                blocks: [
                    block("inside", "2027-10-01T07:00:00Z", "2027-10-01T10:00:00Z"),
                    block("early", "2027-09-30T20:00:00Z", "2027-10-01T07:00:00Z"),
                ],
            }),
        );

        assert.equal(response.status, 422);
        const document = await response.json<ErrorWithMeta>();
        assert.equal(document.errors[0].code, "outside_edition");
        assert.equal(document.errors[0].meta?.lid, "early");
        assert.equal(await em.fork().count(Location, { edition: editionId }), 1);
    });

    it("refuses availability that does not start on a whole minute", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({
                attributes: { name: "Room A", externalKey: "room-a" },
                blocks: [block("seconds", "2027-10-01T07:00:30Z", "2027-10-01T10:00:00Z")],
            }),
        );

        assert.equal(response.status, 422);
        const document = await response.json<ErrorWithMeta>();
        assert.equal(document.errors[0].code, "sub_minute_interval");
        assert.equal(document.errors[0].meta?.lid, "seconds");
    });

    it("refuses availability that ends before it starts", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            locationDocument({
                attributes: { name: "Room A", externalKey: "room-a" },
                blocks: [block("reversed", "2027-10-01T15:00:00Z", "2027-10-01T07:00:00Z")],
            }),
        );

        assert.equal(response.status, 422);
        const document = await response.json<ErrorWithMeta>();
        assert.equal(document.errors[0].code, "reversed_interval");
        assert.equal(document.errors[0].meta?.lid, "reversed");
    });

    it("lists the locations of an edition", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/locations`, managerToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { id: string; attributes: { name: string } }[];
        };
        assert.deepEqual(
            document.data.map((resource) => resource.id),
            [locationId],
        );
        assert.equal(document.data[0].attributes.name, "Main Hall");
    });

    it("patches a location", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
            locationDocument({
                id: locationId,
                attributes: { name: "Room B", externalKey: null },
            }),
        );

        assert.equal(response.status, 200);
        const document = await response.json<LocationResponseDocument>();
        assert.equal(document.data.id, locationId);
        assert.equal(document.data.attributes.name, "Room B");
        assert.equal(document.data.attributes.externalKey, null);
    });

    it("replaces every availability the location had", async () => {
        const fork = em.fork();
        const existing = new LocationAvailability({
            startsAt: Temporal.Instant.from("2027-10-01T07:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T15:00:00Z"),
            location: ref(fork.getReference(Location, locationId)),
        });

        await fork.persist(existing).flush();

        const response = await jsonApi.patch(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
            locationDocument({
                id: locationId,
                attributes: { name: "Main Hall", externalKey: "main-hall" },
                blocks: [block("second-day", "2027-10-02T07:00:00Z", "2027-10-02T10:00:00Z")],
            }),
        );

        assert.equal(response.status, 200);
        const document = await response.json<LocationResponseDocument>();
        assert.deepEqual(includedTimes(document), [
            ["2027-10-02T07:00:00Z", "2027-10-02T10:00:00Z"],
        ]);

        const stored = await em
            .fork()
            .find(LocationAvailability, { location: locationId }, { orderBy: { startsAt: "asc" } });
        assert.deepEqual(
            stored.map((availability) => availability.startsAt.toString()),
            ["2027-10-02T07:00:00Z"],
        );
    });

    it("empties the availability of a location asked for none", async () => {
        const fork = em.fork();
        const existing = new LocationAvailability({
            startsAt: Temporal.Instant.from("2027-10-01T07:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T15:00:00Z"),
            location: ref(fork.getReference(Location, locationId)),
        });

        await fork.persist(existing).flush();

        const response = await jsonApi.patch(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
            locationDocument({
                id: locationId,
                attributes: { name: "Main Hall", externalKey: "main-hall" },
            }),
        );

        assert.equal(response.status, 200);
        assert.equal(await em.fork().count(LocationAvailability, { location: locationId }), 0);
    });

    it("keeps availability from callers below manager", async () => {
        const fork = em.fork();

        await fork
            .persist(
                new LocationAvailability({
                    startsAt: Temporal.Instant.from("2027-10-01T07:00:00Z"),
                    endsAt: Temporal.Instant.from("2027-10-01T15:00:00Z"),
                    location: ref(fork.getReference(Location, locationId)),
                }),
            )
            .flush();

        const path = `/editions/${editionId}/locations`;
        const query = "include=availabilities";

        const asManager = await jsonApi.get(`${path}/${locationId}?${query}`, managerToken);
        assert.equal(asManager.status, 200);
        const managerDocument = await asManager.json<LocationResponseDocument>();
        assert.deepEqual(includedTimes(managerDocument), [
            ["2027-10-01T07:00:00Z", "2027-10-01T15:00:00Z"],
        ]);

        const asHost = await jsonApi.get(`${path}/${locationId}?${query}`, hostToken);
        assert.equal(asHost.status, 200);
        const hostDocument = await asHost.json<LocationResponseDocument>();
        assert.deepEqual(includedTimes(hostDocument), []);
        assert.equal(hostDocument.data.relationships?.availabilities, undefined);

        const listedByHost = await jsonApi.get(`${path}?${query}`, hostToken);
        assert.equal(listedByHost.status, 200);
        const listDocument = await listedByHost.json<LocationListDocument>();
        assert.deepEqual(listDocument.included ?? [], []);
        assert.equal(listDocument.data[0].relationships?.availabilities, undefined);
    });

    const foreignVenueDocument = (foreignVenueId: string, id?: string): unknown => ({
        data: {
            type: "location",
            ...(id === undefined ? {} : { id }),
            attributes: { name: "Elsewhere", externalKey: null },
            relationships: {
                venue: { data: { type: "venue", id: foreignVenueId } },
                availabilities: { data: [] },
            },
        },
    });

    const buildForeignVenue = async (): Promise<string> => {
        const fork = em.fork();
        const otherEdition = buildEdition({ name: "Other Location Edition" });
        const foreign = buildVenue(otherEdition, { externalKey: "foreign-venue" });
        await fork.persist([otherEdition, foreign]).flush();

        return foreign.id;
    };

    it("refuses a venue of another edition on create", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/locations`,
            managerToken,
            foreignVenueDocument(await buildForeignVenue()),
        );

        assert.equal(response.status, 404);
        assert.equal(await em.fork().count(Location, { edition: editionId }), 1);
    });

    it("refuses a venue of another edition on update", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
            foreignVenueDocument(await buildForeignVenue(), locationId),
        );

        assert.equal(response.status, 404);
        const stored = await em.fork().findOneOrFail(Location, locationId);
        assert.equal(stored.venue.id, venueId);
    });

    it("moves the revision when a location changes venue", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const second = buildVenue(edition, { position: 1, externalKey: "second-venue" });
        await fork.persist(second).flush();

        const readRevision = async (): Promise<number> =>
            (await em.fork().findOne(EditionRevision, { editionId }))?.revision ?? 0;
        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
            {
                data: {
                    type: "location",
                    id: locationId,
                    attributes: { name: "Main Hall", externalKey: "main-hall" },
                    relationships: {
                        venue: { data: { type: "venue", id: second.id } },
                        availabilities: { data: [] },
                    },
                },
            },
        );

        assert.equal(response.status, 200);
        assert.equal(await readRevision(), before + 1);
        assert.equal((await em.fork().findOneOrFail(Location, locationId)).venue.id, second.id);
    });

    it("refuses to delete a location still used by a slot", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = await fork.findOneOrFail(SessionType, sessionTypeId);
        const slottedLocation = new Location({
            position: 1,
            name: "Slotted Room",
            externalKey: null,
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
        const session = buildSession(edition, sessionType, { title: "Slotted Session" });
        const slot = new Slot({
            startsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T10:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 15 }),
            teardownTime: Temporal.Duration.from({ minutes: 15 }),
            schedule: ref(schedule),
            session: ref(session),
            location: ref(slottedLocation),
        });

        await fork.persist([slottedLocation, schedule, session, slot]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/locations/${slottedLocation.id}`,
            managerToken,
        );

        await expectJsonApiError(response, 409, "entity_in_use");
        assert.equal(await em.fork().count(Location, { id: slottedLocation.id }), 1);
    });

    it("deletes a location", async () => {
        const response = await jsonApi.delete(
            `/editions/${editionId}/locations/${locationId}`,
            managerToken,
        );

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Location, { id: locationId }), 0);
    });

    // An edition settling its dates holds the edition and writes the same
    // availability rows this delete cascades into, so the delete has to wait
    // for it rather than meet it among those rows.
    it("waits for a writer holding the edition", async () => {
        const fork = em.fork();
        const availability = new LocationAvailability({
            startsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T17:00:00Z"),
            location: ref(fork.getReference(Location, locationId)),
        });

        await fork.persist(availability).flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOne(Edition, editionId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        // Without this the delete can finish before the lock is taken, leaving
        // nothing to block on and no contention to prove.
        await taken.promise;

        const remove = send(
            jsonApi.delete(`/editions/${editionId}/locations/${locationId}`, managerToken),
        );

        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    assert.equal(
                        await em.fork().count(LocationAvailability, { id: availability.id }),
                        1,
                    );
                },
            },
        );

        await holding;
        const response = await remove;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(LocationAvailability, { id: availability.id }), 0);
    });

    it("reorders the columns a schedule draws", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const second = new Location({
            position: 1,
            name: "Second Room",
            externalKey: "second-room",
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        const third = new Location({
            position: 2,
            name: "Third Room",
            externalKey: "third-room",
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        await fork.persist([second, third]).flush();

        // Reversed, so every one of the three has to move at once.
        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/locations`,
            managerToken,
            {
                data: [third, second, { id: locationId }].map(({ id }) => ({
                    type: "location",
                    id,
                })),
            },
        );

        assert.equal(response.status, 204);

        // Read back through the list, the order the position field exists to fix.
        const listed = await jsonApi.get(`/editions/${editionId}/locations`, managerToken);
        const document = await listed.json<{ data: { id: string }[] }>();
        assert.deepEqual(
            document.data.map((location) => location.id),
            [third.id, second.id, locationId],
        );
    });

    it("moves the revision, since an integration draws the columns it is given", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const second = new Location({
            position: 1,
            name: "Revision Room",
            externalKey: "revision-room",
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        await fork.persist(second).flush();

        const readRevision = async (): Promise<number> =>
            (await em.fork().findOne(EditionRevision, { editionId }))?.revision ?? 0;
        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/locations`,
            managerToken,
            {
                data: [second, { id: locationId }].map(({ id }) => ({ type: "location", id })),
            },
        );
        assert.equal(response.status, 204);

        assert.equal(await readRevision(), before + 1);
    });

    it("refuses an order that does not name every location", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/locations`,
            managerToken,
            { data: [] },
        );

        await expectJsonApiError(response, 422, "incomplete_order");
    });
});
