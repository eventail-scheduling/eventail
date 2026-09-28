import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { LockMode, ref } from "@mikro-orm/core";
import type { TestResponse } from "@taxum/testing";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Edition } from "../../../src/entity/Edition.js";
import { Response } from "../../../src/entity/Response.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition, buildHost, buildSession, buildTeamMember } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi, send } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

/**
 * Every test here sends less than the whole session and asks what survived.
 *
 * An absent member keeps its stored value (JSON:API 1.1, "Updating Resources"),
 * and a complete body passes through the merge unchanged.
 */
describe("session patch merge", () => {
    let managerToken: string;
    let editionId: string;
    let sessionId: string;
    let sessionTypeId: string;
    let otherSessionTypeId: string;
    let trackId: string;
    let customFieldId: string;
    let responseId: string;

    before(async () => {
        managerToken = await fetchAccessToken("testuser");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const { user: manager, team } = buildTeamMember("testuser", "manager", {
            displayName: "Test Manager",
            emailAddress: "manager@example.test",
            teamName: "Merge Managers",
        });

        const edition = buildEdition({
            name: "Merge Edition",
            sessionFieldOptions: {
                abstract: { requirement: "optional" },
                notes: { requirement: "optional" },
                track: { requirement: "optional" },
            },
        });
        const sessionType = SessionType.default(ref(edition));
        const otherSessionType = new SessionType({
            name: "Workshop",
            externalKey: null,
            internal: false,
            selectionDefault: false,
            defaultDuration: Temporal.Duration.from({ minutes: 60 }),
            edition: ref(edition),
        });
        const track = new Track({
            name: "Main",
            externalKey: null,
            description: "",
            color: "#123456",
            internal: false,
            edition: ref(edition),
        });

        const session = buildSession(edition, sessionType, {
            title: "Original title",
            abstract: "Original abstract",
            notes: "Original notes",
        });
        session.track = ref(track);

        const customField = new CustomField({
            position: 0,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_required",
            options: { type: "single_line_text" },
            title: "What do you need?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(edition),
        });
        const response = Response.sessionResponse(ref(customField), ref(session), "a projector");

        await fork
            .persist([
                manager,
                team,
                edition,
                sessionType,
                otherSessionType,
                track,
                session,
                customField,
                response,
            ])
            .flush();

        editionId = edition.id;
        sessionId = session.id;
        sessionTypeId = sessionType.id;
        otherSessionTypeId = otherSessionType.id;
        trackId = track.id;
        customFieldId = customField.id;
        responseId = response.id;
    });

    const patch = (data: Record<string, unknown>, included?: unknown[]) =>
        jsonApi.patch(`/editions/${editionId}/sessions/${sessionId}`, managerToken, {
            data: { type: "session", id: sessionId, ...data },
            ...(included && { included }),
        });

    const storedValue = async (): Promise<unknown> =>
        (await em.fork().findOneOrFail(Response, responseId)).value;

    const answerById = (id: string) => ({
        relationships: { responses: { data: [{ type: "response", id }] } },
    });

    const storedSession = (): Promise<Session> =>
        em.fork().findOneOrFail(Session, sessionId, { populate: ["track", "sessionType"] });

    it("changes only the attributes it was sent", async () => {
        const response = await patch({ attributes: { title: "New title" } });
        assert.equal(response.status, 200);

        const stored = await storedSession();
        assert.equal(stored.title, "New title");
        assert.equal(stored.abstract, "Original abstract");
        assert.equal(stored.notes, "Original notes");
    });

    it("leaves the relationships it was not sent", async () => {
        const response = await patch({ attributes: { title: "Still tracked" } });
        assert.equal(response.status, 200);

        const stored = await storedSession();
        assert.equal(stored.track?.id, trackId);
        assert.equal(stored.sessionType.id, sessionTypeId);
    });

    // The edition removing its track question sends the same absence a client
    // does, and neither may throw away an assignment an organizer made.
    it("clears a relationship only when told to in so many words", async () => {
        const kept = await patch({ relationships: { sessionType: { data: null } } });
        assert.equal(kept.status, 422);

        const cleared = await patch({ relationships: { track: { data: null } } });
        assert.equal(cleared.status, 200);
        assert.equal((await storedSession()).track, null);
    });

    it("repoints a relationship it was sent", async () => {
        const response = await patch({
            relationships: {
                sessionType: { data: { type: "session_type", id: otherSessionTypeId } },
            },
        });
        assert.equal(response.status, 200);

        const stored = await storedSession();
        assert.equal(stored.sessionType.id, otherSessionTypeId);
        assert.equal(stored.track?.id, trackId);
    });

    it("keeps the stored answers when responses is absent", async () => {
        const response = await patch({ attributes: { title: "Answers untouched" } });
        assert.equal(response.status, 200);

        const stored = await em.fork().find(Response, { session: sessionId });
        assert.equal(stored.length, 1);
        assert.equal(stored[0]?.value, "a projector");
    });

    it("still demands every applicable answer when responses is sent", async () => {
        await expectJsonApiError(
            await patch({ relationships: { responses: { data: [] } } }),
            422,
            "missing_responses",
        );
    });

    it("replaces the answers it was sent", async () => {
        const response = await patch(
            { relationships: { responses: { data: [{ type: "response", lid: "one" }] } } },
            [
                {
                    type: "response",
                    lid: "one",
                    attributes: { value: "a whiteboard" },
                    relationships: {
                        customField: { data: { type: "custom_field", id: customFieldId } },
                    },
                },
            ],
        );
        assert.equal(response.status, 200);

        const stored = await em.fork().find(Response, { session: sessionId });
        assert.equal(stored.length, 1);
        assert.equal(stored[0]?.value, "a whiteboard");
    });

    it("refuses a type change that leaves a question it brings in unanswered", async () => {
        const fork = em.fork();
        const workshopField = new CustomField({
            position: 1,
            externalKey: null,
            target: "per_proposal",
            requirement: "always_optional",
            options: { type: "single_line_text" },
            title: "How many seats?",
            helperText: "",
            deadline: null,
            freezeAfter: null,
            edition: ref(fork.getReference(Edition, editionId)),
        });
        workshopField.sessionTypes.add(fork.getReference(SessionType, otherSessionTypeId));
        await fork.persist(workshopField).flush();

        const response = await patch({
            relationships: {
                sessionType: { data: { type: "session_type", id: otherSessionTypeId } },
            },
        });

        assert.equal(response.status, 422);
        const document = await response.json<{
            errors: { code: string; meta: { missingCustomFieldIds: string[] } }[];
        }>();
        assert.equal(document.errors[0]?.code, "missing_responses");
        assert.deepEqual(document.errors[0]?.meta.missingCustomFieldIds, [workshopField.id]);
        assert.equal((await storedSession()).sessionType.id, sessionTypeId);
    });

    it("accepts a body carrying nothing but the identity", async () => {
        const response = await patch({});
        assert.equal(response.status, 200);

        const stored = await storedSession();
        assert.equal(stored.title, "Original title");
        assert.equal(stored.track?.id, trackId);
    });

    describe("answers named by id", () => {
        // Another writer changes the answer after this sender loaded it. The id
        // carries no value, so there is nothing stale to write back.
        it("keeps the stored value, not the one the sender last saw", async () => {
            const other = await patch(
                { relationships: { responses: { data: [{ type: "response", lid: "one" }] } } },
                [
                    {
                        type: "response",
                        lid: "one",
                        attributes: { value: "a whiteboard" },
                        relationships: {
                            customField: { data: { type: "custom_field", id: customFieldId } },
                        },
                    },
                ],
            );
            assert.equal(other.status, 200);

            const response = await patch({
                attributes: { title: "Edited meanwhile" },
                ...answerById(responseId),
            });
            assert.equal(response.status, 200);

            assert.equal((await storedSession()).title, "Edited meanwhile");
            assert.equal(await storedValue(), "a whiteboard");
        });

        // The field is required, so an empty answer is one given before the
        // organizer made it so. Sent by lid it is refused, which is what makes
        // the id case prove anything.
        it("keeps an answer the field would no longer accept", async () => {
            await em.fork().nativeUpdate(Response, { id: responseId }, { value: null });

            await expectJsonApiError(
                await patch(
                    { relationships: { responses: { data: [{ type: "response", lid: "one" }] } } },
                    [
                        {
                            type: "response",
                            lid: "one",
                            attributes: { value: null },
                            relationships: {
                                customField: { data: { type: "custom_field", id: customFieldId } },
                            },
                        },
                    ],
                ),
                422,
                "invalid_responses",
            );

            const response = await patch(answerById(responseId));
            assert.equal(response.status, 200);
            assert.equal(await storedValue(), null);
        });

        it("refuses an answer of another session", async () => {
            const fork = em.fork();
            const edition = fork.getReference(Edition, editionId);
            const otherSession = buildSession(
                edition,
                fork.getReference(SessionType, sessionTypeId),
            );
            const otherResponse = Response.sessionResponse(
                fork.getReference(CustomField, customFieldId, { wrapped: true }),
                ref(otherSession),
                "somebody else's",
            );
            await fork.persist([otherSession, otherResponse]).flush();

            await expectJsonApiError(
                await patch(answerById(otherResponse.id)),
                422,
                "unknown_response",
            );
            assert.equal(await storedValue(), "a projector");
        });

        it("refuses an answer of a host", async () => {
            const fork = em.fork();
            const edition = fork.getReference(Edition, editionId);
            const user = new User({
                externalId: "answer-host",
                displayName: "Answer Host",
                emailAddress: "answer-host@example.test",
            });
            const host = buildHost(edition, user);
            const hostField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_host",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Where are you from?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });
            const hostResponse = Response.hostResponse(ref(hostField), ref(host), "Berlin");
            await fork.persist([user, host, hostField, hostResponse]).flush();

            await expectJsonApiError(
                await patch(answerById(hostResponse.id)),
                422,
                "unknown_response",
            );
        });

        const storeSecondAnswer = async (scopedToSessionTypeId?: string): Promise<string> => {
            const fork = em.fork();
            const field = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Anything else?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(fork.getReference(Edition, editionId)),
            });

            if (scopedToSessionTypeId !== undefined) {
                field.sessionTypes.add(fork.getReference(SessionType, scopedToSessionTypeId));
            }

            const answer = Response.sessionResponse(
                ref(field),
                ref(fork.getReference(Session, sessionId)),
                "a second answer",
            );
            await fork.persist([field, answer]).flush();

            return answer.id;
        };

        it("changes an answer sent by lid and keeps one named by id", async () => {
            const answerId = await storeSecondAnswer();

            const response = await patch(
                {
                    relationships: {
                        responses: {
                            data: [
                                { type: "response", lid: "one" },
                                { type: "response", id: answerId },
                            ],
                        },
                    },
                },
                [
                    {
                        type: "response",
                        lid: "one",
                        attributes: { value: "a whiteboard" },
                        relationships: {
                            customField: { data: { type: "custom_field", id: customFieldId } },
                        },
                    },
                ],
            );
            assert.equal(response.status, 200);

            assert.equal(await storedValue(), "a whiteboard");
            const kept = await em.fork().findOneOrFail(Response, answerId);
            assert.equal(kept.value, "a second answer");
        });

        // Scoped away is not deleted: switching back brings the answer back,
        // so a client carries it by id through the switch.
        it("keeps an answer by id whose field the patch scopes away", async () => {
            const answerId = await storeSecondAnswer(sessionTypeId);

            const response = await patch({
                relationships: {
                    sessionType: { data: { type: "session_type", id: otherSessionTypeId } },
                    responses: {
                        data: [
                            { type: "response", id: responseId },
                            { type: "response", id: answerId },
                        ],
                    },
                },
            });
            assert.equal(response.status, 200);

            assert.equal((await storedSession()).sessionType.id, otherSessionTypeId);
            const kept = await em.fork().findOneOrFail(Response, answerId);
            assert.equal(kept.value, "a second answer");
        });

        it("brings a kept answer back when the session switches back", async () => {
            const answerId = await storeSecondAnswer(sessionTypeId);
            const switchTo = (id: string) =>
                patch({
                    relationships: {
                        sessionType: { data: { type: "session_type", id } },
                        responses: {
                            data: [
                                { type: "response", id: responseId },
                                { type: "response", id: answerId },
                            ],
                        },
                    },
                });

            assert.equal((await switchTo(otherSessionTypeId)).status, 200);
            assert.equal((await switchTo(sessionTypeId)).status, 200);

            assert.equal((await storedSession()).sessionType.id, sessionTypeId);
            const kept = await em.fork().findOneOrFail(Response, answerId);
            assert.equal(kept.value, "a second answer");
        });

        it("refuses a patch that leaves out an answer its field scopes away", async () => {
            await storeSecondAnswer(sessionTypeId);

            const response = await patch({
                relationships: {
                    sessionType: { data: { type: "session_type", id: otherSessionTypeId } },
                    responses: { data: [{ type: "response", id: responseId }] },
                },
            });

            await expectJsonApiError(response, 422, "inapplicable_response");
            assert.equal((await storedSession()).sessionType.id, sessionTypeId);
        });

        it("refuses a field named by both id and lid", async () => {
            const response = await patch(
                {
                    relationships: {
                        responses: {
                            data: [
                                { type: "response", id: responseId },
                                { type: "response", lid: "one" },
                            ],
                        },
                    },
                },
                [
                    {
                        type: "response",
                        lid: "one",
                        attributes: { value: "a whiteboard" },
                        relationships: {
                            customField: { data: { type: "custom_field", id: customFieldId } },
                        },
                    },
                ],
            );

            await expectJsonApiError(response, 422, "duplicate_response");
            assert.equal(await storedValue(), "a projector");
        });

        it("refuses the same id named twice", async () => {
            const response = await patch({
                relationships: {
                    responses: {
                        data: [
                            { type: "response", id: responseId },
                            { type: "response", id: responseId },
                        ],
                    },
                },
            });

            await expectJsonApiError(response, 422, "duplicate_response");
        });

        it("still demands an answer for a field the patch makes applicable", async () => {
            const fork = em.fork();
            const workshopField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "How many seats?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(fork.getReference(Edition, editionId)),
            });
            workshopField.sessionTypes.add(fork.getReference(SessionType, otherSessionTypeId));
            await fork.persist(workshopField).flush();

            const response = await patch({
                relationships: {
                    sessionType: { data: { type: "session_type", id: otherSessionTypeId } },
                    responses: { data: [{ type: "response", id: responseId }] },
                },
            });

            assert.equal(response.status, 422);
            const document = await response.json<{
                errors: { code: string; meta: { missingCustomFieldIds: string[] } }[];
            }>();
            assert.equal(document.errors[0]?.code, "missing_responses");
            assert.deepEqual(document.errors[0]?.meta.missingCustomFieldIds, [workshopField.id]);
        });
    });

    describe("stored answers on a type or track change", () => {
        type FieldSetup = {
            /** Past the one beforeEach stores, and distinct per field in a test. */
            position?: number;
            sessionTypeId?: string;
            trackId?: string;
            frozen?: boolean;
            /** Stored as the session's answer when present, null included. */
            answer?: string | null;
        };

        const storeField = async ({
            position = 1,
            sessionTypeId: scopedSessionTypeId,
            trackId: scopedTrackId,
            frozen = false,
            answer,
        }: FieldSetup): Promise<string> => {
            const fork = em.fork();
            const field = new CustomField({
                position,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Added later",
                helperText: "",
                deadline: null,
                freezeAfter: frozen ? Temporal.Now.instant().subtract({ hours: 1 }) : null,
                edition: ref(fork.getReference(Edition, editionId)),
            });

            if (scopedSessionTypeId !== undefined) {
                field.sessionTypes.add(fork.getReference(SessionType, scopedSessionTypeId));
            }

            if (scopedTrackId !== undefined) {
                field.tracks.add(fork.getReference(Track, scopedTrackId));
            }

            fork.persist(field);

            if (answer !== undefined) {
                fork.persist(
                    Response.sessionResponse(
                        ref(field),
                        ref(fork.getReference(Session, sessionId)),
                        answer,
                    ),
                );
            }

            await fork.flush();

            return field.id;
        };

        const retype = (id: string) =>
            patch({ relationships: { sessionType: { data: { type: "session_type", id } } } });

        const missingOf = async (response: TestResponse) => {
            assert.equal(response.status, 422);
            const document = await response.json<{
                errors: { code: string; meta: { missingCustomFieldIds: string[] } }[];
            }>();
            assert.equal(document.errors[0]?.code, "missing_responses");

            return document.errors[0]?.meta.missingCustomFieldIds;
        };

        // A client that echoes the type it already has but leaves `responses` out
        // must not be held to a question added since that it never touched.
        it("lets the unchanged type through with a question left unanswered", async () => {
            await storeField({});

            const response = await retype(sessionTypeId);

            assert.equal(response.status, 200);
        });

        it("judges a track change against the questions the new track brings", async () => {
            const fork = em.fork();
            const otherTrack = new Track({
                name: "Side",
                externalKey: null,
                description: "",
                color: "#654321",
                internal: false,
                edition: ref(fork.getReference(Edition, editionId)),
            });
            await fork.persist(otherTrack).flush();
            const fieldId = await storeField({ trackId: otherTrack.id });

            const response = await patch({
                relationships: { track: { data: { type: "track", id: otherTrack.id } } },
            });

            assert.deepEqual(await missingOf(response), [fieldId]);
        });

        it("judges clearing the track as a change too", async () => {
            const fieldId = await storeField({});

            const response = await patch({ relationships: { track: { data: null } } });

            assert.deepEqual(await missingOf(response), [fieldId]);
        });

        it("counts a stored empty answer as answered", async () => {
            await storeField({ sessionTypeId: otherSessionTypeId, answer: null });

            const response = await retype(otherSessionTypeId);

            assert.equal(response.status, 200);
        });

        it("refuses answers that leave a stored frozen answer out", async () => {
            const fieldId = await storeField({ frozen: true, answer: "before the freeze" });

            const response = await patch(answerById(responseId));

            await expectJsonApiError(response, 422, "frozen_response");
            assert.equal(
                await em.fork().count(Response, { session: sessionId, customField: fieldId }),
                1,
            );
        });

        it("keeps a stored frozen answer named by its id", async () => {
            const fieldId = await storeField({ frozen: true, answer: "before the freeze" });
            const frozenAnswer = await em
                .fork()
                .findOneOrFail(Response, { session: sessionId, customField: fieldId });

            const response = await patch({
                relationships: {
                    responses: {
                        data: [
                            { type: "response", id: responseId },
                            { type: "response", id: frozenAnswer.id },
                        ],
                    },
                },
            });

            assert.equal(response.status, 200);
        });

        it("lets a manager leave out a frozen question the change brings in", async () => {
            await storeField({ sessionTypeId: otherSessionTypeId, frozen: true });

            const response = await retype(otherSessionTypeId);

            assert.equal(response.status, 200);
        });

        // Nobody can answer a frozen question, so demanding one would leave the
        // session stuck on its type. The open question shows the check still
        // ran for a host.
        it("exempts a frozen question for a host too, not an open one", async () => {
            await storeField({ sessionTypeId: otherSessionTypeId, frozen: true });
            const openFieldId = await storeField({
                position: 2,
                sessionTypeId: otherSessionTypeId,
            });
            const fork = em.fork();
            const speaker = new User({
                externalId: "testhost",
                displayName: "Test Host",
                emailAddress: "testhost@example.test",
            });
            const host = buildHost(fork.getReference(Edition, editionId), speaker);
            const session = await fork.findOneOrFail(Session, sessionId, { populate: ["hosts"] });
            session.hosts.add(host);
            await fork.persist([speaker, host]).flush();

            const response = await jsonApi.patch(
                `/editions/${editionId}/sessions/${sessionId}`,
                await fetchAccessToken("testhost"),
                {
                    data: {
                        type: "session",
                        id: sessionId,
                        relationships: {
                            sessionType: {
                                data: { type: "session_type", id: otherSessionTypeId },
                            },
                        },
                    },
                },
            );

            assert.deepEqual(await missingOf(response), [openFieldId]);
        });
    });

    describe("frozen questions", () => {
        const storeFrozenRequired = async (): Promise<string> => {
            const fork = em.fork();
            const field = new CustomField({
                position: 1,
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

            return field.id;
        };

        it("lets a manager leave a required frozen question out of the answers", async () => {
            await storeFrozenRequired();

            const response = await patch({
                relationships: { responses: { data: [{ type: "response", id: responseId }] } },
            });

            assert.equal(response.status, 200);
        });

        it("refuses a manager's answer to a frozen question", async () => {
            const fieldId = await storeFrozenRequired();

            const response = await patch(
                {
                    relationships: {
                        responses: {
                            data: [
                                { type: "response", id: responseId },
                                { type: "response", lid: "late" },
                            ],
                        },
                    },
                },
                [
                    {
                        type: "response",
                        lid: "late",
                        attributes: { value: "added late" },
                        relationships: {
                            customField: { data: { type: "custom_field", id: fieldId } },
                        },
                    },
                ],
            );

            assert.equal(response.status, 422);
            const document = await response.json<{
                errors: { code: string; meta: { customFieldId: string } }[];
            }>();
            assert.equal(document.errors[0]?.code, "frozen_response");
            assert.equal(document.errors[0]?.meta.customFieldId, fieldId);
            const stored = await em
                .fork()
                .findOne(Response, { session: sessionId, customField: fieldId });
            assert.equal(stored, null);
        });
    });

    describe("lock order", () => {
        // The holder stands in for a track delete, one side of the populate
        // cycle in src/support/locking.ts.
        it("answers without waiting on a track a custom field is scoped to", async () => {
            const fork = em.fork();
            const trackField = new CustomField({
                position: 1,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title: "Which stage?",
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(fork.getReference(Edition, editionId)),
            });
            trackField.tracks.add(fork.getReference(Track, trackId));
            await fork.persist(trackField).flush();

            const taken = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const holding = em.fork().transactional(async (em) => {
                await em.findOne(Track, trackId, { lockMode: LockMode.PESSIMISTIC_WRITE });
                taken.resolve();
                await release.promise;
            });

            await Promise.race([taken.promise, holding]);
            const patching = send(
                patch(
                    {
                        relationships: {
                            responses: {
                                data: [
                                    { type: "response", id: responseId },
                                    { type: "response", lid: "stage" },
                                ],
                            },
                        },
                    },
                    [
                        {
                            type: "response",
                            lid: "stage",
                            attributes: { value: "Main stage" },
                            relationships: {
                                customField: {
                                    data: { type: "custom_field", id: trackField.id },
                                },
                            },
                        },
                    ],
                ),
            );
            const giveUp = new AbortController();

            try {
                const response = await Promise.race([
                    patching,
                    delay(5000, null, { signal: giveUp.signal }),
                ]);

                assert.notEqual(response, null, "the patch waited on the held track");
                assert.equal(response?.status, 200);
            } finally {
                giveUp.abort();
                release.resolve();
                await holding;
                await patching.catch(() => undefined);
            }

            const stored = await em
                .fork()
                .findOneOrFail(Response, { session: sessionId, customField: trackField.id });
            assert.equal(stored.value, "Main stage");
        });
    });
});
