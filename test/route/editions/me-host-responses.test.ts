import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Host } from "../../../src/entity/Host.js";
import { Response } from "../../../src/entity/Response.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildSuperAdmin, findOrBuildHost } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

type Answer = {
    type: string;
    attributes: { value: unknown };
};

type ResponseInput = {
    customFieldId: string;
    value: unknown;
};

describe("me host answers", () => {
    let token: string;
    let editionId: string;
    let customFieldId: string;
    let frozenCustomFieldId: string;

    before(async () => {
        token = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const user = new User({
            externalId: "testuser",
            displayName: "Test User",
            emailAddress: "testuser@example.test",
        });
        const edition = buildEdition({
            name: "Response Edition",
            startDate: Temporal.PlainDate.from("2027-09-01"),
            endDate: Temporal.PlainDate.from("2027-09-03"),
        });
        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_host",
            requirement: "always_required",
            options: { type: "single_line_text" },
            title: "What is your name?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const frozenCustomField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_host",
            requirement: "always_required",
            options: { type: "single_line_text" },
            title: "Too late for this one",
            helperText: "",
            deadline: null,
            freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }),
            edition: ref(edition),
        });
        await fork.persist([user, edition, customField, frozenCustomField]).flush();

        editionId = edition.id;
        customFieldId = customField.id;
        frozenCustomFieldId = frozenCustomField.id;
    });

    const answersOf = (document: unknown): Answer[] =>
        ((document as { included?: Answer[] }).included ?? []).filter(
            (resource) => resource.type === "response",
        );

    const patchResponses = (value: unknown) =>
        jsonApi.patch(`/editions/${editionId}/me/host`, token, {
            data: {
                type: "host",
                relationships: {
                    responses: { data: [{ type: "response", lid: "a1" }] },
                },
            },
            included: [
                {
                    type: "response",
                    lid: "a1",
                    attributes: { value },
                    relationships: {
                        customField: { data: { type: "custom_field", id: customFieldId } },
                    },
                },
            ],
        });

    const readAnswers = async (): Promise<Answer[]> => {
        const response = await jsonApi.get(`/editions/${editionId}/me/host`, token);
        assert.equal(response.status, 200);

        return answersOf(await response.json());
    };

    it("carries no answers before any are given", async () => {
        assert.deepEqual(await readAnswers(), []);
    });

    it("rejects a submission missing required responses", async () => {
        const response = await jsonApi.patch(`/editions/${editionId}/me/host`, token, {
            data: {
                type: "host",
                relationships: { responses: { data: [] } },
            },
        });

        await expectJsonApiError(response, 422, "missing_responses");
    });

    it("rejects responses to frozen customFields", async () => {
        const response = await jsonApi.patch(`/editions/${editionId}/me/host`, token, {
            data: {
                type: "host",
                relationships: {
                    responses: {
                        data: [
                            { type: "response", lid: "a1" },
                            { type: "response", lid: "a2" },
                        ],
                    },
                },
            },
            included: [
                {
                    type: "response",
                    lid: "a1",
                    attributes: { value: "Fable" },
                    relationships: {
                        customField: { data: { type: "custom_field", id: customFieldId } },
                    },
                },
                {
                    type: "response",
                    lid: "a2",
                    attributes: { value: "too late" },
                    relationships: {
                        customField: { data: { type: "custom_field", id: frozenCustomFieldId } },
                    },
                },
            ],
        });

        await expectJsonApiError(response, 422, "frozen_response");
    });

    describe("answers named by id", () => {
        type StoredAnswers = {
            answerId: string;
            frozenAnswerId: string;
        };

        const storeAnswers = async (externalId: string): Promise<StoredAnswers> => {
            const fork = em.fork();
            const edition = await fork.findOneOrFail(Edition, editionId);
            const user =
                (await fork.findOne(User, { externalId })) ??
                new User({
                    externalId,
                    displayName: externalId,
                    emailAddress: `${externalId}@example.test`,
                });
            const host = await findOrBuildHost(fork, edition, user);
            const answer = Response.hostResponse(
                fork.getReference(CustomField, customFieldId, { wrapped: true }),
                ref(host),
                "Fable",
            );
            const frozenAnswer = Response.hostResponse(
                fork.getReference(CustomField, frozenCustomFieldId, { wrapped: true }),
                ref(host),
                "given in time",
            );
            await fork.persist([user, answer, frozenAnswer]).flush();

            return { answerId: answer.id, frozenAnswerId: frozenAnswer.id };
        };

        const patchById = (ids: string[]) =>
            jsonApi.patch(`/editions/${editionId}/me/host`, token, {
                data: {
                    type: "host",
                    relationships: {
                        responses: { data: ids.map((id) => ({ type: "response", id })) },
                    },
                },
            });

        it("accepts a frozen answer named by id", async () => {
            const { answerId, frozenAnswerId } = await storeAnswers("testuser");

            const response = await patchById([answerId, frozenAnswerId]);
            assert.equal(response.status, 200);

            const stored = await em.fork().findOneOrFail(Response, frozenAnswerId);
            assert.equal(stored.value, "given in time");
        });

        it("refuses an answer of another host", async () => {
            await storeAnswers("testuser");
            const { answerId } = await storeAnswers("otheruser");

            await expectJsonApiError(await patchById([answerId]), 422, "unknown_response");
        });
    });

    it("stores and updates responses", async () => {
        const createResponse = await patchResponses("Fable");
        assert.equal(createResponse.status, 200);

        const updateResponse = await patchResponses("Mythos");
        assert.equal(updateResponse.status, 200);

        const answers = await readAnswers();

        assert.equal(answers.length, 1);
        assert.equal(answers[0].attributes.value, "Mythos");
    });

    it("refuses a submission that leaves a stored frozen answer out", async () => {
        const fork = em.fork();
        const user = await fork.findOneOrFail(User, { externalId: "testuser" });
        const frozenCustomField = await fork.findOneOrFail(CustomField, frozenCustomFieldId);
        const edition = await fork.findOneOrFail(Edition, editionId);
        const host = await findOrBuildHost(fork, edition, user);
        fork.persist(Response.hostResponse(ref(frozenCustomField), ref(host), "before the freeze"));
        await fork.flush();

        await expectJsonApiError(await patchResponses("Opus"), 422, "frozen_response");

        const answers = await readAnswers();

        assert.deepEqual(
            answers.map((resource) => resource.attributes.value),
            ["before the freeze"],
        );
    });

    describe("deadlines and manager writes", () => {
        let managerToken: string;
        let deadlineEditionId: string;
        let deadlineCustomFieldId: string;
        let lockedCustomFieldId: string;
        let managerUserId: string;

        before(async () => {
            managerToken = await fetchAccessToken("admin");
        });

        beforeEach(async () => {
            const fork = em.fork();
            // Responses are always written for the calling user, so the
            // superadmin token needs a user row of its own.
            const manager = buildSuperAdmin({
                displayName: "Test Manager",
                emailAddress: "manager@example.test",
            });
            const edition = buildEdition({ name: "Deadline Edition" });
            const deadlineCustomField = new CustomField({
                position: 2,
                externalKey: null,
                target: "per_host",
                requirement: "required_after_deadline",
                options: { type: "single_line_text" },
                title: "Anything else we should know?",
                helperText: "",
                deadline: Temporal.Now.instant().add({ hours: 1 }),
                freezeAfter: null,
                edition: ref(edition),
            });
            const lockedCustomField = new CustomField({
                position: 3,
                externalKey: null,
                target: "per_host",
                requirement: "always_required",
                options: { type: "single_line_text" },
                title: "Locked down already",
                helperText: "",
                deadline: null,
                freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }),
                edition: ref(edition),
            });
            await fork.persist([manager, edition, deadlineCustomField, lockedCustomField]).flush();

            deadlineEditionId = edition.id;
            deadlineCustomFieldId = deadlineCustomField.id;
            lockedCustomFieldId = lockedCustomField.id;
            managerUserId = manager.id;
        });

        const patchDeadlineResponses = (submitterToken: string, responses: ResponseInput[]) =>
            jsonApi.patch(`/editions/${deadlineEditionId}/me/host`, submitterToken, {
                data: {
                    type: "host",
                    relationships: {
                        responses: {
                            data: responses.map((_response, index) => ({
                                type: "response",
                                lid: `a${index}`,
                            })),
                        },
                    },
                },
                included: responses.map((response, index) => ({
                    type: "response",
                    lid: `a${index}`,
                    attributes: { value: response.value },
                    relationships: {
                        customField: { data: { type: "custom_field", id: response.customFieldId } },
                    },
                })),
            });

        it("demands every unfrozen customField regardless of its requirement", async () => {
            const response = await jsonApi.patch(`/editions/${deadlineEditionId}/me/host`, token, {
                data: {
                    type: "host",
                    relationships: { responses: { data: [] } },
                },
            });

            assert.equal(response.status, 422);
            const document = (await response.json()) as {
                errors: { code: string; meta: { missingCustomFieldIds: string[] } }[];
            };
            assert.equal(document.errors[0]?.code, "missing_responses");

            assert.deepEqual(document.errors[0]?.meta.missingCustomFieldIds, [
                deadlineCustomFieldId,
            ]);
        });

        it("accepts an empty value before the deadline passes", async () => {
            const response = await patchDeadlineResponses(token, [
                { customFieldId: deadlineCustomFieldId, value: "" },
            ]);

            assert.equal(response.status, 200);
            const answers = answersOf(await response.json());
            assert.equal(answers.length, 1);
            assert.equal(answers[0].attributes.value, "");
        });

        it("demands a value once the deadline passed", async () => {
            const fork = em.fork();
            const customField = await fork.findOneOrFail(CustomField, deadlineCustomFieldId);
            customField.deadline = Temporal.Now.instant().subtract({ hours: 1 });
            await fork.flush();

            const emptyResponse = await patchDeadlineResponses(token, [
                { customFieldId: deadlineCustomFieldId, value: "" },
            ]);
            assert.equal(emptyResponse.status, 422);
            const document = (await emptyResponse.json()) as {
                errors: { code: string; meta: { customFieldId: string } }[];
            };
            assert.equal(document.errors[0]?.code, "invalid_responses");
            assert.equal(document.errors[0]?.meta.customFieldId, deadlineCustomFieldId);

            const filledResponse = await patchDeadlineResponses(token, [
                { customFieldId: deadlineCustomFieldId, value: "Now it matters" },
            ]);
            assert.equal(filledResponse.status, 200);
        });

        it("refuses a manager's response to a frozen customField", async () => {
            const response = await patchDeadlineResponses(managerToken, [
                { customFieldId: deadlineCustomFieldId, value: "Manager response" },
                { customFieldId: lockedCustomFieldId, value: "written after the freeze" },
            ]);

            await expectJsonApiError(response, 422, "frozen_response");
            const storedResponse = await em.fork().findOne(Response, {
                host: { user: managerUserId },
                customField: lockedCustomFieldId,
            });
            assert.equal(storedResponse, null);
        });

        it("lets a manager leave out a required frozen customField", async () => {
            const response = await patchDeadlineResponses(managerToken, [
                { customFieldId: deadlineCustomFieldId, value: "Manager response" },
            ]);

            assert.equal(response.status, 200);
        });
    });

    describe("without a host profile yet", () => {
        let freshEditionId: string;
        let freshCustomFieldId: string;
        let extraCustomFieldId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({ name: "Fresh Response Edition" });
            const freshCustomField = new CustomField({
                position: 0,
                externalKey: null,
                target: "per_host",
                requirement: "always_required",
                options: { type: "single_line_text" },
                title: "Which meal do you prefer?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            const extraCustomField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_host",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Anything else?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            await fork.persist([edition, freshCustomField, extraCustomField]).flush();

            freshEditionId = edition.id;
            freshCustomFieldId = freshCustomField.id;
            extraCustomFieldId = extraCustomField.id;
        });

        const patchFreshResponses = (responses: ResponseInput[]) =>
            jsonApi.patch(`/editions/${freshEditionId}/me/host`, token, {
                data: {
                    type: "host",
                    relationships: {
                        responses: {
                            data: responses.map((_response, index) => ({
                                type: "response",
                                lid: `a${index}`,
                            })),
                        },
                    },
                },
                included: responses.map((response, index) => ({
                    type: "response",
                    lid: `a${index}`,
                    attributes: { value: response.value },
                    relationships: {
                        customField: { data: { type: "custom_field", id: response.customFieldId } },
                    },
                })),
            });

        it("creates the host profile on the first submission and names it", async () => {
            const fork = em.fork();
            const user = await fork.findOneOrFail(User, { externalId: "testuser" });
            assert.equal(await fork.count(Host, { edition: freshEditionId, user }), 0);

            const response = await patchFreshResponses([
                { customFieldId: freshCustomFieldId, value: "Vegan" },
                { customFieldId: extraCustomFieldId, value: "" },
            ]);

            assert.equal(response.status, 200);
            const document = (await response.json()) as {
                data: { type: string; id: string };
                included: { type: string; attributes: { value: unknown } }[];
            };

            const host = await em
                .fork()
                .findOneOrFail(Host, { edition: freshEditionId, user: user.id });
            assert.equal(document.data.type, "host");
            assert.equal(document.data.id, host.id);
            assert.deepEqual(
                document.included.map((resource) => resource.attributes.value).sort(),
                ["", "Vegan"],
            );
        });

        // A field added after the first submission is the only way a create and
        // an update meet in one request: every applicable field must already
        // carry a response for the submission before it to have been accepted.
        it("updates answered fields and creates one for a field added since", async () => {
            const setupFork = em.fork();
            const lateCustomField = new CustomField({
                position: 2,
                externalKey: null,
                target: "per_host",
                requirement: "always_required",
                options: { type: "single_line_text" },
                title: "Added after you first answered",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(Edition, freshEditionId),
            });
            await setupFork.persist(lateCustomField).flush();

            const response = await patchFreshResponses([
                { customFieldId: freshCustomFieldId, value: "Omnivore" },
                { customFieldId: extraCustomFieldId, value: "A quiet room, please" },
                { customFieldId: lateCustomField.id, value: "Answered late" },
            ]);

            assert.equal(response.status, 200);

            const fork = em.fork();
            const stored = await fork.find(Response, {
                customField: { edition: freshEditionId },
            });
            const byCustomField = new Map(
                stored.map((response) => [response.customField.id, response.value]),
            );

            assert.equal(stored.length, 3);
            assert.equal(byCustomField.get(freshCustomFieldId), "Omnivore");
            assert.equal(byCustomField.get(extraCustomFieldId), "A quiet room, please");
            assert.equal(byCustomField.get(lateCustomField.id), "Answered late");
        });

        it("still demands every applicable field once the host exists", async () => {
            const response = await patchFreshResponses([
                { customFieldId: extraCustomFieldId, value: "Only the optional one" },
            ]);

            await expectJsonApiError(response, 422, "missing_responses");
        });
    });
});
