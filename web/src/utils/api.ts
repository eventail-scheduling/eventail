import { JsonApiError } from "@jsonapi-serde/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

const JSON_API_MEDIA_TYPE = "application/vnd.api+json";

/** For a request carrying a document. */
export const jsonApiHeaders = {
    "Content-Type": JSON_API_MEDIA_TYPE,
    Accept: JSON_API_MEDIA_TYPE,
};

/** For one that carries none, where a content type would describe an empty body. */
export const jsonApiAcceptHeaders = {
    Accept: JSON_API_MEDIA_TYPE,
};

const hasObjectPrototype = (value: unknown): boolean =>
    Object.prototype.toString.call(value) === "[object Object]";

/**
 * Recognizes the arrays this walk descends into, leaving the rest to identity.
 *
 * The walk here has to agree with query-core's own on what it will descend into.
 */
const isPlainArray = (value: unknown): value is unknown[] =>
    Array.isArray(value) && value.length === Object.keys(value).length;

/** Excludes anything carrying a prototype of its own, a Temporal value included. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!hasObjectPrototype(value)) {
        return false;
    }

    const objectConstructor = (value as { constructor?: unknown }).constructor;

    if (objectConstructor === undefined) {
        return true;
    }

    const prototype = (objectConstructor as { prototype?: unknown }).prototype;

    return hasObjectPrototype(prototype) && Object.hasOwn(prototype as object, "isPrototypeOf");
};

export const apiUrl = (path: string): URL => new URL(path, window.RUNTIME_ENV.API_URL);

/**
 * An API refusal saying the form was built from out-of-date data.
 *
 * A mutation raising it has to refresh what the form is built from before its
 * caller hears of it, through `refreshStaleForm`, whose outcome decides what
 * the message promises.
 */
export class StaleFormError extends Error {
    public override readonly name = "StaleFormError";
    /** Whether the form's sources were fetched again, as `refreshStaleForm` sets it. */
    public refreshed = false;

    public constructor(refusal: JsonApiError) {
        super("The form was out of date", { cause: refusal });
    }
}

/**
 * Refetches what a stale form is built from, recording on the refusal whether that worked.
 *
 * An invalidation resolves the same whether its refetch landed, failed, or was
 * held back offline, so what counts is whether every query on screen received
 * data since. Asking it to throw instead would drop the promise of a refetch
 * held back offline, which rejects with nothing listening if it later fails.
 */
export const refreshStaleForm = async (
    queryClient: QueryClient,
    error: StaleFormError,
    queryKeys: QueryKey[],
): Promise<void> => {
    const updatesBefore = new Map(
        queryKeys
            .flatMap((queryKey) =>
                queryClient.getQueryCache().findAll({ queryKey, exact: true, type: "active" }),
            )
            .map((query) => [query, query.state.dataUpdateCount]),
    );
    await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

    error.refreshed = [...updatesBefore].every(
        ([query, count]) => query.state.dataUpdateCount > count,
    );
};

// Only what a refreshed form can put right: a question deleted, rescoped,
// added or frozen, a stored answer the form never loaded, a requirement
// switched on, a built-in field switched on or off, or the edition no longer
// asking for availability. A deleted session, type or track is not, and keeps
// the API's own message rather than inviting a retry that fails the same way.
const staleFormCodes: ReadonlySet<string> = new Set([
    "unknown_custom_field",
    "unknown_response",
    "inapplicable_response",
    "frozen_response",
    "missing_responses",
    "incomplete_profile",
    "availability_not_asked",
    "session_fields_changed",
]);

/** Rethrows a refusal that means the form was out of date as a StaleFormError, and anything else unchanged. */
export const flagStaleForm = (error: unknown): never => {
    if (
        error instanceof JsonApiError &&
        error.errors.some(({ code }) => code !== undefined && staleFormCodes.has(code))
    ) {
        throw new StaleFormError(error);
    }

    throw error;
};

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof StaleFormError) {
        return error.refreshed
            ? "This form was out of date and has been refreshed. Check your answers and save again."
            : "This form is out of date and could not be refreshed. Try saving again in a moment.";
    }

    if (!(error instanceof JsonApiError)) {
        return "An unknown error occurred";
    }

    const jsonApiError = error.errors[0];

    return jsonApiError.detail ?? jsonApiError.title ?? "An unknown error occurred";
};

export const hasErrorCode = (error: unknown, code: string): boolean =>
    error instanceof JsonApiError && error.errors.some((entry) => entry.code === code);

export const defaultMutationErrorHandler = (error: unknown) => {
    enqueueSnackbar(getErrorMessage(error), { variant: "error" });
};

/**
 * Reports a failed reorder, whose list reloads whatever the cause.
 *
 * The reorder mutations roll back and refetch on every failure. Only
 * `incomplete_order` says somebody else changed the items meanwhile.
 */
export const reportReorderFailure = (error: unknown, subject: string): void => {
    const changedMeanwhile = hasErrorCode(error, "incomplete_order");

    enqueueSnackbar(
        changedMeanwhile
            ? `The ${subject} changed while you were reordering them, so the list has been` +
                  " reloaded."
            : getErrorMessage(error),
        { variant: changedMeanwhile ? "warning" : "error" },
    );
};

/**
 * Wraps a submit handler so what it throws is reported like a failed request.
 *
 * Building a request body can throw before any request exists, and a throw
 * from a form's submit handler otherwise only reaches the console.
 */
export const reportingErrors =
    <TArgs extends unknown[]>(handler: (...args: TArgs) => void | Promise<void>) =>
    async (...args: TArgs): Promise<void> => {
        try {
            await handler(...args);
        } catch (error) {
            console.error(error);
            defaultMutationErrorHandler(error);
        }
    };

type TemporalType =
    | Temporal.PlainDate
    | Temporal.PlainTime
    | Temporal.PlainDateTime
    | Temporal.ZonedDateTime
    | Temporal.PlainMonthDay
    | Temporal.PlainYearMonth
    | Temporal.Instant
    | Temporal.Duration;

export const isTemporal = (object: unknown): object is TemporalType => {
    return (
        object instanceof Temporal.PlainDate ||
        object instanceof Temporal.PlainTime ||
        object instanceof Temporal.PlainDateTime ||
        object instanceof Temporal.ZonedDateTime ||
        object instanceof Temporal.PlainMonthDay ||
        object instanceof Temporal.PlainYearMonth ||
        object instanceof Temporal.Instant ||
        object instanceof Temporal.Duration
    );
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: low-level complexity
export const isTemporalEqual = (oldData: TemporalType, newData: TemporalType): boolean => {
    if (oldData instanceof Temporal.PlainDate && newData instanceof Temporal.PlainDate) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.PlainTime && newData instanceof Temporal.PlainTime) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.PlainDateTime && newData instanceof Temporal.PlainDateTime) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.ZonedDateTime && newData instanceof Temporal.ZonedDateTime) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.PlainMonthDay && newData instanceof Temporal.PlainMonthDay) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.PlainYearMonth && newData instanceof Temporal.PlainYearMonth) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.Instant && newData instanceof Temporal.Instant) {
        return oldData.equals(newData);
    }

    if (oldData instanceof Temporal.Duration && newData instanceof Temporal.Duration) {
        return Temporal.Duration.compare(oldData, newData) === 0;
    }

    return false;
};

const areSetsEquals = (left: Set<unknown>, right: Set<unknown>): boolean => {
    if (left.size !== right.size) {
        return false;
    }

    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }

    return true;
};

const replaceArrayItems = (oldData: unknown[], newData: unknown[]): unknown[] => {
    const oldSize = oldData.length;
    const newSize = newData.length;
    const copy = [];
    let equalItems = 0;

    for (let i = 0; i < newSize; ++i) {
        copy[i] = extendedReplaceEqualDeep(oldData[i], newData[i]);

        if (copy[i] === oldData[i]) {
            equalItems += 1;
        }
    }

    return oldSize === newSize && equalItems === oldSize ? oldData : copy;
};

const replaceObjectProperties = (
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
): Record<string, unknown> => {
    const oldKeys = Object.keys(oldData);
    const newKeys = Object.keys(newData);
    const oldSize = oldKeys.length;
    const newSize = newKeys.length;
    const copy: Record<string, unknown> = {};
    let equalItems = 0;

    for (let i = 0; i < newSize; ++i) {
        const key = newKeys[i];
        copy[key] = extendedReplaceEqualDeep(oldData[key], newData[key]);

        if (copy[key] === oldData[key]) {
            equalItems += 1;
        }
    }

    return oldSize === newSize && equalItems === oldSize ? oldData : copy;
};

/**
 * Performs the whole of structural sharing, rather than adding to the default.
 *
 * Passed as `structuralSharing`, so query-core never reaches its own
 * `replaceEqualDeep` and the plain array and object walk here stands in for it.
 * Temporal values are equal by content rather than by identity and every
 * refetch parses fresh ones, so without a branch that reads them the query
 * object comes back new each time and every observer of that key rerenders.
 */
export const extendedReplaceEqualDeep = (oldData: unknown, newData: unknown): unknown => {
    if (oldData === newData) {
        return oldData;
    }

    if (oldData instanceof Set && newData instanceof Set) {
        return areSetsEquals(oldData, newData) ? oldData : newData;
    }

    if (isTemporal(oldData) && isTemporal(newData)) {
        return isTemporalEqual(oldData, newData) ? oldData : newData;
    }

    if (isPlainArray(oldData) && isPlainArray(newData)) {
        return replaceArrayItems(oldData, newData);
    }

    if (isPlainObject(oldData) && isPlainObject(newData)) {
        return replaceObjectProperties(oldData, newData);
    }

    return newData;
};
