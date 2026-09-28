import { describe, expect, it } from "vitest";
import { builtInFieldOptionsSchema, type SessionFieldSpec } from "#/queries/edition.ts";
import {
    type BuiltInFieldTransformedValues,
    type BuiltInFieldValues,
    buildBuiltInFieldOption,
    buildBuiltInFieldSchema,
    createBuiltInFieldDefaultValues,
} from "#/routes/_user/manage/$editionId/submission-form/-components/schema.ts";

const teaserSpec: SessionFieldSpec = {
    label: "Teaser image",
    forceRequired: false,
    type: "file",
    imageDefaults: { minWidth: 640, minHeight: 360, maxWidth: 3840, maxHeight: 2160 },
};

const avatarSpec: SessionFieldSpec = {
    label: "Avatar",
    forceRequired: false,
    type: "file",
    imageConstraints: {
        minWidth: 64,
        minHeight: 64,
        maxWidth: 512,
        maxHeight: 512,
        aspectRatio: { width: 1, height: 1 },
    },
};

const abstractSpec: SessionFieldSpec = {
    label: "Abstract",
    forceRequired: false,
    type: "string",
};

const values = (overrides: Partial<BuiltInFieldValues> = {}): BuiltInFieldValues => ({
    ...createBuiltInFieldDefaultValues(undefined),
    requirement: "optional",
    ...overrides,
});

const transformed = (
    overrides: Partial<BuiltInFieldTransformedValues> = {},
): BuiltInFieldTransformedValues => ({
    label: "",
    helperText: "",
    requirement: "optional",
    minLength: undefined,
    maxLength: undefined,
    minWidth: undefined,
    minHeight: undefined,
    maxWidth: undefined,
    maxHeight: undefined,
    aspectRatioWidth: undefined,
    aspectRatioHeight: undefined,
    ...overrides,
});

describe("buildBuiltInFieldSchema", () => {
    it("accepts constraint overrides within the resolved bounds", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(
            values({ minWidth: 1280, maxHeight: 1080, aspectRatioWidth: 16, aspectRatioHeight: 9 }),
        );

        expect(result.success).toBe(true);
    });

    it("passes empty constraints through as undefined", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(values());

        expect(result.success).toBe(true);
        expect(result.data?.minWidth).toBeUndefined();
        expect(result.data?.aspectRatioWidth).toBeUndefined();
    });

    it("flags a minimum above the default maximum", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(values({ minWidth: 5000 }));

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["minWidth"]);
        expect(result.error?.issues[0]?.message).toContain("maximum (3840)");
    });

    it("flags a maximum below the default minimum", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(values({ maxHeight: 200 }));

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["maxHeight"]);
        expect(result.error?.issues[0]?.message).toContain("minimum (360)");
    });

    it("judges conflicting overrides against each other, not the defaults", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(
            values({ minWidth: 1000, maxWidth: 800 }),
        );

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["maxWidth"]);
    });

    it("requires both parts of an aspect ratio", () => {
        const result = buildBuiltInFieldSchema(teaserSpec).safeParse(
            values({ aspectRatioWidth: 16 }),
        );

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["aspectRatioHeight"]);
    });

    it("skips constraint validation without image defaults", () => {
        const result = buildBuiltInFieldSchema(abstractSpec).safeParse(values({ minWidth: 5000 }));

        expect(result.success).toBe(true);
    });

    it("still orders the length bounds", () => {
        const result = buildBuiltInFieldSchema(abstractSpec).safeParse(
            values({ minLength: 10, maxLength: 5 }),
        );

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(["minLength"]);
    });
});

describe("builtInFieldOptionsSchema", () => {
    it("keeps constraint keys and unknown keys through a parse", () => {
        const options = {
            teaserImage: {
                requirement: "optional",
                minWidth: 1280,
                aspectRatio: { width: 16, height: 9 },
                futureKey: "from a newer server",
            },
        };

        const result = builtInFieldOptionsSchema.safeParse(options);

        expect(result.success).toBe(true);
        expect(result.data).toEqual(options);
    });
});

describe("buildBuiltInFieldOption", () => {
    it("keeps keys the form does not manage", () => {
        const result = buildBuiltInFieldOption(
            teaserSpec,
            { position: 3, label: "Old label", futureKey: "kept" },
            transformed(),
        );

        expect(result).toEqual({ position: 3, futureKey: "kept", requirement: "optional" });
    });

    it("carries constraints for a field with image defaults", () => {
        const result = buildBuiltInFieldOption(
            teaserSpec,
            undefined,
            transformed({ minWidth: 1280, aspectRatioWidth: 16, aspectRatioHeight: 9 }),
        );

        expect(result).toEqual({
            requirement: "optional",
            minWidth: 1280,
            aspectRatio: { width: 16, height: 9 },
        });
    });

    it("drops constraints for a field with fixed constraints", () => {
        const result = buildBuiltInFieldOption(
            avatarSpec,
            undefined,
            transformed({ minWidth: 128, aspectRatioWidth: 16, aspectRatioHeight: 9 }),
        );

        expect(result).toEqual({ requirement: "optional" });
    });

    it("drops the requirement for a force-required field", () => {
        const result = buildBuiltInFieldOption(
            { ...abstractSpec, forceRequired: true },
            undefined,
            transformed(),
        );

        expect(result).toEqual({});
    });

    it("drops a half-formed aspect ratio", () => {
        const result = buildBuiltInFieldOption(
            teaserSpec,
            { aspectRatio: { width: 4, height: 3 } },
            transformed({ aspectRatioWidth: 16 }),
        );

        expect(result).toEqual({ requirement: "optional" });
    });
});
