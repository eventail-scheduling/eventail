import { JsonApiError } from "@jsonapi-serde/client";
import { describe, expect, it } from "vitest";
import { describeProfileGaps } from "#/utils/profile-gaps.ts";

type Gaps = {
    missingFields?: string[];
    missingCustomFieldIds?: string[];
    missingAvailability?: boolean;
};

const refusal = (meta: Record<string, unknown> | undefined): JsonApiError =>
    new JsonApiError("Unprocessable entity", 422, [
        { status: "422", code: "incomplete_profile", title: "Incomplete profile", meta },
    ]);

type GapCase = [Gaps, string];

const gaps = ({
    missingFields = [],
    missingCustomFieldIds = [],
    missingAvailability = false,
}: Gaps = {}): JsonApiError =>
    refusal({ missingFields, missingCustomFieldIds, missingAvailability });

describe("describeProfileGaps", () => {
    // Every combination rather than a sample: the three arms are independent,
    // and a wrong join still reads as a plausible sentence.
    it.each<GapCase>([
        [{ missingFields: ["biography"] }, "profile details"],
        [{ missingCustomFieldIds: ["01a0"] }, "answers this event asks for"],
        [{ missingAvailability: true }, "your availability"],
        [
            { missingFields: ["biography"], missingCustomFieldIds: ["01a0"] },
            "profile details and answers this event asks for",
        ],
        [
            { missingFields: ["biography"], missingAvailability: true },
            "profile details and your availability",
        ],
        [
            { missingCustomFieldIds: ["01a0"], missingAvailability: true },
            "answers this event asks for and your availability",
        ],
        [
            {
                missingFields: ["biography"],
                missingCustomFieldIds: ["01a0"],
                missingAvailability: true,
            },
            "profile details, answers this event asks for, and your availability",
        ],
    ])("names %o as %s", (missing, named) => {
        expect(describeProfileGaps(gaps(missing))).toEqual(
            `Your profile is still missing ${named}.`,
        );
    });

    it("declines anything it cannot read gaps from", () => {
        expect(describeProfileGaps(gaps())).toBeNull();
        expect(describeProfileGaps(refusal(undefined))).toBeNull();
        expect(describeProfileGaps(refusal({ missingFields: "biography" }))).toBeNull();
        expect(describeProfileGaps(new Error("offline"))).toBeNull();
        expect(describeProfileGaps(undefined)).toBeNull();
    });
});
