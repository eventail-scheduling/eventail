import { describe, expect, it } from "vitest";
import {
    BuiltInField,
    type BuiltInFieldRenderProps,
} from "#/components/BuiltInField/BuiltInField.tsx";
import type { BuiltInFieldOption, SessionFieldSpec } from "#/queries/edition.ts";

type Field = {
    options?: BuiltInFieldOption;
    spec?: Partial<SessionFieldSpec>;
};

const asked = ({ options, spec }: Field): BuiltInFieldRenderProps | null => {
    const seen: BuiltInFieldRenderProps[] = [];

    BuiltInField({
        name: "abstract",
        fieldOptions: options !== undefined ? { abstract: options } : {},
        specs:
            spec !== undefined
                ? { abstract: { label: "Abstract", forceRequired: false, type: "string", ...spec } }
                : {},
        render: (props) => {
            seen.push(props);

            return null;
        },
    });

    return seen[0] ?? null;
};

const askedFor = (field: Field): BuiltInFieldRenderProps => {
    const props = asked(field);

    if (props === null) {
        throw new Error("the field was not asked at all");
    }

    return props;
};

describe("BuiltInField", () => {
    describe("whether it asks at all", () => {
        it("asks nothing for a field the organizer left out", () => {
            expect(asked({ spec: {} })).toBe(null);
        });

        it("asks for a force-required field the organizer left out", () => {
            expect(askedFor({ spec: { forceRequired: true } }).label).toBe("Abstract");
        });

        it("asks for a field the server has no spec for", () => {
            expect(asked({ options: {} })).not.toBe(null);
        });
    });

    describe("label", () => {
        it("prefers the organizer's wording to the server's", () => {
            expect(askedFor({ options: { label: "Summary" }, spec: {} }).label).toBe("Summary");
        });

        it("falls back to the server's wording", () => {
            expect(askedFor({ options: {}, spec: {} }).label).toBe("Abstract");
        });

        it("falls back to the field's own name", () => {
            expect(askedFor({ options: {} }).label).toBe("abstract");
        });
    });

    describe("helper text", () => {
        it("prefers the organizer's wording to the server's", () => {
            const props = askedFor({
                options: { helperText: "Keep it short" },
                spec: { helperText: "What the talk covers" },
            });

            expect(props.helperText).toBe("Keep it short");
        });

        it("falls back to the server's wording", () => {
            const props = askedFor({ options: {}, spec: { helperText: "What the talk covers" } });

            expect(props.helperText).toBe("What the talk covers");
        });

        it("says nothing when neither offers any", () => {
            expect(askedFor({ options: {}, spec: {} }).helperText).toBe(undefined);
        });
    });

    describe("requirement", () => {
        it("holds a force-required field required against the organizer", () => {
            const props = askedFor({
                options: { requirement: "optional" },
                spec: { forceRequired: true },
            });

            expect(props.required).toBe(true);
        });

        it("takes the organizer's word that a field is required", () => {
            expect(askedFor({ options: { requirement: "required" }, spec: {} }).required).toBe(
                true,
            );
        });

        it("takes the organizer's word that a field is optional", () => {
            expect(askedFor({ options: { requirement: "optional" }, spec: {} }).required).toBe(
                false,
            );
        });
    });

    describe("lengths", () => {
        it("carries the organizer's through", () => {
            const props = askedFor({ options: { minLength: 20, maxLength: 400 }, spec: {} });

            expect(props.minLength).toBe(20);
            expect(props.maxLength).toBe(400);
        });

        it("leaves a field the organizer left unbounded unbounded", () => {
            const props = askedFor({ options: { requirement: "optional" }, spec: {} });

            expect(props.minLength).toBe(undefined);
            expect(props.maxLength).toBe(undefined);
        });
    });
});
