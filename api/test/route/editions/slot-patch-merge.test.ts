import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { Edition } from "../../../src/entity/Edition.js";
import { Location } from "../../../src/entity/Location.js";
import { Slot } from "../../../src/entity/Slot.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildScheduleFixture, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("slot patch merge", () => {
    let managerToken: string;
    let editionId: string;
    let scheduleId: string;
    let slotId: string;
    let locationId: string;
    let otherLocationId: string;

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Slot Merge Managers",
        });
        await em.fork().persist([manager, team]).flush();

        const fixture = await buildScheduleFixture(em, { name: "Slot Merge Edition" });
        editionId = fixture.editionId;
        scheduleId = fixture.scheduleId;
        locationId = fixture.locationId;

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const otherLocation = new Location({
            position: 1,
            name: "Side Room",
            externalKey: null,
            edition: ref(edition),
        });
        await fork.persist(otherLocation).flush();
        otherLocationId = otherLocation.id;

        const created = await jsonApi.post(
            `/editions/${editionId}/schedules/${scheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-01T09:00:00Z",
                        endsAt: "2027-11-01T10:00:00Z",
                        setupTime: "PT5M",
                        teardownTime: "PT5M",
                    },
                    relationships: {
                        session: { data: { type: "session", id: fixture.sessionId } },
                        location: { data: { type: "location", id: locationId } },
                    },
                },
            },
        );
        assert.equal(created.status, 201);
        slotId = ((await created.json()) as { data: { id: string } }).data.id;
    });

    const patch = (data: Record<string, unknown>) =>
        jsonApi.patch(
            `/editions/${editionId}/schedules/${scheduleId}/slots/${slotId}`,
            managerToken,
            { data: { type: "slot", id: slotId, ...data } },
        );

    const storedSlot = (): Promise<Slot> =>
        em.fork().findOneOrFail(Slot, slotId, { populate: ["location"] });

    it("changes only the attributes it was sent", async () => {
        const response = await patch({ attributes: { endsAt: "2027-11-01T11:00:00Z" } });
        assert.equal(response.status, 200);

        const stored = await storedSlot();
        assert.equal(stored.endsAt.toString(), "2027-11-01T11:00:00Z");
        assert.equal(stored.startsAt.toString(), "2027-11-01T09:00:00Z");
        assert.equal(stored.setupTime.toString(), "PT5M");
    });

    it("leaves the location it was not sent, and repoints the one it was", async () => {
        assert.equal((await patch({ attributes: { setupTime: "PT10M" } })).status, 200);
        assert.equal((await storedSlot()).location.id, locationId);

        const moved = await patch({
            relationships: { location: { data: { type: "location", id: otherLocationId } } },
        });
        assert.equal(moved.status, 200);
        assert.equal((await storedSlot()).location.id, otherLocationId);
    });

    it("refuses an interval that ends before it starts", async () => {
        await expectJsonApiError(
            await patch({
                attributes: {
                    startsAt: "2027-11-01T12:00:00Z",
                    endsAt: "2027-11-01T11:00:00Z",
                },
            }),
            422,
            "reversed_interval",
        );
    });

    it("refuses one end that reverses the interval against the stored other", async () => {
        await expectJsonApiError(
            await patch({ attributes: { endsAt: "2027-11-01T08:00:00Z" } }),
            422,
            "reversed_interval",
        );

        assert.equal((await storedSlot()).endsAt.toString(), "2027-11-01T10:00:00Z");
    });

    it("accepts a body carrying nothing but the identity", async () => {
        const response = await patch({});
        assert.equal(response.status, 200);

        const stored = await storedSlot();
        assert.equal(stored.startsAt.toString(), "2027-11-01T09:00:00Z");
        assert.equal(stored.location.id, locationId);
    });

    it("refuses a created slot whose interval runs backwards", async () => {
        const fixture = await buildScheduleFixture(em, { name: "Backwards Edition" });
        const response = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/slots`,
            managerToken,
            {
                data: {
                    type: "slot",
                    attributes: {
                        startsAt: "2027-11-01T12:00:00Z",
                        endsAt: "2027-11-01T11:00:00Z",
                        setupTime: "PT0S",
                        teardownTime: "PT0S",
                    },
                    relationships: {
                        session: { data: { type: "session", id: fixture.sessionId } },
                        location: { data: { type: "location", id: fixture.locationId } },
                    },
                },
            },
        );

        await expectJsonApiError(response, 422, "reversed_interval");
    });
});
