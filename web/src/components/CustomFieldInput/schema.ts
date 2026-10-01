import { isAfter } from "temporal-extra";
import { match, P } from "ts-pattern";
import { z } from "zod/mini";
import {
    type FileUpload,
    fileUploadSchema,
    toFileDescriptorInput,
} from "#/components/FileUploadField/index.js";
import type { ResponseChanges } from "#/mutations/session.js";
import type { CustomField } from "#/queries/custom-field.js";
import { type Changes, changesWithin } from "#/utils/changed-fields.js";
import { serverNow } from "#/utils/server-clock.ts";
import { formRelationshipSchema, plainDateSchema } from "#/utils/zod.js";

export type ResponseSchema = z.ZodMiniType;
export type ResponsesSchema = z.ZodMiniType<
    Record<string, unknown>,
    Record<string, unknown> | undefined
>;

export const createResponseSchema = (customField: CustomField): ResponseSchema => {
    const required = isRequired(customField);

    return match(customField.options)
        .with({ type: "number" }, (options) => {
            let schema = z.int();

            if (options.min !== undefined) {
                schema = schema.check(z.minimum(options.min));
            }

            if (options.max !== undefined) {
                schema = schema.check(z.maximum(options.max));
            }

            return defaultToNull(schema, required);
        })
        .with({ type: P.union("single_line_text", "multi_line_text") }, (options) => {
            let filled = z.string().check(z.minLength(options.minLength ?? 1));

            if (customField.answerMaxLength !== null) {
                filled = filled.check(z.maxLength(customField.answerMaxLength));
            }

            const value = required ? filled : z.union([z.literal(""), filled]);

            return z.prefault(z.pipe(z.string().check(z.trim()), value), "");
        })
        .with({ type: "boolean" }, () =>
            required ? z.literal(true, "Required") : z.prefault(z.boolean(), false),
        )
        .with({ type: "date" }, () => defaultToNull(plainDateSchema, required))
        .with({ type: "file" }, () => defaultToNull(fileUploadSchema, required))
        .with({ type: "single_choice" }, () => defaultToNull(formRelationshipSchema, required))
        .with({ type: "multiple_choice" }, () => {
            const schema = z.array(formRelationshipSchema);

            return z.prefault(required ? schema.check(z.minLength(1)) : schema, []);
        })
        .with({ type: "url" }, () =>
            required
                ? z.httpUrl()
                : z.pipe(
                      z.transform((value): unknown => {
                          if (
                              value === undefined ||
                              (typeof value === "string" && value.trim() === "")
                          ) {
                              return null;
                          }

                          return value;
                      }),
                      z.nullish(z.httpUrl()),
                  ),
        )
        .exhaustive();
};

/**
 * Defaults an optional field to null rather than leaving it undefined.
 *
 * The API demands a key for every applicable field, and `undefined` would be
 * dropped by JSON.stringify and rejected as a missing value.
 */
const defaultToNull = <T extends z.ZodMiniType>(schema: T, required: boolean): z.ZodMiniType => {
    return required ? schema : z.prefault(z.nullable(schema), null);
};

/**
 * Seeds exactly the fields it is handed, whichever target they carry.
 *
 * A multiple choice picker reads its value's length on render, and changing the
 * session type or track can bring a field into the form after mount, so a caller
 * seeding session answers passes every one of them rather than only those
 * applicable now.
 */
export const createResponseDefaultValues = (
    customFields: CustomField[],
    findStoredValue: (customField: CustomField) => unknown = () => undefined,
): Record<string, unknown> =>
    Object.fromEntries(
        customFields.map((customField) => [
            customField.id,
            toResponseFieldValue(customField, findStoredValue(customField)),
        ]),
    );

const toResponseFieldValue = (customField: CustomField, value: unknown): unknown => {
    const { options } = customField;

    if (options.type === "single_choice") {
        return options.items.find((item) => item.id === value) ?? null;
    }

    if (options.type === "multiple_choice") {
        const ids = Array.isArray(value) ? value : [];

        return options.items.filter((item) => ids.includes(item.id));
    }

    if (options.type === "date") {
        return typeof value === "string" ? Temporal.PlainDate.from(value) : null;
    }

    return value;
};

/**
 * Swaps each file answer for the descriptor the API takes, leaving the others as they are.
 *
 * A stored file cannot be sent back, only a fresh upload, so a caller hands
 * over only answers that changed or were never stored.
 */
export const buildResponseValues = (
    customFields: CustomField[],
    responses: Record<string, unknown>,
): Record<string, unknown> => {
    const values: Record<string, unknown> = { ...responses };

    for (const customField of customFields) {
        const value = values[customField.id];

        if (customField.options.type === "file" && value) {
            values[customField.id] = toFileDescriptorInput(value as FileUpload);
        }
    }

    return values;
};

export type StoredResponse = {
    id: string;
    customField: { id: string };
};

/**
 * Joins the stored answers of several copies of one record.
 *
 * The live record lags a save whose refetch failed, so an answer that save
 * created is only in the copy the save answered with. It also loses an answer
 * whose question an organizer deleted, while the form's question list may not
 * have caught up yet. Either way an answer only a seeded copy holds would
 * otherwise go by lid, and a stored file cannot be sent that way; by id, the
 * deleted one is refused by the API with an error the form reports.
 *
 * The copies have to include the live record: the result supplies the ids of
 * untouched answers, and the live record may hold answers given since the form
 * opened.
 */
export const knownResponses = (
    ...copies: readonly (readonly StoredResponse[])[]
): StoredResponse[] => {
    const known = new Map<string, StoredResponse>();

    for (const responses of copies) {
        for (const response of responses) {
            if (!known.has(response.customField.id)) {
                known.set(response.customField.id, response);
            }
        }
    }

    return [...known.values()];
};

/**
 * Splits a form's answers into values to send and stored ones to keep by id.
 *
 * An answer never stored is sent even when untouched, since a relationship that
 * is sent has to name every applicable field and there is no id to name it by.
 * A caller should therefore send the set only when the patch has to carry it:
 * an answer given since `storedResponses` was read would be overwritten by the
 * form's untouched empty value. A stored answer to one of `keptCustomFields`,
 * frozen or no longer applying, is always kept by id, since the set sent
 * replaces the stored one and such an answer can neither be left out nor
 * changed.
 */
export const buildResponseChanges = (
    customFields: CustomField[],
    responses: Record<string, unknown>,
    changes: Changes,
    storedResponses: readonly StoredResponse[],
    keptCustomFields: readonly CustomField[],
): ResponseChanges => {
    const values: Record<string, unknown> = {};
    const keptResponseIds: string[] = [];

    for (const customField of keptCustomFields) {
        const stored = storedResponses.find(
            (response) => response.customField.id === customField.id,
        );

        if (stored) {
            keptResponseIds.push(stored.id);
        }
    }

    for (const customField of customFields) {
        const stored = storedResponses.find(
            (response) => response.customField.id === customField.id,
        );

        if (stored && changesWithin(changes, customField.id) === undefined) {
            keptResponseIds.push(stored.id);
            continue;
        }

        values[customField.id] = responses[customField.id];
    }

    return { values: buildResponseValues(customFields, values), keptResponseIds };
};

export const isRequired = (customField: CustomField): boolean => {
    if (customField.requirement === "always_required") {
        return true;
    }

    if (customField.requirement === "always_optional") {
        return false;
    }

    return customField.deadline !== null && isAfter(serverNow(), customField.deadline);
};
