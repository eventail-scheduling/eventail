import { JsonApiError } from "@jsonapi-serde/client";
import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";
import { z } from "zod/mini";
import type { FileUpload } from "./FileUploadField.js";

const missingFileMetaSchema = z.intersection(
    z.object({ key: z.string() }),
    z.union([z.object({ attribute: z.string() }), z.object({ customFieldId: z.string() })]),
);

type UploadForm<TFieldValues extends FieldValues> = Pick<
    UseFormReturn<TFieldValues>,
    "getValues" | "resetField" | "setError"
>;

/**
 * Puts the field whose upload the API no longer holds back to its stored value, and asks for the
 * file again there.
 *
 * `pathPrefix` is where the refused request's fields sit in the form, so a profile write inside
 * the session wizard passes `profile.`. A field already holding another upload by the time the
 * refusal lands is left alone. Reports whether a field was reset.
 */
export const recoverMissingUpload = <TFieldValues extends FieldValues>(
    form: UploadForm<TFieldValues>,
    error: unknown,
    pathPrefix = "",
): boolean => {
    if (!(error instanceof JsonApiError)) {
        return false;
    }

    const refusal = error.errors.find((entry) => entry.code === "missing_file");
    const parsed = missingFileMetaSchema.safeParse(refusal?.meta);

    if (!parsed.success) {
        return false;
    }

    const path = (
        "attribute" in parsed.data
            ? `${pathPrefix}${parsed.data.attribute}`
            : `${pathPrefix}responses.${parsed.data.customFieldId}`
    ) as FieldPath<TFieldValues>;
    const current = form.getValues(path) as FileUpload | null | undefined;

    if (current?.key !== parsed.data.key) {
        return false;
    }

    form.resetField(path);
    form.setError(path, {
        type: "missing_file",
        message: "This upload expired before it was saved. Choose the file again.",
    });

    return true;
};
