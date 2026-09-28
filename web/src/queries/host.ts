import {
    createDeserializer,
    extractPageParams,
    handleJsonApiError,
    type Relationships,
} from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";
import { imageDescriptorSchema } from "./image.ts";
import { responseAttributesSchema, responseRelationships } from "./response.ts";

/**
 * A host reading their own record, the only view that always carries the address.
 *
 * Everywhere else the API serves it to managers and admins alone, and absent
 * rather than null to everyone else.
 */
const ownHostAttributesSchema = z.object({
    displayName: z.string(),
    emailAddress: z.string(),
    biography: z.string(),
    avatar: z.nullable(imageDescriptorSchema),
});

export const hostAvailabilityAttributesSchema = z.object({
    startsAt: zt.instant(),
    endsAt: zt.instant(),
});

/** `/me/host` populates both members for every caller, so both always arrive. */
const ownHostRelationships = {
    responses: {
        type: "response",
        cardinality: "many",
        included: {
            attributesSchema: responseAttributesSchema,
            relationships: responseRelationships,
        },
    },
    availabilities: {
        type: "host_availability",
        cardinality: "many",
        included: {
            attributesSchema: hostAvailabilityAttributesSchema,
        },
    },
} satisfies Relationships;

/**
 * Lets availabilities be absent, which a reader has to take as "not mine to see".
 *
 * The organizer-facing read omits it outright below manager rather than sending
 * it empty. Separate from the own host shape because that one is never missing
 * it, and a form filling itself from it would otherwise need a fallback that
 * cannot happen.
 */
const visibleHostRelationships = {
    ...ownHostRelationships,
    availabilities: { ...ownHostRelationships.availabilities, optional: true },
} satisfies Relationships;

export const deserializeOwnHost = createDeserializer({
    type: "host",
    cardinality: "one",
    attributesSchema: ownHostAttributesSchema,
    relationships: ownHostRelationships,
});

export type Host = ReturnType<typeof deserializeOwnHost>["data"];

/**
 * What the organizer's list and detail carry, where the address may be absent.
 *
 * The API serves `emailAddress` to managers and admins alone and omits it for
 * everyone else rather than sending null, so the reader has to treat missing as
 * "not mine to see" instead of "not set".
 */
export const visibleHostAttributesSchema = z.object({
    displayName: z.string(),
    emailAddress: z.optional(z.string()),
    biography: z.string(),
    avatar: z.nullable(imageDescriptorSchema),
});

const hostMetaSchema = z.object({
    sessionCount: z.number(),
});

const listDocumentMetaSchema = z.object({
    total: z.number(),
});

const deserializeHosts = createDeserializer({
    type: "host",
    cardinality: "many",
    attributesSchema: z.pick(visibleHostAttributesSchema, {
        displayName: true,
        emailAddress: true,
    }),
    metaSchema: hostMetaSchema,
    documentMetaSchema: listDocumentMetaSchema,
});

const deserializeHost = createDeserializer({
    type: "host",
    cardinality: "one",
    attributesSchema: visibleHostAttributesSchema,
    relationships: visibleHostRelationships,
});

export type ListHost = ReturnType<typeof deserializeHosts>["data"][number];
export type VisibleHost = ReturnType<typeof deserializeHost>["data"];

export type HostPageCursor = {
    after?: string;
    before?: string;
};

export type HostPage = {
    hosts: ListHost[];
    total: number;
    before: string | null;
    after: string | null;
};

export const createHostQueryOptionsFactory = (authFetch: typeof fetch) => ({
    /**
     * Reading this is what brings a host record into being.
     *
     * A speaker who has never submitted anything still gets a filled-in profile
     * to edit rather than nothing.
     */
    mine: (editionId: string) =>
        queryOptions({
            queryKey: ["me", "host", editionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/me/host?include=responses,availabilities`),
                    {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    },
                );
                await handleJsonApiError(response);
                return deserializeOwnHost(await response.json()).data;
            },
        }),

    /** Everyone with a record in the edition, ordered by name. */
    list: (editionId: string, search?: string, cursor: HostPageCursor = {}) =>
        queryOptions({
            queryKey: ["hosts", editionId, search, cursor],
            queryFn: async ({ signal }): Promise<HostPage> => {
                const url = apiUrl(`/editions/${editionId}/hosts`);

                if (search !== undefined) {
                    url.searchParams.set("filter[search]", search);
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

                const document = deserializeHosts(await response.json());
                const links = extractPageParams(document.links ?? {});

                return {
                    hosts: document.data,
                    total: document.meta.total,
                    before: links.prev?.before ?? null,
                    after: links.next?.after ?? null,
                };
            },
        }),

    /**
     * One host, with their answers and, for a manager, when they are free.
     *
     * Availability is asked for rather than always included because the API
     * drops the path silently below manager, and a request that names it would
     * otherwise read as though the answer were "they have none".
     */
    get: (editionId: string, hostId: string, withAvailabilities: boolean) =>
        queryOptions({
            queryKey: ["host", editionId, hostId, withAvailabilities],
            queryFn: async ({ signal }) => {
                const url = apiUrl(`/editions/${editionId}/hosts/${hostId}`);
                url.searchParams.set(
                    "include",
                    withAvailabilities ? "responses,availabilities" : "responses",
                );

                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);

                return deserializeHost(await response.json()).data;
            },
        }),
});
