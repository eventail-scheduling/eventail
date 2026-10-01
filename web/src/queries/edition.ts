import { createDeserializer, handleJsonApiError, JsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { settleReportSchema } from "#/queries/settle.js";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const builtInFieldRequirementSchema = z.enum(["optional", "required"]);
export type BuiltInFieldRequirement = z.output<typeof builtInFieldRequirementSchema>;

const aspectRatioSchema = z.object({
    width: z.int(),
    height: z.int(),
});
export type AspectRatio = z.output<typeof aspectRatioSchema>;

/**
 * Deliberately open, at both levels.
 *
 * The server owns which built-in fields exist and which options they take, and
 * the editor writes the whole map back, so a field or option key this client
 * does not know must still survive the round trip rather than be stripped and
 * then deleted.
 */
const builtInFieldOptionSchema = z.looseObject({
    label: z.optional(z.string()),
    helperText: z.optional(z.string()),
    position: z.optional(z.int()),
    requirement: z.optional(builtInFieldRequirementSchema),
    minLength: z.optional(z.int()),
    maxLength: z.optional(z.int()),
    minWidth: z.optional(z.int()),
    minHeight: z.optional(z.int()),
    maxWidth: z.optional(z.int()),
    maxHeight: z.optional(z.int()),
    aspectRatio: z.optional(aspectRatioSchema),
});

export type BuiltInFieldOption = z.output<typeof builtInFieldOptionSchema>;

export const builtInFieldOptionsSchema = z.record(z.string(), builtInFieldOptionSchema);
export type BuiltInFieldOptions = z.output<typeof builtInFieldOptionsSchema>;

const imageDefaultsSchema = z.object({
    minWidth: z.int(),
    minHeight: z.int(),
    maxWidth: z.int(),
    maxHeight: z.int(),
});
export type ImageDefaults = z.output<typeof imageDefaultsSchema>;

const imageConstraintsSchema = z.object({
    minWidth: z.int(),
    minHeight: z.int(),
    maxWidth: z.int(),
    maxHeight: z.int(),
    aspectRatio: z.nullable(aspectRatioSchema),
});
export type ImageConstraints = z.output<typeof imageConstraintsSchema>;

const sessionFieldSpecSchema = z.object({
    label: z.string(),
    helperText: z.optional(z.string()),
    forceRequired: z.boolean(),
    type: z.enum(["string", "duration", "file", "availability", "relationship"]),
    imageDefaults: z.optional(imageDefaultsSchema),
    imageConstraints: z.optional(imageConstraintsSchema),
});
export type SessionFieldSpec = z.output<typeof sessionFieldSpecSchema>;

const editionDocumentMetaSchema = z.object({
    sessionFieldSpecs: z.record(z.string(), sessionFieldSpecSchema),
    profileFieldSpecs: z.record(z.string(), sessionFieldSpecSchema),
    maxFileSize: z.int(),
    fileContentTypes: z.array(z.string()),
    imageContentTypes: z.array(z.string()),
    settled: z.optional(settleReportSchema),
});

/**
 * What an upload has to satisfy before the store will take it.
 *
 * Travels as one object because every field that can hold a file needs all of
 * it, and the chain from the route down to the input is four components deep.
 */
export type UploadLimits = Pick<
    z.output<typeof editionDocumentMetaSchema>,
    "maxFileSize" | "fileContentTypes" | "imageContentTypes"
>;

const startDateQuestionSchema = z.object({
    previousStartDate: zt.plainDate(),
    earliest: zt.plainDate(),
    latest: zt.plainDate(),
});

export type StartDateQuestion = z.output<typeof startDateQuestionSchema>;

export const isEditionChanged = (error: unknown): boolean =>
    error instanceof JsonApiError && error.errors.some((entry) => entry.code === "edition_changed");

/**
 * Recognizes the one failure an organizer has to answer.
 *
 * The days moved under something scheduled, and how far they were meant to
 * travel is a question only the organizer can answer. Null for every other
 * failure, so a caller can hand those to the usual handler.
 */
export const startDateQuestion = (error: unknown): StartDateQuestion | null => {
    if (!(error instanceof JsonApiError)) {
        return null;
    }

    const asked = error.errors.find((entry) => entry.code === "start_date_required");
    const parsed = startDateQuestionSchema.safeParse(asked?.meta);

    return parsed.success ? parsed.data : null;
};

const editionAttributesSchema = z.object({
    name: z.string(),
    startDate: zt.plainDate(),
    endDate: zt.plainDate(),
    submissionDeadline: z.nullable(zt.instant()),
    timeZone: z.string(),
    sessionFieldOptions: builtInFieldOptionsSchema,
    profileFieldOptions: builtInFieldOptionsSchema,
});

const deserializeEditions = createDeserializer({
    type: "edition",
    cardinality: "many",
    attributesSchema: z.pick(editionAttributesSchema, {
        name: true,
        startDate: true,
        endDate: true,
        timeZone: true,
    }),
});
export type ListEdition = ReturnType<typeof deserializeEditions>["data"][number];

const editionMetaSchema = z.object({
    version: z.int(),
});

export const deserializeEdition = createDeserializer({
    type: "edition",
    cardinality: "one",
    attributesSchema: editionAttributesSchema,
    metaSchema: editionMetaSchema,
    documentMetaSchema: editionDocumentMetaSchema,
});
export type Edition = ReturnType<typeof deserializeEdition>["data"];

export type EditionDocument = {
    edition: Edition;
    sessionFieldSpecs: Record<string, SessionFieldSpec>;
    profileFieldSpecs: Record<string, SessionFieldSpec>;
    uploadLimits: UploadLimits;
};

export const createEditionQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: () =>
        queryOptions({
            queryKey: ["editions"],
            queryFn: async ({ signal }) => {
                const url = apiUrl("/editions");
                url.searchParams.set("fields[edition]", "name,startDate,endDate,timeZone");

                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeEditions(await response.json()).data;
            },
        }),
    get: (editionId: string) =>
        queryOptions({
            queryKey: ["edition", editionId],
            queryFn: async ({ signal }): Promise<EditionDocument> => {
                const response = await authFetch(apiUrl(`/editions/${editionId}`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                const document = deserializeEdition(await response.json());

                return {
                    edition: document.data,
                    sessionFieldSpecs: document.meta.sessionFieldSpecs,
                    profileFieldSpecs: document.meta.profileFieldSpecs,
                    uploadLimits: {
                        maxFileSize: document.meta.maxFileSize,
                        fileContentTypes: document.meta.fileContentTypes,
                        imageContentTypes: document.meta.imageContentTypes,
                    },
                };
            },
        }),
});
