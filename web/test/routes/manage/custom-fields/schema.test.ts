import { describe, expect, it } from "vitest";
import {
    buildCustomFieldOptions,
    buildCustomFieldPayload,
    type CustomFieldInputValues,
    createCustomFieldDefaultValues,
    customFieldFormSchema,
} from "#/routes/_user/manage/$editionId/custom-fields/-components/schema.ts";

const july = Temporal.ZonedDateTime.from("2027-07-01T12:00[UTC]");
const june = Temporal.ZonedDateTime.from("2027-06-01T12:00[UTC]");

const values = (overrides: Partial<CustomFieldInputValues> = {}): CustomFieldInputValues => ({
    ...createCustomFieldDefaultValues(null, { sessionTypes: [], tracks: [] }, "Europe/Berlin"),
    title: "A customField",
    ...overrides,
});

describe("customFieldFormSchema", () => {
    it("demands a deadline when the requirement depends on one", () => {
        const result = customFieldFormSchema.safeParse(
            values({ requirement: "required_after_deadline", deadline: null }),
        );

        expect(result.success).toBe(false);
    });

    it("rejects a freeze date before the deadline", () => {
        const result = customFieldFormSchema.safeParse(
            values({
                requirement: "required_after_deadline",
                deadline: july,
                freezeAfter: june,
            }),
        );

        expect(result.success).toBe(false);
    });

    it("rejects a freeze date at the deadline", () => {
        const result = customFieldFormSchema.safeParse(
            values({
                requirement: "required_after_deadline",
                deadline: july,
                freezeAfter: july,
            }),
        );

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["freezeAfter"]);
        expect(result.error?.issues[0]?.message).toBe("Must be after the deadline");
    });

    it("ignores a blank option label when the response type has no options", () => {
        const result = customFieldFormSchema.safeParse(
            values({
                optionType: "number",
                items: [{ id: "01a00801-0000-7000-8000-000000000003", label: "" }],
            }),
        );

        expect(result.success).toBe(true);
    });

    // Switching the type hides the bounds but keeps their values, so a pair
    // that no longer applies must not block the form.
    it("checks the number range on a number question only", () => {
        const reversed = { min: 10, max: 5 };

        expect(
            customFieldFormSchema.safeParse(values({ optionType: "number", ...reversed })).error
                ?.issues[0]?.path,
        ).toEqual(["max"]);
        expect(
            customFieldFormSchema.safeParse(values({ optionType: "single_line_text", ...reversed }))
                .success,
        ).toBe(true);
    });

    it("checks the length range on a text question only", () => {
        const reversed = { minLength: 10, maxLength: 5 };

        expect(
            customFieldFormSchema.safeParse(values({ optionType: "single_line_text", ...reversed }))
                .error?.issues[0]?.path,
        ).toEqual(["maxLength"]);
        expect(
            customFieldFormSchema.safeParse(values({ optionType: "number", ...reversed })).success,
        ).toBe(true);
    });

    it("ignores a leftover deadline once the requirement no longer uses one", () => {
        // Switching the requirement hides the deadline but keeps its value, so
        // an ordering that no longer applies must not block the form.
        const result = customFieldFormSchema.safeParse(
            values({ requirement: "always_optional", deadline: july, freezeAfter: june }),
        );

        expect(result.success).toBe(true);
    });
});

const parseValues = (input: CustomFieldInputValues) => {
    const result = customFieldFormSchema.safeParse(input);

    if (!result.success) {
        throw new Error(`Expected the values to parse: ${JSON.stringify(result.error.issues)}`);
    }

    return result.data;
};

describe("buildCustomFieldOptions", () => {
    const bounded = values({ minLength: 2, maxLength: 8, min: 3, max: 9 });
    const items = [{ id: "01a00801-0000-7000-8000-000000000004", label: "Only" }];

    it.each([
        ["single_line_text", { type: "single_line_text", minLength: 2, maxLength: 8 }],
        ["multi_line_text", { type: "multi_line_text", minLength: 2, maxLength: 8 }],
        ["number", { type: "number", min: 3, max: 9 }],
        ["boolean", { type: "boolean" }],
        ["file", { type: "file" }],
        ["date", { type: "date" }],
        ["url", { type: "url" }],
    ])("carries only what %s reads", (optionType, expected) => {
        const options = buildCustomFieldOptions(
            parseValues({
                ...bounded,
                optionType: optionType as CustomFieldInputValues["optionType"],
            }),
        );

        expect(options).toEqual(expected);
    });

    it.each(["single_choice", "multiple_choice"] as const)("carries the items %s reads", (type) => {
        const options = buildCustomFieldOptions(
            parseValues({ ...bounded, optionType: type, items }),
        );

        expect(options).toEqual({ type, items });
    });
});

describe("buildCustomFieldPayload", () => {
    const parse = (input: CustomFieldInputValues) => buildCustomFieldPayload(parseValues(input));

    it("drops a deadline no requirement consults", () => {
        const payload = parse(values({ requirement: "always_optional", deadline: july }));

        expect(payload.deadline).toBeNull();
    });

    it("keeps the deadline the requirement depends on", () => {
        const payload = parse(values({ requirement: "required_after_deadline", deadline: july }));

        expect(payload.deadline).toBe(july);
    });

    it("drops scoping a per-person customField would never consult", () => {
        const payload = parse(
            values({
                target: "per_host",
                sessionTypes: [{ id: "01a00801-0000-7000-8000-000000000001" }],
                tracks: [{ id: "01a00801-0000-7000-8000-000000000002" }],
            }),
        );

        expect(payload.sessionTypes).toEqual([]);
        expect(payload.tracks).toEqual([]);
    });

    it("keeps scoping on a per-proposal customField", () => {
        const payload = parse(
            values({
                target: "per_proposal",
                sessionTypes: [{ id: "01a00801-0000-7000-8000-000000000001" }],
            }),
        );

        expect(payload.sessionTypes).toEqual(["01a00801-0000-7000-8000-000000000001"]);
    });
});
