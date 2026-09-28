import {
    createDeserializer,
    handleJsonApiError,
    JsonApiError,
    type Relationships,
} from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { sessionStates } from "#/queries/session.ts";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const slotAttributesSchema = z.object({
    stableId: z.string(),
    startsAt: zt.instant(),
    endsAt: zt.instant(),
    setupTime: zt.duration(),
    teardownTime: zt.duration(),
});

const slotRelationships = {
    session: {
        type: "session",
        cardinality: "one",
        // The state comes along because a slot whose session has left the
        // slottable states stays on the grid and has to look like it.
        included: {
            attributesSchema: z.object({ title: z.string(), state: z.enum(sessionStates) }),
        },
    },
    location: { type: "location", cardinality: "one" },
} satisfies Relationships;

/**
 * A publication carries the window it was announced for; a draft carries nulls.
 *
 * Read a publication's slots against its own zone rather than the edition's,
 * which is free to have moved since.
 */
const scheduleAttributesSchema = z.object({
    createdAt: zt.instant(),
    publishedAt: z.nullable(zt.instant()),
    startDate: z.nullable(zt.plainDate()),
    endDate: z.nullable(zt.plainDate()),
    timeZone: z.nullable(z.string()),
    preliminary: z.boolean(),
});

const scheduleRelationships = {
    slots: {
        type: "slot",
        cardinality: "many",
        included: {
            attributesSchema: slotAttributesSchema,
            relationships: slotRelationships,
        },
    },
} satisfies Relationships;

/**
 * What the list is asked for, which is what every reader of it uses.
 *
 * Narrower than the singular read on purpose: unnarrowed, the API carries a
 * resource identifier per slot of every schedule, and nothing here draws a
 * slot. The request names these too, so the two stay in step.
 */
const scheduleSummaryAttributesSchema = z.pick(scheduleAttributesSchema, {
    publishedAt: true,
    preliminary: true,
    timeZone: true,
});

const summaryFields = ["publishedAt", "preliminary", "timeZone"] as const;

const deserializeSchedules = createDeserializer({
    type: "schedule",
    cardinality: "many",
    attributesSchema: scheduleSummaryAttributesSchema,
});
export type ScheduleSummary = ReturnType<typeof deserializeSchedules>["data"][number];

const deserializeSchedule = createDeserializer({
    type: "schedule",
    cardinality: "one",
    attributesSchema: scheduleAttributesSchema,
    relationships: scheduleRelationships,
});
export type Schedule = ReturnType<typeof deserializeSchedule>["data"];
export type Slot = Schedule["slots"][number];

const readSchedule = async (url: URL, authFetch: typeof fetch, signal: AbortSignal) => {
    const response = await authFetch(url, {
        signal,
        headers: jsonApiAcceptHeaders,
    });
    await handleJsonApiError(response);

    return deserializeSchedule(await response.json()).data;
};

export const createScheduleQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: (editionId: string) =>
        queryOptions({
            queryKey: ["schedules", editionId],
            queryFn: async ({ signal }) => {
                const url = apiUrl(`/editions/${editionId}/schedules`);
                url.searchParams.set("fields[schedule]", summaryFields.join(","));

                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeSchedules(await response.json()).data;
            },
        }),
    /** The working draft, which is the highest sequence and never published. */
    latest: (editionId: string) =>
        queryOptions({
            queryKey: ["schedules", editionId, "latest"],
            queryFn: ({ signal }) =>
                readSchedule(
                    apiUrl(
                        `/editions/${editionId}/schedules/latest?include=slots.session&fields%5Bsession%5D=title,state`,
                    ),
                    authFetch,
                    signal,
                ),
        }),
    /**
     * The publication an integration serves, null until something is published.
     *
     * The API answers 404 for that, which is a normal state for an edition
     * rather than a failure, so it is read as an answer here instead of
     * reaching an error boundary.
     */
    current: (editionId: string) =>
        queryOptions({
            queryKey: ["schedules", editionId, "current"],
            queryFn: async ({ signal }) => {
                try {
                    return await readSchedule(
                        apiUrl(
                            `/editions/${editionId}/schedules/current?include=slots.session&fields%5Bsession%5D=title,state`,
                        ),
                        authFetch,
                        signal,
                    );
                } catch (error) {
                    if (error instanceof JsonApiError && error.status === 404) {
                        return null;
                    }

                    throw error;
                }
            },
        }),
    get: (editionId: string, scheduleId: string) =>
        queryOptions({
            queryKey: ["schedules", editionId, scheduleId],
            queryFn: ({ signal }) =>
                readSchedule(
                    apiUrl(
                        `/editions/${editionId}/schedules/${scheduleId}?include=slots.session&fields%5Bsession%5D=title,state`,
                    ),
                    authFetch,
                    signal,
                ),
        }),
});
