import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { LockMode, ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Host } from "../../../src/entity/Host.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { releaseAfterLockWait } from "../../setup/locks.js";
import { fetchAccessToken } from "../../setup/token.js";

describe("sessions-crud", () => {
    let managerToken: string;
    let hostToken: string;
    let editionId: string;
    let sessionTypeId: string;
    let hostUserId: string;

    before(async () => {
        [managerToken, hostToken] = await Promise.all([
            fetchAccessToken("testuser"),
            fetchAccessToken("testhost"),
        ]);
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Managers",
        });
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });

        const edition = buildEdition({
            name: "Submission Edition",
            startDate: Temporal.PlainDate.from("2027-12-01"),
            endDate: Temporal.PlainDate.from("2027-12-03"),
            sessionFieldOptions: { abstract: { requirement: "optional" } },
        });
        const sessionType = SessionType.default(ref(edition));

        await fork.persist([manager, host, team, edition, sessionType]).flush();

        editionId = edition.id;
        sessionTypeId = sessionType.id;
        hostUserId = host.id;
    });

    const createSession = (token: string, title: string, abstract: string) =>
        jsonApi.post(`/editions/${editionId}/sessions`, token, {
            data: {
                type: "session",
                attributes: { title, abstract },
                relationships: {
                    sessionType: { data: { type: "session_type", id: sessionTypeId } },
                    responses: { data: [] },
                },
                meta: { selfService: true },
            },
        });

    const patchSession = (targetSessionId: string, title: string) =>
        jsonApi.patch(`/editions/${editionId}/sessions/${targetSessionId}`, hostToken, {
            data: {
                type: "session",
                id: targetSessionId,
                attributes: { title, abstract: "" },
                relationships: {
                    sessionType: { data: { type: "session_type", id: sessionTypeId } },
                    responses: { data: [] },
                },
                meta: { selfService: true },
            },
        });

    const transition = (token: string, targetSessionId: string, state: string) =>
        jsonApi.post(`/editions/${editionId}/sessions/${targetSessionId}/transitions`, token, {
            data: {
                type: "session_transition",
                attributes: { state },
            },
        });

    const deleteSession = (targetSessionId: string) =>
        jsonApi.delete(`/editions/${editionId}/sessions/${targetSessionId}`, managerToken);

    it("creates a session for the submitting user", async () => {
        const response = await createSession(
            hostToken,
            "Temporal in practice",
            "A tour through the new date API",
        );

        assert.equal(response.status, 201);
        const document = (await response.json()) as {
            data: {
                id: string;
                type: string;
                attributes: { state: string; title: string; abstract: string };
                relationships: {
                    hosts: { data: { id: string }[] };
                    sessionType: { data: { id: string } };
                    track: { data: unknown };
                };
            };
        };

        assert.equal(document.data.type, "session");
        assert.equal(document.data.attributes.state, "submitted");
        assert.equal(document.data.attributes.title, "Temporal in practice");
        assert.equal(document.data.attributes.abstract, "A tour through the new date API");
        const hostRecord = await em
            .fork()
            .findOneOrFail(Host, { edition: editionId, user: hostUserId });
        assert.deepEqual(
            document.data.relationships.hosts.data.map((identifier) => identifier.id),
            [hostRecord.id],
        );
        assert.equal(document.data.relationships.sessionType.data.id, sessionTypeId);
        assert.equal(document.data.relationships.track.data, null);
    });

    it("updates a submitted session as its host", async () => {
        const submitted = await createSession(
            hostToken,
            "Temporal in practice",
            "A tour through the new date API",
        );
        assert.equal(submitted.status, 201);
        const sessionId = ((await submitted.json()) as { data: { id: string } }).data.id;

        const response = await jsonApi.patch(
            `/editions/${editionId}/sessions/${sessionId}`,
            hostToken,
            {
                data: {
                    type: "session",
                    id: sessionId,
                    attributes: {
                        title: "Temporal in production",
                        abstract: "What broke and what did not",
                    },
                    relationships: {
                        sessionType: { data: { type: "session_type", id: sessionTypeId } },
                        responses: { data: [] },
                    },
                    meta: { selfService: true },
                },
            },
        );

        assert.equal(response.status, 200);
        const document = (await response.json()) as {
            data: { attributes: { title: string; abstract: string; state: string } };
        };
        assert.equal(document.data.attributes.title, "Temporal in production");
        assert.equal(document.data.attributes.abstract, "What broke and what did not");
        assert.equal(document.data.attributes.state, "submitted");

        const stored = await em.fork().findOneOrFail(Session, sessionId);
        assert.equal(stored.title, "Temporal in production");
        assert.equal(stored.abstract, "What broke and what did not");
    });

    it("deletes a submitted session without history", async () => {
        const create = await createSession(hostToken, "Draft to be dropped", "");
        assert.equal(create.status, 201);
        const createDocument = (await create.json()) as { data: { id: string } };

        const response = await deleteSession(createDocument.data.id);
        assert.equal(response.status, 204);
        assert.equal(await em.fork().count(Session, { id: createDocument.data.id }), 0);
    });

    it("refuses to delete a session carrying transitions", async () => {
        const create = await createSession(hostToken, "Already reviewed", "");
        assert.equal(create.status, 201);
        const createDocument = (await create.json()) as { data: { id: string } };
        const reviewedSessionId = createDocument.data.id;

        const accept = await transition(managerToken, reviewedSessionId, "accepted");
        assert.equal(accept.status, 201);

        // Back to submitted, so only the transition history stands between the
        // session and deletion.
        const revert = await transition(managerToken, reviewedSessionId, "submitted");
        assert.equal(revert.status, 201);

        const response = await deleteSession(reviewedSessionId);
        await expectJsonApiError(response, 409, "not_deletable");
        assert.equal(await em.fork().count(Session, { id: reviewedSessionId }), 1);
    });

    it("locks a host out of a rejected session but not out of an accepted one", async () => {
        const create = await createSession(hostToken, "Under review", "");
        assert.equal(create.status, 201);
        const createDocument = (await create.json()) as { data: { id: string } };
        const reviewedSessionId = createDocument.data.id;

        const reject = await transition(managerToken, reviewedSessionId, "rejected");
        assert.equal(reject.status, 201);

        const rejectedPatch = await patchSession(reviewedSessionId, "Rejected but rewritten");
        await expectJsonApiError(rejectedPatch, 403, "not_editable");

        const reopen = await transition(managerToken, reviewedSessionId, "submitted");
        assert.equal(reopen.status, 201);
        const accept = await transition(managerToken, reviewedSessionId, "accepted");
        assert.equal(accept.status, 201);

        const acceptedPatch = await patchSession(reviewedSessionId, "Accepted and rewritten");
        assert.equal(acceptedPatch.status, 200);

        const stored = await em.fork().findOneOrFail(Session, reviewedSessionId);
        assert.equal(stored.title, "Accepted and rewritten");
    });

    // The deadline is read before the edition lock, so a write moving it into
    // the past while this waits has to be judged by what it commits.
    it("refuses a submission a concurrent deadline change closed", async () => {
        const taken = Promise.withResolvers<void>();
        const held = Promise.withResolvers<void>();
        const holding = em.fork().transactional(async (em) => {
            const edition = await em.findOneOrFail(Edition, editionId, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            edition.submissionDeadline = Temporal.Now.instant().subtract({ minutes: 1 });
            await em.flush();
            taken.resolve();
            await held.promise;
        });

        await taken.promise;

        const submitted = send(createSession(hostToken, "Just too late", ""));
        const waitError = await releaseAfterLockWait(em.fork(), () => {
            held.resolve();
        });

        await holding;

        if (waitError !== null) {
            throw waitError;
        }

        await expectJsonApiError(await submitted, 403, "deadline_passed");
    });

    describe("passed submission deadline", () => {
        let closedEditionId: string;
        let closedSessionTypeId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Closed Edition",
                submissionDeadline: Temporal.Now.instant().subtract({ hours: 1 }),
                sessionFieldOptions: {},
            });
            const sessionType = SessionType.default(ref(edition));
            await fork.persist([edition, sessionType]).flush();

            closedEditionId = edition.id;
            closedSessionTypeId = sessionType.id;
        });

        const createClosedSession = (token: string, title: string, selfService: boolean) =>
            jsonApi.post(`/editions/${closedEditionId}/sessions`, token, {
                data: {
                    type: "session",
                    attributes: { title },
                    relationships: {
                        sessionType: { data: { type: "session_type", id: closedSessionTypeId } },
                        responses: { data: [] },
                    },
                    meta: { selfService },
                },
            });

        it("refuses a submission from a host", async () => {
            const response = await createClosedSession(hostToken, "Too late", true);

            await expectJsonApiError(response, 403, "deadline_passed");
            assert.equal(await em.fork().count(Session, { edition: closedEditionId }), 0);
        });

        it("still takes a submission from a manager", async () => {
            const response = await createClosedSession(managerToken, "Entered by hand", false);

            assert.equal(response.status, 201);
            const document = (await response.json()) as { data: { id: string } };
            const stored = await em.fork().findOneOrFail(Session, document.data.id);
            assert.equal(stored.title, "Entered by hand");
        });
    });

    describe("frozen questions", () => {
        let frozenFieldId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const field = new CustomField({
                position: 0,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_required",
                options: { type: "single_line_text" },
                title: "Frozen and required",
                helperText: "",
                deadline: null,
                freezeAfter: Temporal.Now.instant().subtract({ hours: 1 }),
                edition: ref(fork.getReference(Edition, editionId)),
            });
            await fork.persist(field).flush();

            frozenFieldId = field.id;
        });

        const createAsManager = (title: string, answer?: string) =>
            jsonApi.post(`/editions/${editionId}/sessions`, managerToken, {
                data: {
                    type: "session",
                    attributes: { title, abstract: "" },
                    relationships: {
                        sessionType: { data: { type: "session_type", id: sessionTypeId } },
                        responses: {
                            data: answer === undefined ? [] : [{ type: "response", lid: "late" }],
                        },
                    },
                    meta: { selfService: false },
                },
                ...(answer === undefined
                    ? {}
                    : {
                          included: [
                              {
                                  type: "response",
                                  lid: "late",
                                  attributes: { value: answer },
                                  relationships: {
                                      customField: {
                                          data: { type: "custom_field", id: frozenFieldId },
                                      },
                                  },
                              },
                          ],
                      }),
            });

        it("takes a manager's session that leaves a required frozen question out", async () => {
            const response = await createAsManager("Entered after the freeze");

            assert.equal(response.status, 201);
        });

        it("refuses a manager's answer to a frozen question", async () => {
            const response = await createAsManager("Answered after the freeze", "added late");

            await expectJsonApiError(response, 422, "frozen_response");
            assert.equal(await em.fork().count(Session, { title: "Answered after the freeze" }), 0);
        });
    });

    describe("length bounds", () => {
        let boundedEditionId: string;
        let boundedSessionTypeId: string;

        beforeEach(async () => {
            const fork = em.fork();
            const edition = buildEdition({
                name: "Bounded Edition",
                sessionFieldOptions: {
                    abstract: { requirement: "optional", minLength: 5, maxLength: 10 },
                },
            });
            const sessionType = SessionType.default(ref(edition));
            await fork.persist([edition, sessionType]).flush();

            boundedEditionId = edition.id;
            boundedSessionTypeId = sessionType.id;
        });

        const createWithAbstract = (title: string, abstract: string) =>
            jsonApi.post(`/editions/${boundedEditionId}/sessions`, hostToken, {
                data: {
                    type: "session",
                    attributes: { title, abstract },
                    relationships: {
                        sessionType: { data: { type: "session_type", id: boundedSessionTypeId } },
                        responses: { data: [] },
                    },
                    meta: { selfService: true },
                },
            });

        it("takes no answer at all for an optional field", async () => {
            const response = await createWithAbstract("No abstract", "");

            assert.equal(response.status, 201);
        });

        it("takes whitespace as no answer at all", async () => {
            const response = await createWithAbstract("Blank abstract", "   ");

            assert.equal(response.status, 201);
            const document = (await response.json()) as { data: { id: string } };
            const stored = await em.fork().findOneOrFail(Session, document.data.id);
            assert.equal(stored.abstract, "");
        });

        it("refuses an answer below the minimum, optional or not", async () => {
            const response = await createWithAbstract("Short abstract", "abc");

            await expectJsonApiError(response, 422, "too_small");
            assert.equal(await em.fork().count(Session, { title: "Short abstract" }), 0);
        });

        it("refuses an answer above the maximum", async () => {
            const response = await createWithAbstract("Long abstract", "abcdefghijk");

            await expectJsonApiError(response, 422, "too_big");
        });

        it("takes an answer that trims into range", async () => {
            const response = await createWithAbstract("Padded abstract", "  abcde  ");

            assert.equal(response.status, 201);
            const document = (await response.json()) as { data: { id: string } };
            const stored = await em.fork().findOneOrFail(Session, document.data.id);
            assert.equal(stored.abstract, "abcde");
        });
    });

    describe("a field switched under an open form", () => {
        const postSession = (
            attributes: Record<string, unknown>,
            relationships: Record<string, unknown> = {},
        ) =>
            jsonApi.post(`/editions/${editionId}/sessions`, hostToken, {
                data: {
                    type: "session",
                    attributes,
                    relationships: {
                        sessionType: { data: { type: "session_type", id: sessionTypeId } },
                        responses: { data: [] },
                        ...relationships,
                    },
                    meta: { selfService: true },
                },
            });

        it("refuses a field the edition no longer asks for as a stale form", async () => {
            const response = await postSession({ title: "Talk", abstract: "", notes: "Hi" });

            await expectJsonApiError(response, 422, "session_fields_changed");
        });

        it("refuses a track the edition no longer asks for as a stale form", async () => {
            const response = await postSession(
                { title: "Talk", abstract: "" },
                { track: { data: null } },
            );

            await expectJsonApiError(response, 422, "session_fields_changed");
        });

        it("refuses a create leaving out a field the edition now asks for", async () => {
            const response = await postSession({ title: "Talk" });

            await expectJsonApiError(response, 422, "session_fields_changed");
        });

        it("still refuses a create leaving out the title as a missing key", async () => {
            const response = await postSession({ abstract: "" });

            await expectJsonApiError(response, 422, "invalid_type");
        });

        it("refuses an update to a field the edition no longer asks for", async () => {
            const created = await postSession({ title: "Talk", abstract: "" });
            const { data } = (await created.json()) as { data: { id: string } };

            const response = await jsonApi.patch(
                `/editions/${editionId}/sessions/${data.id}`,
                hostToken,
                {
                    data: {
                        type: "session",
                        id: data.id,
                        attributes: { notes: "Hi" },
                        meta: { selfService: true },
                    },
                },
            );

            await expectJsonApiError(response, 422, "session_fields_changed");
        });

        it("takes an update leaving an asked field out", async () => {
            const created = await postSession({ title: "Talk", abstract: "" });
            const { data } = (await created.json()) as { data: { id: string } };

            const response = await jsonApi.patch(
                `/editions/${editionId}/sessions/${data.id}`,
                hostToken,
                {
                    data: {
                        type: "session",
                        id: data.id,
                        attributes: { title: "Renamed" },
                        meta: { selfService: true },
                    },
                },
            );

            assert.equal(response.status, 200);
        });
    });

    describe("meta transitions on the written session", () => {
        type WrittenSession = {
            data: {
                id: string;
                meta?: { hostTransitions?: string[]; managerTransitions?: string[] };
            };
        };

        const metaOf = async (response: Awaited<ReturnType<typeof createSession>>) =>
            ((await response.json()) as WrittenSession).data.meta;

        const createOnBehalf = (title: string) =>
            jsonApi.post(`/editions/${editionId}/sessions`, managerToken, {
                data: {
                    type: "session",
                    attributes: { title, abstract: "" },
                    relationships: {
                        sessionType: { data: { type: "session_type", id: sessionTypeId } },
                        responses: { data: [] },
                    },
                    meta: { selfService: false },
                },
            });

        // The one caller both sets exist for. Merged into a single list, this
        // session would offer its organizer the decision on it from the page
        // they speak from, and the withdrawal from the page they organize on.
        it("keeps each role's moves apart for a manager who hosts", async () => {
            const response = await createSession(managerToken, "Filed by an organizer", "");

            assert.equal(response.status, 201);
            const meta = await metaOf(response);

            assert.deepEqual(meta?.hostTransitions, ["withdrawn"]);
            assert.deepEqual(meta?.managerTransitions?.toSorted(), ["accepted", "rejected"]);
        });

        it("offers the creator the move only a host may make", async () => {
            const response = await createSession(hostToken, "Freshly filed", "");

            assert.equal(response.status, 201);
            assert.deepEqual((await metaOf(response))?.hostTransitions, ["withdrawn"]);
        });

        it("offers no host move to a manager filing on someone's behalf", async () => {
            // Self service is what attaches the caller as a host, so without it
            // the session is nobody's to withdraw.
            const response = await createOnBehalf("Filed for someone");

            assert.equal(response.status, 201);
            const meta = await metaOf(response);

            assert.deepEqual(meta?.managerTransitions?.toSorted(), ["accepted", "rejected"]);
            assert.deepEqual(meta?.hostTransitions, []);
        });

        it("still answers after an update", async () => {
            const created = await createSession(hostToken, "Filed then edited", "");
            const { data } = (await created.json()) as WrittenSession;

            const response = await patchSession(data.id, "Edited");

            assert.equal(response.status, 200);
            assert.deepEqual((await metaOf(response))?.hostTransitions, ["withdrawn"]);
        });
    });
});
