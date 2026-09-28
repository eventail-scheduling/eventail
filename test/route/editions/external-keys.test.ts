import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

/**
 * One entry per entity carrying an external key.
 *
 * Every 409 conversion runs through this table, so a wrapper dropped from any
 * create or update handler fails here rather than silently turning a duplicate
 * key into a 500.
 */
type KeyedResource = {
    label: string;
    create: (name: string, externalKey: string | null) => Promise<TestResponse>;
    update: (id: string, externalKey: string) => Promise<TestResponse>;
};

describe("external keys", () => {
    let managerToken: string;
    let editionId: string;
    let otherEditionId: string;
    let sessionTypeId: string;

    const createTrack = (edition: string, name: string, externalKey: string | null) =>
        jsonApi.post(`/editions/${edition}/tracks`, managerToken, {
            data: {
                type: "track",
                attributes: {
                    name,
                    externalKey,
                    description: "",
                    color: "#123456",
                    internal: false,
                },
            },
        });

    const customFieldAttributes = (target: string, externalKey: string | null, title: string) => ({
        externalKey,
        target,
        requirement: "always_optional",
        options: { type: "boolean" },
        title,
        helperText: "",
        deadline: null,
        freezeAfter: null,
        confidential: false,
    });

    const customFieldRelationships = (target: string) => ({
        sessionTypes: {
            data: target === "per_proposal" ? [{ type: "session_type", id: sessionTypeId }] : [],
        },
        tracks: { data: [] },
    });

    const createCustomField = (target: string, externalKey: string | null, title: string) =>
        jsonApi.post(`/editions/${editionId}/custom-fields`, managerToken, {
            data: {
                type: "custom_field",
                attributes: customFieldAttributes(target, externalKey, title),
                relationships: customFieldRelationships(target),
            },
        });

    const resources: KeyedResource[] = [
        {
            label: "track",
            create: (name, externalKey) => createTrack(editionId, name, externalKey),
            update: (id, externalKey) =>
                jsonApi.patch(`/editions/${editionId}/tracks/${id}`, managerToken, {
                    data: {
                        type: "track",
                        id,
                        attributes: {
                            name: "Patched",
                            externalKey,
                            description: "",
                            color: "#123456",
                            internal: false,
                        },
                    },
                }),
        },
        {
            label: "session type",
            create: (name, externalKey) =>
                jsonApi.post(`/editions/${editionId}/session-types`, managerToken, {
                    data: {
                        type: "session_type",
                        attributes: {
                            name,
                            externalKey,
                            defaultDuration: "PT45M",
                            internal: false,
                        },
                    },
                }),
            update: (id, externalKey) =>
                jsonApi.patch(`/editions/${editionId}/session-types/${id}`, managerToken, {
                    data: {
                        type: "session_type",
                        id,
                        attributes: {
                            name: "Patched",
                            externalKey,
                            defaultDuration: "PT45M",
                            internal: false,
                        },
                    },
                }),
        },
        {
            label: "location",
            create: (name, externalKey) =>
                jsonApi.post(`/editions/${editionId}/locations`, managerToken, {
                    data: {
                        type: "location",
                        attributes: { name, externalKey },
                        relationships: { availabilities: { data: [] } },
                    },
                }),
            update: (id, externalKey) =>
                jsonApi.patch(`/editions/${editionId}/locations/${id}`, managerToken, {
                    data: {
                        type: "location",
                        id,
                        attributes: { name: "Patched", externalKey },
                        relationships: { availabilities: { data: [] } },
                    },
                }),
        },
        {
            label: "custom field",
            create: (name, externalKey) => createCustomField("per_proposal", externalKey, name),
            update: (id, externalKey) =>
                jsonApi.patch(`/editions/${editionId}/custom-fields/${id}`, managerToken, {
                    data: {
                        type: "custom_field",
                        id,
                        attributes: customFieldAttributes("per_proposal", externalKey, "Patched"),
                        relationships: customFieldRelationships("per_proposal"),
                    },
                }),
        },
    ];

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const edition = buildEdition({ name: "Key Edition" });
        const otherEdition = buildEdition({ name: "Other Key Edition" });
        const sessionType = SessionType.default(ref(edition));

        await fork.persist([manager, team, edition, otherEdition, sessionType]).flush();

        editionId = edition.id;
        otherEditionId = otherEdition.id;
        sessionTypeId = sessionType.id;
    });

    const idOf = async (response: TestResponse): Promise<string> => {
        const document = (await response.json()) as { data: { id: string } };
        return document.data.id;
    };

    for (const [index, resource] of resources.entries()) {
        it(`refuses a duplicate key when creating a ${resource.label}`, async () => {
            const key = `create-${index}`;

            const first = await resource.create("First", key);
            assert.equal(first.status, 201);

            const second = await resource.create("Second", key);
            await expectJsonApiError(second, 409, "external_key_taken");

            const document = (await second.json()) as {
                errors: { source?: { pointer?: string } }[];
            };
            assert.equal(document.errors[0].source?.pointer, "/data/attributes/externalKey");
        });

        it(`refuses a duplicate key when updating a ${resource.label}`, async () => {
            const held = `update-held-${index}`;

            const holder = await resource.create("Holder", held);
            assert.equal(holder.status, 201);

            const mover = await resource.create("Mover", `update-mover-${index}`);
            assert.equal(mover.status, 201);

            const moved = await resource.update(await idOf(mover), held);
            await expectJsonApiError(moved, 409, "external_key_taken");
        });
    }

    // Keys are scoped per edition on purpose, so a convention can carry the
    // same mapping from one year to the next.
    it("allows the same key in another edition", async () => {
        const here = await createTrack(editionId, "Here", "shared-across-editions");
        assert.equal(here.status, 201);

        const elsewhere = await createTrack(otherEditionId, "Elsewhere", "shared-across-editions");
        assert.equal(elsewhere.status, 201);
    });

    it("allows one key per custom field target", async () => {
        const proposal = await createCustomField("per_proposal", "dietary", "Proposal dietary");
        assert.equal(proposal.status, 201);

        const host = await createCustomField("per_host", "dietary", "Host dietary");
        assert.equal(host.status, 201);

        const duplicate = await createCustomField("per_host", "dietary", "Another host dietary");
        await expectJsonApiError(duplicate, 409, "external_key_taken");
    });

    // Postgres treats nulls as distinct in a unique constraint, which is what
    // makes the key optional at all.
    it("allows any number of entities without a key", async () => {
        const first = await createTrack(editionId, "Unkeyed One", null);
        assert.equal(first.status, 201);

        const second = await createTrack(editionId, "Unkeyed Two", null);
        assert.equal(second.status, 201);

        const unkeyed = await em.fork().count(Track, { edition: editionId, externalKey: null });
        assert.equal(unkeyed, 2);
    });
});
