import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { ref } from "@mikro-orm/core";
import { CustomField } from "../../../src/entity/CustomField.js";
import { Response } from "../../../src/entity/Response.js";
import { Session } from "../../../src/entity/Session.js";
import { SessionType } from "../../../src/entity/SessionType.js";
import { Track } from "../../../src/entity/Track.js";
import { User } from "../../../src/entity/User.js";
import { em } from "../../../src/util/mikro-orm.js";
import { buildEdition } from "../../setup/fixtures.js";
import { expectJsonApiError, jsonApi } from "../../setup/json-api.js";
import { fetchAccessToken } from "../../setup/token.js";

const UNKNOWN_CUSTOM_FIELD_ID = "00000000-0000-4000-8000-000000000000";

type ResponseInput = {
    customFieldId: string;
    value: unknown;
};

type SessionInput = {
    id?: string;
    title: string;
    trackId: string | null;
    responses: ResponseInput[];
};

describe("custom-field scoping", () => {
    let hostToken: string;
    let editionId: string;
    let sessionTypeId: string;
    let trackId: string;
    let openCustomFieldId: string;
    let workshopCustomFieldId: string;
    let trackCustomFieldId: string;
    let sessionId: string;

    before(async () => {
        hostToken = await fetchAccessToken("testhost");
    });

    beforeEach(async () => {
        const fork = em.fork();
        const host = new User({
            externalId: "testhost",
            displayName: "Test Host",
            emailAddress: "host@example.test",
        });
        const edition = buildEdition({
            name: "Scoping Edition",
            sessionFieldOptions: { track: { requirement: "optional" } },
        });
        const sessionType = SessionType.default(ref(edition));
        const workshopSessionType = new SessionType({
            name: "Workshop",
            externalKey: "workshop",
            defaultDuration: Temporal.Duration.from({ minutes: 90 }),
            internal: false,
            selectionDefault: false,
            edition: ref(edition),
        });
        const track = new Track({
            name: "Main Track",
            externalKey: null,
            description: "",
            color: "#00ff00",
            internal: false,
            edition: ref(edition),
        });

        const buildCustomField = (title: string, position: number) =>
            new CustomField({
                position,
                externalKey: null,
                target: "per_proposal",
                requirement: "always_optional",
                options: { type: "single_line_text" },
                title,
                helperText: "",
                deadline: null,
                freezeAfter: null,
                edition: ref(edition),
            });

        const openCustomField = buildCustomField("Anything we should know?", 0);
        const workshopCustomField = buildCustomField("How many seats do you need?", 1);
        workshopCustomField.sessionTypes.add(workshopSessionType);
        const trackCustomField = buildCustomField("Which stage suits you best?", 2);
        trackCustomField.tracks.add(track);

        await fork
            .persist([
                host,
                edition,
                sessionType,
                workshopSessionType,
                track,
                openCustomField,
                workshopCustomField,
                trackCustomField,
            ])
            .flush();

        editionId = edition.id;
        sessionTypeId = sessionType.id;
        trackId = track.id;
        openCustomFieldId = openCustomField.id;
        workshopCustomFieldId = workshopCustomField.id;
        trackCustomFieldId = trackCustomField.id;
    });

    const buildSessionDocument = (values: SessionInput) => ({
        data: {
            type: "session",
            id: values.id,
            attributes: { title: values.title },
            relationships: {
                sessionType: { data: { type: "session_type", id: sessionTypeId } },
                track: {
                    data: values.trackId === null ? null : { type: "track", id: values.trackId },
                },
                responses: {
                    data: values.responses.map((_response, index) => ({
                        type: "response",
                        lid: `a${index}`,
                    })),
                },
            },
            meta: { selfService: true },
        },
        included: values.responses.map((response, index) => ({
            type: "response",
            lid: `a${index}`,
            attributes: { value: response.value },
            relationships: {
                customField: { data: { type: "custom_field", id: response.customFieldId } },
            },
        })),
    });

    const createSession = (values: SessionInput) =>
        jsonApi.post(`/editions/${editionId}/sessions`, hostToken, buildSessionDocument(values));

    const updateSession = (values: SessionInput) =>
        jsonApi.patch(
            `/editions/${editionId}/sessions/${sessionId}`,
            hostToken,
            buildSessionDocument({ ...values, id: sessionId }),
        );

    const findStoredResponses = async (): Promise<Response[]> =>
        em.fork().find(Response, { session: sessionId }, { orderBy: { id: "asc" } });

    const submitScopedSession = async (): Promise<void> => {
        const response = await createSession({
            title: "Scoped Session",
            trackId: null,
            responses: [{ customFieldId: openCustomFieldId, value: "Nothing at all" }],
        });

        assert.equal(response.status, 201);
        sessionId = ((await response.json()) as { data: { id: string } }).data.id;
    };

    it("demands only the custom fields applying to the session", async () => {
        await submitScopedSession();

        // The workshop and track custom fields are scoped away from this session,
        // so leaving them without a response is not a missing one.
        const responses = await findStoredResponses();
        assert.deepEqual(
            responses.map((response) => response.customField.id),
            [openCustomFieldId],
        );
        assert.equal(responses[0].value, "Nothing at all");
    });

    it("refuses responses to custom fields scoped away from the session", async () => {
        await submitScopedSession();

        const wrongSessionType = await updateSession({
            title: "Scoped Session",
            trackId: null,
            responses: [
                { customFieldId: openCustomFieldId, value: "Nothing at all" },
                { customFieldId: workshopCustomFieldId, value: "30" },
            ],
        });

        await expectJsonApiError(wrongSessionType, 422, "inapplicable_response");
        const sessionTypeDocument = (await wrongSessionType.json()) as {
            errors: { meta: { customFieldId: string } }[];
        };
        assert.equal(sessionTypeDocument.errors[0]?.meta.customFieldId, workshopCustomFieldId);

        const withoutTrack = await updateSession({
            title: "Scoped Session",
            trackId: null,
            responses: [
                { customFieldId: openCustomFieldId, value: "Nothing at all" },
                { customFieldId: trackCustomFieldId, value: "The big one" },
            ],
        });

        await expectJsonApiError(withoutTrack, 422, "inapplicable_response");
        const trackDocument = (await withoutTrack.json()) as {
            errors: { meta: { customFieldId: string } }[];
        };
        assert.equal(trackDocument.errors[0]?.meta.customFieldId, trackCustomFieldId);

        const responses = await findStoredResponses();
        assert.equal(responses.length, 1);
    });

    it("refuses a response to an unknown customField", async () => {
        await submitScopedSession();

        const response = await updateSession({
            title: "Scoped Session",
            trackId: null,
            responses: [
                { customFieldId: openCustomFieldId, value: "Nothing at all" },
                { customFieldId: UNKNOWN_CUSTOM_FIELD_ID, value: "Out of nowhere" },
            ],
        });

        await expectJsonApiError(response, 422, "unknown_custom_field");
        const document = (await response.json()) as {
            errors: { meta: { customFieldId: string } }[];
        };
        assert.equal(document.errors[0]?.meta.customFieldId, UNKNOWN_CUSTOM_FIELD_ID);
    });

    it("demands the track customField once the session takes the track", async () => {
        await submitScopedSession();

        const withoutTrackResponse = await updateSession({
            title: "Scoped Session",
            trackId,
            responses: [{ customFieldId: openCustomFieldId, value: "Nothing at all" }],
        });

        await expectJsonApiError(withoutTrackResponse, 422, "missing_responses");
        const document = (await withoutTrackResponse.json()) as {
            errors: { meta: { missingCustomFieldIds: string[] } }[];
        };
        assert.deepEqual(document.errors[0]?.meta.missingCustomFieldIds, [trackCustomFieldId]);

        const complete = await updateSession({
            title: "Scoped Session",
            trackId,
            responses: [
                { customFieldId: openCustomFieldId, value: "Nothing at all" },
                { customFieldId: trackCustomFieldId, value: "The big one" },
            ],
        });

        assert.equal(complete.status, 200);
        const stored = await em.fork().findOneOrFail(Session, sessionId);
        assert.equal(stored.track?.id, trackId);
        const responses = await findStoredResponses();
        assert.deepEqual(
            responses.map((response) => response.customField.id).sort(),
            [openCustomFieldId, trackCustomFieldId].sort(),
        );
    });
});
