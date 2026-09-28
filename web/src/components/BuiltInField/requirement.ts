import type { BuiltInFieldOption, BuiltInFieldRequirement } from "#/queries/edition.js";

/**
 * Reads the organizer's switch, which the API sets on every field that has one.
 *
 * The server resolves the same question without a fallback, because its own
 * strict schema guarantees the key (the API's `support/profile-fields.ts`).
 * Ours exists for a document that contradicts that, and absence already means
 * required on the one path the server does produce, a field whose spec forces
 * it.
 */
export const resolveRequirement = (
    options: BuiltInFieldOption | undefined,
): BuiltInFieldRequirement => options?.requirement ?? "required";
