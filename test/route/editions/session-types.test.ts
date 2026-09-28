import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait, waitForLockWaiters } from "../../setup/locks.js";
import { raceScopeEmptyingDeletes } from "../../setup/scope-race.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("session-types", () => {
    let managerToken: string;
    let viewerToken: string;
    let plainUserToken: string;
    let editionId: string;
    let defaultSessionTypeId: string;
    let sessionTypeId: string;
    let internalSessionTypeId: string;

    before(async () => {
        [managerToken, viewerToken, plainUserToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
            fetchAccessToken("stranger"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager");
        const { user: viewer, team: viewerTeam } = buildTeamMember("testhost", "viewer");
        const plainUser = new User({
            externalId: "stranger",
            displayName: "Test Stranger",
            emailAddress: "stranger@example.test",
        });

        const edition = buildEdition({ name: "Session Type Edition" });
        const defaultSessionType = SessionType.default(ref(edition));
        const sessionType = new SessionType({
            name: "Breakout",
            externalKey: "breakout",
            defaultDuration: Temporal.Duration.from({ minutes: 45 }),
            internal: false,
            selectionDefault: false,
            edition: ref(edition),
        });

        const internalSessionType = new SessionType({
            name: "Break",
            externalKey: "break",
            defaultDuration: Temporal.Duration.from({ minutes: 30 }),
            internal: true,
            selectionDefault: false,
            edition: ref(edition),
        });

        await fork
            .persist([
                manager,
                viewer,
                plainUser,
                team,
                viewerTeam,
                edition,
                defaultSessionType,
                sessionType,
                internalSessionType,
            ])
            .flush();

        editionId = edition.id;
        defaultSessionTypeId = defaultSessionType.id;
        sessionTypeId = sessionType.id;
        internalSessionTypeId = internalSessionType.id;
    });

    it("hides internal session types from anyone on no team", async () => {
        const listFor = async (who: string, token: string): Promise<string[]> => {
            const response = await jsonApi.get(`/editions/${editionId}/session-types`, token);

            assert.equal(response.status, 200, `${who} could not list the session types`);
            const document = (await response.json()) as { data: { id: string }[] };

            return document.data.map((resource) => resource.id).sort();
        };

        const all = [defaultSessionTypeId, sessionTypeId, internalSessionTypeId].sort();

        assert.deepEqual(await listFor("the manager", managerToken), all);
        assert.deepEqual(await listFor("the viewer", viewerToken), all);
        assert.deepEqual(
            await listFor("the stranger", plainUserToken),
            [defaultSessionTypeId, sessionTypeId].sort(),
        );
    });

    it("rejects a session type of no length", async () => {
        const response = await jsonApi.post(`/editions/${editionId}/session-types`, managerToken, {
            data: {
                type: "session_type",
                attributes: {
                    name: "Instant",
                    externalKey: null,
                    defaultDuration: "PT0S",
                    internal: false,
                },
            },
        });

        assert.equal(response.status, 422);
    });

    it("creates a session type that is not the selection default", async () => {
        const response = await jsonApi.post(`/editions/${editionId}/session-types`, managerToken, {
            data: {
                type: "session_type",
                attributes: {
                    name: "Workshop",
                    externalKey: "workshop",
                    defaultDuration: "PT45M",
                    internal: false,
                },
            },
        });

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: {
                id: string;
                type: string;
                attributes: {
                    name: string;
                    externalKey: string | null;
                    defaultDuration: string;
                    internal: boolean;
                    selectionDefault: boolean;
                };
            };
        };
        assert.equal(document.data.type, "session_type");
        assert.deepEqual(document.data.attributes, {
            name: "Workshop",
            externalKey: "workshop",
            defaultDuration: "PT45M",
            internal: false,
            selectionDefault: false,
        });
    });

    it("lists the session types of an edition", async () => {
        const response = await jsonApi.get(`/editions/${editionId}/session-types`, managerToken);

        assert.equal(response.status, 200);
        const document = (await response.json()) as { data: { id: string }[] };
        assert.deepEqual(
            document.data.map((resource) => resource.id).sort(),
            [defaultSessionTypeId, sessionTypeId, internalSessionTypeId].sort(),
        );
    });

    it("refuses to make the last session type speakers may pick internal", async () => {
        await em.fork().nativeUpdate(SessionType, { id: defaultSessionTypeId }, { internal: true });

        const response = await jsonApi.patch(
            `/editions/${editionId}/session-types/${sessionTypeId}`,
            managerToken,
            {
                data: {
                    type: "session_type",
                    id: sessionTypeId,
                    attributes: {
                        name: "Breakout",
                        externalKey: "breakout",
                        defaultDuration: "PT45M",
                        internal: true,
                    },
                },
            },
        );

        await expectJsonApiError(response, 409, "nothing_to_pick");
        assert.equal((await em.fork().findOneOrFail(SessionType, sessionTypeId)).internal, false);
    });

    it("patches a session type", async () => {
        const response = await jsonApi.patch(
            `/editions/${editionId}/session-types/${sessionTypeId}`,
            managerToken,
            {
                data: {
                    type: "session_type",
                    id: sessionTypeId,
                    attributes: {
                        name: "Long Workshop",
                        externalKey: null,
                        defaultDuration: "PT1H30M",
                        internal: true,
                    },
                },
            },
        );

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: {
                id: string;
                attributes: {
                    name: string;
                    externalKey: string | null;
                    defaultDuration: string;
                    internal: boolean;
                };
            };
        };
        assert.equal(document.data.id, sessionTypeId);
        assert.equal(document.data.attributes.name, "Long Workshop");
        assert.equal(document.data.attributes.externalKey, null);
        assert.equal(document.data.attributes.defaultDuration, "PT1H30M");
        assert.equal(document.data.attributes.internal, true);
    });

    it("moves the selection default to the promoted session type", async () => {
        const response = await jsonApi.post(
            `/editions/${editionId}/session-types/${sessionTypeId}/default-promotion`,
            managerToken,
            {
                data: {
                    type: "session_type_default_promotion",
                    id: sessionTypeId,
                },
            },
        );

        assert.equal(response.status, 204);

        const fork = em.fork();
        const promoted = await fork.findOneOrFail(SessionType, sessionTypeId);
        const demoted = await fork.findOneOrFail(SessionType, defaultSessionTypeId);
        assert.equal(promoted.selectionDefault, true);
        assert.equal(demoted.selectionDefault, false);
    });

    // An edition delete holds the edition and then cascades into every session
    // type in its own order, while a promotion takes two of them in another.
    // Waiting at the edition is what keeps the two from meeting among the rows.
    it("waits for a writer holding the edition before taking any session type", async () => {
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOne(Edition, editionId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const promote = send(
            jsonApi.post(
                `/editions/${editionId}/session-types/${sessionTypeId}/default-promotion`,
                managerToken,
                {
                    data: {
                        type: "session_type_default_promotion",
                        id: sessionTypeId,
                    },
                },
            ),
        );

        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                // Waiting is not enough: a promote that pinned the edition last
                // would also wait, holding both rows. Taking the target from a
                // third connection shows it has not reached them yet.
                whileHeld: async () => {
                    await em
                        .fork()
                        .getConnection()
                        .execute('select 1 from "session_type" where "id" = ? for update nowait', [
                            sessionTypeId,
                        ]);
                },
            },
        );

        await holding;
        const response = await promote;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(response.status, 204);
        assert.equal(
            (await em.fork().findOneOrFail(SessionType, sessionTypeId)).selectionDefault,
            true,
        );
    });

    // An edition delete removes the edition's sessions and then cascades into
    // the type, while this delete's foreign key check waits on those sessions.
    it("waits for a writer holding the edition before taking the session type it deletes", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = await fork.findOneOrFail(SessionType, sessionTypeId);
        await fork.persist(buildSession(edition, sessionType)).flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.findOne(Edition, editionId, { lockMode: LockMode.PESSIMISTIC_WRITE });
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const remove = send(
            jsonApi.delete(`/editions/${editionId}/session-types/${sessionTypeId}`, managerToken),
        );

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
                        .execute('select 1 from "session_type" where "id" = ? for update nowait', [
                            sessionTypeId,
                        ]);
                },
            },
        );

        await holding;
        const response = await remove;

        if (waitError !== null) {
            throw waitError;
        }

        await expectJsonApiError(response, 409, "entity_in_use");
        assert.equal(await em.fork().count(SessionType, { id: sessionTypeId }), 1);
    });

    it("refuses to delete the default session type", async () => {
        const rejected = await jsonApi.delete(
            `/editions/${editionId}/session-types/${defaultSessionTypeId}`,
            managerToken,
        );

        await expectJsonApiError(rejected, 409, "default_session_type");

        const accepted = await jsonApi.delete(
            `/editions/${editionId}/session-types/${sessionTypeId}`,
            managerToken,
        );

        assert.equal(accepted.status, 204);
        assert.equal(await em.fork().count(SessionType, { id: sessionTypeId }), 0);
    });

    it("refuses to delete a session type a session still uses", async () => {
        const createResponse = await jsonApi.post(
            `/editions/${editionId}/session-types`,
            managerToken,
            {
                data: {
                    type: "session_type",
                    attributes: {
                        name: "Keynote",
                        externalKey: "keynote",
                        defaultDuration: "PT30M",
                        internal: false,
                    },
                },
            },
        );
        assert.equal(createResponse.status, 201);
        const document = (await createResponse.json()) as { data: { id: string } };
        const usedSessionTypeId = document.data.id;

        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = await fork.findOneOrFail(SessionType, usedSessionTypeId);
        await fork
            .persist(buildSession(edition, sessionType, { title: "Keynote Session" }))
            .flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/session-types/${usedSessionTypeId}`,
            managerToken,
        );

        await expectJsonApiError(response, 409, "entity_in_use");
        assert.equal(await em.fork().count(SessionType, { id: usedSessionTypeId }), 1);
    });

    it("refuses to delete a session type a custom field is scoped to and nothing else", async () => {
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const sessionType = new SessionType({
            name: "Doomed Type",
            externalKey: null,
            defaultDuration: Temporal.Duration.from({ minutes: 30 }),
            internal: false,
            selectionDefault: false,
            edition: ref(edition),
        });
        const customField = new CustomField({
            position: 90,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "Scoped to a doomed type",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        customField.sessionTypes.add(sessionType);
        await fork.persist([sessionType, customField]).flush();

        const response = await jsonApi.delete(
            `/editions/${editionId}/session-types/${sessionType.id}`,
            managerToken,
        );
        await expectJsonApiError(response, 409, "scope_in_use");

        const readFork = em.fork();
        assert.equal(await readFork.count(SessionType, { id: sessionType.id }), 1);
        const survivor = await readFork.findOneOrFail(
            CustomField,
            { id: customField.id },
            { populate: ["sessionTypes"] },
        );
        assert.equal(survivor.sessionTypes.length, 1);
    });

    // A custom field update pins the session types it names in id order. A
    // promote holding its target while waiting for a lower default would
    // cross it, so promote takes the edition exclusively and the update waits
    // there. A key share held on the default parks the promote at it.
    it("finishes a promote before a custom field update naming both types", async () => {
        assert.ok(defaultSessionTypeId < sessionTypeId);
        const fork = em.fork();
        const edition = await fork.findOneOrFail(Edition, editionId);
        const scoped = new CustomField({
            position: 0,
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
        scoped.sessionTypes.add(
            fork.getReference(SessionType, defaultSessionTypeId),
            fork.getReference(SessionType, sessionTypeId),
        );
        await fork.persist(scoped).flush();

        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            await em.execute('select 1 from "session_type" where "id" = ? for key share', [
                defaultSessionTypeId,
            ]);
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const promoting = send(
            jsonApi.post(
                `/editions/${editionId}/session-types/${sessionTypeId}/default-promotion`,
                managerToken,
                {
                    data: {
                        type: "session_type_default_promotion",
                        id: sessionTypeId,
                    },
                },
            ),
        );
        let updating: Promise<TestResponse> | undefined;
        const waitError = await releaseAfterLockWait(
            em.fork(),
            () => {
                held.resolve();
            },
            {
                whileHeld: async () => {
                    updating = send(
                        jsonApi.patch(
                            `/editions/${editionId}/custom-fields/${scoped.id}`,
                            managerToken,
                            {
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
                                        sessionTypes: {
                                            data: [
                                                { type: "session_type", id: defaultSessionTypeId },
                                                { type: "session_type", id: sessionTypeId },
                                            ],
                                        },
                                        tracks: { data: [] },
                                    },
                                },
                            },
                        ),
                    );
                    await waitForLockWaiters(em.fork(), { count: 2 });
                },
            },
        );

        await holding;
        const promoted = await promoting;
        const updated = await updating;

        if (waitError !== null) {
            throw waitError;
        }

        assert.equal(promoted.status, 204);
        assert.equal(updated?.status, 200);
    });

    // Holding the scoping rows parks the first in its cascade, after its check
    // and before its commit.
    it("refuses the second of two deletes that would empty a field's scope", async () => {
        await raceScopeEmptyingDeletes({
            editionId,
            managerToken,
            dimension: "sessionTypes",
            ids: [sessionTypeId, internalSessionTypeId],
            park: (em, customFieldId) =>
                em.execute(
                    'select 1 from "custom_field_session_types" where "custom_field_id" = ? for update',
                    [customFieldId],
                ),
        });
    });
});
