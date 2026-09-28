import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { HostAvailability } from "../../../src/entity/HostAvailability.js";
import { Location } from "../../../src/entity/Location.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type Document = {
    data: unknown;
    included?: {
        type: string;
        id: string;
        attributes?: { startsAt?: string; endsAt?: string };
    }[];
};

type HostResource = {
    type: string;
    id: string;
    relationships?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
};

const availabilityTimes = (document: Document): [string, string][] =>
    (document.included ?? [])
        .filter((resource) => resource.type === "host_availability")
        .map((resource) => [
            resource.attributes?.startsAt ?? "",
            resource.attributes?.endsAt ?? "",
        ]);

const hostResources = (document: Document): HostResource[] =>
    (document.included ?? []).filter(
        (resource): resource is HostResource => resource.type === "host",
    );

/**
 * Asserts the document carries hosts but no availability, as resource or as linkage.
 *
 * The host assertion is the guard on the guard: an empty document satisfies the
 * other two and says nothing about what the endpoint serves.
 */
const expectNoAvailability = (document: Document): void => {
    const hosts = hostResources(document);
    assert.ok(hosts.length > 0, "expected the document to carry a host");
    assert.deepEqual(availabilityTimes(document), []);

    for (const host of hosts) {
        assert.equal(host.relationships?.availabilities, undefined);
    }
};

describe("session host availability", () => {
    let managerToken: string;
    let speakerToken: string;
    let editionId: string;

    before(async () => {
        [managerToken, speakerToken] = await Promise.all([
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testhost", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Availability Managers",
        });
        // A viewer, because the list admits any team role while the gate here
        // turns on being a manager, leaving the role as the only thing between
        // the two callers.
        const { user: speaker, team: speakerTeam } = buildTeamMember("stranger", "viewer", {
            displayName: "Test Speaker",
            emailAddress: "speaker@example.test",
            teamName: "Availability Viewers",
        });

        const edition = buildEdition({ name: "Availability Edition" });
        const sessionType = SessionType.default(ref(edition));

        // The speaker hosts the session, so availability rows hang off a host
        // the document can reach at all.
        const session = buildSession(edition, sessionType, { title: "Shared session" });
        session.state = "confirmed";
        const speakerHost = buildHost(edition, speaker);
        session.hosts.add(speakerHost);

        // The schedule carries a real slot, so the document it serves actually
        // contains the host whose availability must not appear on it. Without
        // one the assertions below run over an empty array and prove nothing.
        const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
        const room = new Location({
            name: "Main hall",
            externalKey: null,
            position: 1,
            edition: ref(edition),
        });
        const slot = new Slot({
            startsAt: Temporal.Instant.from("2027-10-01T08:00:00Z"),
            endsAt: Temporal.Instant.from("2027-10-01T09:00:00Z"),
            setupTime: Temporal.Duration.from({ minutes: 0 }),
            teardownTime: Temporal.Duration.from({ minutes: 0 }),
            schedule: ref(schedule),
            session: ref(session),
            location: ref(room),
        });

        fork.persist([
            manager,
            team,
            speaker,
            speakerTeam,
            edition,
            sessionType,
            session,
            schedule,
            room,
            slot,

            // Out of order on purpose: the endpoint promises them sorted.
            new HostAvailability({
                startsAt: Temporal.Instant.from("2027-10-02T08:00:00Z"),
                endsAt: Temporal.Instant.from("2027-10-02T12:00:00Z"),
                host: ref(speakerHost),
            }),
            new HostAvailability({
                startsAt: Temporal.Instant.from("2027-10-01T07:00:00Z"),
                endsAt: Temporal.Instant.from("2027-10-01T10:00:00Z"),
                host: ref(speakerHost),
            }),
        ]);

        await fork.flush();
        editionId = edition.id;
    });

    it("serves a manager the hosts' availability, in order", async () => {
        const response = await jsonApi.get(
            `/editions/${editionId}/sessions?include=hosts.availabilities`,
            managerToken,
        );

        assert.equal(response.status, 200);
        assert.deepEqual(availabilityTimes(await response.json<Document>()), [
            ["2027-10-01T07:00:00Z", "2027-10-01T10:00:00Z"],
            ["2027-10-02T08:00:00Z", "2027-10-02T12:00:00Z"],
        ]);
    });

    it("leaves a speaker's own request for it unanswered rather than refused", async () => {
        const response = await jsonApi.get(
            `/editions/${editionId}/sessions?include=hosts,hosts.availabilities`,
            speakerToken,
        );

        assert.equal(response.status, 200);
        // The hosts are asked for in their own right, because only the deeper
        // path is dropped.
        expectNoAvailability(await response.json<Document>());
    });

    // Naming the field outright is the obvious way to try to talk the document
    // into carrying it. Which of the two gates answers is not this test's
    // business: removing either one on its own still leaves this passing.
    it("keeps it out of the document when fields[host] asks for it by name", async () => {
        const response = await jsonApi.get(
            `/editions/${editionId}/sessions?include=hosts,hosts.availabilities&fields%5Bhost%5D=displayName,availabilities`,
            speakerToken,
        );

        assert.equal(response.status, 200);
        expectNoAvailability(await response.json<Document>());
    });

    // The schedule document builds its own includes, so the gating proved on
    // the sessions endpoint says nothing about this one.
    it("never puts availability in the schedule document", async () => {
        const response = await jsonApi.get(
            `/editions/${editionId}/schedules/latest?include=slots.session.hosts`,
            managerToken,
        );

        assert.equal(response.status, 200);
        expectNoAvailability(await response.json<Document>());
    });
});
