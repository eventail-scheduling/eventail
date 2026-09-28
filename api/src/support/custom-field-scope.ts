import { JsonApiError } from "@jsonapi-serde/server/common";
import type { EntityManager } from "@mikro-orm/postgresql";
import { CustomField } from "../entity/CustomField.js";
import type { Edition } from "../entity/Edition.js";

export type ScopeDimension = "sessionTypes" | "tracks";

/**
 * Finds the custom fields whose scope in this dimension is only this row.
 *
 * An empty dimension means "every row of it" and both pivots cascade on
 * delete, so removing the last row an `always_required` question names widens
 * it to every track or session type. A field naming others in the same
 * dimension narrows correctly and is not returned.
 */
export const customFieldsScopedSolelyTo = async (
    em: EntityManager,
    edition: Edition,
    dimension: ScopeDimension,
    id: string,
): Promise<CustomField[]> => {
    const customFields = await em.find(
        CustomField,
        { edition, [dimension]: id },
        { populate: [dimension], orderBy: { position: "asc" } },
    );

    return customFields.filter((customField) => customField[dimension].length === 1);
};

export const scopeInUseError = (customFields: CustomField[], subject: string): JsonApiError =>
    new JsonApiError({
        status: "409",
        code: "scope_in_use",
        title: "Scope in use",
        detail: `Custom fields are scoped to this ${subject} and nothing else`,
        meta: {
            customFields: customFields.map((customField) => ({
                id: customField.id,
                title: customField.title,
            })),
        },
    });
