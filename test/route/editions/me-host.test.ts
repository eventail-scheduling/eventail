import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { EditionRevision } from "../../../src/entity/EditionRevision.js";
import { Host } from "../../../src/entity/Host.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

type HostDocument = {
    data: {
        id: string;
        attributes: {
            displayName: string;
            emailAddress: string;
            biography: string;
            avatar: unknown;
        };
        relationships?: {
            responses?: { data: { id: string }[] };
            availabilities?: { data: { id: string }[] };
        };
    };
    included?: { type: string; id: string; attributes: Record<string, unknown> }[];
};

describe("me host", () => {
    let token: string;
    let editionId: string;
    let customFieldId: string;

    let strangerToken: string;
    let integrationToken: string;

    before(async () => {
        token = await fetchAccessToken("testuser");
        strangerToken = await fetchAccessToken("stranger");
        integrationToken = await fetchAccessToken("integration");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const user = new User({
            externalId: "testuser",
            displayName: "Test User",
            emailAddress: "testuser@example.test",
        });
        const edition = buildEdition({
            name: "Host Edition",
            startDate: Temporal.PlainDate.from("2027-09-01"),
            endDate: Temporal.PlainDate.from("2027-09-03"),
            profileFieldOptions: {
                displayName: {},
                emailAddress: {},
                biography: { requirement: "optional" },
                availability: { requirement: "optional" },
            },
        });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "What should we call you?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        await fork.persist([user, edition, customField]).flush();

        editionId = edition.id;
        customFieldId = customField.id;
    });

    const read = () => jsonApi.get(`/editions/${editionId}/me/host`, token);

    const patch = (data: Record<string, unknown>, included?: unknown[]) =>
        jsonApi.patch(`/editions/${editionId}/me/host`, token, {
            data: { type: "host", ...data },
            ...(included ? { included } : {}),
        });

    // Reading this creates a row, so the guard on it is what stops a caller
    // with no user record from making one. Without it the handler reaches an
    // assertion instead and answers 500.
    describe("who may reach it at all", () => {
        it("turns away a caller the events know nothing about", async () => {
            const response = await jsonApi.get(`/editions/${editionId}/me/host`, strangerToken);

            assert.equal(response.status, 403);
        });

        it("turns away an integration, which is nobody's host", async () => {
            const response = await jsonApi.get(`/editions/${editionId}/me/host`, integrationToken);

            assert.equal(response.status, 403);
        });
    });

    it("makes the host on first read and fills it from the user record", async () => {
        const response = await read();

        assert.equal(response.status, 200);
        const document = (await response.json()) as HostDocument;
        assert.equal(document.data.attributes.displayName, "Test User");
        assert.equal(document.data.attributes.emailAddress, "testuser@example.test");
        assert.equal(document.data.attributes.biography, "");
    });

    it("reads back the same host rather than a second one", async () => {
        const first = (await (await read()).json()) as HostDocument;
        const second = (await (await read()).json()) as HostDocument;

        assert.equal(first.data.id, second.data.id);
        assert.equal(await em.fork().count(Host, { edition: editionId }), 1);
    });

    it("leaves an attribute alone when its key is absent", async () => {
        await patch({ attributes: { biography: "Writes things" } });
        const response = await patch({ attributes: { displayName: "Someone Else" } });

        assert.equal(response.status, 200);
        const document = (await response.json()) as HostDocument;
        assert.equal(document.data.attributes.displayName, "Someone Else");
        assert.equal(document.data.attributes.biography, "Writes things");
    });

    it("refuses to empty an attribute the edition always requires", async () => {
        const response = await patch({ attributes: { displayName: "" } });

        assert.equal(response.status, 422);
    });

    it("refuses a host address that is not one email address", async () => {
        for (const emailAddress of ["a@x.example, b@y.example", "alice@example,com"]) {
            const response = await patch({ attributes: { emailAddress } });

            assert.equal(response.status, 422, emailAddress);
        }

        const response = await patch({ attributes: { emailAddress: "Alice@Example.test" } });
        assert.equal(response.status, 200);
        const document = (await response.json()) as HostDocument;
        assert.equal(document.data.attributes.emailAddress, "alice@example.test");
    });

    it("refuses an attribute the edition does not ask for", async () => {
        const response = await patch({ attributes: { nickname: "Fable" } });

        assert.equal(response.status, 422);
    });

    it("keeps the answers when the responses relationship is left out", async () => {
        await patch({ relationships: { responses: { data: [{ type: "response", lid: "a1" }] } } }, [
            {
                type: "response",
                lid: "a1",
                attributes: { value: "Fable" },
                relationships: {
                    customField: { data: { type: "custom_field", id: customFieldId } },
                },
            },
        ]);

        const response = await patch({ attributes: { biography: "Unrelated" } });
        const document = (await response.json()) as HostDocument;

        assert.equal(document.data.relationships?.responses?.data.length, 1);
    });

    it("refuses an answer set that leaves out a field still being asked", async () => {
        const response = await patch({ relationships: { responses: { data: [] } } });

        await expectJsonApiError(response, 422, "missing_responses");
    });

    describe("what the published program notices", () => {
        const readRevision = async (): Promise<number> =>
            (await em.fork().findOne(EditionRevision, { editionId }))?.revision ?? 0;

        it("moves the revision for a name a program is printed under", async () => {
            const before = await readRevision();
            await patch({ attributes: { displayName: "Someone Else" } });

            assert.equal(await readRevision(), before + 1);
        });

        // The address is stripped from every host an integration is served, so
        // changing it changes nothing anyone downstream can see.
        it("leaves the revision alone for an address nobody is served", async () => {
            const before = await readRevision();
            await patch({ attributes: { emailAddress: "elsewhere@example.test" } });

            assert.equal(await readRevision(), before);
        });

        it("leaves the revision alone for availability, which no document carries", async () => {
            const before = await readRevision();
            await patch(
                {
                    relationships: {
                        availabilities: { data: [{ type: "host_availability", lid: "s1" }] },
                    },
                },
                [
                    {
                        type: "host_availability",
                        lid: "s1",
                        attributes: {
                            startsAt: "2027-09-01T08:00:00Z",
                            endsAt: "2027-09-01T10:00:00Z",
                        },
                    },
                ],
            );

            assert.equal(await readRevision(), before);
        });
    });

    describe("availability", () => {
        const availability = (lid: string, startsAt: string, endsAt: string) => ({
            type: "host_availability",
            lid,
            attributes: { startsAt, endsAt },
        });

        const storedTimes = (document: HostDocument): [unknown, unknown][] =>
            (document.included ?? [])
                .filter((resource) => resource.type === "host_availability")
                .map((resource) => [resource.attributes.startsAt, resource.attributes.endsAt]);

        const sendAvailabilities = (lids: string[], included: unknown[]) =>
            patch(
                {
                    relationships: {
                        availabilities: {
                            data: lids.map((lid) => ({ type: "host_availability", lid })),
                        },
                    },
                },
                included,
            );

        it("stores the times a host said they are free", async () => {
            const response = await sendAvailabilities(
                ["s1"],
                [availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z")],
            );

            assert.equal(response.status, 200);
            const document = (await response.json()) as HostDocument;
            assert.deepEqual(storedTimes(document), [
                ["2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z"],
            ]);
        });

        // The rows the previous set left behind have to go, not merely stop
        // pointing at anyone: the column they point through is not nullable.
        it("replaces what a host said the last time round", async () => {
            await sendAvailabilities(
                ["s1"],
                [availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z")],
            );

            const response = await sendAvailabilities(
                ["s2"],
                [availability("s2", "2027-09-02T08:00:00Z", "2027-09-02T09:00:00Z")],
            );

            assert.equal(response.status, 200);
            const document = (await response.json()) as HostDocument;
            assert.deepEqual(storedTimes(document), [
                ["2027-09-02T08:00:00Z", "2027-09-02T09:00:00Z"],
            ]);
        });

        it("lets a host take back every time they gave", async () => {
            await sendAvailabilities(
                ["s1"],
                [availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z")],
            );

            const response = await sendAvailabilities([], []);

            assert.equal(response.status, 200);
            const document = (await response.json()) as HostDocument;
            assert.equal(document.data.relationships?.availabilities?.data.length, 0);
        });

        it("merges two stretches that touch into one", async () => {
            const response = await sendAvailabilities(
                ["s1", "s2"],
                [
                    availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z"),
                    availability("s2", "2027-09-01T10:00:00Z", "2027-09-01T12:00:00Z"),
                ],
            );

            const document = (await response.json()) as HostDocument;
            assert.deepEqual(storedTimes(document), [
                ["2027-09-01T08:00:00Z", "2027-09-01T12:00:00Z"],
            ]);
        });

        it("refuses a stretch outside the edition", async () => {
            const response = await sendAvailabilities(
                ["s1"],
                [availability("s1", "2026-01-01T08:00:00Z", "2026-01-01T10:00:00Z")],
            );

            await expectJsonApiError(response, 422, "outside_edition");
        });

        // A move holds the edition while it settles every stored stretch, and a
        // write checked against the dates read before it would store one
        // outside the days the move leaves.
        it("checks a stretch against the days a concurrent move leaves", async () => {
            const taken = Promise.withResolvers<void>();
            const held = Promise.withResolvers<void>();
            const holding = em.fork().transactional(async (em) => {
                const edition = await em.findOneOrFail(Edition, editionId, {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                });
                edition.startDate = Temporal.PlainDate.from("2027-09-10");
                edition.endDate = Temporal.PlainDate.from("2027-09-12");
                await em.flush();
                taken.resolve();
                await held.promise;
            });

            await taken.promise;

            const write = send(
                sendAvailabilities(
                    ["s1"],
                    [availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z")],
                ),
            );
            const waitError = await releaseAfterLockWait(em.fork(), () => {
                held.resolve();
            });

            await holding;

            if (waitError !== null) {
                throw waitError;
            }

            await expectJsonApiError(await write, 422, "outside_edition");
        });

        it("refuses availability from an edition that does not ask for it", async () => {
            const fork = em.fork();
            const quiet = buildEdition({
                name: "Quiet Edition",
                startDate: Temporal.PlainDate.from("2027-09-01"),
                endDate: Temporal.PlainDate.from("2027-09-03"),
            });
            quiet.profileFieldOptions = { displayName: {}, emailAddress: {} };
            await fork.persist(quiet).flush();

            const response = await jsonApi.patch(`/editions/${quiet.id}/me/host`, token, {
                data: {
                    type: "host",
                    relationships: {
                        availabilities: {
                            data: [{ type: "host_availability", lid: "s1" }],
                        },
                    },
                },
                included: [availability("s1", "2027-09-01T08:00:00Z", "2027-09-01T10:00:00Z")],
            });

            await expectJsonApiError(response, 422, "availability_not_asked");
        });
    });
});
