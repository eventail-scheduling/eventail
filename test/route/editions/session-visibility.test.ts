import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Host } from "../../../src/entity/Host.js";
import { Location } from "../../../src/entity/Location.js";
import { Response } from "../../../src/entity/Response.js";
import { Schedule } from "../../../src/entity/Schedule.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Slot } from "../../../src/entity/Slot.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import {
    buildEdition,
    buildHost,
    buildSession,
    buildSuperAdmin,
    buildTeamMember,
} from "../../setup/fixtures.js";
import { expectJsonApiError, expectNoAttributes, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type SessionListDocument = {
    data: { id: string }[];
};

const readListedIds = async (response: TestResponse): Promise<string[]> => {
    assert.equal(response.status, 200);
    const document = (await response.json()) as SessionListDocument;

    return document.data.map((resource) => resource.id);
};

describe("session-visibility", () => {
    let strangerToken: string;
    let superAdminToken: string;
    let viewerToken: string;
    let integrationToken: string;
    let managerToken: string;
    let confirmedSessionId: string;
    let editionId: string;
    let foreignEditionId: string;
    let strangerSessionId: string;
    let hostSessionId: string;
    let unhostedSessionId: string;

    before(async () => {
        [strangerToken, superAdminToken, viewerToken, integrationToken, managerToken] =
            await Promise.all([
                fetchAccessToken("stranger"),
                fetchAccessToken("admin"),
                fetchAccessToken("testuser"),
                fetchAccessToken("integration"),
                fetchAccessToken("testhost"),
            ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });
        // The host doubles as a manager team member for the email visibility
        // cases, which must not ride on the superadmin claim.
        const { user: host, team: managerTeam } = buildTeamMember("testhost", "manager", {
            displayName: "Test Host",
            emailAddress: "host@example.test",
            teamName: "Visibility Managers",
        });
        // Both rows are deliberately team-less: the list's gate and the clamp
        // that still narrows `show` both key on team membership, so the
        // superadmin claim is the only thing separating these two identities.
        const superAdmin = buildSuperAdmin();

        const edition = buildEdition({ name: "Visibility Edition" });
        const sessionType = SessionType.default(ref(edition));
        const foreignEdition = buildEdition({ name: "Foreign Visibility Edition" });
        const foreignSessionType = SessionType.default(ref(foreignEdition));

        const foreignHost = buildHost(foreignEdition, host);

        const strangerSession = buildSession(edition, sessionType, { title: "Stranger session" });
        strangerSession.hosts.add(buildHost(edition, stranger));
        const hostSession = buildSession(edition, sessionType, { title: "Other host session" });
        hostSession.hosts.add(buildHost(edition, host));
        const unhostedSession = buildSession(edition, sessionType, { title: "Unhosted session" });

        const foreignSession = buildSession(foreignEdition, foreignSessionType, {
            title: "Foreign session",
        });
        foreignSession.hosts.add(foreignHost);

        // Lives in the foreign edition so the list-order assertions on the home
        // edition stay untouched; the integration can only read confirmed
        // sessions.
        const confirmedSession = buildSession(foreignEdition, foreignSessionType, {
            title: "Confirmed foreign session",
        });
        confirmedSession.state = "confirmed";
        confirmedSession.hosts.add(foreignHost);

        const { user: viewer, team: viewerTeam } = buildTeamMember("testuser", "viewer", {
            displayName: "Test Viewer",
            emailAddress: "viewer@example.test",
            teamName: "Viewers",
        });

        // Global read access and a session of their own, which is the pair that
        // separates a per-session confidentiality rule from a per-request one.
        hostSession.hosts.add(buildHost(edition, viewer));

        await fork
            .persist([
                stranger,
                host,
                superAdmin,
                edition,
                sessionType,
                foreignEdition,
                foreignSessionType,
                strangerSession,
                hostSession,
                unhostedSession,
                foreignSession,
                confirmedSession,
                viewer,
                viewerTeam,
                managerTeam,
            ])
            .flush();

        editionId = edition.id;
        foreignEditionId = foreignEdition.id;
        confirmedSessionId = confirmedSession.id;
        strangerSessionId = strangerSession.id;
        hostSessionId = hostSession.id;
        unhostedSessionId = unhostedSession.id;
    });

    const listSessions = (token: string, targetEditionId: string) =>
        jsonApi.get(`/editions/${targetEditionId}/sessions`, token);

    const showSession = (token: string, targetSessionId: string) =>
        jsonApi.get(`/editions/${editionId}/sessions/${targetSessionId}`, token);

    it("refuses the list to a team-less user, whatever they host", async () => {
        await expectJsonApiError(await listSessions(strangerToken, editionId), 403, "forbidden");
        await expectJsonApiError(
            await listSessions(strangerToken, foreignEditionId),
            403,
            "forbidden",
        );
    });

    it("refuses another host's session to a team-less user", async () => {
        const own = await showSession(strangerToken, strangerSessionId);
        assert.equal(own.status, 200);

        const foreign = await showSession(strangerToken, hostSessionId);
        await expectJsonApiError(foreign, 403, "forbidden");

        const invented = await showSession(strangerToken, "01a00800-0000-7000-8000-00000000ffff");
        await expectJsonApiError(invented, 404, "not_found");
    });

    it("serves every session to a superadmin without team memberships", async () => {
        const listedIds = await readListedIds(await listSessions(superAdminToken, editionId));

        assert.deepEqual(listedIds, [unhostedSessionId, hostSessionId, strangerSessionId]);
    });

    it("serves another host's session to a superadmin without team memberships", async () => {
        const response = await showSession(superAdminToken, hostSessionId);

        assert.equal(response.status, 200);
        const document = (await response.json()) as { data: { id: string } };
        assert.equal(document.data.id, hostSessionId);
    });

    // Sessions reach an integration only as part of the current schedule
    // document, so neither session route is on its surface.
    it("turns an integration away from the session routes", async () => {
        await expectJsonApiError(
            await jsonApi.get(`/editions/${editionId}/sessions`, integrationToken),
            403,
            "forbidden",
        );
        await expectJsonApiError(
            await jsonApi.get(
                `/editions/${editionId}/sessions/${confirmedSessionId}`,
                integrationToken,
            ),
            403,
            "forbidden",
        );
    });

    describe("host email visibility", () => {
        type IncludedHostsDocument = {
            included?: {
                type: string;
                attributes?: { displayName: string; emailAddress?: string };
                relationships?: { responses?: { data: { id: string }[] } };
            }[];
        };

        const readIncludedHosts = async (response: TestResponse) => {
            assert.equal(response.status, 200);
            const document = (await response.json()) as IncludedHostsDocument;
            const hosts = (document.included ?? []).filter((resource) => resource.type === "host");
            assert.ok(hosts.length > 0);
            return hosts;
        };

        it("serves host email addresses to managers and admins", async () => {
            const hosts = await readIncludedHosts(
                await showSession(superAdminToken, hostSessionId),
            );
            assert.ok(hosts.every((host) => host.attributes?.emailAddress !== undefined));

            const managerSeen = await readIncludedHosts(
                await showSession(managerToken, strangerSessionId),
            );
            assert.ok(managerSeen.every((host) => host.attributes?.emailAddress !== undefined));
        });

        // Absence would claim the host answered nothing, so only a fieldset may
        // drop the relationship.
        it("carries host response linkage in a list that does not include them", async () => {
            const listed = await readIncludedHosts(
                await jsonApi.get(`/editions/${editionId}/sessions?include=hosts`, managerToken),
            );
            assert.ok(listed.every((host) => host.relationships?.responses !== undefined));

            const excluded = await readIncludedHosts(
                await jsonApi.get(
                    `/editions/${editionId}/sessions?include=hosts&fields[host]=displayName`,
                    managerToken,
                ),
            );
            assert.ok(excluded.every((host) => host.relationships?.responses === undefined));
        });

        it("honors a manager's fieldset naming the email address", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/sessions?include=hosts&fields[host]=emailAddress`,
                managerToken,
            );
            const hosts = await readIncludedHosts(response);
            assert.ok(
                hosts.every(
                    (host) =>
                        host.attributes?.emailAddress !== undefined &&
                        host.attributes.displayName === undefined,
                ),
            );
        });

        it("hides host email addresses from viewers", async () => {
            const hosts = await readIncludedHosts(await showSession(viewerToken, hostSessionId));
            assert.ok(hosts.every((host) => host.attributes?.emailAddress === undefined));
        });

        it("hides co-host email addresses from hosts themselves", async () => {
            const hosts = await readIncludedHosts(
                await showSession(strangerToken, strangerSessionId),
            );
            assert.ok(hosts.every((host) => host.attributes?.emailAddress === undefined));
        });

        it("ignores a fieldset that requests the email address", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/sessions?include=hosts&fields[host]=emailAddress`,
                viewerToken,
            );
            expectNoAttributes(await readIncludedHosts(response));
        });
    });

    describe("confidential response visibility", () => {
        let visibleResponseId: string;
        let confidentialResponseId: string;
        let strangerHostConfidentialResponseId: string;
        let integrationVisibleResponseId: string;
        let integrationConfidentialResponseId: string;
        let scheduleId: string;
        let viewerSessionConfidentialResponseId: string;
        let viewerHostConfidentialResponseId: string;
        let viewerCoHostConfidentialResponseId: string;
        let strangerHostId: string;
        let viewerCoHostId: string;

        type ResponseDocument = {
            included?: { type: string; id: string }[];
        };

        const readIncludedResponseIds = async (response: TestResponse): Promise<string[]> => {
            assert.equal(response.status, 200);
            const document = (await response.json()) as ResponseDocument;

            return (document.included ?? [])
                .filter((resource) => resource.type === "response")
                .map((resource) => resource.id);
        };

        beforeEach(async () => {
            const fork = em.fork();
            const edition = await fork.findOneOrFail(Edition, editionId);
            const session = await fork.findOneOrFail(Session, strangerSessionId);
            const visibleCustomField = new CustomField({
                position: 0,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Anything to add?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            const confidentialCustomField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Any accessibility needs?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(edition),
            });
            const visibleResponse = Response.sessionResponse(
                ref(visibleCustomField),
                ref(session),
                "a remark",
            );
            const confidentialResponse = Response.sessionResponse(
                ref(confidentialCustomField),
                ref(session),
                "a private need",
            );

            const viewerHostedSession = await fork.findOneOrFail(Session, hostSessionId);
            const viewerSessionConfidentialResponse = Response.sessionResponse(
                ref(confidentialCustomField),
                ref(viewerHostedSession),
                "only its hosts see this",
            );

            const stranger = await fork.findOneOrFail(User, { externalId: "stranger" });
            const hostConfidentialCustomField = new CustomField({
                position: 2,
                externalKey: null,
                target: "per_host",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Any dietary requirements?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(edition),
            });
            const strangerHost = await fork.findOneOrFail(Host, { edition, user: stranger });
            const strangerHostConfidentialResponse = Response.hostResponse(
                ref(hostConfidentialCustomField),
                ref(strangerHost),
                "vegan",
            );

            const viewer = await fork.findOneOrFail(User, { externalId: "testuser" });
            const viewerHost = await fork.findOneOrFail(Host, { edition, user: viewer });
            // Both host answers hang off the same field, so a pass can only come
            // from the clamp keying on the host row rather than on the field.
            const viewerHostConfidentialResponse = Response.hostResponse(
                ref(hostConfidentialCustomField),
                ref(viewerHost),
                "no peanuts",
            );

            // The stranger hosts a session of their own, so filtering by the
            // reader's sessions rather than their host row would still hide the
            // stranger's answer. Only a co-host on the reader's own session
            // separates those two rules.
            const coHostUser = await fork.findOneOrFail(User, { externalId: "testhost" });
            const viewerCoHost = await fork.findOneOrFail(Host, { edition, user: coHostUser });
            const viewerCoHostConfidentialResponse = Response.hostResponse(
                ref(hostConfidentialCustomField),
                ref(viewerCoHost),
                "no dairy",
            );

            // The integration only reads confirmed sessions, which live in the
            // foreign edition.
            const foreignEdition = await fork.findOneOrFail(Edition, foreignEditionId);
            const foreignSession = await fork.findOneOrFail(Session, confirmedSessionId);
            const integrationVisibleCustomField = new CustomField({
                position: 3,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Public talk abstract addendum?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(foreignEdition),
            });
            const integrationConfidentialCustomField = new CustomField({
                position: 4,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Travel reimbursement details?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(foreignEdition),
            });
            const integrationVisibleResponse = Response.sessionResponse(
                ref(integrationVisibleCustomField),
                ref(foreignSession),
                "an addendum",
            );
            const integrationConfidentialResponse = Response.sessionResponse(
                ref(integrationConfidentialCustomField),
                ref(foreignSession),
                "bank details",
            );

            // An integration reads only the current publication, and the
            // responses load only for a confirmed session in a published
            // schedule.
            const publishedSchedule = new Schedule({ edition: ref(foreignEdition), sequence: 1 });
            publishedSchedule.publish(foreignEdition, Temporal.Now.instant());
            const foreignLocation = new Location({
                position: 0,
                name: "Integration Room",
                externalKey: null,
                edition: ref(foreignEdition),
            });
            const publishedSlot = new Slot({
                startsAt: Temporal.Instant.from("2027-11-03T09:00:00Z"),
                endsAt: Temporal.Instant.from("2027-11-03T10:00:00Z"),
                setupTime: Temporal.Duration.from({ minutes: 0 }),
                teardownTime: Temporal.Duration.from({ minutes: 0 }),
                schedule: ref(publishedSchedule),
                session: ref(foreignSession),
                location: ref(foreignLocation),
            });

            const schedule = new Schedule({ edition: ref(edition), sequence: 1 });
            const location = new Location({
                position: 1,
                name: "Response Room",
                externalKey: null,
                edition: ref(edition),
            });
            const slot = new Slot({
                startsAt: Temporal.Instant.from("2027-11-02T09:00:00Z"),
                endsAt: Temporal.Instant.from("2027-11-02T10:00:00Z"),
                setupTime: Temporal.Duration.from({ minutes: 0 }),
                teardownTime: Temporal.Duration.from({ minutes: 0 }),
                schedule: ref(schedule),
                session: ref(session),
                location: ref(location),
            });

            await fork
                .persist([
                    visibleCustomField,
                    confidentialCustomField,
                    visibleResponse,
                    confidentialResponse,
                    viewerSessionConfidentialResponse,
                    hostConfidentialCustomField,
                    strangerHostConfidentialResponse,
                    viewerHostConfidentialResponse,
                    viewerCoHostConfidentialResponse,
                    integrationVisibleCustomField,
                    integrationConfidentialCustomField,
                    integrationVisibleResponse,
                    integrationConfidentialResponse,
                    schedule,
                    location,
                    slot,
                    publishedSchedule,
                    foreignLocation,
                    publishedSlot,
                ])
                .flush();

            visibleResponseId = visibleResponse.id;
            confidentialResponseId = confidentialResponse.id;
            viewerSessionConfidentialResponseId = viewerSessionConfidentialResponse.id;
            strangerHostConfidentialResponseId = strangerHostConfidentialResponse.id;
            viewerHostConfidentialResponseId = viewerHostConfidentialResponse.id;
            viewerCoHostConfidentialResponseId = viewerCoHostConfidentialResponse.id;
            strangerHostId = strangerHost.id;
            viewerCoHostId = viewerCoHost.id;
            integrationVisibleResponseId = integrationVisibleResponse.id;
            integrationConfidentialResponseId = integrationConfidentialResponse.id;
            scheduleId = schedule.id;
        });

        it("hides confidential responses from viewers", async () => {
            const responseIds = await readIncludedResponseIds(
                await showSession(viewerToken, strangerSessionId),
            );
            assert.ok(responseIds.includes(visibleResponseId));
            assert.equal(responseIds.includes(confidentialResponseId), false);
            // The per_host arm of the response query is clamped the same way.
            assert.equal(responseIds.includes(strangerHostConfidentialResponseId), false);
        });

        it("serves confidential responses to managers", async () => {
            const responseIds = await readIncludedResponseIds(
                await showSession(managerToken, strangerSessionId),
            );
            assert.ok(responseIds.includes(visibleResponseId));
            assert.ok(responseIds.includes(confidentialResponseId));
            assert.ok(responseIds.includes(strangerHostConfidentialResponseId));
        });

        it("filters confidential responses from published schedules for integrations", async () => {
            const showPublishedSchedule = (token: string) =>
                jsonApi.get(
                    `/editions/${foreignEditionId}/schedules/current?include=slots.session.responses.customField`,
                    token,
                );

            const integrationResponseIds = await readIncludedResponseIds(
                await showPublishedSchedule(integrationToken),
            );
            assert.ok(integrationResponseIds.includes(integrationVisibleResponseId));
            assert.equal(integrationResponseIds.includes(integrationConfidentialResponseId), false);

            const managerResponseIds = await readIncludedResponseIds(
                await showPublishedSchedule(managerToken),
            );
            assert.ok(managerResponseIds.includes(integrationConfidentialResponseId));
        });

        const showScheduleCustomFields = (token: string) =>
            jsonApi.get(
                `/editions/${foreignEditionId}/schedules/current?include=slots.session.responses.customField`,
                token,
            );

        const readIncludedCustomFieldKeys = async (
            response: TestResponse,
        ): Promise<Set<string>> => {
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                included?: { type: string; attributes?: Record<string, unknown> }[];
            };
            const customFields = (document.included ?? []).filter(
                (resource) => resource.type === "custom_field",
            );
            assert.ok(customFields.length > 0);

            return new Set(
                customFields.flatMap((resource) => Object.keys(resource.attributes ?? {})),
            );
        };

        it("narrows embedded custom fields for integrations", async () => {
            const integrationKeys = await readIncludedCustomFieldKeys(
                await showScheduleCustomFields(integrationToken),
            );
            assert.deepEqual([...integrationKeys].sort(), [
                "externalKey",
                "options",
                "target",
                "title",
            ]);

            const managerKeys = await readIncludedCustomFieldKeys(
                await showScheduleCustomFields(managerToken),
            );
            assert.ok(managerKeys.has("confidential"));
            assert.ok(managerKeys.has("position"));
            assert.ok(managerKeys.has("requirement"));
        });

        it("ignores a fieldset that requests a narrowed custom field attribute", async () => {
            const response = await jsonApi.get(
                `/editions/${foreignEditionId}/schedules/current` +
                    "?include=slots.session.responses.customField" +
                    "&fields[custom_field]=confidential,position",
                integrationToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                included?: { type: string; attributes?: Record<string, unknown> }[];
            };
            const customFields = (document.included ?? []).filter(
                (resource) => resource.type === "custom_field",
            );

            expectNoAttributes(customFields);
        });

        it("still serves the whole definition on the config route", async () => {
            const response = await jsonApi.get(
                `/editions/${foreignEditionId}/custom-fields`,
                integrationToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: { attributes?: Record<string, unknown> }[];
            };
            assert.ok(document.data.length > 0);

            // This route carries no role layer, so it is not narrowed;
            // customFieldsRouter says why.
            const keys = new Set(
                document.data.flatMap((resource) => Object.keys(resource.attributes ?? {})),
            );
            assert.ok(keys.has("requirement"));
            assert.ok(keys.has("helperText"));
            assert.ok(keys.has("position"));
        });

        it("serves a listing host their own confidential session responses only", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/sessions?include=responses.customField`,
                viewerToken,
            );
            const responseIds = await readIncludedResponseIds(response);

            assert.ok(responseIds.includes(viewerSessionConfidentialResponseId));
            assert.equal(responseIds.includes(confidentialResponseId), false);
            assert.ok(responseIds.includes(visibleResponseId));
        });

        it("serves a listing host their own confidential host responses only", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/sessions?include=hosts.responses.customField`,
                viewerToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as ResponseDocument;
            const includedIdsOfType = (type: string) =>
                (document.included ?? [])
                    .filter((resource) => resource.type === type)
                    .map((resource) => resource.id);
            const responseIds = includedIdsOfType("response");
            const hostIds = includedIdsOfType("host");

            // Asserted rather than assumed: without both other hosts in the
            // document, the two absent answers would only prove that the listing
            // never reached them.
            assert.ok(hostIds.includes(strangerHostId));
            assert.ok(hostIds.includes(viewerCoHostId));

            assert.ok(responseIds.includes(viewerHostConfidentialResponseId));
            assert.equal(responseIds.includes(strangerHostConfidentialResponseId), false);
            assert.equal(responseIds.includes(viewerCoHostConfidentialResponseId), false);
        });

        it("serves confidential responses to the session's hosts", async () => {
            const responseIds = await readIncludedResponseIds(
                await showSession(strangerToken, strangerSessionId),
            );
            assert.ok(responseIds.includes(visibleResponseId));
            assert.ok(responseIds.includes(confidentialResponseId));
        });

        it("filters confidential responses from schedule includes for viewers", async () => {
            const showSchedule = (token: string) =>
                jsonApi.get(
                    `/editions/${editionId}/schedules/${scheduleId}?include=slots.session.responses.customField`,
                    token,
                );

            const viewerResponseIds = await readIncludedResponseIds(
                await showSchedule(viewerToken),
            );
            assert.ok(viewerResponseIds.includes(visibleResponseId));
            assert.equal(viewerResponseIds.includes(confidentialResponseId), false);

            const managerResponseIds = await readIncludedResponseIds(
                await showSchedule(managerToken),
            );
            assert.ok(managerResponseIds.includes(confidentialResponseId));
        });

        it("carries linkage for a relation nobody included, without its resources", async () => {
            const readDocument = async (path: string) => {
                const response = await jsonApi.get(path, managerToken);
                assert.equal(response.status, 200);
                return (await response.json()) as {
                    included?: {
                        type: string;
                        id: string;
                        relationships?: { responses?: { data: { id: string }[] } };
                    }[];
                };
            };

            const base = `/editions/${editionId}/schedules/${scheduleId}`;
            const document = await readDocument(
                `${base}?include=slots.session.hosts,slots.session.responses.customField`,
            );
            const hosts = (document.included ?? []).filter((resource) => resource.type === "host");

            assert.ok(hosts.length > 0);
            assert.ok(hosts.every((host) => host.relationships?.responses !== undefined));
            assert.ok(hosts.some((host) => (host.relationships?.responses?.data ?? []).length > 0));

            const responseIds = (document.included ?? [])
                .filter((resource) => resource.type === "response")
                .map((resource) => resource.id);
            const linkedIds = hosts.flatMap((host) => host.relationships?.responses?.data ?? []);

            assert.ok(linkedIds.length > 0);
            assert.ok(linkedIds.every((identifier) => !responseIds.includes(identifier.id)));
        });

        // slots.session.responses is stripped from the populate, so the forced
        // slots.session is all that loads the sessions this asserts on.
        it("serves an included session that a fieldset stripped of hosts", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/schedules/${scheduleId}` +
                    "?include=slots.session.responses.customField&fields[session]=title,responses",
                managerToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as { included?: { type: string }[] };
            const types = (document.included ?? []).map((resource) => resource.type);

            assert.ok(types.includes("session"));
            assert.ok(types.includes("response"));
        });

        // A host whose every response is confidential still belongs to the
        // session, so filtering responses must not reach the hosts themselves.
        it("keeps hosts on a schedule whose responses are all filtered away", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/schedules/${scheduleId}?include=slots.session.hosts.responses.customField`,
                viewerToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                included?: { type: string; relationships?: { hosts?: { data: unknown[] } } }[];
            };
            const hostCounts = (document.included ?? [])
                .filter((resource) => resource.type === "session")
                .map((resource) => resource.relationships?.hosts?.data.length ?? 0);

            assert.ok(hostCounts.length > 0);
            assert.ok(hostCounts.every((count) => count > 0));
        });
    });

    describe("co-host response visibility", () => {
        let coHostEditionId: string;
        let coHostedSessionId: string;
        let ownResponseId: string;
        let coHostResponseId: string;
        let sessionConfidentialResponseId: string;
        let viewerHostId: string;
        let strangerHostId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const viewer = await fork.findOneOrFail(User, { externalId: "testuser" });
            const stranger = await fork.findOneOrFail(User, { externalId: "stranger" });
            const edition = buildEdition({ name: "Co-host Edition" });
            const sessionType = SessionType.default(ref(edition));
            const session = buildSession(edition, sessionType, { title: "Shared session" });
            const viewerHost = buildHost(edition, viewer);
            const strangerHost = buildHost(edition, stranger);
            session.hosts.add(viewerHost, strangerHost);

            const customField = new CustomField({
                position: 0,
                externalKey: null,
                target: "per_host",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Any dietary requirements?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(edition),
            });
            const ownResponse = Response.hostResponse(ref(customField), ref(viewerHost), "vegan");
            const coHostResponse = Response.hostResponse(
                ref(customField),
                ref(strangerHost),
                "no shellfish",
            );

            const sessionConfidentialCustomField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Any accessibility needs?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: true,
                edition: ref(edition),
            });
            const sessionConfidentialResponse = Response.sessionResponse(
                ref(sessionConfidentialCustomField),
                ref(session),
                "step-free access",
            );

            await fork
                .persist([
                    edition,
                    sessionType,
                    session,
                    viewerHost,
                    strangerHost,
                    customField,
                    ownResponse,
                    coHostResponse,
                    sessionConfidentialCustomField,
                    sessionConfidentialResponse,
                ])
                .flush();

            coHostEditionId = edition.id;
            coHostedSessionId = session.id;
            ownResponseId = ownResponse.id;
            coHostResponseId = coHostResponse.id;
            sessionConfidentialResponseId = sessionConfidentialResponse.id;
            viewerHostId = viewerHost.id;
            strangerHostId = strangerHost.id;
        });

        const readIncludedIds = async (token: string): Promise<string[]> => {
            const response = await jsonApi.get(
                `/editions/${coHostEditionId}/sessions/${coHostedSessionId}`,
                token,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as { included?: { id: string }[] };

            return (document.included ?? []).map((resource) => resource.id);
        };

        // Both host rows have to reach the document for the absent answer to
        // mean the filter dropped it. Only the ORM's `populateWhere` default
        // keeps the reader's own clamp off the populated hosts, so the
        // assertion guards a setting this file cannot see.
        it("hides a co-host's confidential responses from a host", async () => {
            const includedIds = await readIncludedIds(viewerToken);

            assert.ok(includedIds.includes(viewerHostId));
            assert.ok(includedIds.includes(strangerHostId));
            assert.ok(includedIds.includes(ownResponseId));
            assert.equal(includedIds.includes(coHostResponseId), false);
        });

        it("hides a host's confidential responses from their co-host", async () => {
            const includedIds = await readIncludedIds(strangerToken);

            assert.ok(includedIds.includes(viewerHostId));
            assert.ok(includedIds.includes(strangerHostId));
            assert.ok(includedIds.includes(coHostResponseId));
            assert.equal(includedIds.includes(ownResponseId), false);
        });

        it("serves both hosts the confidential responses of the session itself", async () => {
            const viewerIds = await readIncludedIds(viewerToken);
            const strangerIds = await readIncludedIds(strangerToken);

            assert.ok(viewerIds.includes(sessionConfidentialResponseId));
            assert.ok(strangerIds.includes(sessionConfidentialResponseId));
        });
    });

    describe("session notes visibility", () => {
        beforeEach(async () => {
            const fork = em.fork();
            const foreignEdition = await fork.findOneOrFail(Edition, foreignEditionId);
            const session = await fork.findOneOrFail(Session, confirmedSessionId);
            session.notes = "Please do not schedule me on the Friday";

            const publishedSchedule = new Schedule({ edition: ref(foreignEdition), sequence: 1 });
            publishedSchedule.publish(foreignEdition, Temporal.Now.instant());
            const location = new Location({
                position: 2,
                name: "Notes Room",
                externalKey: null,
                edition: ref(foreignEdition),
            });
            const slot = new Slot({
                startsAt: Temporal.Instant.from("2027-11-03T11:00:00Z"),
                endsAt: Temporal.Instant.from("2027-11-03T12:00:00Z"),
                setupTime: Temporal.Duration.from({ minutes: 0 }),
                teardownTime: Temporal.Duration.from({ minutes: 0 }),
                schedule: ref(publishedSchedule),
                session: ref(session),
                location: ref(location),
            });

            await fork.persist([session, publishedSchedule, location, slot]).flush();
        });

        it("ignores a fieldset that requests the notes", async () => {
            const response = await jsonApi.get(
                `/editions/${foreignEditionId}/schedules/current` +
                    "?include=slots.session&fields[session]=notes",
                integrationToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                included?: { type: string; attributes?: Record<string, unknown> }[];
            };
            const sessions = (document.included ?? []).filter(
                (resource) => resource.type === "session",
            );

            expectNoAttributes(sessions);
        });

        it("filters notes from published schedules for integrations", async () => {
            const showPublishedSchedule = (token: string) =>
                jsonApi.get(
                    `/editions/${foreignEditionId}/schedules/current?include=slots.session`,
                    token,
                );

            const readIncludedSession = async (response: TestResponse) => {
                assert.equal(response.status, 200);
                const document = (await response.json()) as {
                    included?: { type: string; attributes?: Record<string, unknown> }[];
                };
                const session = document.included?.find((resource) => resource.type === "session");
                assert.ok(session);

                return session.attributes;
            };

            const integrationAttributes = await readIncludedSession(
                await showPublishedSchedule(integrationToken),
            );
            assert.equal(integrationAttributes?.notes, undefined);
            assert.equal(integrationAttributes?.title, "Confirmed foreign session");

            const managerAttributes = await readIncludedSession(
                await showPublishedSchedule(managerToken),
            );
            assert.equal(managerAttributes?.notes, "Please do not schedule me on the Friday");
        });
    });
});
