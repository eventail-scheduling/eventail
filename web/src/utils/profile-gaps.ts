import { JsonApiError } from "@jsonapi-serde/client";
import { z } from "zod/mini";

const profileGapsSchema = z.object({
    missingFields: z.array(z.string()),
    missingCustomFieldIds: z.array(z.string()),
    missingAvailability: z.boolean(),
});

/**
 * Names the part still wanting, out of what the refusal already carries.
 *
 * By category rather than by field: naming each one needs the edition's labels
 * and custom field titles, which live inside the suspended form rather than
 * here, and the reader mainly needs to know where to look. Returns null when
 * the refusal carries no gaps, which leaves the generic handler to speak.
 */
export const describeProfileGaps = (error: unknown): string | null => {
    if (!(error instanceof JsonApiError)) {
        return null;
    }

    const parsed = profileGapsSchema.safeParse(error.errors[0]?.meta);

    if (!parsed.success) {
        return null;
    }

    const missing = [
        parsed.data.missingFields.length > 0 ? "profile details" : null,
        parsed.data.missingCustomFieldIds.length > 0 ? "answers this event asks for" : null,
        parsed.data.missingAvailability ? "your availability" : null,
    ].filter((part) => part !== null);

    if (missing.length === 0) {
        return null;
    }

    // English, as the sentence around it is: the regional format governs how
    // values are written, not the language the app speaks.
    return `Your profile is still missing ${new Intl.ListFormat("en", {
        type: "conjunction",
    }).format(missing)}.`;
};
