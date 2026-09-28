import { JsonApiError } from "@jsonapi-serde/client";
import { describe, expect, it } from "vitest";
import { startDateQuestion } from "#/queries/edition.ts";

const validMeta = {
    previousStartDate: "2027-03-24",
    earliest: "2027-03-26",
    latest: "2027-04-05",
};

const askedError = (meta: unknown) =>
    new JsonApiError("Conflict", 409, [
        {
            status: "409",
            code: "start_date_required",
            title: "Start date required",
            source: { pointer: "/data/meta/startDateBecomes" },
            meta: meta as Record<string, unknown>,
        },
    ]);

describe("startDateQuestion", () => {
    it("reads the range out of the error meta", () => {
        const question = startDateQuestion(askedError(validMeta));

        expect(question?.previousStartDate.toString()).toBe("2027-03-24");
        expect(question?.earliest.toString()).toBe("2027-03-26");
        expect(question?.latest.toString()).toBe("2027-04-05");
    });

    it("finds it behind an error carrying another code", () => {
        const error = new JsonApiError("Conflict", 409, [
            { status: "409", code: "something_else" },
            { status: "409", code: "start_date_required", meta: validMeta },
        ]);

        expect(startDateQuestion(error)).not.toBeNull();
    });

    it("passes over an error with a different code", () => {
        const error = new JsonApiError("Conflict", 409, [
            { status: "409", code: "invalid_date_range", meta: validMeta },
        ]);

        expect(startDateQuestion(error)).toBeNull();
    });

    // The code alone does not make the meta usable, and trusting it would hand
    // the picker dates it cannot bound itself with.
    it("refuses the right code with meta it cannot read", () => {
        expect(startDateQuestion(askedError({ earliest: "2027-03-26" }))).toBeNull();
        expect(startDateQuestion(askedError({ ...validMeta, latest: "not a date" }))).toBeNull();
        expect(startDateQuestion(askedError(undefined))).toBeNull();
    });

    it("passes over anything that is not a JSON:API error", () => {
        expect(startDateQuestion(new Error("network down"))).toBeNull();
        expect(startDateQuestion(validMeta)).toBeNull();
        expect(startDateQuestion(null)).toBeNull();
    });
});
