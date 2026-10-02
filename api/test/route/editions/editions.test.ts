import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { HostAvailability } from "../../../src/entity/HostAvailability.js";
import { Location } from "../../../src/entity/Location.js";
import { LocationAvailability } from "../../../src/entity/LocationAvailability.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionHostInvite } from "../../../src/entity/SessionHostInvite.js";
import { SessionTransition } from "../../../src/entity/SessionTransition.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { Venue } from "../../../src/entity/Venue.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildTeamMember,
    buildVenue,
    editionVersion,
    fallBackWeek,
} from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type SeededAvailability = {
    editionId: string;
    hostAvailabilityId: string;
    locationAvailabilityId: string;
};

describe("editions", () => {
    let managerToken: string;
    let templateEditionId: string;
    let patchableEditionId: string;
    let deletableEditionId: string;

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");

        const templateEdition = buildEdition({
            name: "Template Edition",
            startDate: Temporal.PlainDate.from("2027-09-01"),
            endDate: Temporal.PlainDate.from("2027-09-03"),
            sessionFieldOptions: { abstract: { requirement: "required" } },
        });
        const templateDefaultSessionType = SessionType.default(ref(templateEdition));
        const templateWorkshopSessionType = new SessionType({
            name: "Workshop",
            externalKey: "workshop",
            defaultDuration: Temporal.Duration.from({ minutes: 45 }),
            internal: true,
            selectionDefault: false,
            edition: ref(templateEdition),
        });
        const templateTrack = new Track({
            name: "Main Track",
            externalKey: "main",
            description: "Everything on the main stage",
            color: "#112233",
            internal: true,
            edition: ref(templateEdition),
        });
        const templateVenue = new Venue({
            position: 0,
            name: "Main Venue",
            address: "1 Example Street",
            externalKey: "main-venue",
            edition: ref(templateEdition),
        });
        const templateSecondVenue = buildVenue(templateEdition, {
            position: 1,
            name: "Second Venue",
            externalKey: "second-venue",
        });
        const templateLocation = new Location({
            position: 0,
            name: "Main Hall",
            externalKey: "main-hall",
            edition: ref(templateEdition),
            venue: ref(templateSecondVenue),
        });
        const templateLocationAvailability = new LocationAvailability({
            startsAt: Temporal.Instant.from("2027-09-01T07:00:00Z"),
            endsAt: Temporal.Instant.from("2027-09-01T15:00:00Z"),
            location: ref(templateLocation),
        });
        const templateCustomField = new CustomField({
            position: 0,
            externalKey: "catering",
            target: "per_proposal",
            requirement: "required_after_deadline",
            options: { type: "boolean" },
            title: "Do you need catering?",
            helperText: "Only for on-site sessions",
            deadline: Temporal.Instant.from("2027-08-01T00:00:00Z"),
            freezeAfter: Temporal.Instant.from("2027-08-15T00:00:00Z"),
            edition: ref(templateEdition),
        });
        templateCustomField.sessionTypes.add(templateWorkshopSessionType);
        templateCustomField.tracks.add(templateTrack);

        const patchableEdition = buildEdition({
            name: "Patchable Edition",
            startDate: Temporal.PlainDate.from("2028-04-01"),
            endDate: Temporal.PlainDate.from("2028-04-02"),
        });
        const deletableEdition = buildEdition({
            name: "Deletable Edition",
            startDate: Temporal.PlainDate.from("2026-04-01"),
            endDate: Temporal.PlainDate.from("2026-04-02"),
        });

        await fork
            .persist([
                manager,
                team,
                templateEdition,
                templateDefaultSessionType,
                templateWorkshopSessionType,
                templateTrack,
                templateVenue,
                templateSecondVenue,
                templateLocation,
                templateLocationAvailability,
                templateCustomField,
                patchableEdition,
                deletableEdition,
            ])
            .flush();

        templateEditionId = templateEdition.id;
        patchableEditionId = patchableEdition.id;
        deletableEditionId = deletableEdition.id;
    });

    it("lists editions by start date descending", async () => {
        const response = await jsonApi.get("/editions", managerToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { id: string; type: string; attributes: { startDate: string } }[];
        };
        assert.ok(document.data.some((resource) => resource.id === templateEditionId));
        assert.equal(document.data[0].type, "edition");

        const startDates = document.data.map((resource) => resource.attributes.startDate);
        assert.deepEqual(startDates, [...startDates].sort().reverse());
    });

    it("shows a single edition", async () => {
        const response = await jsonApi.get(`/editions/${templateEditionId}`, managerToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: {
                id: string;
                type: string;
                attributes: {
                    name: string;
                    startDate: string;
                    endDate: string;
                    timeZone: string;
                    submissionDeadline: string | null;
                    sessionFieldOptions: unknown;
                };
            };
        };
        assert.equal(document.data.id, templateEditionId);
        assert.equal(document.data.type, "edition");
        assert.deepEqual(document.data.attributes, {
            name: "Template Edition",
            startDate: "2027-09-01",
            endDate: "2027-09-03",
            profileFieldOptions: {
                avatar: { requirement: "optional" },
                biography: { requirement: "optional" },
                displayName: {},
                emailAddress: {},
            },
            timeZone: "Europe/Berlin",
            submissionDeadline: null,
            sessionFieldOptions: { abstract: { requirement: "required" } },
        });
    });

    it("patches an edition", async () => {
        const { version } = await em.fork().findOneOrFail(Edition, patchableEditionId);
        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    name: "Renamed Edition",
                    startDate: "2028-04-05",
                    endDate: "2028-04-07",
                    timeZone: "Europe/Vienna",
                    submissionDeadline: "2028-03-01T12:00:00Z",
                },
                meta: { version },
            },
        });

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: {
                attributes: {
                    name: string;
                    startDate: string;
                    endDate: string;
                    timeZone: string;
                    submissionDeadline: string | null;
                };
            };
        };
        assert.equal(document.data.attributes.name, "Renamed Edition");
        assert.equal(document.data.attributes.startDate, "2028-04-05");
        assert.equal(document.data.attributes.endDate, "2028-04-07");
        assert.equal(document.data.attributes.timeZone, "Europe/Vienna");
        assert.equal(document.data.attributes.submissionDeadline, "2028-03-01T12:00:00Z");
    });

    describe("availability follows the edition", () => {
        const berlinInterval = (day: string, from: string, to: string) => ({
            startsAt: Temporal.PlainDate.from(day)
                .toZonedDateTime({
                    timeZone: "Europe/Berlin",
                    plainTime: Temporal.PlainTime.from(from),
                })
                .toInstant(),
            endsAt: Temporal.PlainDate.from(day)
                .toZonedDateTime({
                    timeZone: "Europe/Berlin",
                    plainTime: Temporal.PlainTime.from(to),
                })
                .toInstant(),
        });

        const seedAvailability = async (): Promise<SeededAvailability> => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Availability Edition",
                startDate: Temporal.PlainDate.from("2029-05-01"),
                endDate: Temporal.PlainDate.from("2029-05-03"),
            });
            const user = new User({
                externalId: "avail-host",
                displayName: "Avail Host",
                emailAddress: "avail-host@example.test",
            });
            const host = buildHost(edition, user);
            const availVenue = buildVenue(edition);
            const location = new Location({
                position: 1,
                name: "Avail Hall",
                externalKey: "avail-hall",
                edition: ref(edition),
                venue: ref(availVenue),
            });
            const hostAvailability = new HostAvailability({
                ...berlinInterval("2029-05-01", "09:00", "17:00"),
                host: ref(host),
            });
            const locationAvailability = new LocationAvailability({
                ...berlinInterval("2029-05-03", "09:00", "17:00"),
                location: ref(location),
            });

            await fork
                .persist([edition, user, host, location, hostAvailability, locationAvailability])
                .flush();

            return {
                editionId: edition.id,
                hostAvailabilityId: hostAvailability.id,
                locationAvailabilityId: locationAvailability.id,
            };
        };

        type SettledCounts = { trimmedAvailability: number; droppedAvailability: number };

        const patchEdition = async (
            editionId: string,
            attributes: Record<string, string>,
            startDateBecomes?: string,
        ): Promise<SettledCounts> => {
            const { version } = await em.fork().findOneOrFail(Edition, editionId);
            const response = await jsonApi.patch(`/editions/${editionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: editionId,
                    attributes,
                    meta: {
                        version,
                        ...(startDateBecomes === undefined ? {} : { startDateBecomes }),
                    },
                },
            });
            assert.equal(response.status, 200);

            const document = (await response.json()) as { meta: { settled?: SettledCounts } };

            return document.meta.settled ?? { trimmedAvailability: 0, droppedAvailability: 0 };
        };

        const wallClock = (instant: Temporal.Instant, timeZone: string): string =>
            instant.toZonedDateTimeISO(timeZone).toPlainDateTime().toString();

        it("moves host and location availability when the dates shift", async () => {
            const { editionId, hostAvailabilityId, locationAvailabilityId } =
                await seedAvailability();

            await patchEdition(
                editionId,
                { startDate: "2029-05-08", endDate: "2029-05-10" },
                "2029-05-08",
            );

            const fork = em.fork();
            const hostAvailability = await fork.findOneOrFail(HostAvailability, hostAvailabilityId);
            const locationAvailability = await fork.findOneOrFail(
                LocationAvailability,
                locationAvailabilityId,
            );

            assert.equal(
                wallClock(hostAvailability.startsAt, "Europe/Berlin"),
                "2029-05-08T09:00:00",
            );
            assert.equal(
                wallClock(hostAvailability.endsAt, "Europe/Berlin"),
                "2029-05-08T17:00:00",
            );
            assert.equal(
                wallClock(locationAvailability.startsAt, "Europe/Berlin"),
                "2029-05-10T09:00:00",
            );
            assert.equal(
                wallClock(locationAvailability.endsAt, "Europe/Berlin"),
                "2029-05-10T17:00:00",
            );
        });

        it("keeps the wall clock when only the zone changes", async () => {
            const { editionId, hostAvailabilityId } = await seedAvailability();

            await patchEdition(editionId, { timeZone: "Europe/London" });

            const fork = em.fork();
            const hostAvailability = await fork.findOneOrFail(HostAvailability, hostAvailabilityId);

            assert.equal(
                wallClock(hostAvailability.startsAt, "Europe/London"),
                "2029-05-01T09:00:00",
            );
            assert.equal(
                wallClock(hostAvailability.endsAt, "Europe/London"),
                "2029-05-01T17:00:00",
            );
        });

        // The clock skips from 01:59 to 03:00 that morning, so an end at 02:30
        // has nowhere to stand and lands on the jump itself, which reads 03:00.
        it("clamps availability out of an hour the day does not have", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Skipping Edition",
                startDate: Temporal.PlainDate.from("2027-03-20"),
                endDate: Temporal.PlainDate.from("2027-03-22"),
            });
            const user = new User({
                externalId: "skip-host",
                displayName: "Skip Host",
                emailAddress: "skip-host@example.test",
            });
            const host = buildHost(edition, user);
            const availability = new HostAvailability({
                startsAt: Temporal.Instant.from("2027-03-21T00:00:00Z"),
                endsAt: Temporal.Instant.from("2027-03-21T01:30:00Z"),
                host: ref(host),
            });

            await fork.persist([edition, user, host, availability]).flush();

            const report = await patchEdition(
                edition.id,
                { startDate: "2027-03-27", endDate: "2027-03-29" },
                "2027-03-27",
            );

            assert.equal(report.trimmedAvailability, 1);
            assert.equal(report.droppedAvailability, 0);

            const settled = await em.fork().findOneOrFail(HostAvailability, availability.id);
            assert.equal(wallClock(settled.startsAt, "Europe/Berlin"), "2027-03-28T01:00:00");
            assert.equal(wallClock(settled.endsAt, "Europe/Berlin"), "2027-03-28T03:00:00");
        });

        // The end has nowhere to stand, and the quarter hour before the gap
        // really exists, so the answer is trimmed rather than thrown away.
        it("keeps the part of an answer that survives the missing hour", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Surviving Edition",
                startDate: Temporal.PlainDate.from("2027-03-20"),
                endDate: Temporal.PlainDate.from("2027-03-22"),
            });
            const user = new User({
                externalId: "survive-host",
                displayName: "Survive Host",
                emailAddress: "survive@example.test",
            });
            const host = buildHost(edition, user);
            const availability = new HostAvailability({
                startsAt: Temporal.Instant.from("2027-03-21T00:45:00Z"),
                endsAt: Temporal.Instant.from("2027-03-21T01:30:00Z"),
                host: ref(host),
            });

            await fork.persist([edition, user, host, availability]).flush();

            await patchEdition(
                edition.id,
                { startDate: "2027-03-27", endDate: "2027-03-29" },
                "2027-03-27",
            );

            const settled = await em.fork().findOneOrFail(HostAvailability, availability.id);
            assert.equal(wallClock(settled.startsAt, "Europe/Berlin"), "2027-03-28T01:45:00");
            assert.equal(wallClock(settled.endsAt, "Europe/Berlin"), "2027-03-28T03:00:00");
        });

        it("settles availability when only the far edge of the window moves", async () => {
            const fork = em.fork();
            // London matches UTC on the 28th and gains an hour on the 29th, so
            // the window keeps its start and loses its final hour.
            const edition = buildEdition({
                name: "Edge Edition",
                startDate: Temporal.PlainDate.from("2026-03-28"),
                endDate: Temporal.PlainDate.from("2026-03-30"),
                timeZone: "UTC",
            });
            const edgeVenue = buildVenue(edition);
            const location = new Location({
                position: 2,
                name: "Edge Hall",
                externalKey: "edge-hall",
                edition: ref(edition),
                venue: ref(edgeVenue),
            });
            const availability = new LocationAvailability({
                startsAt: Temporal.Instant.from("2026-03-30T22:00:00Z"),
                endsAt: Temporal.Instant.from("2026-03-31T00:00:00Z"),
                location: ref(location),
            });
            await fork.persist([edition, location, availability]).flush();

            await patchEdition(edition.id, { timeZone: "Europe/London" });

            const after = em.fork();
            const settled = await after.findOneOrFail(LocationAvailability, availability.id);

            assert.equal(settled.endsAt.toString(), "2026-03-30T23:00:00Z");
        });

        // Two answers can sit an hour apart in fallBackWeek's repeated hour
        // without overlapping. Moved, they land on top of each other.
        it("joins two answers the repeated hour settles onto each other", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Repeated Hour Edition",
                startDate: Temporal.PlainDate.from(fallBackWeek.startDate),
                endDate: Temporal.PlainDate.from(fallBackWeek.endDate),
            });
            const user = new User({
                externalId: "repeat-host",
                displayName: "Repeat Host",
                emailAddress: "repeat@example.test",
            });
            const host = buildHost(edition, user);
            const firstPass = new HostAvailability({
                startsAt: Temporal.Instant.from("2027-10-31T00:10:00Z"),
                endsAt: Temporal.Instant.from("2027-10-31T00:50:00Z"),
                host: ref(host),
            });
            const secondPass = new HostAvailability({
                startsAt: Temporal.Instant.from("2027-10-31T01:30:00Z"),
                endsAt: Temporal.Instant.from("2027-10-31T01:59:00Z"),
                host: ref(host),
            });

            await fork.persist([edition, user, host, firstPass, secondPass]).flush();

            const report = await patchEdition(
                edition.id,
                fallBackWeek.movedTo,
                fallBackWeek.movedTo.startDate,
            );

            // A merge loses the speaker no time, so it is not a trim.
            assert.equal(report.trimmedAvailability, 0);
            assert.equal(report.droppedAvailability, 0);

            // 02:10 to 02:50 and 02:30 to 02:59 become one answer covering
            // both, rather than one of them being thrown away.
            const after = em.fork();
            const surviving = await after.find(HostAvailability, { host: host.id });
            assert.equal(surviving.length, 1);
            assert.equal(wallClock(surviving[0].startsAt, "Europe/Berlin"), "2027-11-07T02:10:00");
            assert.equal(wallClock(surviving[0].endsAt, "Europe/Berlin"), "2027-11-07T02:59:00");
        });

        // Moving the days under an answer is what makes it wrong, so the question
        // is asked even with nothing scheduled.
        it("asks where the first day lands for availability with no slots", async () => {
            const { editionId } = await seedAvailability();

            const { version } = await em.fork().findOneOrFail(Edition, editionId);
            const patch = await jsonApi.patch(`/editions/${editionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: editionId,
                    attributes: { startDate: "2029-05-08", endDate: "2029-05-10" },
                    meta: { version },
                },
            });

            await expectJsonApiError(patch, 409, "start_date_required");

            const fork = em.fork();
            const edition = await fork.findOneOrFail(Edition, editionId);
            assert.equal(edition.startDate.toString(), "2029-05-01");
        });

        // Two answers meeting at a point are one answer: whatever made the
        // speaker give them separately, there is no minute between them that
        // they are unavailable for.
        it("joins two answers that meet exactly", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Touching Edition",
                startDate: Temporal.PlainDate.from("2029-06-01"),
                endDate: Temporal.PlainDate.from("2029-06-03"),
            });
            const user = new User({
                externalId: "touch-host",
                displayName: "Touch Host",
                emailAddress: "touch@example.test",
            });
            const host = buildHost(edition, user);
            const morning = new HostAvailability({
                startsAt: Temporal.Instant.from("2029-06-02T07:00:00Z"),
                endsAt: Temporal.Instant.from("2029-06-02T10:00:00Z"),
                host: ref(host),
            });
            const afternoon = new HostAvailability({
                startsAt: Temporal.Instant.from("2029-06-02T10:00:00Z"),
                endsAt: Temporal.Instant.from("2029-06-02T13:00:00Z"),
                host: ref(host),
            });

            await fork.persist([edition, user, host, morning, afternoon]).flush();

            const report = await patchEdition(
                edition.id,
                { startDate: "2029-06-08", endDate: "2029-06-10" },
                "2029-06-08",
            );

            assert.equal(report.trimmedAvailability, 0);
            assert.equal(report.droppedAvailability, 0);

            const after = em.fork();
            const surviving = await after.find(HostAvailability, { host: host.id });
            assert.equal(surviving.length, 1);
            assert.equal(surviving[0].startsAt.toString(), "2029-06-09T07:00:00Z");
            assert.equal(surviving[0].endsAt.toString(), "2029-06-09T13:00:00Z");
        });

        it("keeps each host's answer to itself when they coincide", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Two Hosts Edition",
                startDate: Temporal.PlainDate.from("2029-07-01"),
                endDate: Temporal.PlainDate.from("2029-07-03"),
            });
            const firstUser = new User({
                externalId: "first-host",
                displayName: "First Host",
                emailAddress: "first@example.test",
            });
            const secondUser = new User({
                externalId: "second-host",
                displayName: "Second Host",
                emailAddress: "second@example.test",
            });
            const firstHost = buildHost(edition, firstUser);
            const secondHost = buildHost(edition, secondUser);
            const answers = [firstHost, secondHost].map(
                (host) =>
                    new HostAvailability({
                        startsAt: Temporal.Instant.from("2029-07-02T09:00:00Z"),
                        endsAt: Temporal.Instant.from("2029-07-02T12:00:00Z"),
                        host: ref(host),
                    }),
            );

            await fork
                .persist([edition, firstUser, secondUser, firstHost, secondHost, ...answers])
                .flush();

            await patchEdition(
                edition.id,
                { startDate: "2029-07-08", endDate: "2029-07-10" },
                "2029-07-08",
            );

            const after = em.fork();
            const surviving = await after.find(HostAvailability, {
                host: { $in: [firstHost.id, secondHost.id] },
            });

            assert.deepEqual(
                surviving.map((availability) => availability.host.id).sort(),
                [firstHost.id, secondHost.id].sort(),
            );
            assert.deepEqual(
                surviving.map((availability) => availability.startsAt.toString()),
                ["2029-07-09T09:00:00Z", "2029-07-09T09:00:00Z"],
            );
        });

        // Re-anchoring keeps an answer inside the days it was given for, so the
        // only thing left to cut is one running through the closing midnight.
        it("cuts an answer that runs past the end of the last day", async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Overnight Edition",
                startDate: Temporal.PlainDate.from("2029-05-01"),
                endDate: Temporal.PlainDate.from("2029-05-03"),
            });
            const user = new User({
                externalId: "night-host",
                displayName: "Night Host",
                emailAddress: "night@example.test",
            });
            const host = buildHost(edition, user);
            const availability = new HostAvailability({
                ...berlinInterval("2029-05-02", "20:00", "23:59"),
                host: ref(host),
            });
            availability.endsAt = Temporal.PlainDate.from("2029-05-03")
                .toZonedDateTime({
                    timeZone: "Europe/Berlin",
                    plainTime: Temporal.PlainTime.from("04:00"),
                })
                .toInstant();

            await fork.persist([edition, user, host, availability]).flush();

            const settled = await patchEdition(edition.id, { endDate: "2029-05-02" }, "2029-05-01");

            assert.equal(settled.trimmedAvailability, 1);
            assert.equal(settled.droppedAvailability, 0);

            const after = await em.fork().findOneOrFail(HostAvailability, availability.id);
            assert.equal(wallClock(after.startsAt, "Europe/Berlin"), "2029-05-02T20:00:00");
            assert.equal(wallClock(after.endsAt, "Europe/Berlin"), "2029-05-03T00:00:00");
        });

        it("drops availability on a day the edition no longer has", async () => {
            const { editionId, hostAvailabilityId, locationAvailabilityId } =
                await seedAvailability();

            const settled = await patchEdition(editionId, { endDate: "2029-05-02" }, "2029-05-01");
            assert.equal(settled.droppedAvailability, 1);
            assert.equal(settled.trimmedAvailability, 0);

            const fork = em.fork();
            assert.notEqual(await fork.findOne(HostAvailability, hostAvailabilityId), null);
            assert.equal(await fork.findOne(LocationAvailability, locationAvailabilityId), null);
        });
    });

    it("requires a track only once speakers have one to pick", async () => {
        const fork = em.fork();
        const edition = fork.getReference(Edition, patchableEditionId);
        const track = (name: string, internal: boolean) =>
            new Track({
                name,
                externalKey: null,
                description: "",
                color: "#123456",
                internal,
                edition: ref(edition),
            });
        await fork.persist(track("Backstage", true)).flush();
        const requireTrack = async () =>
            jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: patchableEditionId,
                    attributes: {
                        sessionFieldOptions: {
                            abstract: { requirement: "required" },
                            track: { requirement: "required" },
                        },
                    },
                    meta: { version: await editionVersion(em, patchableEditionId) },
                },
            });

        await expectJsonApiError(await requireTrack(), 409, "nothing_to_pick");

        await fork.persist(track("Main Stage", false)).flush();
        assert.equal((await requireTrack()).status, 200);
    });

    it("leaves an edition already requiring a track speakers cannot pick editable", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, patchableEditionId);
        edition.sessionFieldOptions = {
            ...edition.sessionFieldOptions,
            track: { requirement: "required" },
        };
        await fork.flush();

        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    name: "Renamed",
                    sessionFieldOptions: {
                        abstract: { requirement: "required", maxLength: 500 },
                        track: { requirement: "required" },
                    },
                },
                meta: { version: await editionVersion(em, patchableEditionId) },
            },
        });

        assert.equal(response.status, 200);
    });

    describe("date order", () => {
        type PointedError = {
            errors: { code: string; source?: { pointer?: string } }[];
        };

        const pointedAt = async (
            response: TestResponse,
        ): Promise<[string | undefined, string | undefined]> => {
            assert.equal(response.status, 422);
            const [error] = (await response.json<PointedError>()).errors;

            return [error?.code, error?.source?.pointer];
        };

        it("refuses a new edition ending before it starts", async () => {
            const response = await jsonApi.post("/editions", managerToken, {
                data: {
                    type: "edition",
                    attributes: {
                        name: "Backwards Edition",
                        startDate: "2028-06-03",
                        endDate: "2028-06-01",
                        timeZone: "Europe/Berlin",
                        submissionDeadline: null,
                    },
                },
            });

            assert.deepEqual(await pointedAt(response), [
                "invalid_date_range",
                "/data/attributes/startDate",
            ]);
            assert.equal(await em.fork().count(Edition, { name: "Backwards Edition" }), 0);
        });

        it("refuses an end date before the stored start, blaming the end", async () => {
            const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: patchableEditionId,
                    attributes: { endDate: "2028-03-31" },
                    meta: { version: await editionVersion(em, patchableEditionId) },
                },
            });

            assert.deepEqual(await pointedAt(response), [
                "invalid_date_range",
                "/data/attributes/endDate",
            ]);
            const stored = await em.fork().findOneOrFail(Edition, patchableEditionId);
            assert.equal(stored.endDate.toString(), "2028-04-02");
        });
    });

    it("patches teaser image constraints", async () => {
        const version = await editionVersion(em, patchableEditionId);
        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    sessionFieldOptions: {
                        teaserImage: {
                            requirement: "optional",
                            minWidth: 1280,
                            minHeight: 720,
                            aspectRatio: { width: 16, height: 9 },
                        },
                    },
                },
                meta: { version },
            },
        });

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { attributes: { sessionFieldOptions: unknown } };
        };
        assert.deepEqual(document.data.attributes.sessionFieldOptions, {
            teaserImage: {
                requirement: "optional",
                minWidth: 1280,
                minHeight: 720,
                aspectRatio: { width: 16, height: 9 },
            },
        });
    });

    it("rejects teaser image constraints conflicting with the defaults", async () => {
        const version = await editionVersion(em, patchableEditionId);
        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    sessionFieldOptions: {
                        teaserImage: { requirement: "optional", minWidth: 5000 },
                    },
                },
                meta: { version },
            },
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string } }[];
        };
        assert.equal(
            document.errors[0]?.source.pointer,
            "/data/attributes/sessionFieldOptions/teaserImage/minWidth",
        );
    });

    it("patches the avatar requirement", async () => {
        const version = await editionVersion(em, patchableEditionId);
        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    profileFieldOptions: {
                        avatar: { requirement: "required" },
                    },
                },
                meta: { version },
            },
        });

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { attributes: { profileFieldOptions: unknown } };
        };
        assert.deepEqual(document.data.attributes.profileFieldOptions, {
            avatar: { requirement: "required" },
        });
    });

    it("rejects avatar constraint overrides", async () => {
        const version = await editionVersion(em, patchableEditionId);
        const response = await jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
            data: {
                type: "edition",
                id: patchableEditionId,
                attributes: {
                    profileFieldOptions: {
                        avatar: { requirement: "optional", minWidth: 128 },
                    },
                },
                meta: { version },
            },
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string } }[];
        };
        assert.match(
            document.errors[0]?.source.pointer ?? "",
            /^\/data\/attributes\/profileFieldOptions\/avatar/,
        );
    });

    it("deletes an edition", async () => {
        const response = await jsonApi.delete(`/editions/${deletableEditionId}`, managerToken);

        assert.equal(response.status, 204);

        const detail = await jsonApi.get(`/editions/${deletableEditionId}`, managerToken);
        assert.equal(detail.status, 404);
    });

    it("purges everything an edition owns on delete", async () => {
        // Created through the API so the edition owns a schedule and a
        // default session type.
        const create = await jsonApi.post("/editions", managerToken, {
            data: {
                type: "edition",
                attributes: {
                    name: "Purged Edition",
                    startDate: "2028-06-01",
                    endDate: "2028-06-03",
                    timeZone: "Europe/Berlin",
                    submissionDeadline: null,
                },
            },
        });
        assert.equal(create.status, 201);
        const createDocument = (await create.json()) as { data: { id: string } };
        const editionId = createDocument.data.id;

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const schedule = await fork.findOneOrFail(Schedule, { edition });
        const sessionType = await fork.findOneOrFail(SessionType, { edition });
        const track = new Track({
            name: "Purged Track",
            externalKey: null,
            description: "",
            color: "#abcdef",
            internal: false,
            edition: ref(edition),
        });
        const purgedVenue = buildVenue(edition);
        const location = new Location({
            position: 3,
            name: "Purged Room",
            externalKey: null,
            edition: ref(edition),
            venue: ref(purgedVenue),
        });
        const customField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Purged customField",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.tracks.add(track);
        customField.sessionTypes.add(sessionType);

        // The session references the edition's own session type and track,
        // which is exactly what forces the purge to delete sessions before
        // the cascade reaches the session types.
        const host = new User({
            externalId: "purge-host",
            displayName: "Purge Host",
            emailAddress: "purge-host@example.test",
        });
        const session = buildSession(edition, sessionType, {
            title: "Purged Session",
            track: ref(track),
        });
        session.state = "accepted";
        session.hosts.add(buildHost(edition, host));
        const transition = new SessionTransition({
            session: ref(session),
            actor: ref(host),
            fromState: "submitted",
            toState: "accepted",
            note: null,
        });
        const hostInvite = new SessionHostInvite({
            emailAddress: "purge-invitee@example.test",
            session: ref(session),
            createdBy: ref(host),
        });
        const sessionResponse = Response.sessionResponse(ref(customField), ref(session), "purged");
        const slot = new Slot({
            startsAt: Temporal.Instant.from("2028-06-01T09:00:00Z"),
            endsAt: Temporal.Instant.from("2028-06-01T10:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 0 }),
            teardownTime: Temporal.Duration.from({ minutes: 0 }),
            schedule: ref(schedule),
            session: ref(session),
            location: ref(location),
        });

        const survivorEdition = buildEdition({ name: "Survivor Edition" });
        const survivorSessionType = SessionType.default(ref(survivorEdition));
        const survivorSession = buildSession(survivorEdition, survivorSessionType, {
            title: "Survivor Session",
        });

        await fork
            .persist([
                track,
                location,
                customField,
                host,
                session,
                transition,
                hostInvite,
                sessionResponse,
                slot,
                survivorEdition,
                survivorSessionType,
                survivorSession,
            ])
            .flush();

        // A visible edit first, so a counter row exists for the delete to remove.
        const version = await editionVersion(em, editionId);
        const rename = await jsonApi.patch(`/editions/${editionId}`, managerToken, {
            data: {
                type: "edition",
                id: editionId,
                attributes: { name: "Purged Edition, renamed" },
                meta: { version },
            },
        });
        assert.equal(rename.status, 200);
        assert.equal(await em.fork().count(EditionRevision, { editionId }), 1);

        const purge = await jsonApi.delete(`/editions/${editionId}`, managerToken);
        assert.equal(purge.status, 204);

        const readFork = em.fork();
        assert.equal(await readFork.count(Edition, { id: editionId }), 0);
        assert.equal(await readFork.count(EditionRevision, { editionId }), 0);
        assert.equal(await readFork.count(Schedule, { id: schedule.id }), 0);
        assert.equal(await readFork.count(SessionType, { id: sessionType.id }), 0);
        assert.equal(await readFork.count(Track, { id: track.id }), 0);
        assert.equal(await readFork.count(Location, { id: location.id }), 0);
        assert.equal(await readFork.count(CustomField, { id: customField.id }), 0);
        assert.equal(await readFork.count(Session, { id: session.id }), 0);
        assert.equal(await readFork.count(SessionTransition, { id: transition.id }), 0);
        assert.equal(await readFork.count(SessionHostInvite, { id: hostInvite.id }), 0);
        assert.equal(await readFork.count(Response, { id: sessionResponse.id }), 0);
        assert.equal(await readFork.count(Slot, { id: slot.id }), 0);

        assert.equal(await readFork.count(Edition, { id: survivorEdition.id }), 1);
        assert.equal(await readFork.count(Session, { id: survivorSession.id }), 1);
        assert.equal(await readFork.count(User, { id: host.id }), 1);
    });

    it("purges an edition against a writer holding its schedules", async () => {
        const fork = em.fork();
        const edition = buildEdition({ name: "Contended Edition" });
        const sessionType = SessionType.default(ref(edition));
        const session = buildSession(edition, sessionType, { title: "Contended Session" });
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });

        await fork.persist([edition, sessionType, session, schedule]).flush();

        // The order a transition handler takes: the draft schedule, then the
        // session. The delete cascades to the schedules last, so clearing the
        // sessions before taking them closes a cycle against this.
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.find(
                Schedule,
                { edition: edition.id },
                { fields: ["id"], lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: "asc" } },
            );
            taken.resolve();
            await held.promise;
            await em.find(
                Session,
                { edition: edition.id },
                { fields: ["id"], lockMode: LockMode.PESSIMISTIC_WRITE },
            );
        });

        // Without this the delete can win the race, take everything and
        // commit, leaving nothing to block on and no contention to prove.
        await taken.promise;

        const purge = send(jsonApi.delete(`/editions/${edition.id}`, managerToken));

        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;
        const response = await purge;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Edition, { id: edition.id }), 0);
    });

    it("copies template contents into a new edition", async () => {
        const response = await jsonApi.post("/editions", managerToken, {
            data: {
                type: "edition",
                attributes: {
                    name: "Copied Edition",
                    startDate: "2029-09-01",
                    endDate: "2029-09-03",
                    timeZone: "Europe/Berlin",
                    submissionDeadline: null,
                },
                relationships: {
                    templateEdition: {
                        data: { type: "edition", id: templateEditionId },
                    },
                },
            },
        });

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: { id: string; attributes: { sessionFieldOptions: unknown } };
        };
        assert.deepEqual(document.data.attributes.sessionFieldOptions, {
            abstract: { requirement: "required" },
        });

        const copiedEditionId = document.data.id;
        const fork = em.fork();

        const sessionTypes = await fork.find(
            SessionType,
            { edition: copiedEditionId },
            { orderBy: { name: "asc" } },
        );
        assert.deepEqual(
            sessionTypes.map((sessionType) => sessionType.name),
            ["Default", "Workshop"],
        );
        assert.deepEqual(
            sessionTypes.map((sessionType) => sessionType.selectionDefault),
            [true, false],
        );
        // A copy keeps the external key on purpose: the mapping a consumer
        // built against last year's edition still resolves against this one.
        assert.deepEqual(
            sessionTypes.map((sessionType) => sessionType.externalKey),
            ["default", "workshop"],
        );

        const tracks = await fork.find(Track, { edition: copiedEditionId });
        assert.equal(tracks.length, 1);
        assert.equal(tracks[0].name, "Main Track");
        assert.equal(tracks[0].internal, true);
        assert.equal(tracks[0].externalKey, "main");

        const venues = await fork.find(Venue, { edition: copiedEditionId });
        assert.deepEqual(venues.map((venue) => venue.name).sort(), ["Main Venue", "Second Venue"]);
        assert.deepEqual(venues.map((venue) => venue.externalKey).sort(), [
            "main-venue",
            "second-venue",
        ]);

        const locations = await fork.find(Location, { edition: copiedEditionId });
        // Both sides are Ref<Venue>, so a spread carrying the template's venue
        // across the boundary typechecks and only this catches it.
        const secondCopy = venues.find((venue) => venue.externalKey === "second-venue");
        assert(secondCopy);
        assert.deepEqual(
            locations.map((location) => location.venue.id),
            [secondCopy.id],
        );
        assert.deepEqual(
            locations.map((location) => location.name),
            ["Main Hall"],
        );
        // Intervals are anchored to the dates of the edition they were stated
        // for, so a copy would place every one of them outside its own window.
        assert.equal(
            await fork.count(LocationAvailability, { location: { edition: copiedEditionId } }),
            0,
        );
        assert.equal(
            await fork.count(LocationAvailability, { location: { edition: templateEditionId } }),
            1,
        );
        assert.deepEqual(
            locations.map((location) => location.externalKey),
            ["main-hall"],
        );

        const customFields = await fork.find(
            CustomField,
            { edition: copiedEditionId },
            { populate: ["sessionTypes", "tracks"] },
        );
        assert.equal(customFields.length, 1);
        const copiedCustomField = customFields[0];
        assert.equal(copiedCustomField.title, "Do you need catering?");
        assert.equal(copiedCustomField.externalKey, "catering");
        assert.equal(copiedCustomField.deadline, null);
        assert.equal(copiedCustomField.freezeAfter, null);
        assert.equal(copiedCustomField.requirement, "always_optional");
        assert.deepEqual(
            copiedCustomField.sessionTypes.map((sessionType) => sessionType.id),
            [sessionTypes[1].id],
        );
        assert.deepEqual(
            copiedCustomField.tracks.map((track) => track.id),
            [tracks[0].id],
        );
    });

    describe("version", () => {
        type VersionDirective = {
            version: number;
        };

        const rename = (name: string, meta?: VersionDirective) =>
            jsonApi.patch(`/editions/${patchableEditionId}`, managerToken, {
                data: {
                    type: "edition",
                    id: patchableEditionId,
                    attributes: { name },
                    ...(meta && { meta }),
                },
            });

        it("refuses a patch naming a version another write has moved past", async () => {
            const version = await editionVersion(em, patchableEditionId);

            assert.equal((await rename("First save", { version })).status, 200);

            const response = await rename("Stale save", { version });

            await expectJsonApiError(response, 409, "edition_changed");
            const stored = await em.fork().findOneOrFail(Edition, patchableEditionId);
            assert.equal(stored.name, "First save");
        });

        it("answers with the version the next save has to name", async () => {
            const version = await editionVersion(em, patchableEditionId);

            const first = await rename("First save", { version });
            assert.equal(first.status, 200);
            const document = await first.json<{ data: { meta: VersionDirective } }>();
            assert.equal(document.data.meta.version, version + 1);

            const second = await rename("Second save", document.data.meta);
            assert.equal(second.status, 200);
        });

        it("refuses a patch that names no version", async () => {
            const response = await rename("Unversioned save");

            assert.equal(response.status, 422);
            const document = await response.json<{
                errors: { code: string; source: { pointer: string } }[];
            }>();
            assert.equal(document.errors[0]?.code, "invalid_type");
            assert.equal(document.errors[0]?.source.pointer, "/data/meta");
            const stored = await em.fork().findOneOrFail(Edition, patchableEditionId);
            assert.equal(stored.name, "Patchable Edition");
        });
    });
});
