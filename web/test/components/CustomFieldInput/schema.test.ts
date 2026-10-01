import { afterEach, describe, expect, it } from "vitest";
import {
    buildResponseChanges,
    createResponseSchema,
    isRequired,
    knownResponses,
} from "#/components/CustomFieldInput/schema.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import { syncServerClock } from "#/utils/server-clock.ts";

type NumberOptions = {
    min?: number;
    max?: number;
};

const numberCustomField = (
    options: NumberOptions = {},
    requirement: CustomField["requirement"] = "always_required",
): CustomField =>
    ({
        id: "00000000-0000-0000-0000-000000000001",
        requirement,
        deadline: null,
        title: "How many attendees?",
        helperText: "",
        options: { type: "number", ...options },
    }) as unknown as CustomField;

describe("createResponseSchema for number customFields", () => {
    it("takes the number the field holds", () => {
        const result = createResponseSchema(numberCustomField()).safeParse(42);

        expect(result.success).toBe(true);
        expect(result.data).toBe(42);
    });

    it("accepts zero and negative values", () => {
        const schema = createResponseSchema(numberCustomField());

        expect(schema.safeParse(0).data).toBe(0);
        expect(schema.safeParse(-7).data).toBe(-7);
    });

    it("rejects values that are not whole numbers", () => {
        const schema = createResponseSchema(numberCustomField());

        for (const input of [1.5, Number.NaN, Number.POSITIVE_INFINITY, "42", null]) {
            expect(
                schema.safeParse(input).success,
                `expected ${String(input)} to be rejected`,
            ).toBe(false);
        }
    });

    it("enforces the configured bounds", () => {
        const schema = createResponseSchema(numberCustomField({ min: 5, max: 10 }));

        expect(schema.safeParse(4).success).toBe(false);
        expect(schema.safeParse(5).data).toBe(5);
        expect(schema.safeParse(10).data).toBe(10);
        expect(schema.safeParse(11).success).toBe(false);
    });

    it("enforces a zero minimum, which a truthiness check would skip", () => {
        const schema = createResponseSchema(numberCustomField({ min: 0 }));

        expect(schema.safeParse(-1).success).toBe(false);
        expect(schema.safeParse(0).data).toBe(0);
    });

    it("treats an empty optional response as absent", () => {
        const schema = createResponseSchema(numberCustomField({}, "always_optional"));

        expect(schema.safeParse(null).data).toBe(null);
        expect(schema.safeParse(undefined).data).toBe(null);
        expect(schema.safeParse(8).data).toBe(8);
        expect(schema.safeParse(1.5).success).toBe(false);
    });
});

describe("createResponseSchema for text customFields", () => {
    it("holds an optional answer to its minimum once one is given", () => {
        const schema = createResponseSchema({
            id: "00000000-0000-0000-0000-000000000003",
            requirement: "always_optional",
            deadline: null,
            title: "Equipment needed",
            helperText: "",
            options: { type: "single_line_text", minLength: 5 },
            answerMaxLength: 200,
        } as unknown as CustomField);

        expect(schema.safeParse(undefined).data).toBe("");
        expect(schema.safeParse("   ").data).toBe("");
        expect(schema.safeParse("no").error?.issues[0]?.code).toBe("too_small");
        expect(schema.safeParse(" a mic ").data).toBe("a mic");
    });

    it("refuses an answer over the cap the API serves", () => {
        const schema = createResponseSchema({
            id: "00000000-0000-0000-0000-000000000003",
            requirement: "always_optional",
            deadline: null,
            title: "Equipment needed",
            helperText: "",
            options: { type: "single_line_text" },
            answerMaxLength: 200,
        } as unknown as CustomField);

        expect(schema.safeParse("x".repeat(200)).success).toBe(true);
        expect(schema.safeParse("x".repeat(201)).error?.issues[0]?.code).toBe("too_big");
    });
});

const deadlineCustomField = (deadline: Temporal.Instant): CustomField =>
    ({
        id: "00000000-0000-0000-0000-000000000002",
        requirement: "required_after_deadline",
        deadline,
        title: "Equipment needed",
        helperText: "",
        options: { type: "single_line_text" },
        answerMaxLength: 200,
    }) as unknown as CustomField;

describe("isRequired once a deadline decides it", () => {
    it("stays optional while the deadline is still ahead", () => {
        const customField = deadlineCustomField(Temporal.Now.instant().add({ hours: 24 }));

        expect(isRequired(customField)).toBe(false);
        expect(createResponseSchema(customField).safeParse("").success).toBe(true);
    });

    it("turns required once the deadline has passed", () => {
        const customField = deadlineCustomField(Temporal.Now.instant().subtract({ hours: 24 }));

        expect(isRequired(customField)).toBe(true);
        expect(createResponseSchema(customField).safeParse("").success).toBe(false);
    });

    describe("with the server's clock ahead of this one", () => {
        afterEach(() => {
            syncServerClock(Temporal.Now.instant(), performance.now(), performance.now());
        });

        it("turns required once the server has passed the deadline", () => {
            const deadline = Temporal.Now.instant().add({ hours: 1 });
            syncServerClock(deadline.add({ minutes: 1 }), performance.now(), performance.now());

            expect(isRequired(deadlineCustomField(deadline))).toBe(true);
        });
    });
});

describe("buildResponseChanges", () => {
    const textField = (id: string): CustomField =>
        ({ id, options: { type: "single_line_text" } }) as unknown as CustomField;
    const fields = [textField("field-a"), textField("field-b")];
    const stored = [
        { id: "answer-a", customField: { id: "field-a" } },
        { id: "answer-b", customField: { id: "field-b" } },
    ];
    const values = { "field-a": "a whiteboard", "field-b": "Berlin" };

    it("sends a changed answer and names the untouched one by id", () => {
        expect(buildResponseChanges(fields, values, { "field-a": true }, stored, [])).toEqual({
            values: { "field-a": "a whiteboard" },
            keptResponseIds: ["answer-b"],
        });
    });

    it("keeps every stored answer by id when nothing changed", () => {
        expect(buildResponseChanges(fields, values, undefined, stored, [])).toEqual({
            values: {},
            keptResponseIds: ["answer-a", "answer-b"],
        });
    });

    it("sends an untouched answer that was never stored", () => {
        expect(buildResponseChanges(fields, values, {}, stored.slice(0, 1), [])).toEqual({
            values: { "field-b": "Berlin" },
            keptResponseIds: ["answer-a"],
        });
    });

    it("keeps a stored answer to a frozen question by id", () => {
        const frozen = textField("field-frozen");

        expect(
            buildResponseChanges(
                fields,
                values,
                { "field-a": true },
                [...stored, { id: "answer-frozen", customField: { id: "field-frozen" } }],
                [frozen],
            ),
        ).toEqual({
            values: { "field-a": "a whiteboard" },
            keptResponseIds: ["answer-frozen", "answer-b"],
        });
    });

    it("takes a nested change marker as a change", () => {
        expect(
            buildResponseChanges(fields, values, { "field-a": { id: true } }, stored, []).values,
        ).toEqual({ "field-a": "a whiteboard" });
    });
});

describe("buildResponseChanges for a file answer", () => {
    const fileField = { id: "field-file", options: { type: "file" } } as unknown as CustomField;
    const stored = [{ id: "answer-file", customField: { id: "field-file" } }];

    it("keeps an untouched stored file by id rather than sending it back", () => {
        const values = {
            "field-file": {
                key: "edition-1/sessions/session-1/slides.pdf",
                filename: "slides.pdf",
            },
        };

        expect(buildResponseChanges([fileField], values, {}, stored, [])).toEqual({
            values: {},
            keptResponseIds: ["answer-file"],
        });
    });

    it("sends a replaced file by its temporary key", () => {
        const values = {
            "field-file": { key: "temp/0199bbbb.pdf", filename: "slides.pdf", url: "blob:x" },
        };

        expect(
            buildResponseChanges([fileField], values, { "field-file": { key: true } }, stored, []),
        ).toEqual({
            values: { "field-file": { key: "temp/0199bbbb.pdf", filename: "slides.pdf" } },
            keptResponseIds: [],
        });
    });
});

describe("knownResponses", () => {
    it("keeps an answer only the seeded copy still has", () => {
        const live = [{ id: "answer-a", customField: { id: "field-a" } }];
        const seeded = [
            { id: "answer-a", customField: { id: "field-a" } },
            { id: "answer-file", customField: { id: "field-file" } },
        ];

        expect(knownResponses(live, seeded)).toEqual(seeded);
    });
});
