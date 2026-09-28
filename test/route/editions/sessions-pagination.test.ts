import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import type { SessionState } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type SessionListDocument = {
    data: {
        id: string;
        type: string;
        attributes: { title: string; state: string };
    }[];
    links: {
        first: string | null;
        prev: string | null;
        next: string | null;
    };
};

const pageTitles = [
    "Opening keynote",
    "Type-level tricks",
    "Migrating to Temporal",
    "Cursor pagination pitfalls",
    "Testing HTTP handlers",
    "Postgres index tuning",
    "Closing panel",
];

const filterStates: SessionState[] = [
    "submitted",
    "accepted",
    "submitted",
    "confirmed",
    "submitted",
    "rejected",
    "submitted",
    "submitted",
];

const toRequestPath = (link: string): string => {
    const url = new URL(link);

    return `${url.pathname}${url.search}`;
};

const readDocument = async (response: TestResponse): Promise<SessionListDocument> => {
    assert.equal(response.status, 200);

    return (await response.json()) as SessionListDocument;
};

const expectLink = (link: string | null): string => {
    assert.ok(link !== null, "Expected a pagination link");

    return link;
};

describe("sessions-pagination", () => {
    let managerToken: string;
    let editionId: string;
    let filterEditionId: string;
    let newestFirstSessionIds: string[];
    let newestFirstSubmittedIds: string[];

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });

        const edition = buildEdition({ name: "Pagination Edition" });
        const sessionType = SessionType.default(ref(edition));
        const filterEdition = buildEdition({ name: "Filter Edition" });
        const filterSessionType = SessionType.default(ref(filterEdition));

        const sessions = pageTitles.map((title) => buildSession(edition, sessionType, { title }));
        const filterSessions = filterStates.map((state, index) => {
            const session = buildSession(filterEdition, filterSessionType, {
                title: `Filtered session ${index + 1}`,
            });
            session.state = state;

            return session;
        });

        await fork
            .persist([
                manager,
                team,
                edition,
                sessionType,
                filterEdition,
                filterSessionType,
                ...sessions,
                ...filterSessions,
            ])
            .flush();

        editionId = edition.id;
        filterEditionId = filterEdition.id;
        newestFirstSessionIds = sessions.map((session) => session.id).reverse();
        newestFirstSubmittedIds = filterSessions
            .filter((session) => session.state === "submitted")
            .map((session) => session.id)
            .reverse();
    });

    const getPath = (path: string) => jsonApi.get(path, managerToken);

    const listSessions = (query: string) => getPath(`/editions/${editionId}/sessions${query}`);

    const followLink = (link: string) => getPath(toRequestPath(link));

    it("serves the newest sessions on the first page", async () => {
        const document = await readDocument(await listSessions("?page[size]=3"));

        assert.ok(document.data.every((resource) => resource.type === "session"));
        assert.deepEqual(
            document.data.map((resource) => resource.id),
            newestFirstSessionIds.slice(0, 3),
        );
        assert.equal(document.links.first, null);
        assert.equal(document.links.prev, null);
        assert.notEqual(document.links.next, null);
    });

    it("walks the whole list through the next links", async () => {
        const firstPage = await readDocument(await listSessions("?page[size]=3"));
        const secondPage = await readDocument(await followLink(expectLink(firstPage.links.next)));

        assert.deepEqual(
            secondPage.data.map((resource) => resource.id),
            newestFirstSessionIds.slice(3, 6),
        );

        const thirdPage = await readDocument(await followLink(expectLink(secondPage.links.next)));

        assert.deepEqual(
            thirdPage.data.map((resource) => resource.id),
            newestFirstSessionIds.slice(6),
        );
        assert.equal(thirdPage.links.next, null);
        assert.notEqual(thirdPage.links.prev, null);
    });

    it("returns the first page unchanged when following the prev link back", async () => {
        const firstPage = await readDocument(await listSessions("?page[size]=3"));
        const secondPage = await readDocument(await followLink(expectLink(firstPage.links.next)));
        const backToFirst = await readDocument(await followLink(expectLink(secondPage.links.prev)));

        assert.deepEqual(
            backToFirst.data.map((resource) => resource.id),
            firstPage.data.map((resource) => resource.id),
        );
    });

    it("pages through a state filter without leaking other states", async () => {
        const collectedIds: string[] = [];
        let nextPath: string | null =
            `/editions/${filterEditionId}/sessions?filter[state]=submitted&page[size]=2`;
        let pageCount = 0;

        // Bounded so a broken next link cannot turn this into an endless loop.
        while (nextPath !== null && pageCount < 10) {
            const document = await readDocument(await getPath(nextPath));

            assert.ok(
                document.data.every((resource) => resource.attributes.state === "submitted"),
                "Filtered page contained a session in another state",
            );
            collectedIds.push(...document.data.map((resource) => resource.id));
            nextPath = document.links.next === null ? null : toRequestPath(document.links.next);
            pageCount += 1;
        }

        assert.equal(pageCount, 3);
        assert.deepEqual(collectedIds, newestFirstSubmittedIds);
    });

    it("matches any state a comma separated filter names", async () => {
        const document = await readDocument(
            await getPath(
                `/editions/${filterEditionId}/sessions?filter[state]=accepted,confirmed&page[size]=100`,
            ),
        );
        const states = new Set(document.data.map((resource) => resource.attributes.state));

        assert.ok(states.size > 0, "expected the fixture to hold both states");
        assert.deepEqual(
            [...states].toSorted(),
            ["accepted", "confirmed"],
            "a two-state filter must serve both and nothing else",
        );
    });

    it("refuses a state the enum does not name", async () => {
        const response = await getPath(
            `/editions/${filterEditionId}/sessions?filter[state]=accepted,nonsense`,
        );

        assert.equal(response.status, 400);
    });

    it("rejects a cursor that is not base64url-encoded JSON", async () => {
        const response = await listSessions("?page[after]=not-a-valid-cursor");

        await expectJsonApiError(response, 400, "custom");
        const document = (await response.json()) as {
            errors: { title: string; source: { parameter: string } }[];
        };
        assert.equal(document.errors[0]?.title, "Invalid cursor");
        assert.equal(document.errors[0]?.source.parameter, "page[after]");
    });
});
