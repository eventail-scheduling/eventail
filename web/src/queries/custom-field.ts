import {
    createDeserializer,
    handleJsonApiError,
    JsonApiError,
    type Relationships,
} from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

const blockingCustomFieldSchema = z.object({ id: z.string(), title: z.string() });

const scopeInUseSchema = z.object({
    customFields: z.array(blockingCustomFieldSchema).check(z.minLength(1)),
});

export type BlockingCustomField = z.output<typeof blockingCustomFieldSchema>;

/**
 * Recognizes a delete the edition's own questions are standing in the way of.
 *
 * Each question returned has the row being deleted as its whole scope in that
 * one dimension, so removing it would widen the question to every track or
 * session type. Null for every other failure, so a caller can hand those to the
 * usual handler.
 */
export const scopeInUse = (error: unknown): BlockingCustomField[] | null => {
    if (!(error instanceof JsonApiError)) {
        return null;
    }

    const blocked = error.errors.find((entry) => entry.code === "scope_in_use");
    const parsed = scopeInUseSchema.safeParse(blocked?.meta);

    return parsed.success ? parsed.data.customFields : null;
};

export const customFieldAttributesSchema = z.object({
    externalKey: z.nullable(z.string()),
    target: z.enum(["per_proposal", "per_host"]),
    requirement: z.enum(["always_optional", "always_required", "required_after_deadline"]),
    title: z.string(),
    helperText: z.string(),
    options: z.discriminatedUnion("type", [
        z.object({
            type: z.enum(["boolean", "url", "date", "file"]),
        }),
        z.object({
            type: z.enum(["single_line_text", "multi_line_text"]),
            minLength: z.optional(z.int()),
            maxLength: z.optional(z.int()),
        }),
        z.object({
            type: z.enum(["single_choice", "multiple_choice"]),
            items: z.array(z.object({ id: z.string(), label: z.string() })),
        }),
        z.object({
            type: z.literal("number"),
            min: z.optional(z.int()),
            max: z.optional(z.int()),
        }),
    ]),
    answerMaxLength: z.nullable(z.int()),
    deadline: z.nullable(zt.instant()),
    freezeAfter: z.nullable(zt.instant()),
    confidential: z.boolean(),
});

const customFieldRelationships = {
    tracks: {
        type: "track",
        cardinality: "many",
    },
    sessionTypes: {
        type: "session_type",
        cardinality: "many",
    },
} satisfies Relationships;

const deserializeCustomFields = createDeserializer({
    type: "custom_field",
    cardinality: "many",
    attributesSchema: customFieldAttributesSchema,
    relationships: customFieldRelationships,
});
export type CustomField = ReturnType<typeof deserializeCustomFields>["data"][number];

export const createCustomFieldQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["customFields", editionId],
            queryFn: async ({ signal }) => {
                const url = apiUrl(`/editions/${editionId}/custom-fields`);
                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeCustomFields(await response.json()).data;
            },
        }),
});
