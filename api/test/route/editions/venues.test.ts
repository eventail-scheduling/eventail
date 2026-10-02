import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Location } from "../../../src/entity/Location.js";
import { User } from "../../../src/entity/User.js";
import { Venue } from "../../../src/entity/Venue.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type VenueAttributes = { name: string; address: string | null; externalKey: string | null };

type VenueDocument = {
    data: {
        type: "venue";
        id?: string;
        attributes: VenueAttributes;
    };
};

type VenueResponseDocument = {
    data: {
        id: string;
        type: string;
        attributes: VenueAttributes & { position: number };
    };
};

const venueDocument = (id: string | undefined, attributes: VenueAttributes): VenueDocument => ({
    data: {
        type: "venue",
        ...(id === undefined ? {} : { id }),
        attributes,
    },
});

describe("venues", () => {
    let managerToken: string;
    let hostToken: string;
    let editionId: string;
    let venueId: string;

    before(async () => {
        [managerToken, hostToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        // Without a user row the token is refused for having no user at all,
        // so the test below would pass whatever role the gate demanded.
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const edition = buildEdition({ name: "Venue Edition" });
        const venue = new Venue({
            position: 0,
            name: "Main Venue",
            address: "1 Example Street",
            externalKey: "main-venue",
            edition: ref(edition),
        });

        await fork.persist([manager, team, host, edition, venue]).flush();

        editionId = edition.id;
        venueId = venue.id;
    });

    it("creates a venue", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/venues`,
            managerToken,
            venueDocument(undefined, {
                name: "Venue A",
                address: "2 Example Street",
                externalKey: "venue-a",
            }),
        );

        assert.equal(response.status, 201);
        const document = await response.json<VenueResponseDocument>();
        assert.equal(document.data.type, "venue");
        // Position 1, because the edition already has the venue the fixture
        // made: a new one goes after what is there.
        assert.deepEqual(document.data.attributes, {
            name: "Venue A",
            address: "2 Example Street",
            externalKey: "venue-a",
            position: 1,
        });
    });

    it("creates a venue without an address", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/venues`,
            managerToken,
            venueDocument(undefined, { name: "Outdoors", address: null, externalKey: null }),
        );

        assert.equal(response.status, 201);
        const document = await response.json<VenueResponseDocument>();
        assert.equal(document.data.attributes.address, null);
    });

    it("lists the venues of an edition", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/venues`, managerToken);

        assert.equal(response.status, 200);
        const document = await response.json<{
            data: { id: string; attributes: VenueAttributes }[];
        }>();
        assert.deepEqual(
            document.data.map((resource) => resource.id),
            [venueId],
        );
        assert.equal(document.data[0].attributes.name, "Main Venue");
    });

    it("serves a venue to a caller below manager", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/venues/${venueId}`, hostToken);

        assert.equal(response.status, 200);
        const document = await response.json<VenueResponseDocument>();
        assert.equal(document.data.attributes.name, "Main Venue");
    });

    it("refuses a write from a caller below manager", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/venues`,
            hostToken,
            venueDocument(undefined, { name: "Venue A", address: null, externalKey: null }),
        );

        assert.equal(response.status, 403);
        assert.equal(await em.fork().count(Venue, { edition: editionId }), 1);
    });

    it("patches a venue", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
            venueDocument(venueId, { name: "Venue B", address: null, externalKey: null }),
        );

        assert.equal(response.status, 200);
        const document = await response.json<VenueResponseDocument>();
        assert.equal(document.data.id, venueId);
        assert.equal(document.data.attributes.name, "Venue B");
        assert.equal(document.data.attributes.address, null);
        assert.equal(document.data.attributes.externalKey, null);

        const stored = await em.fork().findOneOrFail(Venue, venueId);
        assert.equal(stored.name, "Venue B");
        assert.equal(stored.address, null);
    });

    const readRevision = async (): Promise<number> =>
        (await em.fork().findOne(EditionRevision, { editionId }))?.revision ?? 0;

    it("moves the revision when a venue an integration reads changes", async () => {
        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
            venueDocument(venueId, {
                name: "Venue B",
                address: "1 Example Street",
                externalKey: "main-venue",
            }),
        );
        assert.equal(response.status, 200);

        assert.equal(await readRevision(), before + 1);
    });

    // The address reaches the integration's document as its own field, so a
    // fingerprint covering the name alone would leave this patch invisible.
    it("moves the revision when only the address changes", async () => {
        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
            venueDocument(venueId, {
                name: "Main Venue",
                address: "Somewhere else entirely",
                externalKey: "main-venue",
            }),
        );
        assert.equal(response.status, 200);

        assert.equal(await readRevision(), before + 1);
    });

    it("leaves the revision alone when nothing visible changed", async () => {
        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
            venueDocument(venueId, {
                name: "Main Venue",
                address: "1 Example Street",
                externalKey: "main-venue",
            }),
        );
        assert.equal(response.status, 200);

        assert.equal(await readRevision(), before);
    });

    it("deletes a venue", async () => {
        const response = await jsonApi.delete(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
        );

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Venue, { id: venueId }), 0);
    });

    it("refuses to delete a venue a location still names", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const location = new Location({
            position: 0,
            name: "Main Hall",
            externalKey: null,
            edition: ref(edition),
            venue: ref(fork.getReference(Venue, venueId)),
        });
        await fork.persist(location).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/venues/${venueId}`,
            managerToken,
        );

        await expectJsonApiError(response, 409, "entity_in_use");
        assert.equal(await em.fork().count(Venue, { id: venueId }), 1);
    });

    it("waits for a writer holding the edition", async () => {
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOne(Edition, editionId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const remove = send(
            jsonApi.delete(`/editions/${editionId}/venues/${venueId}`, managerToken),
        );

        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    assert.equal(await em.fork().count(Venue, { id: venueId }), 1);
                },
            },
        );

        await holding;
        const response = await remove;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Venue, { id: venueId }), 0);
    });

    it("reorders the venues of an edition", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const second = new Venue({
            position: 1,
            name: "Second Venue",
            address: null,
            externalKey: "second-venue",
            edition: ref(edition),
        });
        const third = new Venue({
            position: 2,
            name: "Third Venue",
            address: null,
            externalKey: "third-venue",
            edition: ref(edition),
        });
        await fork.persist([second, third]).flush();

        // Reversed, so a position is held by two venues part way through,
        // which is what the deferred unique is for.
        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/venues`,
            managerToken,
            {
                data: [third, second, { id: venueId }].map(({ id }) => ({ type: "venue", id })),
            },
        );

        assert.equal(response.status, 204);

        // Read back through the list, the order the position field exists to fix.
        const listed = await jsonApi.get(`/editions/${editionId}/venues`, managerToken);
        const document = await listed.json<{ data: { id: string }[] }>();
        assert.deepEqual(
            document.data.map((venue) => venue.id),
            [third.id, second.id, venueId],
        );
    });

    it("moves the revision on a reorder", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const second = new Venue({
            position: 1,
            name: "Revision Venue",
            address: null,
            externalKey: "revision-venue",
            edition: ref(edition),
        });
        await fork.persist(second).flush();

        const before = await readRevision();

        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/venues`,
            managerToken,
            {
                data: [second, { id: venueId }].map(({ id }) => ({ type: "venue", id })),
            },
        );
        assert.equal(response.status, 204);

        assert.equal(await readRevision(), before + 1);
    });

    it("refuses an order naming a venue of another edition", async () => {
        const fork = em.fork();
        const otherEdition = buildEdition({ name: "Other Venue Edition" });
        const foreign = new Venue({
            position: 0,
            name: "Foreign Venue",
            address: null,
            externalKey: "foreign-venue",
            edition: ref(otherEdition),
        });
        await fork.persist([otherEdition, foreign]).flush();

        // One id for one venue, so the count guard passes and only the lookup
        // of the edition's own venues refuses this.
        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/venues`,
            managerToken,
            { data: [{ type: "venue", id: foreign.id }] },
        );

        await expectJsonApiError(response, 422, "incomplete_order");
        assert.equal((await em.fork().findOneOrFail(Venue, foreign.id)).position, 0);
    });

    it("refuses an order that does not name every venue", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/relationships/venues`,
            managerToken,
            { data: [] },
        );

        await expectJsonApiError(response, 422, "incomplete_order");
    });
});
