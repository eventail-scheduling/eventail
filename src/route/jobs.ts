import { jsonApiQuery, jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildQueryParameters,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import {
    type AnyParseQueryOptions,
    type AnyParseResourceRequestOptions,
    createQueryParser,
} from "@jsonapi-serde/server/request";
import { type FilterQuery, LockMode } from "@mikro-orm/core";
import { extension, pathParams } from "@taxum/core/extract";
import { createExtractHandler, m, ORIGINAL_URI, Router } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import { Job, type JobState, jobStates } from "../entity/Job.js";
import { serialize } from "../json-api/index.js";
import {
    jobDetailResourceSchema,
    jobListDocumentMetaSchemaObject,
    jobResourceSchema,
} from "../json-api/job.js";
import { RequireAuthorizationLayer } from "../util/auth.js";
import { assertExists } from "../util/helpers.js";
import { em } from "../util/mikro-orm.js";
import { createUuidPathParameter, paginationLinkSchemaObjects } from "../util/openapi.js";
import { encodeCursor, findPage } from "../util/pagination.js";
import { createPageSchema } from "../util/zod.js";
import { notifyJobsAvailable } from "../worker/util.js";

const filterSchema = z
    .strictObject({
        state: z
            .string()
            .transform((states) => states.split(","))
            .pipe(z.array(z.enum(jobStates)).min(1))
            .optional(),
    })
    .optional();

const cursorSchema = z.object({
    id: z.uuid(),
});

const pageSchema = createPageSchema(cursorSchema);

const listQueryOptions = {
    page: pageSchema,
    filter: filterSchema,
} satisfies AnyParseQueryOptions;

const listJobsHandler = createExtractHandler(
    jsonApiQuery(createQueryParser(listQueryOptions)),
    extension(ORIGINAL_URI, true),
).handler(async ({ page, filter }, requestUri) => {
    const filterQuery: FilterQuery<Job> = {};

    if (filter?.state) {
        filterQuery.state = { $in: filter.state };
    }

    const { items, links, total } = await findPage(Job, requestUri, {
        where: filterQuery,
        page,
        countMatches: true,
        createCursor: (job) => encodeCursor({ id: job.id }),
        orderBy: {
            id: "desc",
        },
    });

    return serialize("job", items, { links, meta: { total } });
});

const showJobHandler = createExtractHandler(pathParams(z.object({ jobId: z.uuid() }))).handler(
    async ({ jobId }) => {
        const job = await em.findOne(Job, jobId);
        assertExists(job, "Job", jobId);

        return serialize("job", job, { context: { job: { withPayload: true } } });
    },
);

const retryableStates: readonly JobState[] = ["discarded", "canceled"];

/**
 * The states a job can still be taken out of.
 *
 * A running job is already doing what it was for, such as sending a mail,
 * which a cancel could no longer stop. The claim takes the row with
 * `FOR UPDATE SKIP LOCKED`, so a cancel holding it makes the worker pass the
 * job over rather than wait, and a cancel arriving after the claim blocks until
 * the worker commits and then reads `running` here.
 */
const cancelableStates: readonly JobState[] = ["available", "scheduled", "retryable"];

const retryResourceOptions = { type: "job_retry" } satisfies AnyParseResourceRequestOptions;
const retryContentObject = buildResourceRequestContentObject(retryResourceOptions);

const retryJobHandler = createExtractHandler(
    pathParams(z.object({ jobId: z.uuid() })),
    jsonApiResource(retryResourceOptions),
).handler(async ({ jobId }) => {
    const job = await em.transactional(async (em) => {
        const job = await em.findOne(Job, jobId, { lockMode: LockMode.PESSIMISTIC_WRITE });
        assertExists(job, "Job", jobId);

        if (!retryableStates.includes(job.state)) {
            throw new JsonApiError({
                status: "409",
                code: "not_retryable",
                title: "Not retryable",
                detail: "Only discarded or canceled jobs can be retried",
            });
        }

        job.state = "available";
        job.attempt = 0;
        job.lastError = null;
        job.scheduledAt = Temporal.Now.instant();
        job.attemptedAt = null;
        job.finalizedAt = null;
        em.persist(job);

        await notifyJobsAvailable(em);
        return job;
    });

    return serialize("job", job);
});

const cancelResourceOptions = { type: "job_cancellation" } satisfies AnyParseResourceRequestOptions;
const cancelContentObject = buildResourceRequestContentObject(cancelResourceOptions);

const cancelJobHandler = createExtractHandler(
    pathParams(z.object({ jobId: z.uuid() })),
    jsonApiResource(cancelResourceOptions),
).handler(async ({ jobId }) => {
    const job = await em.transactional(async (em) => {
        const job = await em.findOne(Job, jobId, { lockMode: LockMode.PESSIMISTIC_WRITE });
        assertExists(job, "Job", jobId);

        if (!cancelableStates.includes(job.state)) {
            throw new JsonApiError({
                status: "409",
                code: "not_cancelable",
                title: "Not cancelable",
                detail: "Only a job that is waiting to run can be canceled",
            });
        }

        job.state = "canceled";
        job.finalizedAt = Temporal.Now.instant();
        em.persist(job);

        return job;
    });

    return serialize("job", job);
});

export const jobsRouter = new Router()
    .route("/", m.get(listJobsHandler))
    .route("/:jobId", m.get(showJobHandler))
    .route("/:jobId/retry", m.post(retryJobHandler))
    .route("/:jobId/cancellation", m.post(cancelJobHandler))
    .layer(new RequireAuthorizationLayer({ user: { superAdmin: true } }));

export const addOpenapiJobPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/jobs", {
        get: {
            tags: ["Jobs"],
            summary: "List jobs",
            description:
                "Lists queued jobs, newest first. `filter[state]` takes a comma separated list and matches any of them. Pages are cursor-based: `page[after]` and `page[before]` take the opaque cursors carried by the returned links. Cursors are keyed on the id this list is ordered by, so a cursor whose row was since deleted still resolves to the right place. A row created mid-walk sorts above the first page and a forward walk never sees it. `meta.total` is recounted per request, so it may differ between one page and the next. The links replay the request's filters, `first` is null on the first page, and there is no `last`. `meta.total` counts every job the filter matched, not the page. Requires the superadmin claim.",
            operationId: "listJobs",
            parameters: buildQueryParameters(listQueryOptions),
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: jobResourceSchema,
                    links: paginationLinkSchemaObjects,
                    meta: jobListDocumentMetaSchemaObject,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
            },
        },
    });

    builder.addPath("/jobs/{jobId}", {
        get: {
            tags: ["Jobs"],
            summary: "Show a job",
            description:
                "Serves one job with the payload its consumer was handed, which the list leaves out. Requires the superadmin claim.",
            operationId: "showJob",
            parameters: [createUuidPathParameter("jobId")],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: jobDetailResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Job not found" }),
            },
        },
    });

    builder.addPath("/jobs/{jobId}/cancellation", {
        post: {
            tags: ["Jobs"],
            summary: "Cancel a job",
            description:
                "Takes a job that is waiting to run out of the queue. A running job is refused, because the worker holding it writes its own outcome when it finishes. Requires the superadmin claim.",
            operationId: "cancelJob",
            parameters: [createUuidPathParameter("jobId")],
            requestBody: {
                required: true,
                content: cancelContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: jobResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Job not found" }),
                409: buildErrorResponseObject({
                    description: "The job is running or already finished (not_cancelable)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });

    builder.addPath("/jobs/{jobId}/retry", {
        post: {
            tags: ["Jobs"],
            summary: "Retry a job",
            description:
                "Puts a discarded or canceled job back into the queue with its attempt counter reset, and clears the reason it failed. Requires the superadmin claim.",
            operationId: "retryJob",
            parameters: [createUuidPathParameter("jobId")],
            requestBody: {
                required: true,
                content: retryContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: jobResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Job not found" }),
                409: buildErrorResponseObject({
                    description: "Job is neither discarded nor canceled (not_retryable)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
