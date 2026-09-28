import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField, type CustomFieldTarget } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Response } from "../../../src/entity/Response.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildTeamMember, findOrBuildHost } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait, waitForLockWaiters } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

const VEGAN_ID = "01a00801-0000-7000-8000-000000000001";
const OMNIVORE_ID = "01a00801-0000-7000-8000-000000000002";
const PLANT_BASED_ID = "01a00801-0000-7000-8000-000000000003";

type ErrorsWithSource = {
    errors: {
        detail: string;
        source?: { pointer?: string };
        meta?: { id?: string };
    }[];
};

type ChoiceItem = {
    id: string;
    label: string;
};

describe("customFields", () => {
    let managerToken: string;
    let strangerToken: string;
    let editionId: string;
    let sessionTypeId: string;
    let customFieldId: string;

    before(async () => {
        [managerToken, strangerToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const stranger = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({
            name: "CustomField Edition",
            startDate: Temporal.PlainDate.from("2027-08-01"),
            endDate: Temporal.PlainDate.from("2027-08-03"),
        });
        const sessionType = SessionType.default(ref(edition));
        const customField = new CustomField({
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text", maxLength: 100 },
            title: "Which equipment do you need?",
            helperText: "Leave empty if none",
            deadline: null,
            freezeAfter: null,
            confidential: false,
            position: 0,
            edition: ref(edition),
        });
        customField.sessionTypes.add(sessionType);

        await fork.persist([manager, stranger, team, edition, sessionType, customField]).flush();

        editionId = edition.id;
        sessionTypeId = sessionType.id;
        customFieldId = customField.id;
    });

    const createCustomField = (token: string, attributes: Record<string, unknown>) =>
        jsonApi.post(`/editions/${editionId}/custom-fields`, token, {
            data: {
                type: "custom_field",
                attributes,
                relationships: {
                    sessionTypes: {
                        data: [{ type: "session_type", id: sessionTypeId }],
                    },
                    tracks: { data: [] },
                },
            },
        });

    const noRelationships = {
        sessionTypes: { data: [] },
        tracks: { data: [] },
    };

    const patchCustomField = (
        attributes: Record<string, unknown>,
        relationships: Record<string, unknown> = noRelationships,
    ) =>
        jsonApi.patch(`/editions/${editionId}/custom-fields/${customFieldId}`, managerToken, {
            data: {
                type: "custom_field",
                id: customFieldId,
                attributes,
                relationships,
            },
        });

    it("refuses a scope naming the same session type twice", async () => {
        const repeated = { type: "session_type", id: sessionTypeId };
        const response = await jsonApi.post(`/editions/${editionId}/custom-fields`, managerToken, {
            data: {
                type: "custom_field",
                attributes: {
                    externalKey: null,
                    target: "per_proposal",
                    requirement: "always_optional",
                    options: { type: "boolean" },
                    title: "Twice scoped",
                    helperText: "",
                    deadline: null,
                    freezeAfter: null,
                    confidential: false,
                },
                relationships: {
                    sessionTypes: { data: [repeated, repeated] },
                    tracks: { data: [] },
                },
            },
        });

        await expectJsonApiError(response, 422, "custom");
    });

    it("creates a customField", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: "equipment",
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text", maxLength: 100 },
            title: "Which equipment do you need?",
            helperText: "Leave empty if none",
            deadline: null,
            freezeAfter: null,
            confidential: false,
        });

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: {
                id: string;
                type: string;
                attributes: {
                    externalKey: string | null;
                    target: string;
                    requirement: string;
                    options: unknown;
                    title: string;
                    helperText: string;
                    deadline: string | null;
                    freezeAfter: string | null;
                };
                relationships: {
                    sessionTypes: { data: { id: string }[] };
                    tracks: { data: unknown[] };
                };
            };
        };

        assert.equal(document.data.type, "custom_field");
        assert.deepEqual(document.data.attributes, {
            externalKey: "equipment",
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text", maxLength: 100 },
            answerMaxLength: 100,
            title: "Which equipment do you need?",
            helperText: "Leave empty if none",
            deadline: null,
            freezeAfter: null,
            confidential: false,
            position: 1,
        });
        assert.deepEqual(
            document.data.relationships.sessionTypes.data.map((identifier) => identifier.id),
            [sessionTypeId],
        );
        assert.deepEqual(document.data.relationships.tracks.data, []);
    });

    it("persists the confidential flag through create and update", async () => {
        const attributes = {
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "boolean" },
            title: "Do you require a travel stipend?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
        };
        const response = await createCustomField(managerToken, {
            ...attributes,
            confidential: true,
        });

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: { id: string; attributes: { confidential: boolean } };
        };
        const createdId = document.data.id;

        assert.equal(document.data.attributes.confidential, true);
        assert.equal((await em.fork().findOneOrFail(CustomField, createdId)).confidential, true);

        // The inverted default makes false a meaningful value to write; a
        // truthiness guard in the patch path would break exactly this.
        const patched = await jsonApi.patch(
            `/editions/${editionId}/custom-fields/${createdId}`,
            managerToken,
            {
                data: {
                    type: "custom_field",
                    id: createdId,
                    attributes: { ...attributes, confidential: false },
                    relationships: {
                        sessionTypes: { data: [{ type: "session_type", id: sessionTypeId }] },
                        tracks: { data: [] },
                    },
                },
            },
        );
        assert.equal(patched.status, 200);
        assert.equal((await em.fork().findOneOrFail(CustomField, createdId)).confidential, false);
    });

    it("lists customFields for managers and plain users alike", async () => {
        const listCustomFields = (token: string) =>
            jsonApi.get(`/editions/${editionId}/custom-fields`, token);

        const managerList = await listCustomFields(managerToken);
        assert.equal(managerList.status, 200);
        const managerDocument = (await managerList.json()) as { data: { id: string }[] };
        assert.deepEqual(
            managerDocument.data.map((resource) => resource.id),
            [customFieldId],
        );

        // Open to submitters: customFieldsRouter says why.
        const strangerList = await listCustomFields(strangerToken);
        assert.equal(strangerList.status, 200);
        const strangerDocument = (await strangerList.json()) as { data: { id: string }[] };
        assert.deepEqual(
            strangerDocument.data.map((resource) => resource.id),
            [customFieldId],
        );
    });

    it("updates a customField", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/custom-fields/${customFieldId}`,
            managerToken,
            {
                data: {
                    type: "custom_field",
                    id: customFieldId,
                    attributes: {
                        externalKey: null,
                        target: "per_proposal",
                        requirement: "always_required",
                        options: { type: "single_line_text", maxLength: 200 },
                        title: "Which equipment do you need on site?",
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential: false,
                    },
                    relationships: {
                        sessionTypes: { data: [] },
                        tracks: { data: [] },
                    },
                },
            },
        );

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: {
                attributes: { title: string; requirement: string; externalKey: string | null };
                relationships: { sessionTypes: { data: unknown[] } };
            };
        };
        assert.equal(document.data.attributes.title, "Which equipment do you need on site?");
        assert.equal(document.data.attributes.requirement, "always_required");
        assert.equal(document.data.attributes.externalKey, null);
        assert.deepEqual(document.data.relationships.sessionTypes.data, []);

        const stored = await em.fork().findOneOrFail(CustomField, customFieldId, {
            populate: ["sessionTypes"],
        });
        assert.equal(stored.title, "Which equipment do you need on site?");
        assert.equal(stored.requirement, "always_required");
        assert.equal(stored.sessionTypes.length, 0);
    });

    it("rejects required_after_deadline without a deadline", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: null,
            target: "per_proposal",
            requirement: "required_after_deadline",
            options: { type: "boolean" },
            title: "Do you need a hotel room?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: false,
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string }; title: string }[];
        };
        assert.equal(document.errors[0]?.source.pointer, "/data/attributes/deadline");
        assert.equal(
            document.errors[0]?.title,
            "Required for required_after_deadline custom fields",
        );
    });

    it("deletes a customField together with its responses", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const user = await fork.findOneOrFail(User, { externalId: "testuser" });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Anything we should know?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: false,
            edition: ref(edition),
        });
        const host = await findOrBuildHost(fork, edition, user);
        await fork.persist([customField, host]).flush();
        await fork
            .persist(Response.hostResponse(ref(customField), ref(host), "Nothing at all"))
            .flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/custom-fields/${customField.id}`,
            managerToken,
        );

        assert.equal(response.status, 204);

        const afterFork = em.fork();
        assert.equal(await afterFork.count(CustomField, { id: customField.id }), 0);
        assert.equal(await afterFork.count(Response, { customField: customField.id }), 0);
    });

    it("refuses a deadline on a customField no deadline makes required", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "boolean" },
            title: "Do you need a projector?",
            helperText: "",
            deadline: "2027-04-01T00:00:00Z",
            freezeAfter: null,
            confidential: false,
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string }; title: string }[];
        };
        assert.equal(document.errors[0]?.source.pointer, "/data/attributes/deadline");
        assert.equal(
            document.errors[0]?.title,
            "Only allowed for required_after_deadline custom fields",
        );
    });

    it("refuses scoping on a per_host custom field", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: { type: "boolean" },
            title: "Do you have dietary requirements?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: false,
        });

        // createCustomField always sends a session type, which a per_host
        // customField is never filtered by.
        await expectJsonApiError(response, 422, "inapplicable_relationship");
        const document = (await response.json()) as ErrorsWithSource;
        assert.equal(document.errors[0]?.source?.pointer, "/data/relationships/sessionTypes");
    });

    it("refuses to drop a choice option that carries a response", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const user = await fork.findOneOrFail(User, { externalId: "testuser" });
        const customField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_host",
            requirement: "always_optional",
            options: {
                type: "single_choice",
                items: [
                    { id: VEGAN_ID, label: "Vegan" },
                    { id: OMNIVORE_ID, label: "Omnivore" },
                ],
            },
            title: "Catering preference",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const host = await findOrBuildHost(fork, edition, user);
        await fork.persist([customField, host]).flush();
        await fork.persist(Response.hostResponse(ref(customField), ref(host), VEGAN_ID)).flush();

        const patchWith = (items: ChoiceItem[]) =>
            jsonApi.patch(`/editions/${editionId}/custom-fields/${customField.id}`, managerToken, {
                data: {
                    id: customField.id,
                    type: "custom_field",
                    attributes: {
                        externalKey: null,
                        target: "per_host",
                        requirement: "always_optional",
                        options: { type: "single_choice", items },
                        title: "Catering preference",
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential: false,
                    },
                    relationships: {
                        sessionTypes: { data: [] },
                        tracks: { data: [] },
                    },
                },
            });

        const removed = await patchWith([{ id: OMNIVORE_ID, label: "Omnivore" }]);
        await expectJsonApiError(removed, 409, "entity_in_use");

        // A rename reaches the server as the same disappearance.
        const renamed = await patchWith([
            { id: PLANT_BASED_ID, label: "Vegan" },
            { id: OMNIVORE_ID, label: "Omnivore" },
        ]);
        await expectJsonApiError(renamed, 409, "entity_in_use");

        const withoutResponses = await patchWith([{ id: VEGAN_ID, label: "Vegan" }]);
        assert.equal(withoutResponses.status, 200);
    });

    it("rejects a freezeAfter before the deadline", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: null,
            target: "per_proposal",
            requirement: "required_after_deadline",
            options: { type: "boolean" },
            title: "Do you need a parking spot?",
            helperText: "",
            deadline: "2027-07-01T12:00:00Z",
            freezeAfter: "2027-06-01T12:00:00Z",
            confidential: false,
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string }; title: string }[];
        };
        assert.equal(document.errors[0]?.source.pointer, "/data/attributes/freezeAfter");
        assert.equal(document.errors[0]?.title, "Must be after the deadline");
    });

    it("rejects a freezeAfter at the deadline", async () => {
        const response = await createCustomField(managerToken, {
            externalKey: null,
            target: "per_proposal",
            requirement: "required_after_deadline",
            options: { type: "boolean" },
            title: "Do you need a parking spot?",
            helperText: "",
            deadline: "2027-07-01T12:00:00Z",
            freezeAfter: "2027-07-01T12:00:00Z",
            confidential: false,
        });

        assert.equal(response.status, 422);
        const document = (await response.json()) as {
            errors: { source: { pointer: string }; title: string }[];
        };
        assert.equal(document.errors[0]?.source.pointer, "/data/attributes/freezeAfter");
        assert.equal(document.errors[0]?.title, "Must be after the deadline");
    });

    it("refuses to change the target of a stored customField", async () => {
        const response = await patchCustomField({
            externalKey: null,
            target: "per_host",
            requirement: "always_required",
            options: { type: "single_line_text", maxLength: 200 },
            title: "Which equipment do you need on site?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: false,
        });

        await expectJsonApiError(response, 409, "conflict");
        const document = (await response.json()) as ErrorsWithSource;
        assert.equal(document.errors[0]?.detail, "Supplied target does not match stored target");
        // Both immutable attributes answer with the same code, so the pointer is
        // the only thing telling a client which one it tried to change.
        assert.equal(document.errors[0]?.source?.pointer, "/data/attributes/target");

        const stored = await em.fork().findOneOrFail(CustomField, customFieldId);
        assert.equal(stored.target, "per_proposal");
    });

    it("refuses to change the option type of a stored customField", async () => {
        const response = await patchCustomField({
            externalKey: null,
            target: "per_proposal",
            requirement: "always_required",
            options: { type: "boolean" },
            title: "Which equipment do you need on site?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            confidential: false,
        });

        await expectJsonApiError(response, 409, "conflict");
        const document = (await response.json()) as ErrorsWithSource;
        assert.equal(document.errors[0]?.detail, "Supplied option type does not match stored type");
        assert.equal(document.errors[0]?.source?.pointer, "/data/attributes/options/type");

        const stored = await em.fork().findOneOrFail(CustomField, customFieldId);
        assert.equal(stored.options.type, "single_line_text");
    });

    describe("relationships of another edition", () => {
        let foreignSessionTypeId: string;
        let foreignTrackId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const foreignEdition = buildEdition({ name: "Foreign CustomField Edition" });
            const foreignSessionType = SessionType.default(ref(foreignEdition));
            const foreignTrack = new Track({
                name: "Foreign Track",
                externalKey: null,
                description: "",
                color: "#123456",
                internal: false,
                edition: ref(foreignEdition),
            });

            await fork.persist([foreignEdition, foreignSessionType, foreignTrack]).flush();

            foreignSessionTypeId = foreignSessionType.id;
            foreignTrackId = foreignTrack.id;
        });

        it("refuses to create a customField scoped to a foreign session type", async () => {
            const response = await jsonApi.post(
                `/editions/${editionId}/custom-fields`,
                managerToken,
                {
                    data: {
                        type: "custom_field",
                        attributes: {
                            externalKey: null,
                            target: "per_proposal",
                            requirement: "always_optional",
                            options: { type: "boolean" },
                            title: "Scoped to the wrong edition",
                            helperText: "",
                            deadline: null,
                            freezeAfter: null,
                            confidential: false,
                        },
                        relationships: {
                            sessionTypes: {
                                data: [{ type: "session_type", id: foreignSessionTypeId }],
                            },
                            tracks: { data: [] },
                        },
                    },
                },
            );

            await expectJsonApiError(response, 404, "not_found");
            // The id is a member rather than prose, so a client can point at the
            // entry it sent instead of parsing the sentence for a uuid.
            const document = (await response.json()) as ErrorsWithSource;
            assert.equal(
                document.errors[0]?.source?.pointer,
                "/data/relationships/sessionTypes/data/0",
            );
            assert.equal(document.errors[0]?.meta?.id, foreignSessionTypeId);
            assert.equal(
                await em.fork().count(CustomField, { title: "Scoped to the wrong edition" }),
                0,
            );
        });

        it("refuses to move a customField onto a foreign track", async () => {
            const response = await patchCustomField(
                {
                    externalKey: null,
                    target: "per_proposal",
                    requirement: "always_required",
                    options: { type: "single_line_text", maxLength: 200 },
                    title: "Which equipment do you need on site?",
                    helperText: "",
                    deadline: null,
                    freezeAfter: null,
                    confidential: false,
                },
                {
                    sessionTypes: { data: [] },
                    tracks: { data: [{ type: "track", id: foreignTrackId }] },
                },
            );

            await expectJsonApiError(response, 404, "not_found");
            const document = (await response.json()) as ErrorsWithSource;
            assert.equal(document.errors[0]?.source?.pointer, "/data/relationships/tracks/data/0");
            assert.equal(document.errors[0]?.meta?.id, foreignTrackId);

            const stored = await em.fork().findOneOrFail(CustomField, customFieldId, {
                populate: ["tracks"],
            });
            assert.equal(stored.tracks.length, 0);
        });
    });

    describe("internal scoping visibility", () => {
        let scopedCustomFieldId: string;
        let internalSessionTypeId: string;
        let internalTrackId: string;

        type CustomFieldListDocument = {
            data: {
                id: string;
                relationships: {
                    sessionTypes: { data: { id: string }[] };
                    tracks: { data: { id: string }[] };
                };
            }[];
            included?: { type: string }[];
        };

        beforeEach(async () => {
            const fork = em.fork();
            const edition = await fork.findOneOrFail(Edition, editionId);
            const internalSessionType = new SessionType({
                name: "Internal Session Type",
                externalKey: null,
                defaultDuration: Temporal.Duration.from({ minutes: 30 }),
                internal: true,
                selectionDefault: false,
                edition: ref(edition),
            });
            const internalTrack = new Track({
                name: "Internal Track",
                externalKey: null,
                description: "",
                color: "#654321",
                internal: true,
                edition: ref(edition),
            });
            const customField = new CustomField({
                position: 2,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "boolean" },
                title: "Internally scoped customField",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                confidential: false,
                edition: ref(edition),
            });
            customField.sessionTypes.add(
                fork.getReference(SessionType, sessionTypeId),
                internalSessionType,
            );
            customField.tracks.add(internalTrack);

            await fork.persist([internalSessionType, internalTrack, customField]).flush();

            scopedCustomFieldId = customField.id;
            internalSessionTypeId = internalSessionType.id;
            internalTrackId = internalTrack.id;
        });

        const findScopedCustomField = async (token: string) => {
            const response = await jsonApi.get(`/editions/${editionId}/custom-fields`, token);
            assert.equal(response.status, 200);
            const document = (await response.json()) as CustomFieldListDocument;
            const customField = document.data.find(
                (resource) => resource.id === scopedCustomFieldId,
            );
            assert.ok(customField);
            return { customField, document };
        };

        it("serves internal scoping ids to managers", async () => {
            const { customField } = await findScopedCustomField(managerToken);

            assert.deepEqual(
                customField.relationships.sessionTypes.data
                    .map((identifier) => identifier.id)
                    .sort(),
                [sessionTypeId, internalSessionTypeId].sort(),
            );
            assert.deepEqual(
                customField.relationships.tracks.data.map((identifier) => identifier.id),
                [internalTrackId],
            );
        });

        // Reads as a leak and is not one: trimmed scoping would arrive as an
        // empty collection, which means "applies to everything", so every
        // speaker on another track would be asked the question and the write
        // would refuse the answer with 422 inapplicable_response.
        it("serves the same internal scoping ids to plain users", async () => {
            const { customField } = await findScopedCustomField(strangerToken);

            assert.deepEqual(
                customField.relationships.sessionTypes.data
                    .map((identifier) => identifier.id)
                    .sort(),
                [sessionTypeId, internalSessionTypeId].sort(),
            );
            assert.deepEqual(
                customField.relationships.tracks.data.map((identifier) => identifier.id),
                [internalTrackId],
            );
        });

        it("includes no session type or track resource for a plain user", async () => {
            const { document } = await findScopedCustomField(strangerToken);

            assert.deepEqual(document.included ?? [], []);
        });

        it("serves the same internal scoping ids on the show route", async () => {
            const response = await jsonApi.get(
                `/editions/${editionId}/custom-fields/${scopedCustomFieldId}`,
                strangerToken,
            );
            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: CustomFieldListDocument["data"][number];
                included?: { type: string }[];
            };

            assert.deepEqual(
                document.data.relationships.sessionTypes.data
                    .map((identifier) => identifier.id)
                    .sort(),
                [sessionTypeId, internalSessionTypeId].sort(),
            );
            assert.deepEqual(
                document.data.relationships.tracks.data.map((identifier) => identifier.id),
                [internalTrackId],
            );
            assert.deepEqual(document.included ?? [], []);
        });
    });

    describe("ordering", () => {
        type SeededEdition = {
            editionId: string;
            proposalIds: string[];
            userIds: string[];
        };

        const buildAt = (edition: Edition, target: CustomFieldTarget, position: number) =>
            new CustomField({
                externalKey: null,
                target,
                requirement: "always_optional",
                options: { type: "boolean" },
                title: `${target} ${position}`,
                helperText: "",
                deadline: null,
                freezeAfter: null,
                position,
                edition: ref(edition),
            });

        const seedEdition = async (): Promise<SeededEdition> => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Ordering Edition" });

            const proposalFields = [0, 1, 2].map((position) =>
                buildAt(edition, "per_proposal", position),
            );
            const userFields = [0, 1].map((position) => buildAt(edition, "per_host", position));

            await fork.persist([edition, ...proposalFields, ...userFields]).flush();

            return {
                editionId: edition.id,
                proposalIds: proposalFields.map((customField) => customField.id),
                userIds: userFields.map((customField) => customField.id),
            };
        };

        const reorder = (editionId: string, customFieldIds: string[]) =>
            jsonApi.patch(`/editions/${editionId}/relationships/custom-fields`, managerToken, {
                data: customFieldIds.map((id) => ({ type: "custom_field", id })),
            });

        const storedPositions = async (customFieldIds: string[]): Promise<number[]> => {
            const fork = em.fork();
            const stored = await Promise.all(
                customFieldIds.map((customFieldId) =>
                    fork.findOneOrFail(CustomField, customFieldId),
                ),
            );

            return stored.map((customField) => customField.position);
        };

        it("lists custom fields by target, then position", async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Ordered List Edition" });
            const proposalFields = [0, 1, 2].map((position) =>
                buildAt(edition, "per_proposal", position),
            );
            const userFields = [0, 1].map((position) => buildAt(edition, "per_host", position));

            await fork
                .persist([
                    edition,
                    proposalFields[2],
                    userFields[1],
                    proposalFields[0],
                    userFields[0],
                    proposalFields[1],
                ])
                .flush();

            const response = await jsonApi.get(
                `/editions/${edition.id}/custom-fields`,
                managerToken,
            );
            assert.equal(response.status, 200);

            const document = await response.json<{ data: { id: string }[] }>();
            assert.deepEqual(
                document.data.map((resource) => resource.id),
                [...proposalFields, ...userFields].map((customField) => customField.id),
            );
        });

        // A session save share-locks the questions it answers in id order, and a
        // batched update takes its rows in whatever order the plan scans them.
        // An edit to an indexed column moves the first field's tuple behind the
        // rest, which is what turns a plan-ordered update against the save's.
        it("locks the custom fields in id order before renumbering them", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const [first, , last] = proposalIds;
            const fork = em.fork();
            (await fork.findOneOrFail(CustomField, first)).externalKey = "moved";
            await fork.flush();

            const taken = Promise.withResolvers<void>();
            const held = Promise.withResolvers<void>();
            const holding = em.fork().transactional(async (em) => {
                await em.execute('select 1 from "custom_field" where "id" = ? for share', [first]);
                taken.resolve();
                await held.promise;
            });

            await taken.promise;

            const reordered = send(reorder(editionId, [...proposalIds].reverse().concat(userIds)));
            const waitError = await releaseAfterLockWait(
                em.fork(),
                () => {
                    held.resolve();
                },
                {
                    whileHeld: async () => {
                        await em
                            .fork()
                            .getConnection()
                            .execute(
                                'select 1 from "custom_field" where "id" = ? for update nowait',
                                [last],
                            );
                    },
                },
            );

            await holding;

            if (waitError !== null) {
                throw waitError;
            }

            assert.equal((await reordered).status, 204);
        });

        it("refuses an empty order while the edition has custom fields", async () => {
            const { editionId, proposalIds } = await seedEdition();

            const response = await reorder(editionId, []);
            await expectJsonApiError(response, 422, "incomplete_order");
            assert.deepEqual(await storedPositions(proposalIds), [0, 1, 2]);
        });

        it("accepts an empty order for an edition without custom fields", async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Fieldless Edition" });
            await fork.persist(edition).flush();

            const response = await reorder(edition.id, []);
            assert.equal(response.status, 204);
        });

        it("renumbers each target independently", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const interleaved = [
                proposalIds[2],
                userIds[0],
                proposalIds[0],
                userIds[1],
                proposalIds[1],
            ];

            const response = await reorder(editionId, interleaved);
            assert.equal(response.status, 204);

            assert.deepEqual(
                await storedPositions([proposalIds[2], proposalIds[0], proposalIds[1]]),
                [0, 1, 2],
            );
            assert.deepEqual(await storedPositions(userIds), [0, 1]);
        });

        it("commits a full reversal", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const reversed = [...proposalIds].reverse();

            const response = await reorder(editionId, [...reversed, ...userIds]);
            assert.equal(response.status, 204);

            assert.deepEqual(await storedPositions(reversed), [0, 1, 2]);
        });

        it("refuses an order that leaves out a custom field", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const all = [...proposalIds, ...userIds];

            const response = await reorder(editionId, all.slice(1));
            await expectJsonApiError(response, 422, "incomplete_order");

            const document = await response.json<{
                errors: { meta: { customFieldIds: string[] } }[];
            }>();
            assert.deepEqual(document.errors[0]?.meta.customFieldIds.toSorted(), all.toSorted());
            assert.deepEqual(await storedPositions(proposalIds), [0, 1, 2]);
        });

        it("refuses an order that repeats a custom field", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const repeated = [...proposalIds, ...userIds, ...proposalIds.slice(0, 1)];

            const response = await reorder(editionId, repeated);
            await expectJsonApiError(response, 422, "incomplete_order");
            assert.deepEqual(await storedPositions(proposalIds), [0, 1, 2]);
        });

        it("refuses an order naming a custom field of another edition", async () => {
            const { editionId, proposalIds, userIds } = await seedEdition();
            const foreign = await seedEdition();
            const withForeign = [
                ...proposalIds,
                ...userIds.slice(1),
                ...foreign.proposalIds.slice(0, 1),
            ];

            const response = await reorder(editionId, withForeign);
            await expectJsonApiError(response, 422, "incomplete_order");
            assert.deepEqual(await storedPositions(proposalIds), [0, 1, 2]);
        });

        it("assigns the next free position per target on create", async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Position Edition" });
            await fork.persist(edition).flush();

            const positions: number[] = [];

            for (const [target, title] of [
                ["per_proposal", "Do you need a projector?"],
                ["per_proposal", "May we record you?"],
                ["per_host", "Do you have dietary requirements?"],
            ] as const) {
                const response = await jsonApi.post(
                    `/editions/${edition.id}/custom-fields`,
                    managerToken,
                    {
                        data: {
                            type: "custom_field",
                            attributes: {
                                externalKey: null,
                                target,
                                requirement: "always_optional",
                                options: { type: "boolean" },
                                title,
                                helperText: "",
                                deadline: null,
                                freezeAfter: null,
                                confidential: false,
                            },
                            relationships: {
                                sessionTypes: { data: [] },
                                tracks: { data: [] },
                            },
                        },
                    },
                );

                assert.equal(response.status, 201);
                const document = await response.json<{
                    data: { attributes: { position: number } };
                }>();
                positions.push(document.data.attributes.position);
            }

            assert.deepEqual(positions, [0, 1, 0]);
        });
    });

    // The holder is a track delete, one side of the populate cycle in
    // src/support/locking.ts. The update pins the tracks it names before it
    // locks the custom field, so it waits for the delete instead.
    it("waits for a track delete instead of deadlocking against it", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const trackOf = (name: string) =>
            new Track({
                name,
                externalKey: null,
                description: "",
                color: "#101010",
                internal: false,
                edition: ref(edition),
            });
        const doomed = trackOf("Doomed");
        const kept = trackOf("Kept");
        const scoped = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Before",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        scoped.tracks.add(doomed, kept);
        await fork.persist([doomed, kept, scoped]).flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const deleting = em.fork().transactional(async (em) => {
            await em.findOneOrFail(Track, doomed.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
            await em.nativeDelete(Track, { id: doomed.id });
        });

        await taken.promise;

        const updating = send(
            jsonApi.patch(`/editions/${editionId}/custom-fields/${scoped.id}`, managerToken, {
                data: {
                    type: "custom_field",
                    id: scoped.id,
                    attributes: {
                        externalKey: null,
                        target: "per_proposal",
                        requirement: "always_optional",
                        options: { type: "single_line_text" },
                        title: "After",
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential: false,
                    },
                    relationships: {
                        sessionTypes: { data: [] },
                        tracks: {
                            data: [
                                { type: "track", id: doomed.id },
                                { type: "track", id: kept.id },
                            ],
                        },
                    },
                },
            }),
        );
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await deleting;
        const response = await updating;

        if (waitError !== null) {
            throw waitError;
        }

        await expectJsonApiError(response, 404, "not_found");
    });

    // A track delete refuses to remove the only track a field names, since an
    // empty scope means every track. Its check reads the scoping without a
    // lock, so an update narrowing the field to that track has to keep the
    // delete out until it commits. Holding the revision counter parks the
    // update after its changes and before its commit; the delete takes the
    // edition exclusively, waits behind the update's pin on it, and then reads
    // the committed narrowing.
    it("refuses to delete a track an uncommitted update narrows a field to", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const trackOf = (name: string) =>
            new Track({
                name,
                externalKey: null,
                description: "",
                color: "#101010",
                internal: false,
                edition: ref(edition),
            });
        const narrowed = trackOf("Narrowed");
        const dropped = trackOf("Dropped");
        const scoped = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Before",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        scoped.tracks.add(narrowed, dropped);
        await fork.persist([narrowed, dropped, scoped]).flush();
        await fork.execute(
            'insert into "edition_revision" ("edition_id", "revision") values (?, 1)',
            [editionId],
        );

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.execute('select 1 from "edition_revision" where "edition_id" = ? for update', [
                editionId,
            ]);
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const updating = send(
            jsonApi.patch(`/editions/${editionId}/custom-fields/${scoped.id}`, managerToken, {
                data: {
                    type: "custom_field",
                    id: scoped.id,
                    attributes: {
                        externalKey: null,
                        target: "per_proposal",
                        requirement: "always_optional",
                        options: { type: "single_line_text" },
                        title: "After",
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential: false,
                    },
                    relationships: {
                        sessionTypes: { data: [] },
                        tracks: { data: [{ type: "track", id: narrowed.id }] },
                    },
                },
            }),
        );
        let deleting: Promise<TestResponse> | undefined;
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    deleting = send(
                        jsonApi.delete(
                            `/editions/${editionId}/tracks/${narrowed.id}`,
                            managerToken,
                        ),
                    );
                    await waitForLockWaiters(em.fork(), { count: 2 });
                },
            },
        );

        await holding;
        const updated = await updating;
        const deleted = await deleting;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(updated.status, 200);
        assert.equal(deleted?.status, 409);
        const stored = await em
            .fork()
            .findOneOrFail(CustomField, scoped.id, { populate: ["tracks"] });
        assert.deepEqual(
            stored.tracks.getItems().map((track) => track.id),
            [narrowed.id],
        );
    });

    it("lets a session write set a track while an update naming it waits", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const track = new Track({
            name: "Shared",
            externalKey: null,
            description: "",
            color: "#101010",
            internal: false,
            edition: ref(edition),
        });
        const scoped = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Before",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        scoped.tracks.add(track);
        await fork.persist([track, scoped]).flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const writing = em.fork().transactional(async (em) => {
            await em.execute('select 1 from "custom_field" where "id" = ? for share', [scoped.id]);
            taken.resolve();
            await held.promise;
            await em.execute('select 1 from "track" where "id" = ? for key share', [track.id]);
        });

        await taken.promise;

        const updating = send(
            jsonApi.patch(`/editions/${editionId}/custom-fields/${scoped.id}`, managerToken, {
                data: {
                    type: "custom_field",
                    id: scoped.id,
                    attributes: {
                        externalKey: null,
                        target: "per_proposal",
                        requirement: "always_optional",
                        options: { type: "single_line_text" },
                        title: "After",
                        helperText: "",
                        deadline: null,
                        freezeAfter: null,
                        confidential: false,
                    },
                    relationships: {
                        sessionTypes: { data: [] },
                        tracks: { data: [{ type: "track", id: track.id }] },
                    },
                },
            }),
        );
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await writing;
        const response = await updating;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 200);
    });
});
