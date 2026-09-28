import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import type { SessionState } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type SessionDocument = {
    data: {
        id: string;
        meta?: {
            hostTransitions?: SessionState[];
            managerTransitions?: SessionState[];
            hosting?: boolean;
        };
    };
};

type SessionListDocument = {
    data: {
        id: string;
        attributes: { title: string };
        meta?: {
            hostTransitions?: SessionState[];
            managerTransitions?: SessionState[];
            hosting?: boolean;
        };
    }[];
    meta?: { total?: number };
};

const readList = async (response: TestResponse): Promise<SessionListDocument> => {
    assert.equal(response.status, 200);

    return (await response.json()) as SessionListDocument;
};

const titlesOf = (document: SessionListDocument): string[] =>
    document.data.map((resource) => resource.attributes.title).sort();

describe("sessions filters and transitions", () => {
    let managerToken: string;
    let viewerToken: string;
    let hostToken: string;
    let strangerToken: string;
    let editionId: string;
    let talkTypeId: string;
    let workshopTypeId: string;
    let hostedSubmittedId: string;
    let acceptedId: string;

    before(async () => {
        [managerToken, viewerToken, hostToken, strangerToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("speaker"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const { user: viewer, team: viewerTeam } = buildTeamMember("speaker", "viewer");
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({ name: "Filter Edition" });
        const talkType = SessionType.default(ref(edition));
        const workshopType = new SessionType({
            name: "Workshop",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ minutes: 90 }),
            internal: false,
            selectionDefault: false,
            edition: ref(edition),
        });

        const hostRecord = buildHost(edition, host);

        // The viewer co-hosts the accepted session and nothing else, which is
        // what tells host-ness apart from the team role: the same caller must
        // be answered differently for two rows of the same list.
        const viewerHostRecord = buildHost(edition, viewer);

        // The host owns one submitted and one accepted session, so the two
        // rows that differ by state can be told apart per actor.
        const hostedSubmitted = buildSession(edition, talkType, {
            title: "Opening keynote",
        });
        hostedSubmitted.hosts.add(hostRecord);

        const accepted = buildSession(edition, talkType, { title: "Closing panel" });
        accepted.state = "accepted";
        accepted.hosts.add(hostRecord);
        accepted.hosts.add(viewerHostRecord);

        // A literal percent in the title, to tell an escaped wildcard from one
        // that reached the pattern intact.
        const discount = buildSession(edition, workshopType, {
            title: "Saving 50% of your build time",
        });

        const foreign = buildSession(edition, workshopType, { title: "Unrelated workshop" });

        // Decoys for the escaping tests.
        const scaling = buildSession(edition, talkType, { title: "Scaling to 500 nodes" });
        const artOf = buildSession(edition, talkType, { title: "The art of testing" });

        await fork
            .persist([
                manager,
                team,
                viewer,
                viewerTeam,
                host,
                stranger,
                edition,
                talkType,
                workshopType,
                hostRecord,
                viewerHostRecord,
                hostedSubmitted,
                accepted,
                discount,
                foreign,
                scaling,
                artOf,
            ])
            .flush();

        editionId = edition.id;
        talkTypeId = talkType.id;
        workshopTypeId = workshopType.id;
        hostedSubmittedId = hostedSubmitted.id;
        acceptedId = accepted.id;
    });

    const list = (token: string, query = "") =>
        jsonApi.get(`/editions/${editionId}/sessions${query}`, token);

    const show = (token: string, sessionId: string) =>
        jsonApi.get(`/editions/${editionId}/sessions/${sessionId}`, token);

    const meSessions = (token: string) => jsonApi.get(`/editions/${editionId}/me/sessions`, token);

    describe("filter[search]", () => {
        it("matches part of a title without regard to case", async () => {
            const document = await readList(await list(managerToken, "?filter[search]=KEYNOTE"));

            assert.deepEqual(titlesOf(document), ["Opening keynote"]);
        });

        it("matches a percent sign as a character rather than a wildcard", async () => {
            // "Scaling to 500 nodes" carries "50" without the percent, so an
            // unescaped term would match it too.
            const document = await readList(await list(managerToken, "?filter[search]=50%25"));

            assert.deepEqual(titlesOf(document), ["Saving 50% of your build time"]);
        });

        it("matches a leading percent sign as a character rather than a wildcard", async () => {
            // "The art of testing" carries " of" without the percent, so an
            // unescaped term would match it too.
            const document = await readList(await list(managerToken, "?filter[search]=%25 of"));

            assert.deepEqual(titlesOf(document), ["Saving 50% of your build time"]);
        });

        it("refuses a term longer than the cap", async () => {
            const response = await list(managerToken, `?filter[search]=${"a".repeat(201)}`);

            await expectJsonApiError(response, 400, "too_big");
        });
    });

    describe("filter[sessionType]", () => {
        it("narrows to one type", async () => {
            const document = await readList(
                await list(managerToken, `?filter[sessionType]=${workshopTypeId}`),
            );

            assert.deepEqual(titlesOf(document), [
                "Saving 50% of your build time",
                "Unrelated workshop",
            ]);
        });

        it("combines with another filter rather than replacing it", async () => {
            const document = await readList(
                await list(
                    managerToken,
                    `?filter[sessionType]=${talkTypeId}&filter[state]=accepted`,
                ),
            );

            assert.deepEqual(titlesOf(document), ["Closing panel"]);
        });
    });

    describe("meta.total", () => {
        it("counts every match rather than the page served", async () => {
            const document = await readList(await list(managerToken, "?page[size]=2"));

            assert.equal(document.data.length, 2);
            assert.equal(document.meta?.total, 6);
        });

        it("counts what the filters matched", async () => {
            const document = await readList(
                await list(managerToken, `?filter[sessionType]=${workshopTypeId}&page[size]=1`),
            );

            assert.equal(document.data.length, 1);
            assert.equal(document.meta?.total, 2);
        });

        it("counts the whole edition for a viewer, the same as for a manager", async () => {
            // The route admits any team role and narrows for none of them, so
            // a viewer counts what a manager counts.
            const document = await readList(await list(viewerToken));

            assert.equal(document.meta?.total, 6);
        });
    });

    describe("who may read the list", () => {
        it("refuses a caller on no team", async () => {
            await expectJsonApiError(await list(strangerToken), 403, "forbidden");
        });

        it("refuses a host, who reads their own sessions elsewhere", async () => {
            // Hosting a session in the edition is not a way onto the list; the
            // speaker routes are.
            await expectJsonApiError(await list(hostToken), 403, "forbidden");
        });
    });

    describe("meta transitions", () => {
        it("offers a manager the transitions a manager may make", async () => {
            const document = await readList(await list(managerToken));
            const submitted = document.data.find((resource) => resource.id === hostedSubmittedId);

            assert.deepEqual(submitted?.meta?.managerTransitions?.toSorted(), [
                "accepted",
                "rejected",
            ]);
            assert.deepEqual(submitted?.meta?.hostTransitions, []);
        });

        it("offers a viewer nothing, on a session they neither host nor manage", async () => {
            const document = await readList(await list(viewerToken));
            const submitted = document.data.find((resource) => resource.id === hostedSubmittedId);

            assert.deepEqual(submitted?.meta?.hostTransitions, []);
            assert.deepEqual(submitted?.meta?.managerTransitions, []);
        });

        // The two sets are what keeps each surface to its own role: this caller
        // may move the session, but only as its host, so the management section
        // has nothing to offer them and the speaker's page has everything.
        it("offers a viewer the host transitions on a session they host", async () => {
            const document = await readList(await list(viewerToken));
            const own = document.data.find((resource) => resource.id === acceptedId);

            assert.deepEqual(own?.meta?.hostTransitions?.toSorted(), ["canceled", "confirmed"]);
            assert.deepEqual(own?.meta?.managerTransitions, []);
        });

        // Neither list answers this on its own: a host is named even where the
        // state leaves them no move, and that is what the invite controls turn
        // on rather than the moves.
        it("names which sessions the caller hosts, move or no move", async () => {
            const document = await readList(await list(viewerToken));
            const own = document.data.find((resource) => resource.id === acceptedId);
            const other = document.data.find((resource) => resource.id === hostedSubmittedId);

            assert.equal(own?.meta?.hosting, true);
            assert.equal(other?.meta?.hosting, false);
        });

        it("offers that same viewer nothing on a session they do not host", async () => {
            const document = await readList(await list(viewerToken));
            const other = document.data.find((resource) => resource.id === hostedSubmittedId);

            assert.deepEqual(other?.meta?.hostTransitions, []);
        });

        it("offers a host the transition only a host may make", async () => {
            const document = await readList(await meSessions(hostToken));
            const submitted = document.data.find((resource) => resource.id === hostedSubmittedId);

            assert.deepEqual(submitted?.meta?.hostTransitions, ["withdrawn"]);
        });

        it("answers per state rather than per session", async () => {
            const document = await readList(await meSessions(hostToken));
            const accepted = document.data.find((resource) => resource.id === acceptedId);

            assert.deepEqual(accepted?.meta?.hostTransitions?.toSorted(), [
                "canceled",
                "confirmed",
            ]);
        });

        it("serves the same answer from the session's own route", async () => {
            const response = await show(hostToken, hostedSubmittedId);
            assert.equal(response.status, 200);

            const document = (await response.json()) as SessionDocument;

            assert.deepEqual(document.data.meta?.hostTransitions, ["withdrawn"]);
        });
    });
});
