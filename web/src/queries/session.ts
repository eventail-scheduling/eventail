import {
    createDeserializer,
    extractPageParams,
    handleJsonApiError,
    injectPageParams,
    type Relationships,
} from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { hostAvailabilityAttributesSchema, visibleHostAttributesSchema } from "#/queries/host.js";
import { responseAttributesSchema, responseRelationships } from "#/queries/response.js";
import { sessionTypeAttributesSchema } from "#/queries/session-type.js";
import { trackAttributesSchema } from "#/queries/track.js";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";
import { fulfillsRole, type RoleBearer } from "#/utils/role.ts";
import { imageDescriptorSchema } from "./image.ts";

export const sessionStates = [
    "submitted",
    "accepted",
    "confirmed",
    "rejected",
    "withdrawn",
    "canceled",
] as const;

export type SessionState = (typeof sessionStates)[number];

/**
 * The states the API will give a slot, refusing the rest with session_not_slottable.
 *
 * Mirrors slottableStates on the Session entity. Not the same set as the one an
 * invite may be accepted into, which also takes a submitted session.
 */
export const slottableStates: readonly SessionState[] = ["accepted", "confirmed"];

/**
 * The states in which a host may still change who hosts the session.
 *
 * Mirrors hostManageableStates in the API, which refuses the rest with
 * session_frozen. A manager is held to none of it and may act in any state, so
 * this gates the speaker's controls alone. Revoking an invite is exempt there
 * too, which is why only inviting turns on this.
 */
export const hostManageableStates: readonly SessionState[] = ["submitted", "accepted"];

/**
 * Reports whether the caller may read a session's history and pending invites.
 *
 * Both refuse anyone who neither hosts the session nor manages. Only the
 * session knows whether this caller hosts it, so the role alone would deny a
 * team member both on a session they host.
 */
export const isInvolvedWith = (
    currentUser: RoleBearer | undefined,
    session: Pick<Session, "$meta">,
): boolean => fulfillsRole(currentUser, "manager") || session.$meta.hosting;

/**
 * Reports whether a session's state still lets a host edit it.
 *
 * Mirrors the non-manager check in the API's assertSessionUpdatable, which
 * refuses the rest with not_editable.
 *
 * The speaker's pages apply it to a manager too, which the API does not do:
 * they offer what a host may do, and a manager editing past the state uses
 * manage, where the form is offered whatever the state.
 */
export const hostMayEditIn = (state: SessionState, deadlinePassed: boolean): boolean =>
    (state === "submitted" && !deadlinePassed) || state === "accepted";

export const sessionAttributesSchema = z.object({
    createdAt: zt.instant(),
    state: z.enum(sessionStates),
    title: z.string(),
    abstract: z.string(),
    description: z.string(),
    notes: z.string(),
    duration: z.nullable(zt.duration()),
    setupTime: z.nullable(zt.duration()),
    teardownTime: z.nullable(zt.duration()),
    teaserImage: z.nullable(imageDescriptorSchema),
});

const sessionRelationships = {
    hosts: {
        type: "host",
        cardinality: "many",
        included: {
            attributesSchema: visibleHostAttributesSchema,
        },
    },
    sessionType: {
        type: "session_type",
        cardinality: "one",
        included: {
            attributesSchema: sessionTypeAttributesSchema,
        },
    },
    track: {
        type: "track",
        cardinality: "one_nullable",
        included: {
            attributesSchema: trackAttributesSchema,
        },
    },
} satisfies Relationships;

// The me collection populates only what it renders, so hosts is absent from
// the document rather than empty, and declaring it would fail the parse.
const mySessionRelationships = {
    sessionType: sessionRelationships.sessionType,
    track: sessionRelationships.track,
} satisfies Relationships;

/**
 * What the caller is to a session, and what that lets them do with it.
 *
 * The moves are worked out by the API from a matrix over the state and the
 * caller both, so a client that decided for itself would drift into offering
 * what the endpoint refuses. They arrive scoped per role rather than as one
 * list, so each surface offers the moves of the role it exists for: an organizer
 * who submitted their own session decides on it where they organize, and
 * withdraws it where they speak.
 *
 * `hosting` implies neither set. A host is offered no move once the session
 * reaches a state they may not move it from, and the invite controls still
 * belong to them there.
 */
const sessionMetaSchema = z.object({
    hostTransitions: z.array(z.enum(sessionStates)),
    managerTransitions: z.array(z.enum(sessionStates)),
    hosting: z.boolean(),
});

/** Everything the filters matched, which is not the page served. */
const listDocumentMetaSchema = z.object({
    total: z.number(),
});

const deserializeSessions = createDeserializer({
    type: "session",
    cardinality: "many",
    attributesSchema: z.pick(sessionAttributesSchema, {
        state: true,
        title: true,
    }),
    // The list draws a title, a state, a type and a track, so it asks for
    // nothing else. Hosts in particular are a resource per session.
    relationships: mySessionRelationships,
    metaSchema: sessionMetaSchema,
    documentMetaSchema: listDocumentMetaSchema,
});

export type ListSessionDocument = ReturnType<typeof deserializeSessions>;
export type ListSession = ListSessionDocument["data"][number];

// The me collection applies no sparse fieldset, so it carries every attribute.
const deserializeMySessions = createDeserializer({
    type: "session",
    cardinality: "many",
    attributesSchema: sessionAttributesSchema,
    relationships: mySessionRelationships,
    metaSchema: sessionMetaSchema,
});

export type MySession = ReturnType<typeof deserializeMySessions>["data"][number];

export const deserializeSession = createDeserializer({
    type: "session",
    cardinality: "one",
    attributesSchema: sessionAttributesSchema,
    relationships: {
        ...sessionRelationships,
        // The answers a host gave about themselves, which this document carries
        // and no other does. They belong to the host's profile rather than the
        // session, so nothing here may change them.
        hosts: {
            ...sessionRelationships.hosts,
            included: {
                attributesSchema: visibleHostAttributesSchema,
                relationships: {
                    responses: {
                        type: "response",
                        cardinality: "many",
                        included: {
                            attributesSchema: responseAttributesSchema,
                            relationships: responseRelationships,
                        },
                    },
                } satisfies Relationships,
            },
        },
        responses: {
            type: "response",
            cardinality: "many",
            included: {
                attributesSchema: responseAttributesSchema,
                relationships: responseRelationships,
            },
        },
    },
    metaSchema: sessionMetaSchema,
});

export type Session = ReturnType<typeof deserializeSession>["data"];

/**
 * One move in a session's history, oldest first.
 *
 * The actor carries a display name and nothing else, because a speaker reads
 * their own session's history and a user resource otherwise carries an email
 * address. It is null where the move had no actor. `note` is what the actor
 * wrote, and on an acceptance or a rejection the speaker has it by mail too.
 */
const sessionTransitionAttributesSchema = z.object({
    createdAt: zt.instant(),
    fromState: z.enum(sessionStates),
    toState: z.enum(sessionStates),
    note: z.nullable(z.string()),
});

const deserializeSessionTransitions = createDeserializer({
    type: "session_transition",
    cardinality: "many",
    attributesSchema: sessionTransitionAttributesSchema,
    relationships: {
        session: { type: "session", cardinality: "one" },
        actor: {
            type: "user",
            cardinality: "one_nullable",
            included: {
                attributesSchema: z.object({ displayName: z.string() }),
            },
        },
    } satisfies Relationships,
});

export type SessionTransition = ReturnType<typeof deserializeSessionTransitions>["data"][number];

type ListSessionFilters = {
    /** Matches any of them, so an empty array means every state. */
    state?: readonly SessionState[];
    track?: string;
    sessionType?: string;
    /** Matched against the title alone, capped at 200 characters by the API. */
    search?: string;
    /** Up to 500, which is what the API allows; it serves 50 unasked. */
    pageSize?: number;
};

/** Where a page sits, which the caller carries in its url. */
export type SessionPageCursor = {
    after?: string;
    before?: string;
};

/**
 * One page, with the cursors either side of it.
 *
 * The first page is named by having no cursor at all rather than by one of its
 * own, so a caller returns to it by dropping both of these.
 */
export type SessionPage = {
    sessions: ListSession[];
    total: number;
    before: string | null;
    after: string | null;
};

const applyListFilters = (url: URL, filters: ListSessionFilters): void => {
    if (filters.state && filters.state.length > 0) {
        url.searchParams.set("filter[state]", filters.state.join(","));
    }

    if (filters.track) {
        url.searchParams.set("filter[track]", filters.track);
    }

    if (filters.sessionType) {
        url.searchParams.set("filter[sessionType]", filters.sessionType);
    }

    // Trimmed here because the API trims too and then demands a character, so
    // a box holding a space would be refused rather than ignored.
    const search = filters.search?.trim();

    if (search) {
        url.searchParams.set("filter[search]", search);
    }

    if (filters.pageSize) {
        url.searchParams.set("page[size]", filters.pageSize.toString());
    }
};

/**
 * Only what it takes to draw a session and give it a first slot.
 *
 * A session may leave its length and its margins unset, in which case the
 * length comes from its type and the margins are nil, so the type travels with
 * it.
 *
 * Hosts ride along for the sake of the sessions this query returns that are
 * already placed, so every slot that can still move has its hosts here, and a
 * collision can be read without asking the API a second time. A held slot,
 * whose session has left the slottable states, is absent on purpose: its
 * speakers are not booked by it.
 *
 * Their availabilities are declared required, which holds because only a
 * manager ever runs this query: the API drops the include silently below that
 * role rather than refusing, and both callers, `DraftEditor` and the loader
 * that warms it, sit behind the manager check on the schedule page.
 */
const slottableRelationships = {
    sessionType: sessionRelationships.sessionType,
    hosts: {
        type: "host",
        cardinality: "many",
        included: {
            attributesSchema: z.pick(visibleHostAttributesSchema, { displayName: true }),
            relationships: {
                availabilities: {
                    type: "host_availability",
                    cardinality: "many",
                    included: {
                        attributesSchema: hostAvailabilityAttributesSchema,
                    },
                },
            },
        },
    },
} satisfies Relationships;

const deserializeSlottableSessions = createDeserializer({
    type: "session",
    cardinality: "many",
    attributesSchema: z.pick(sessionAttributesSchema, {
        title: true,
        duration: true,
        setupTime: true,
        teardownTime: true,
    }),
    relationships: slottableRelationships,
});

export type SlottableSession = ReturnType<typeof deserializeSlottableSessions>["data"][number];

/** Enough pages for any conference, and a stop if a next link ever loops. */
const MAX_SLOTTABLE_PAGES = 20;

export const createSessionQueryOptionsFactory = (authFetch: typeof fetch) => ({
    /**
     * Every session a slot can be given, whole rather than a page of it.
     *
     * Paging belongs to this query rather than to whoever draws the list: a
     * sidebar showing the first page would report everything placed while older
     * sessions sat unscheduled. Asks the API for both slottable states at once
     * and for the few fields placement needs, rather than the wide shape a
     * sessions page wants.
     */
    slottable: (editionId: string) =>
        queryOptions({
            queryKey: ["sessions", editionId, "slottable"],
            queryFn: async ({ signal }) => {
                const collected: SlottableSession[] = [];
                let pageParam: Record<string, string> | null = null;

                for (let page = 0; page < MAX_SLOTTABLE_PAGES; page += 1) {
                    const url = apiUrl(`/editions/${editionId}/sessions`);
                    url.searchParams.set("filter[state]", slottableStates.join(","));
                    url.searchParams.set(
                        "fields[session]",
                        "title,duration,setupTime,teardownTime,sessionType,hosts",
                    );
                    url.searchParams.set("fields[host]", "displayName,availabilities");
                    url.searchParams.set("include", "sessionType,hosts.availabilities");
                    url.searchParams.set("page[size]", "500");
                    injectPageParams(url, pageParam);

                    const response = await authFetch(url, {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    });
                    await handleJsonApiError(response);

                    const document = deserializeSlottableSessions(await response.json());
                    collected.push(...document.data);
                    pageParam = extractPageParams(document.links ?? {}).next ?? null;

                    if (!pageParam) {
                        break;
                    }
                }

                return collected;
            },
        }),
    list: (editionId: string, filters: ListSessionFilters = {}, cursor: SessionPageCursor = {}) =>
        queryOptions({
            queryKey: ["sessions", editionId, filters, cursor],
            queryFn: async ({ signal }): Promise<SessionPage> => {
                const url = apiUrl(`/editions/${editionId}/sessions`);
                url.searchParams.set("fields[session]", "state,title,sessionType,track");
                url.searchParams.set(
                    "fields[track]",
                    "name,externalKey,description,color,internal",
                );
                url.searchParams.set("include", "sessionType,track");

                applyListFilters(url, filters);

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

                const document = deserializeSessions(await response.json());
                const links = extractPageParams(document.links ?? {});

                return {
                    sessions: document.data,
                    total: document.meta.total,
                    before: links.prev?.before ?? null,
                    after: links.next?.after ?? null,
                };
            },
        }),
    /** Unpaginated by design: this is what one person submitted. */
    mine: (editionId: string) =>
        queryOptions({
            queryKey: ["me", "sessions", editionId],
            queryFn: async ({ signal }) => {
                const url = apiUrl(`/editions/${editionId}/me/sessions`);
                const response = await authFetch(url, {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeMySessions(await response.json()).data;
            },
        }),
    /**
     * Oldest first, which is the order the endpoint serves and a history reads in.
     *
     * Ask only once the session has said whether the caller is involved with it
     * ({@link isInvolvedWith}): asked regardless, it answers 403 to a viewer who
     * does not host this session and takes the page down with it.
     */
    transitions: (editionId: string, sessionId: string) =>
        queryOptions({
            queryKey: ["session", editionId, sessionId, "transitions"],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/sessions/${sessionId}/transitions`),
                    {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    },
                );
                await handleJsonApiError(response);
                return deserializeSessionTransitions(await response.json()).data;
            },
        }),
    get: (editionId: string, sessionId: string) =>
        queryOptions({
            queryKey: ["session", editionId, sessionId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(
                    apiUrl(`/editions/${editionId}/sessions/${sessionId}`),
                    {
                        signal,
                        headers: jsonApiAcceptHeaders,
                    },
                );
                await handleJsonApiError(response);
                return deserializeSession(await response.json()).data;
            },
        }),
});
