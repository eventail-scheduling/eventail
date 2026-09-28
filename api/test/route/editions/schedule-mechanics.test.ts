import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref, wrap } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { isBefore } from "temporal-extra";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { Session } from "../../../src/entity/Session.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildHost,
    buildScheduleFixture as buildSharedScheduleFixture,
    buildTeamMember,
    editionVersion,
    fallBackWeek,
    type ScheduleFixture,
    type ScheduleFixtureOptions,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type SlotWindow = {
    startsAt: string;
    endsAt: string;
    setupTime?: string;
    teardownTime?: string;
};

describe("schedule mechanics", () => {
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

    const buildScheduleFixture = (options: ScheduleFixtureOptions): Promise<ScheduleFixture> =>
        buildSharedScheduleFixture(em, options);

    const createSlot = (
        fixture: ScheduleFixture,
        scheduleId: string,
        window: SlotWindow,
    ): Promise<TestResponse> =>
        jsonApi.post(`/editions/${fixture.editionId}/schedules/${scheduleId}/slots`, managerToken, {
            data: {
                type: "slot",
                attributes: {
                    startsAt: window.startsAt,
                    endsAt: window.endsAt,
                    setupTime: window.setupTime ?? "PT0S",
                    teardownTime: window.teardownTime ?? "PT0S",
                },
                relationships: {
                    session: { data: { type: "session", id: fixture.sessionId } },
                    location: { data: { type: "location", id: fixture.locationId } },
                },
            },
        });

    const patchEditionDates = async (
        fixture: ScheduleFixture,
        name: string,
        startDate: string,
        endDate: string,
        startDateBecomes = startDate,
    ): Promise<TestResponse> =>
        jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: {
                    name,
                    startDate,
                    endDate,
                    timeZone: "Europe/Berlin",
                    submissionDeadline: null,
                },
                meta: { version: await editionVersion(em, fixture.editionId), startDateBecomes },
            },
        });

    const patchEditionZone = async (
        fixture: ScheduleFixture,
        name: string,
        timeZone: string,
    ): Promise<TestResponse> =>
        jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: {
                    name,
                    startDate: "2026-03-28",
                    endDate: "2026-03-30",
                    timeZone,
                    submissionDeadline: null,
                },
                meta: { version: await editionVersion(em, fixture.editionId) },
            },
        });

    it("refuses to slot a session outside a slottable state", async () => {
        const fixture = await buildScheduleFixture({
            name: "Guard Edition",
            sessionState: "submitted",
        });

        const response = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });

        await expectJsonApiError(response, 409, "session_not_slottable");
    });

    it("scopes slot conflicts to a single schedule", async () => {
        const fixture = await buildScheduleFixture({ name: "Conflict Edition" });
        const contestedWindow: SlotWindow = {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
            setupTime: "PT15M",
            teardownTime: "PT15M",
        };

        const created = await createSlot(fixture, fixture.scheduleId, contestedWindow);
        assert.equal(created.status, 201);

        const publish = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(publish.status, 204);

        const successor = await em
            .fork()
            .findOneOrFail(
                Schedule,
                { edition: fixture.editionId, publishedAt: null },
                { populate: ["slots"] },
            );
        const copiedSlots = successor.slots.getItems();
        assert.equal(copiedSlots.length, 1);

        const dropCopy = await jsonApi.delete(
            `/editions/${fixture.editionId}/schedules/${successor.id}/slots/${copiedSlots[0].id}`,
            managerToken,
        );
        assert.equal(dropCopy.status, 204);

        // The published schedule still holds a slot at this window and
        // location, which must not count against the new draft.
        const reused = await createSlot(fixture, successor.id, contestedWindow);
        assert.equal(reused.status, 201);

        const overlapping = await createSlot(fixture, successor.id, {
            startsAt: "2027-11-02T09:30:00Z",
            endsAt: "2027-11-02T10:30:00Z",
        });
        await expectJsonApiError(overlapping, 409, "already_occupied");
    });

    // The request resolves its edition before the transaction opens, so an
    // edition shrinking in between would otherwise admit a slot onto a day the
    // edition no longer has, past the settle that would have removed it.
    it("measures a slot against the edition as it stands when the slot lands", async () => {
        const fixture = await buildScheduleFixture({ name: "Shrinking Race Edition" });

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, fixture.editionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            edition.endDate = Temporal.PlainDate.from("2027-11-02");
            em.persist(edition);
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const create = send(
            createSlot(fixture, fixture.scheduleId, {
                startsAt: "2027-11-03T09:00:00Z",
                endsAt: "2027-11-03T10:00:00Z",
            }),
        );

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;
        const response = await create;

        if (waitError !== null) {
            throw waitError;
        }

        await expectJsonApiError(response, 422, "outside_edition");
        assert.equal(await em.fork().count(Slot, { schedule: fixture.scheduleId }), 0);
    });

    it("keeps slots including their margins within the edition window", async () => {
        const fixture = await buildScheduleFixture({ name: "Bounds Edition" });

        // The edition runs in Europe/Berlin, so its window spans
        // 2027-10-31T23:00Z through 2027-11-03T23:00Z.
        const setupBeforeStart = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-10-31T23:00:00Z",
            endsAt: "2027-11-01T00:00:00Z",
            setupTime: "PT15M",
        });
        await expectJsonApiError(setupBeforeStart, 422, "outside_edition");

        const teardownAfterEnd = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-03T22:00:00Z",
            endsAt: "2027-11-03T23:00:00Z",
            teardownTime: "PT15M",
        });
        await expectJsonApiError(teardownAfterEnd, 422, "outside_edition");

        // The same windows without margins sit exactly on the boundaries.
        const atWindowStart = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-10-31T23:00:00Z",
            endsAt: "2027-11-01T00:00:00Z",
        });
        assert.equal(atWindowStart.status, 201);

        const atWindowEnd = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-03T22:00:00Z",
            endsAt: "2027-11-03T23:00:00Z",
        });
        assert.equal(atWindowEnd.status, 201);
    });

    it("includes session and host responses on the schedule", async () => {
        const fixture = await buildScheduleFixture({ name: "Responses Edition" });

        const fork = em.fork();
        const session = await fork.findOneOrFail(Session, fixture.sessionId);
        const hostUser = new User({
            externalId: "testhost",
            displayName: "Responseing Host",
            emailAddress: "responseing-host@example.test",
        });
        const edition = await session.edition.loadOrFail();
        const host = buildHost(edition, hostUser);
        session.hosts.add(host);
        const sessionCustomField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Session custom field",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(Edition, fixture.editionId),
        });
        const hostCustomField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Host custom field",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(Edition, fixture.editionId),
        });
        await fork
            .persist([
                hostUser,
                session,
                sessionCustomField,
                hostCustomField,
                Response.sessionResponse(ref(sessionCustomField), ref(session), "session value"),
                Response.hostResponse(ref(hostCustomField), ref(host), "host value"),
            ])
            .flush();

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);

        const response = await jsonApi.get(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}?include=slots.session.responses.customField,slots.session.hosts.responses.customField`,
            managerToken,
        );
        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            included?: { type: string; attributes: Record<string, unknown> }[];
        };
        const includedResponseValues = (document.included ?? [])
            .filter((resource) => resource.type === "response")
            .map((resource) => resource.attributes.value)
            .sort();
        assert.deepEqual(includedResponseValues, ["host value", "session value"]);
        const includedCustomFieldTitles = (document.included ?? [])
            .filter((resource) => resource.type === "custom_field")
            .map((resource) => resource.attributes.title)
            .sort();
        assert.deepEqual(includedCustomFieldTitles, ["Host custom field", "Session custom field"]);
    });

    it("serves the responses include on a schedule without slots", async () => {
        const fixture = await buildScheduleFixture({ name: "Empty Responses Edition" });
        const response = await jsonApi.get(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}?include=slots.session.responses.customField,slots.session.hosts.responses.customField`,
            managerToken,
        );

        assert.equal(response.status, 200);
        const document = (await response.json()) as { included?: { type: string }[] };
        assert.equal(
            (document.included ?? []).filter((resource) => resource.type === "response").length,
            0,
        );
    });

    it("stamps the window a schedule was published for and keeps it there", async () => {
        const fixture = await buildScheduleFixture({ name: "Stamped Edition" });

        const publish = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(publish.status, 204);

        const published = await em.fork().findOneOrFail(Schedule, fixture.scheduleId);
        assert.equal(published.startDate?.toString(), "2027-11-01");
        assert.equal(published.endDate?.toString(), "2027-11-03");
        assert.equal(published.timeZone, "Europe/Berlin");

        const patch = await patchEditionDates(
            fixture,
            "Stamped Edition",
            "2027-10-18",
            "2027-10-20",
        );
        assert.equal(patch.status, 200);

        const afterMove = await em.fork().findOneOrFail(Schedule, fixture.scheduleId);
        assert.equal(afterMove.startDate?.toString(), "2027-11-01");
        assert.equal(afterMove.endDate?.toString(), "2027-11-03");

        const draft = await em
            .fork()
            .findOneOrFail(Schedule, { edition: fixture.editionId, publishedAt: null });
        assert.equal(draft.startDate, null);
        assert.equal(draft.timeZone, null);
    });

    it("keeps a publication readable after the edition is retyped to another zone", async () => {
        const fixture = await buildScheduleFixture({ name: "Retyped Edition" });

        const publish = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(publish.status, 204);

        const retype = await jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: {
                    name: "Retyped Edition",
                    startDate: "2027-11-01",
                    endDate: "2027-11-03",
                    timeZone: "Europe/London",
                    submissionDeadline: null,
                },
                meta: { version: await editionVersion(em, fixture.editionId) },
            },
        });
        assert.equal(retype.status, 200);

        // Its slot instants were laid out under Berlin, so reading them
        // against the edition's new zone would move every one of them.
        const published = await em.fork().findOneOrFail(Schedule, fixture.scheduleId);
        assert.equal(published.timeZone, "Europe/Berlin");
    });

    it("shifts the draft with the edition start date and leaves the publication", async () => {
        const fixture = await buildScheduleFixture({ name: "Shift Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };
        const publishedSlotId = createdDocument.data.id;

        const publish = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(publish.status, 204);

        const draft = await em
            .fork()
            .findOneOrFail(
                Schedule,
                { edition: fixture.editionId, publishedAt: null },
                { populate: ["slots"] },
            );
        const draftSlots = draft.slots.getItems();
        assert.equal(draftSlots.length, 1);
        const draftSlotId = draftSlots[0].id;

        // Moving the edition back by 14 days crosses the end of Berlin summer
        // time, so preserving the wall clock lands the slot an hour earlier in
        // UTC than plain instant arithmetic would.
        const patch = await patchEditionDates(fixture, "Shift Edition", "2027-10-18", "2027-10-20");
        assert.equal(patch.status, 200);

        const fork = em.fork();
        const draftSlot = await fork.findOneOrFail(Slot, draftSlotId);
        assert.equal(draftSlot.startsAt.toString(), "2027-10-19T08:00:00Z");
        assert.equal(draftSlot.endsAt.toString(), "2027-10-19T09:00:00Z");

        const publishedSlot = await fork.findOneOrFail(Slot, publishedSlotId);
        assert.equal(publishedSlot.startsAt.toString(), "2027-11-02T09:00:00Z");
        assert.equal(publishedSlot.endsAt.toString(), "2027-11-02T10:00:00Z");
    });

    it("leaves slots in place when only the edition end date changes", async () => {
        const fixture = await buildScheduleFixture({ name: "Extension Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };
        const slotId = createdDocument.data.id;

        const patch = await patchEditionDates(
            fixture,
            "Extension Edition",
            "2027-11-01",
            "2027-11-05",
        );
        assert.equal(patch.status, 200);

        const slot = await em.fork().findOneOrFail(Slot, slotId);
        assert.equal(slot.startsAt.toString(), "2027-11-02T09:00:00Z");
        assert.equal(slot.endsAt.toString(), "2027-11-02T10:00:00Z");
    });

    it("deletes a draft slot the shortened edition has no room for", async () => {
        const fixture = await buildScheduleFixture({ name: "Shrinking Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const shrink = await patchEditionDates(
            fixture,
            "Shrinking Edition",
            "2027-11-01",
            "2027-11-01",
        );
        assert.equal(shrink.status, 200);

        const fork = em.fork();
        assert.equal(await fork.count(Slot, { id: createdDocument.data.id }), 0);

        // Placement is all a slot holds, so the session comes back unscheduled
        // rather than dying with it.
        assert.equal(await fork.count(Session, { id: fixture.sessionId }), 1);
    });

    it("keeps the slots the shortened edition still has room for", async () => {
        const fixture = await buildScheduleFixture({ name: "Partial Edition" });

        const kept = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-01T09:00:00Z",
            endsAt: "2027-11-01T10:00:00Z",
        });
        assert.equal(kept.status, 201);
        const keptDocument = (await kept.json()) as { data: { id: string } };

        const dropped = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(dropped.status, 201);
        const droppedDocument = (await dropped.json()) as { data: { id: string } };

        const shrink = await patchEditionDates(
            fixture,
            "Partial Edition",
            "2027-11-01",
            "2027-11-01",
        );
        assert.equal(shrink.status, 200);

        // Both siblings pass through the one settling loop, so a survivor that
        // was removed and then persisted again would come back as an update.
        const fork = em.fork();
        assert.equal(await fork.count(Slot, { id: droppedDocument.data.id }), 0);

        const survivor = await fork.findOneOrFail(Slot, keptDocument.data.id);
        assert.equal(survivor.startsAt.toString(), "2027-11-01T09:00:00Z");
        assert.equal(survivor.endsAt.toString(), "2027-11-01T10:00:00Z");
    });

    it("keeps a published slot the shortened edition has no room for", async () => {
        const fixture = await buildScheduleFixture({ name: "Shrinking Published Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const publish = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(publish.status, 204);

        const shrink = await patchEditionDates(
            fixture,
            "Shrinking Published Edition",
            "2027-11-01",
            "2027-11-01",
        );
        assert.equal(shrink.status, 200);

        // One left, not two: publishing copied the slot into the draft, and
        // that copy is the one the shrink removes.
        const fork = em.fork();
        const publishedSlot = await fork.findOneOrFail(Slot, createdDocument.data.id);
        assert.equal(publishedSlot.startsAt.toString(), "2027-11-02T09:00:00Z");
        assert.equal(await fork.count(Slot, { schedule: { edition: fixture.editionId } }), 1);
    });

    it("refuses a date change without saying where the first day lands", async () => {
        const fixture = await buildScheduleFixture({ name: "Unanswered Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);

        const patch = await jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: {
                    name: "Unanswered Edition",
                    startDate: "2027-11-08",
                    endDate: "2027-11-10",
                    timeZone: "Europe/Berlin",
                    submissionDeadline: null,
                },
                meta: { version: await editionVersion(em, fixture.editionId) },
            },
        });

        await expectJsonApiError(patch, 409, "start_date_required");

        const document = (await patch.json()) as {
            errors: [{ meta: { previousStartDate: string; earliest: string; latest: string } }];
        };
        assert.equal(document.errors[0].meta.previousStartDate, "2027-11-01");
        assert.equal(document.errors[0].meta.latest, "2027-11-10");
    });

    it("takes a first day that lands before the new start", async () => {
        const fixture = await buildScheduleFixture({ name: "Trimmed Setup Edition" });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await patchEditionDates(
            fixture,
            "Trimmed Setup Edition",
            "2027-11-02",
            "2027-11-03",
            "2027-11-01",
        );
        assert.equal(patch.status, 200);

        const slot = await em.fork().findOneOrFail(Slot, createdDocument.data.id);
        assert.equal(slot.startsAt.toString(), "2027-11-02T09:00:00Z");
    });

    it("drops a slot the new day has no room to run its full length", async () => {
        const fixture = await buildScheduleFixture({
            name: "Shortened Edition",
            startDate: "2027-03-20",
            endDate: "2027-03-22",
        });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-03-21T00:30:00Z",
            endsAt: "2027-03-21T02:30:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await patchEditionDates(
            fixture,
            "Shortened Edition",
            "2027-03-27",
            "2027-03-29",
            "2027-03-27",
        );
        assert.equal(patch.status, 200);

        assert.equal(await em.fork().count(Slot, { id: createdDocument.data.id }), 0);

        const document = (await patch.json()) as {
            meta: {
                settled: { sessions: { id: string; slotsRemoved: number; slotsLeft: number }[] };
            };
        };
        assert.deepEqual(document.meta.settled.sessions, [
            {
                id: fixture.sessionId,
                title: "Shortened Edition Session",
                slotsRemoved: 1,
                slotsLeft: 0,
            },
        ]);
    });

    it("drops a slot that would come out back to front", async () => {
        const fixture = await buildScheduleFixture({
            name: "Straddling Edition",
            startDate: "2027-10-30",
            endDate: "2027-11-01",
        });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-10-31T00:50:00Z",
            endsAt: "2027-10-31T01:10:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await patchEditionDates(
            fixture,
            "Straddling Edition",
            "2027-11-06",
            "2027-11-08",
            "2027-11-06",
        );
        assert.equal(patch.status, 200);

        assert.equal(await em.fork().count(Slot, { id: createdDocument.data.id }), 0);
    });

    // Jerusalem and Beirut change over on different days, so across 26 and 27
    // March they disagree by an hour while agreeing on either side. Both
    // midnights bounding this edition fall outside those two days, so the
    // window's edges land on the very same instants in both zones and only the
    // days in between move.
    it("settles a zone change the window's edges cannot see", async () => {
        const fixture = await buildScheduleFixture({
            name: "Divergent Edition",
            startDate: "2027-03-24",
            endDate: "2027-03-29",
            timeZone: "Asia/Jerusalem",
        });

        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-03-26T11:00:00Z",
            endsAt: "2027-03-26T12:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await jsonApi.patch(`/editions/${fixture.editionId}`, managerToken, {
            data: {
                type: "edition",
                id: fixture.editionId,
                attributes: { timeZone: "Asia/Beirut" },
                meta: { version: await editionVersion(em, fixture.editionId) },
            },
        });
        assert.equal(patch.status, 200);

        // 14:00 in Jerusalem has to stay 14:00 in Beirut, which is a different
        // instant on that day even though it is the same one on every other.
        const settled = await em.fork().findOneOrFail(Slot, createdDocument.data.id);
        assert.equal(
            settled.startsAt.toZonedDateTimeISO("Asia/Beirut").toPlainDateTime().toString(),
            "2027-03-26T14:00:00",
        );
        assert.equal(settled.startsAt.toString(), "2027-03-26T12:00:00Z");
    });

    it("keeps a slot at its hour of day when the edition changes zone", async () => {
        const fixture = await buildScheduleFixture({
            name: "Zoned Edition",
            startDate: "2026-03-28",
            endDate: "2026-03-30",
            timeZone: "UTC",
        });

        // The last half hour of the final day: moving everything by one duration
        // measured at the start would push it out of the window.
        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2026-03-30T23:00:00Z",
            endsAt: "2026-03-30T23:30:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await patchEditionZone(fixture, "Zoned Edition", "Europe/London");
        assert.equal(patch.status, 200);

        const slot = await em.fork().findOneOrFail(Slot, createdDocument.data.id);
        assert.equal(
            slot.startsAt.toZonedDateTimeISO("Europe/London").toPlainTime().toString(),
            "23:00:00",
        );
    });

    // Two talks can hold the same room an hour apart in fallBackWeek's repeated
    // hour. Moved, both want the same place at the same time.
    it("removes the loser when two slots settle onto one room and time", async () => {
        const fixture = await buildScheduleFixture({
            name: "Colliding Edition",
            startDate: fallBackWeek.startDate,
            endDate: fallBackWeek.endDate,
        });

        const firstPass = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-10-31T00:00:00Z",
            endsAt: "2027-10-31T00:45:00Z",
        });
        assert.equal(firstPass.status, 201);
        const firstDocument = (await firstPass.json()) as { data: { id: string } };

        const secondPass = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-10-31T01:00:00Z",
            endsAt: "2027-10-31T01:45:00Z",
        });
        assert.equal(secondPass.status, 201);
        const secondDocument = (await secondPass.json()) as { data: { id: string } };

        const patch = await patchEditionDates(
            fixture,
            "Colliding Edition",
            fallBackWeek.movedTo.startDate,
            fallBackWeek.movedTo.endDate,
            fallBackWeek.movedTo.startDate,
        );
        assert.equal(patch.status, 200);

        const fork = em.fork();
        const survivors = await fork.find(Slot, { schedule: fixture.scheduleId });
        assert.equal(survivors.length, 1);
        assert.equal(survivors[0].id, firstDocument.data.id);
        assert.equal(await fork.count(Slot, { id: secondDocument.data.id }), 0);

        const document = (await patch.json()) as {
            meta: { settled: { sessions: { slotsRemoved: number; slotsLeft: number }[] } };
        };
        assert.deepEqual(
            document.meta.settled.sessions.map((session) => [
                session.slotsRemoved,
                session.slotsLeft,
            ]),
            [[1, 1]],
        );
    });

    // A repeat performance losing one showing is neither unscheduled nor
    // untouched, so the report has to say which.
    it("says which showing a repeated session lost and which it kept", async () => {
        const fixture = await buildScheduleFixture({
            name: "Repeated Edition",
            startDate: "2026-03-28",
            endDate: "2026-03-30",
            timeZone: "UTC",
        });

        const morning = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2026-03-30T09:00:00Z",
            endsAt: "2026-03-30T10:00:00Z",
        });
        assert.equal(morning.status, 201);
        const morningDocument = (await morning.json()) as { data: { id: string } };

        // London skips 01:00 to 02:00 that morning, so this one has nowhere to
        // stand while the other simply keeps its hour.
        const overnight = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2026-03-29T01:30:00Z",
            endsAt: "2026-03-29T02:00:00Z",
        });
        assert.equal(overnight.status, 201);
        const overnightDocument = (await overnight.json()) as { data: { id: string } };

        const patch = await patchEditionZone(fixture, "Repeated Edition", "Europe/London");
        assert.equal(patch.status, 200);

        const fork = em.fork();
        assert.equal(await fork.count(Slot, { id: overnightDocument.data.id }), 0);
        assert.equal(await fork.count(Slot, { id: morningDocument.data.id }), 1);

        const document = (await patch.json()) as {
            meta: {
                settled: { sessions: { id: string; slotsRemoved: number; slotsLeft: number }[] };
            };
        };
        assert.deepEqual(document.meta.settled.sessions, [
            {
                id: fixture.sessionId,
                title: "Repeated Edition Session",
                slotsRemoved: 1,
                slotsLeft: 1,
            },
        ]);
    });

    it("drops a slot standing in the hour the new zone skips", async () => {
        const fixture = await buildScheduleFixture({
            name: "Skipped Edition",
            startDate: "2026-03-28",
            endDate: "2026-03-30",
            timeZone: "UTC",
        });

        // London turns its clocks forward at one in the morning that day, so
        // 01:30 is the half hour there is nowhere to put.
        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2026-03-29T01:30:00Z",
            endsAt: "2026-03-29T02:00:00Z",
        });
        assert.equal(created.status, 201);
        const createdDocument = (await created.json()) as { data: { id: string } };

        const patch = await patchEditionZone(fixture, "Skipped Edition", "Europe/London");
        assert.equal(patch.status, 200);

        assert.equal(await em.fork().count(Slot, { id: createdDocument.data.id }), 0);

        const document = (await patch.json()) as {
            meta: {
                settled: { sessions: { id: string; slotsRemoved: number; slotsLeft: number }[] };
            };
        };
        assert.deepEqual(document.meta.settled.sessions, [
            {
                id: fixture.sessionId,
                title: "Skipped Edition Session",
                slotsRemoved: 1,
                slotsLeft: 0,
            },
        ]);
    });

    describe("publication phases", () => {
        const publish = (
            fixture: ScheduleFixture,
            scheduleId: string,
            preliminary: boolean,
        ): Promise<TestResponse> =>
            jsonApi.post(
                `/editions/${fixture.editionId}/schedules/${scheduleId}/publication`,
                managerToken,
                { data: { type: "schedule_publication", attributes: { preliminary } } },
            );

        const findSuccessorDraft = (fixture: ScheduleFixture): Promise<Schedule> =>
            em.fork().findOneOrFail(Schedule, { edition: fixture.editionId, publishedAt: null });

        it("marks a publication preliminary and then final", async () => {
            const fixture = await buildScheduleFixture({ name: "Phase Edition" });

            const preliminaryResponse = await publish(fixture, fixture.scheduleId, true);
            assert.equal(preliminaryResponse.status, 204);

            const preliminarySchedule = await em.fork().findOneOrFail(Schedule, fixture.scheduleId);
            assert.equal(preliminarySchedule.preliminary, true);

            const successor = await findSuccessorDraft(fixture);
            const finalResponse = await publish(fixture, successor.id, false);
            assert.equal(finalResponse.status, 204);

            const finalSchedule = await em.fork().findOneOrFail(Schedule, successor.id);
            assert.equal(finalSchedule.preliminary, false);
        });

        it("publishes an edition as preliminary more than once", async () => {
            const fixture = await buildScheduleFixture({ name: "Provisional Edition" });

            const firstResponse = await publish(fixture, fixture.scheduleId, true);
            assert.equal(firstResponse.status, 204);

            // Only the step back from final to preliminary is refused, so the
            // phase check has to look for a final publication specifically
            // rather than for any publication at all.
            const successor = await findSuccessorDraft(fixture);
            const secondResponse = await publish(fixture, successor.id, true);
            assert.equal(secondResponse.status, 204);
        });

        it("refuses a publication that omits the phase", async () => {
            const fixture = await buildScheduleFixture({ name: "Unstated Edition" });

            const response = await jsonApi.post(
                `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
                managerToken,
                { data: { type: "schedule_publication" } },
            );

            // Defaulting the phase would publish as final, which permanently
            // locks the edition out of preliminary publications.
            assert.equal(response.status, 422);

            const schedule = await em.fork().findOneOrFail(Schedule, fixture.scheduleId);
            assert.equal(schedule.publishedAt, null);
        });

        it("refuses a preliminary publication after a final one", async () => {
            const fixture = await buildScheduleFixture({ name: "Ratchet Edition" });

            const finalResponse = await publish(fixture, fixture.scheduleId, false);
            assert.equal(finalResponse.status, 204);

            const successor = await findSuccessorDraft(fixture);
            const regression = await publish(fixture, successor.id, true);
            await expectJsonApiError(regression, 409, "already_final");
        });

        it("publishes an edition as final more than once", async () => {
            const fixture = await buildScheduleFixture({ name: "Republish Edition" });

            const firstResponse = await publish(fixture, fixture.scheduleId, false);
            assert.equal(firstResponse.status, 204);

            // Room changes and time shifts after a final publication are the
            // common case at a live event, so republishing is not a phase
            // violation and must not be turned into one.
            const successor = await findSuccessorDraft(fixture);
            const secondResponse = await publish(fixture, successor.id, false);
            assert.equal(secondResponse.status, 204);
        });

        it("reports the published schedule rather than the edition phase", async () => {
            const fixture = await buildScheduleFixture({ name: "Precedence Edition" });

            const finalResponse = await publish(fixture, fixture.scheduleId, false);
            assert.equal(finalResponse.status, 204);

            // This request trips both guards at once, and the schedule is the
            // one the caller named.
            const republished = await publish(fixture, fixture.scheduleId, true);
            await expectJsonApiError(republished, 409, "already_published");
        });
    });

    it("serializes two concurrent publishes into one publication", async () => {
        const fixture = await buildScheduleFixture({ name: "Publish Race Edition" });

        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Edition, fixture.editionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            await held.promise;
        });

        const publish = () =>
            send(
                jsonApi.post(
                    `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
                    managerToken,
                    { data: { type: "schedule_publication", attributes: { preliminary: false } } },
                ),
            );

        // Both requests are provably parked on the edition lock before it
        // releases, so they race for real rather than arriving in sequence.
        const attempts = [publish(), publish()];

        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            { count: 2 },
        );

        await holding;
        const responses = await Promise.all(attempts);

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(responses.filter((response) => response.status === 204).length, 1);
        const loser = responses.find((response) => response.status !== 204);
        assert.ok(loser);
        await expectJsonApiError(loser, 409, "already_published");

        const readFork = em.fork();
        assert.equal(
            await readFork.count(Schedule, {
                edition: fixture.editionId,
                publishedAt: { $ne: null },
            }),
            1,
        );
        assert.equal(
            (await readFork.findOneOrFail(EditionRevision, { editionId: fixture.editionId }))
                .revision,
            1,
        );
    });

    it("copies a published slot into the successor whole, under its stable id", async () => {
        const fixture = await buildScheduleFixture({ name: "Copy Fidelity Edition" });
        const created = await createSlot(fixture, fixture.scheduleId, {
            startsAt: "2027-11-02T09:00:00Z",
            endsAt: "2027-11-02T10:00:00Z",
            setupTime: "PT15M",
            teardownTime: "PT10M",
        });
        assert.equal(created.status, 201);
        const slotId = ((await created.json()) as { data: { id: string } }).data.id;

        const published = await jsonApi.post(
            `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
            managerToken,
            { data: { type: "schedule_publication", attributes: { preliminary: false } } },
        );
        assert.equal(published.status, 204);

        const readFork = em.fork();
        const original = await readFork.findOneOrFail(Slot, slotId);
        const successor = await readFork.findOneOrFail(Schedule, {
            edition: fixture.editionId,
            publishedAt: null,
        });
        const predecessor = await readFork.findOneOrFail(Schedule, fixture.scheduleId);
        assert.equal(successor.sequence, predecessor.sequence + 1);

        const copy = await readFork.findOneOrFail(Slot, {
            schedule: { edition: fixture.editionId, publishedAt: null },
        });
        assert.notEqual(copy.id, original.id);

        // Every field except the identity and the owning schedule must
        // survive the copy, including fields added to Slot after this test
        // was written: a field the copy constructor misses resets on every
        // publish, silently.
        const comparable = (slot: Slot): Record<string, unknown> => {
            const plain: Record<string, unknown> = { ...wrap(slot).toObject() };
            delete plain.id;
            delete plain.schedule;

            return plain;
        };

        assert.deepEqual(comparable(copy), comparable(original));
    });

    // A publish, a cancel and a slot create against one edition at once, eight
    // rounds of it, because the interleaving cannot be forced through the API.
    // Every one of the three has to be answered: a deadlock or an unmapped
    // violation between the draft lock and the session lock surfaces as a 500
    // here and nowhere else in the suite.
    //
    // The resulting slot is deliberately not asserted: a session leaving a
    // slottable state keeps its slot, so a create landing either side of the
    // cancel is legal and only the three answers tell the interleavings apart.
    it("answers a publish, a cancel and a slot create that land together", async () => {
        for (let round = 0; round < 8; round += 1) {
            const fixture = await buildScheduleFixture({
                name: `Cancel Race ${round.toString()} Edition`,
                sessionState: "confirmed",
            });
            const seeded = await createSlot(fixture, fixture.scheduleId, {
                startsAt: "2027-11-02T09:00:00Z",
                endsAt: "2027-11-02T10:00:00Z",
            });
            assert.equal(seeded.status, 201);

            const publishing = send(
                jsonApi.post(
                    `/editions/${fixture.editionId}/schedules/${fixture.scheduleId}/publication`,
                    managerToken,
                    { data: { type: "schedule_publication", attributes: { preliminary: false } } },
                ),
            );
            const canceling = send(
                jsonApi.post(
                    `/editions/${fixture.editionId}/sessions/${fixture.sessionId}/transitions`,
                    managerToken,
                    { data: { type: "session_transition", attributes: { state: "canceled" } } },
                ),
            );

            let successorId: string | null = null;
            const pollDeadline = Temporal.Now.instant().add({ seconds: 5 });

            while (successorId === null) {
                assert.ok(
                    isBefore(Temporal.Now.instant(), pollDeadline),
                    "the publish never produced a successor",
                );
                const draft = await em
                    .fork()
                    .findOne(Schedule, { edition: fixture.editionId, publishedAt: null });

                if (draft !== null && draft.id !== fixture.scheduleId) {
                    successorId = draft.id;
                }
            }

            const slotting = send(
                createSlot(fixture, successorId, {
                    startsAt: "2027-11-02T11:00:00Z",
                    endsAt: "2027-11-02T12:00:00Z",
                }),
            );

            const [publishResponse, cancelResponse, slotResponse] = await Promise.all([
                publishing,
                canceling,
                slotting,
            ]);
            assert.equal(publishResponse.status, 204);
            assert.equal(cancelResponse.status, 201);
            // 409 once the cancel has committed, 201 while it had not: the
            // draft lock is what makes it one of the two rather than a read of
            // a state that is already gone.
            assert.ok(
                [201, 409].includes(slotResponse.status),
                `the slot create answered ${slotResponse.status.toString()}`,
            );
        }
    });
});
