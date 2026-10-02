import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import { match } from "ts-pattern";
import { z } from "zod/mini";
import type { $ZodErrorMap, $ZodType } from "zod/v4/core";

type Bound = number | bigint;

const tooSmallMessage = (origin: string, minimum: Bound): string | undefined =>
    match(origin)
        .with("number", "int", () => `Must be ${minimum} or more`)
        .with("string", () => `Use at least ${minimum} characters`)
        .with("array", "set", () => `Select at least ${minimum}`)
        .otherwise(() => undefined);

const tooBigMessage = (origin: string, maximum: Bound): string | undefined =>
    match(origin)
        .with("number", "int", () => `Must be ${maximum} or less`)
        .with("string", () => `Use at most ${maximum} characters`)
        .with("array", "set", () => `Select at most ${maximum}`)
        .otherwise(() => undefined);

const isMissingAnswer = (origin: string, minimum: Bound): boolean =>
    minimum === 1 && (origin === "string" || origin === "array" || origin === "set");

const zodErrorHandler: $ZodErrorMap = (issue) => {
    if (issue.code === "invalid_type") {
        return issue.expected === "int" ? "Use a whole number" : "Required";
    }

    if (issue.code === "too_small") {
        return isMissingAnswer(issue.origin, issue.minimum)
            ? "Required"
            : tooSmallMessage(issue.origin, issue.minimum);
    }

    if (issue.code === "too_big") {
        return tooBigMessage(issue.origin, issue.maximum);
    }

    return undefined;
};

export const formResolver = <TFieldValues extends FieldValues, TContext, TTransformedValues>(
    schema: $ZodType<TTransformedValues, TFieldValues>,
): Resolver<TFieldValues, TContext, TTransformedValues> =>
    zodResolver(schema, { error: zodErrorHandler });

export const formRelationshipSchema = z.pipe(
    z.object({
        id: z.string(),
    }),
    z.transform((value) => value.id),
);

/** An empty field is sent as null, since the API accepts a null one but not an empty one. */
export const emptyToNullSchema = z.pipe(
    z.string().check(z.trim()),
    z.transform((input) => (input === "" ? null : input)),
);

export const instantSchema = z.instanceof(Temporal.Instant, { error: "Required" });
export const plainDateSchema = z.instanceof(Temporal.PlainDate, { error: "Required" });
export const durationSchema = z.instanceof(Temporal.Duration, { error: "Required" });
export const zonedDateTimeSchema = z.instanceof(Temporal.ZonedDateTime, { error: "Required" });

export const lengthObjectSchema = z.object({
    minLength: z.optional(z.int()),
    maxLength: z.optional(z.int()),
});
