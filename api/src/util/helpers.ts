import { JsonApiError } from "@jsonapi-serde/server/common";
import type { MutableKeys, NonFunctionKeys } from "utility-types";

type PatchSource<T extends object> = Partial<{
    [K in keyof T]: K extends Extract<NonFunctionKeys<T>, MutableKeys<T>> ? T[K] : never;
}>;

export const patchObject = <T extends object>(target: T, source: PatchSource<T>) => {
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) {
            target[key as keyof T] = value as T[keyof T];
        }
    }
};

/**
 * Orders by UTF-16 code unit, which no environment can move.
 *
 * `localeCompare` reads the process locale from LANG and its siblings, and
 * Danish alone reorders roughly a ninth of uuids by collating `aa` after `z`.
 * Anything whose outcome has to agree across processes, or across a restart
 * under a different locale, compares this way.
 */
export const compareCodeUnits = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

export const omit = <T extends object, K extends keyof T>(object: T, keys: K[]): Omit<T, K> => {
    return Object.fromEntries(
        Object.entries(object).filter(([key]) => !keys.includes(key as K)),
    ) as Omit<T, K>;
};

type AssertExists = (value: unknown, name: string, id: string) => asserts value;

/**
 * Builds the fields of a missing-resource answer, so a caller reuses the wording.
 *
 * `translateForeignKeyViolations` reports the same condition after the write
 * rather than before it, and the two answers have to be indistinguishable.
 */
export const notFoundFields = (name: string, id: string) => ({
    status: "404",
    code: "not_found",
    title: `${name} not found`,
    detail: `${name} with ID '${id}' not found`,
});

export const notFoundError = (name: string, id: string): JsonApiError =>
    new JsonApiError(notFoundFields(name, id));

export const assertExists: AssertExists = (
    value: unknown,
    name: string,
    id: string,
): asserts value => {
    if (value) {
        return;
    }

    throw notFoundError(name, id);
};

/**
 * Renders a value inert inside a LIKE or ILIKE pattern.
 *
 * `%` and `_` are wildcards there, so an unescaped search for "50%" matches
 * every row rather than the one it names. Backslash is PostgreSQL's default
 * escape character for the operator, which is why it has to be escaped too,
 * and why no explicit `ESCAPE` clause is needed.
 */
export const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, "\\$&");
