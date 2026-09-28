import { compile as compileJmesPath } from "@jmespath-community/jmespath";
import { z } from "zod";
import { zt } from "zod-temporal";

export type PageParams<TCursor> = {
    before?: TCursor | undefined;
    after?: TCursor | undefined;
    size: number;
};

type Page<TCursorSchema extends z.ZodType> = z.ZodType<PageParams<z.output<TCursorSchema>>>;

export const createPageSchema = <TCursorSchema extends z.ZodType>(
    cursorSchema: TCursorSchema,
): Page<TCursorSchema> => {
    const rawCursorSchema = z
        .string()
        .transform((value, context) => {
            try {
                return cursorSchema.parse(
                    JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
                );
            } catch {
                context.issues.push({
                    code: "custom",
                    message: "Invalid cursor",
                    input: value,
                });
                return z.NEVER;
            }
        })
        .optional();

    return z
        .object({
            before: rawCursorSchema,
            after: rawCursorSchema,
            size: z.coerce.number().int().min(1).max(500).default(50),
        })
        .default({
            before: undefined,
            after: undefined,
            size: 50,
        });
};

const NAME_MAX_LENGTH = 200;

/**
 * A ceiling for a name, a title or any other single-line label a person types.
 *
 * Every one of these is stored in a `text` column and rendered into lists, into
 * mails and into the integration's document, where the only other bound is the
 * 5 MB request body limit. 200 holds the longest real conference or track name
 * several times over.
 */
export const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

export const descriptionSchema = z.string().trim().max(5000);

/**
 * Ceilings for a field whose length an organizer may set and has not.
 *
 * These bound what a speaker writes, which is the one input here nobody vetted,
 * and they are deliberately generous: the point is to keep a megabyte out of a
 * schedule document, not to shape an abstract. An organizer's own `maxLength`
 * still applies wherever it is lower, and neither of these is served to the
 * form, so no field grows a character counter it did not have.
 *
 * Which one applies follows the field's own shape, the same split the custom
 * field types make between `single_line_text` and `multi_line_text`.
 */
export const DEFAULT_SINGLE_LINE_MAX_LENGTH = NAME_MAX_LENGTH;

export const DEFAULT_MULTI_LINE_MAX_LENGTH = 10_000;

/**
 * An address bounded at the length a mail server will carry.
 *
 * Zod's email check has no length rule of its own, so without this one the only
 * ceiling is the request body. RFC 5321 section 4.5.3.1.3 caps a reverse path at
 * 256 octets including its angle brackets.
 */
export const emailAddressSchema = z.email().max(254).toLowerCase();

export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid RGB hex");

export const jmesPathSchema = z.string().transform((source, context) => {
    try {
        return compileJmesPath(source);
    } catch (error) {
        context.issues.push({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid JMESPath",
            input: source,
        });
        return z.NEVER;
    }
});

const fileSizeUnits = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
const FILE_SIZE_REGEX = /^(\d+(?:\.\d*)?)\s*(B|KB|MB|GB|TB)$/i;

export const fileSizeSchema = z.string().transform((source, context) => {
    const match = FILE_SIZE_REGEX.exec(source);

    if (!match) {
        context.issues.push({
            code: "custom",
            message: "Invalid file size",
            input: source,
        });
        return z.NEVER;
    }

    const [, value, unit] = match;
    return Math.floor(
        Number.parseFloat(value) * fileSizeUnits[unit.toUpperCase() as keyof typeof fileSizeUnits],
    );
});

export const durationSchema = zt
    .duration()
    .refine((duration) => duration.sign >= 0, "Must not be negative")
    .refine(
        (duration) =>
            duration.years === 0 &&
            duration.months === 0 &&
            duration.weeks === 0 &&
            duration.days === 0 &&
            duration.seconds === 0 &&
            duration.milliseconds === 0 &&
            duration.microseconds === 0 &&
            duration.nanoseconds === 0,
        // abort: total() below throws on years/months/weeks without a
        // relativeTo. Days would pass (assumed 24 hours) but are rejected by
        // policy, as are sub-minute units.
        { message: "Must only contain hours and minutes", abort: true },
    )
    .refine((duration) => duration.total("minutes") <= 60 * 24, "Must not exceed 24 hours");
