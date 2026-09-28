import { JsonApiError } from "@jsonapi-serde/server/common";
import { notFoundFields } from "./helpers.js";

export type UniqueViolation = {
    code: string;
    title: string;
    detail: string;
    pointer: string;
};

const PG_UNIQUE_VIOLATION = "23505";

/**
 * The shape a unique violation arrives in, whichever path MikroORM took to it.
 *
 * MikroORM converts driver errors around its insert and update calls but not
 * around `commit`, so a `DEFERRABLE INITIALLY DEFERRED` constraint arrives as a
 * raw pg error while an immediate one arrives as
 * `UniqueConstraintViolationException`. Both carry the SQLSTATE and the
 * constraint name, so matching on the code covers whichever one the constraint
 * happens to be. pg's own error declares `constraint`; MikroORM's wrapper
 * copies it across without declaring it, which is why this type exists.
 */
type PostgresError = {
    code?: unknown;
    constraint?: unknown;
};

/**
 * Maps a thrown violation back to the field the caller sent.
 *
 * Uniqueness is checked by the database rather than by a preceding `findOne`,
 * which would be a TOCTOU gap, so the violation only surfaces as a thrown error.
 */
export const translateUniqueViolations = async <T>(
    run: () => Promise<T>,
    violations: Record<string, UniqueViolation>,
): Promise<T> => {
    try {
        return await run();
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }

        const { code, constraint } = error as PostgresError;
        const violation =
            code === PG_UNIQUE_VIOLATION && typeof constraint === "string"
                ? violations[constraint]
                : undefined;

        if (!violation) {
            throw error;
        }

        throw new JsonApiError({
            status: "409",
            code: violation.code,
            title: violation.title,
            detail: violation.detail,
            source: { pointer: violation.pointer },
        });
    }
};

/**
 * Takes the detail from the caller, because the scopes differ.
 *
 * Custom fields are unique per target as well, so an edition-wide phrasing would
 * be false for them.
 */
export const externalKeyTaken = (detail: string): UniqueViolation => ({
    code: "external_key_taken",
    title: "External key taken",
    detail,
    pointer: "/data/attributes/externalKey",
});

const PG_FOREIGN_KEY_VIOLATION = "23503";

/**
 * A reference that no longer resolves by the time the write reaches the database.
 *
 * Every handler here checks its references with a scoped `findOne` before
 * writing, because the foreign key alone cannot say whether the row belongs to
 * this edition. That leaves a gap the referenced row can be deleted in, and the
 * constraint is what closes it.
 */
export type ForeignKeyViolation = {
    title: string;
    detail: string;
    pointer?: string;
};

/**
 * Says what the preceding `assertExists` would have said a moment earlier.
 *
 * One condition answers with one status whether it is caught before the write
 * or by the constraint, so a client can handle it without knowing which.
 */
export const referenceGone = (name: string, id: string): ForeignKeyViolation => {
    const { title, detail } = notFoundFields(name, id);

    return { title, detail };
};

export const translateForeignKeyViolations = async <T>(
    run: () => Promise<T>,
    violations: Record<string, ForeignKeyViolation>,
): Promise<T> => {
    try {
        return await run();
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }

        const { code, constraint } = error as PostgresError;
        const violation =
            code === PG_FOREIGN_KEY_VIOLATION && typeof constraint === "string"
                ? violations[constraint]
                : undefined;

        if (!violation) {
            throw error;
        }

        throw new JsonApiError({
            status: "404",
            code: "not_found",
            title: violation.title,
            detail: violation.detail,
            ...(violation.pointer !== undefined && { source: { pointer: violation.pointer } }),
        });
    }
};
