import { createDeserializer, extractPageParams, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const jobStates = [
    "available",
    "running",
    "retryable",
    "scheduled",
    "completed",
    "canceled",
    "discarded",
] as const;

export type JobState = (typeof jobStates)[number];

/** Leaves completed out, which would bury the rest within a day of real use. */
export const defaultJobStates: readonly JobState[] = jobStates.filter(
    (state) => state !== "completed",
);

const jobAttributesSchema = z.object({
    createdAt: zt.instant(),
    attemptedAt: z.nullable(zt.instant()),
    scheduledAt: zt.instant(),
    finalizedAt: z.nullable(zt.instant()),
    attempt: z.int(),
    state: z.enum(jobStates),
    lastError: z.nullable(z.string()),
    summary: z.string(),
});

const deserializeJobs = createDeserializer({
    type: "job",
    cardinality: "many",
    attributesSchema: jobAttributesSchema,
    documentMetaSchema: z.object({ total: z.number() }),
});

const deserializeJob = createDeserializer({
    type: "job",
    cardinality: "one",
    attributesSchema: z.extend(jobAttributesSchema, {
        payload: z.record(z.string(), z.unknown()),
    }),
});

export type ListJob = ReturnType<typeof deserializeJobs>["data"][number];
export type Job = ReturnType<typeof deserializeJob>["data"];

export type JobPageCursor = {
    after?: string;
    before?: string;
};

export type JobPage = {
    jobs: ListJob[];
    total: number;
    before: string | null;
    after: string | null;
};

export const createJobQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (states: readonly JobState[], cursor: JobPageCursor = {}) =>
        queryOptions({
            queryKey: ["jobs", states, cursor],
            queryFn: async ({ signal }): Promise<JobPage> => {
                const url = apiUrl("/jobs");

                if (states.length > 0) {
                    url.searchParams.set("filter[state]", states.join(","));
                }

                if (cursor.after) {
                    url.searchParams.set("page[after]", cursor.after);
                }

                if (cursor.before) {
                    url.searchParams.set("page[before]", cursor.before);
                }

                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);

                const document = deserializeJobs(await response.json());
                const links = extractPageParams(document.links ?? {});

                return {
                    jobs: document.data,
                    total: document.meta.total,
                    before: links.prev?.before ?? null,
                    after: links.next?.after ?? null,
                };
            },
        }),

    get: (jobId: string) =>
        queryOptions({
            queryKey: ["job", jobId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/jobs/${jobId}`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);

                return deserializeJob(await response.json()).data;
            },
        }),
});
