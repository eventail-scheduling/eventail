import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import type { TestResponse } from "@taxum/testing";
import { Schedule } from "../../../src/entity/Schedule.js";
import { Slot } from "../../../src/entity/Slot.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildScheduleFixture,
    buildTeamMember,
    editionVersion,
    type ScheduleFixture,
    type ScheduleFixtureOptions,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type SettledSessionReport = {
    id: string;
    title: string;
    slotsLeft: number;
};

type SettledBody = {
    meta: { settled: { sessions: SettledSessionReport[] } };
};

describe("schedule reversion", () => {
    let managerToken: string;

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const { user: manager, team: managerTeam } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });

        await em.fork().persist([manager, managerTeam]).flush();
    });

    const buildFixture = (options: ScheduleFixtureOptions): Promise<ScheduleFixture> =>
        buildScheduleFixture(em, options);

    const createSlot = (
        fixture: ScheduleFixture,
        scheduleId: string,
        startsAt: string,
        endsAt: string,
    ): Promise<TestResponse> =>
        jsonApi.post(`/editions/${fixture.editionId}/schedules/${scheduleId}/slots`, managerToken, {
            data: {
                type: "slot",
                attributes: { startsAt, endsAt, setupTime: "PT0S", teardownTime: "PT0S" },
                relationships: {
                    session: { data: { type: "session", id: fixture.sessionId } },
                    location: { data: { type: "location", id: fixture.locationId } },
                },
            },
        });

    const publish = (fixture: ScheduleFixture, scheduleId: string): Promise<TestResponse> =>
        jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );

    const revert = (
        fixture: ScheduleFixture,
        scheduleId: string,
        startDateBecomes?: string,
    ): Promise<TestResponse> =>
        jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${scheduleId}/reversion`,
            managerToken,
            {
                data: {
                    type: "schedule_reversion",
                    attributes: {},
                    ...(startDateBecomes === undefined ? {} : { meta: { startDateBecomes } }),
                },
            },
        );

    const currentDraft = (fixture: ScheduleFixture): Promise<Schedule> =>
        em
            .fork()
            .findOneOrFail(
                Schedule,
                { edition: fixture.editionId, publishedAt: null },
                { populate: ["slots"] },
            );

    const moveEdition = async (
        fixture: ScheduleFixture,
        startDate: string,
        endDate: string,
        startDateBecomes?: string,
    ): Promise<TestResponse> =>
        jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: { startDate, endDate },
                meta: {
                    version: await editionVersion(em, fixture.editionId),
                    ...(startDateBecomes === undefined ? {} : { startDateBecomes }),
                },
            },
        });

    // Slot writes and a revert bump no revision because they touch the draft
    // alone, which only this refusal keeps true for a publication already
    // served to an integration.
    describe("a publication", () => {
        type Published = {
            fixture: ScheduleFixture;
            slotId: string;
        };

        const publishOneSlot = async (): Promise<Published> => {
            const fixture = await buildFixture({ name: "Published Edition" });
            assert.equal(
                (
                    await createSlot(
                        fixture,
                        fixture.scheduleId,
                        "2027-11-01T09:00:00Z",
                        "2027-11-01T10:00:00Z",
                    )
                ).status,
                201,
            );
            assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);
            const slot = await em.fork().findOneOrFail(Slot, { schedule: fixture.scheduleId });

            return { fixture, slotId: slot.id };
        };

        const publishedSlots = async (fixture: ScheduleFixture): Promise<string[]> =>
            (await em.fork().find(Slot, { schedule: fixture.scheduleId })).map(
                (slot) => `${slot.id}@${slot.startsAt.toString()}`,
            );

        it("refuses a new slot", async () => {
            const { fixture } = await publishOneSlot();
            const before = await publishedSlots(fixture);

            const response = await createSlot(
                fixture,
                fixture.scheduleId,
                "2027-11-02T09:00:00Z",
                "2027-11-02T10:00:00Z",
            );

            await expectJsonApiError(response, 409, "already_published");
            assert.deepEqual(await publishedSlots(fixture), before);
        });

        it("refuses to move one of its slots", async () => {
            const { fixture, slotId } = await publishOneSlot();
            const before = await publishedSlots(fixture);

            const response = await jsonApi.patch(
                `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/slots/${slotId}`,
                managerToken,
                {
                    data: {
                        type: "slot",
                        id: slotId,
                        attributes: { startsAt: "2027-11-01T08:00:00Z" },
                    },
                },
            );

            await expectJsonApiError(response, 409, "already_published");
            assert.deepEqual(await publishedSlots(fixture), before);
        });

        it("refuses to delete one of its slots", async () => {
            const { fixture, slotId } = await publishOneSlot();
            const before = await publishedSlots(fixture);

            const response = await jsonApi.delete(
                `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/slots/${slotId}`,
                managerToken,
            );

            await expectJsonApiError(response, 409, "already_published");
            assert.deepEqual(await publishedSlots(fixture), before);
        });

        it("refuses to be reverted onto itself", async () => {
            const { fixture } = await publishOneSlot();
            const before = await publishedSlots(fixture);

            await expectJsonApiError(
                await revert(fixture, fixture.scheduleId),
                409,
                "already_published",
            );
            assert.deepEqual(await publishedSlots(fixture), before);
        });
    });

    it("refills the draft from the current publication", async () => {
        const fixture = await buildFixture({ name: "Reverting Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-01T09:00:00Z",
                    "2027-11-01T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        assert.equal(draft.slots.length, 1);

        const spoiled = await createSlot(
            fixture,
            draft.id,
            "2027-11-02T09:00:00Z",
            "2027-11-02T10:00:00Z",
        );
        assert.equal(spoiled.status, 201);
        assert.equal((await currentDraft(fixture)).slots.length, 2);

        const response = await revert(fixture, draft.id);
        assert.equal(response.status, 200);

        const reverted = await currentDraft(fixture);
        assert.equal(reverted.slots.length, 1);
        assert.equal(reverted.id, draft.id, "the draft is refilled in place, not replaced");
        assert.equal(
            reverted.slots[0].startsAt.toString(),
            "2027-11-01T09:00:00Z",
            "the surviving slot is the published one",
        );
    });

    it("empties the draft when nothing has been published", async () => {
        const fixture = await buildFixture({ name: "Unpublished Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-01T09:00:00Z",
                    "2027-11-01T10:00:00Z",
                )
            ).status,
            201,
        );

        const response = await revert(fixture, fixture.scheduleId);
        assert.equal(response.status, 200);

        const body = (await response.json()) as SettledBody;
        assert.deepEqual(
            body.meta.settled.sessions,
            [],
            "the report covers the publication slots that could not follow, and there were none",
        );

        const draft = await currentDraft(fixture);
        assert.equal(draft.slots.length, 0);
        assert.equal(
            await em.fork().count(Slot, { schedule: fixture.scheduleId }),
            0,
            "the discarded slots are deleted rather than orphaned",
        );
    });

    it("leaves the publication it copies from untouched", async () => {
        const fixture = await buildFixture({ name: "Untouched Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-01T09:00:00Z",
                    "2027-11-01T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        assert.equal((await revert(fixture, draft.id)).status, 200);

        // The publication is what an integration and every viewer already read.
        const published = await em
            .fork()
            .findOneOrFail(Schedule, fixture.scheduleId, { populate: ["slots"] });
        assert.equal(published.slots.length, 1);
        assert.equal(published.slots[0].startsAt.toString(), "2027-11-01T09:00:00Z");
        assert.notEqual(published.publishedAt, null);
    });

    it("refuses to guess where the first day lands", async () => {
        const fixture = await buildFixture({ name: "Unanswered Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-01T09:00:00Z",
                    "2027-11-01T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        assert.equal(
            (await moveEdition(fixture, "2027-11-08", "2027-11-10", "2027-11-08")).status,
            200,
        );

        await expectJsonApiError(await revert(fixture, draft.id), 409, "start_date_required");
    });

    it("reanchors the publication onto the moved window when told where day one lands", async () => {
        const fixture = await buildFixture({ name: "Reanchored Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-01T09:00:00Z",
                    "2027-11-01T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        assert.equal(
            (await moveEdition(fixture, "2027-11-08", "2027-11-10", "2027-11-08")).status,
            200,
        );

        // The patch settles the draft to the same place the revert should land
        // it, so without spoiling the draft first this passes on a handler that
        // writes nothing at all.
        const spoiled = await createSlot(
            fixture,
            draft.id,
            "2027-11-09T09:00:00Z",
            "2027-11-09T10:00:00Z",
        );
        assert.equal(spoiled.status, 201);
        assert.equal((await currentDraft(fixture)).slots.length, 2);

        assert.equal((await revert(fixture, draft.id, "2027-11-08")).status, 200);

        const reverted = await currentDraft(fixture);
        assert.equal(reverted.slots.length, 1);
        // Berlin holds the same offset across both weeks, so the slot keeps its
        // local time and travels exactly the seven days the edition did.
        assert.equal(reverted.slots[0].startsAt.toString(), "2027-11-08T09:00:00Z");
    });

    it("drops a published slot the edition has since moved away from", async () => {
        const fixture = await buildFixture({ name: "Shrunken Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-03T09:00:00Z",
                    "2027-11-03T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        // Pulling the last day in drops the draft copy, while the publication
        // keeps the window it was announced for.
        assert.equal(
            (await moveEdition(fixture, "2027-11-01", "2027-11-02", "2027-11-01")).status,
            200,
        );
        assert.equal((await currentDraft(fixture)).slots.length, 0);

        const response = await revert(fixture, draft.id, "2027-11-01");
        assert.equal(response.status, 200);

        const reverted = await currentDraft(fixture);
        assert.equal(
            reverted.slots.length,
            0,
            "a slot outside the window may not reach the draft, which every slot writer refuses",
        );
        assert.equal(await em.fork().count(Slot, { schedule: draft.id }), 0);
    });

    it("names each session that lost a slot", async () => {
        const fixture = await buildFixture({ name: "Reported Edition" });
        assert.equal(
            (
                await createSlot(
                    fixture,
                    fixture.scheduleId,
                    "2027-11-03T09:00:00Z",
                    "2027-11-03T10:00:00Z",
                )
            ).status,
            201,
        );
        assert.equal((await publish(fixture, fixture.scheduleId)).status, 204);

        const draft = await currentDraft(fixture);
        assert.equal(
            (await moveEdition(fixture, "2027-11-01", "2027-11-02", "2027-11-01")).status,
            200,
        );

        const response = await revert(fixture, draft.id, "2027-11-01");
        assert.equal(response.status, 200);

        // The title comes off the slot's session, which is a bare reference
        // unless the publication is read with it populated, and an undefined
        // one leaves the document without the member its schema requires.
        const body = (await response.json()) as SettledBody;
        assert.equal(body.meta.settled.sessions.length, 1);
        assert.equal(body.meta.settled.sessions[0].id, fixture.sessionId);
        assert.equal(body.meta.settled.sessions[0].title, "Reported Edition Session");
        assert.equal(body.meta.settled.sessions[0].slotsLeft, 0);
    });
});
