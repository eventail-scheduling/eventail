import { JsonApiError } from "@jsonapi-serde/client";
import type {
    FieldValues,
    UseFormGetValues,
    UseFormResetField,
    UseFormSetError,
} from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { recoverMissingUpload } from "#/components/FileUploadField/missing-upload.ts";

const missingFile = (meta: Record<string, string>): JsonApiError =>
    new JsonApiError("Not found", 404, [{ code: "missing_file", title: "Missing file", meta }]);

const refusedKey = "temp/refused.pdf";

const fakeForm = (current: unknown = { key: refusedKey, filename: "slides.pdf" }) => ({
    getValues: vi.fn(() => current) as unknown as UseFormGetValues<FieldValues>,
    resetField: vi.fn<UseFormResetField<FieldValues>>(),
    setError: vi.fn<UseFormSetError<FieldValues>>(),
});

describe("recoverMissingUpload", () => {
    it("resets a built-in field under the request's prefix and asks for the file there", () => {
        const form = fakeForm();

        expect(
            recoverMissingUpload(
                form,
                missingFile({ attribute: "avatar", key: refusedKey }),
                "profile.",
            ),
        ).toBe(true);
        expect(form.resetField).toHaveBeenCalledWith("profile.avatar");
        expect(form.setError).toHaveBeenCalledWith(
            "profile.avatar",
            expect.objectContaining({ type: "missing_file" }),
        );
    });

    it("finds a question's answer among the responses", () => {
        const form = fakeForm();

        recoverMissingUpload(form, missingFile({ customFieldId: "field-slides", key: refusedKey }));

        expect(form.resetField).toHaveBeenCalledWith("responses.field-slides");
    });

    it("leaves a field alone that took another upload while the save was out", () => {
        const form = fakeForm({ key: "temp/replacement.pdf", filename: "new.pdf" });

        expect(
            recoverMissingUpload(form, missingFile({ attribute: "teaserImage", key: refusedKey })),
        ).toBe(false);
        expect(form.resetField).not.toHaveBeenCalled();
    });

    it("leaves the form alone for any other refusal", () => {
        const form = fakeForm();
        const refusal = new JsonApiError("Not found", 404, [{ code: "not_found" }]);

        expect(recoverMissingUpload(form, refusal)).toBe(false);
        expect(form.resetField).not.toHaveBeenCalled();
        expect(form.setError).not.toHaveBeenCalled();
    });
});
