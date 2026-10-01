import { afterEach, describe, expect, it } from "vitest";
import {
    applicableCustomFields,
    buildSessionAttributes,
    buildSessionChanges,
    changedAttributes,
    createSessionSchema,
    isFrozen,
    type SessionTransformedValues,
    sessionPatchCarriesAnswers,
} from "#/components/SessionFormFields/schema.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import type { BuiltInFieldRequirement, Edition } from "#/queries/edition.ts";
import { syncServerClock } from "#/utils/server-clock.ts";

const editionWithTrack = (requirement: BuiltInFieldRequirement): Edition =>
    ({
        id: "01a00100-0000-7000-8000-000000000001",
        name: "Dev Edition",
        startDate: Temporal.PlainDate.from("2026-11-21"),
        endDate: Temporal.PlainDate.from("2026-11-23"),
        submissionDeadline: null,
        timeZone: "Europe/Berlin",
        sessionFieldOptions: {
            title: {},
            track: { requirement },
        },
        profileFieldOptions: {},
    }) as unknown as Edition;

type TrackReference = {
    id: string;
};

const values = (track: TrackReference | null) => ({
    sessionType: { id: "01a00400-0000-7000-8000-000000000001" },
    title: "A session",
    track,
    responses: {},
});

describe("createSessionSchema", () => {
    it("carries a required track through to the schema", () => {
        const result = createSessionSchema(editionWithTrack("required"), []).safeParse(
            values(null),
        );

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["track"]);
        expect(result.error?.issues[0]?.code).toBe("invalid_type");
    });

    it("takes an answered required track", () => {
        const result = createSessionSchema(editionWithTrack("required"), []).safeParse(
            values({ id: "01a00500-0000-7000-8000-000000000001" }),
        );

        expect(result.data?.track).toBe("01a00500-0000-7000-8000-000000000001");
    });

    it("leaves an optional track unanswered", () => {
        const result = createSessionSchema(editionWithTrack("optional"), []).safeParse(
            values(null),
        );

        expect(result.data?.track).toBe(null);
    });
});

describe("buildSessionAttributes for an update", () => {
    const editionWithTeaser = {
        sessionFieldOptions: { teaserImage: { requirement: "optional" } },
    } as unknown as Edition;
    const stored = {
        key: "edition-1/sessions/session-1/teaser.webp",
        filename: "teaser.webp",
        url: "https://files.example.test/teaser.webp",
    };
    const withTeaser = (teaserImage: unknown) =>
        ({ title: "A session", teaserImage }) as unknown as SessionTransformedValues;

    it("leaves an untouched stored teaser image out", () => {
        expect(
            buildSessionAttributes(
                editionWithTeaser,
                withTeaser(stored),
                changedAttributes({ title: true }),
            ),
        ).toEqual({ title: "A session" });
    });

    it("sends a fresh teaser image by its temporary key", () => {
        expect(
            buildSessionAttributes(
                editionWithTeaser,
                withTeaser({ key: "temp/0199aaaa.webp", filename: "stage.webp" }),
                changedAttributes({ teaserImage: { key: true, filename: true } }),
            ),
        ).toEqual({ teaserImage: { key: "temp/0199aaaa.webp", filename: "stage.webp" } });
    });

    it("sends a removed teaser image as null", () => {
        expect(
            buildSessionAttributes(
                editionWithTeaser,
                withTeaser(null),
                changedAttributes({ teaserImage: true }),
            ),
        ).toEqual({ teaserImage: null });
    });
});

describe("sessionPatchCarriesAnswers", () => {
    it("carries the answers when the track changes, even with none of them touched", () => {
        expect(sessionPatchCarriesAnswers({ track: true })).toBe(true);
    });

    it("carries the answers when the session type changes, even with none of them touched", () => {
        expect(sessionPatchCarriesAnswers({ sessionType: { id: true } })).toBe(true);
    });

    it("leaves the answers out of a title-only patch", () => {
        expect(sessionPatchCarriesAnswers({ title: true })).toBe(false);
    });
});

describe("applicableCustomFields", () => {
    const sessionField = (id: string, freezeAfter: Temporal.Instant | null): CustomField =>
        ({
            id,
            target: "per_proposal",
            requirement: "always_required",
            freezeAfter,
            options: { type: "single_line_text" },
            answerMaxLength: 200,
            sessionTypes: [],
            tracks: [],
        }) as unknown as CustomField;
    const fields = [
        sessionField("open", null),
        sessionField("frozen", Temporal.Now.instant().subtract({ hours: 1 })),
    ];
    const scope = { sessionTypeId: undefined, trackId: undefined };

    it("drops a frozen question", () => {
        expect(applicableCustomFields(fields, scope).map(({ id }) => id)).toEqual(["open"]);
    });

    it("keeps a frozen question for a view that only reads answers", () => {
        expect(
            applicableCustomFields(fields, { ...scope, includeFrozen: true }).map(({ id }) => id),
        ).toEqual(["open", "frozen"]);
    });
});

describe("buildSessionChanges", () => {
    const sessionField = (id: string, sessionTypeIds: string[]): CustomField =>
        ({
            id,
            target: "per_proposal",
            requirement: "always_optional",
            freezeAfter: null,
            deadline: null,
            options: { type: "single_line_text" },
            answerMaxLength: 200,
            sessionTypes: sessionTypeIds.map((sessionTypeId) => ({ id: sessionTypeId })),
            tracks: [],
        }) as unknown as CustomField;
    const general = sessionField("field-general", []);
    const talkOnly = sessionField("field-talk", ["type-talk"]);

    it("keeps by id a stored answer to a question the new type no longer asks", () => {
        const changes = buildSessionChanges({
            edition: editionWithTrack("optional"),
            customFields: [general, talkOnly],
            proposalCustomFields: [general],
            frozenCustomFields: [],
            values: {
                ...values(null),
                sessionType: { id: "type-workshop" },
            } as unknown as SessionTransformedValues,
            changes: { sessionType: { id: true } },
            sessionTypes: [{ id: "type-talk" }, { id: "type-workshop" }],
            tracks: [],
            storedResponses: [
                { id: "answer-general", customField: { id: "field-general" } },
                { id: "answer-talk", customField: { id: "field-talk" } },
            ],
        });

        expect(changes.responses).toEqual({
            values: {},
            keptResponseIds: ["answer-talk", "answer-general"],
        });
    });
});

describe("isFrozen with the server's clock ahead of this one", () => {
    afterEach(() => {
        syncServerClock(Temporal.Now.instant(), performance.now(), performance.now());
    });

    it("freezes a question once the server has passed its freeze", () => {
        const freezeAfter = Temporal.Now.instant().add({ hours: 1 });
        syncServerClock(freezeAfter.add({ minutes: 1 }), performance.now(), performance.now());

        expect(isFrozen({ id: "field-diet", freezeAfter } as unknown as CustomField)).toBe(true);
    });
});
