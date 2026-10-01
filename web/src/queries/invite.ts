import { createDeserializer, handleJsonApiError, type Relationships } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { zt } from "zod-temporal/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

const deserializeTeamInvitePreview = createDeserializer({
    type: "team_invite_preview",
    cardinality: "one",
    attributesSchema: z.object({
        teamName: z.string(),
        emailAddress: z.string(),
        expiresAt: zt.instant(),
    }),
});

const sessionHostInvitePreviewRelationships = {
    session: {
        type: "session",
        cardinality: "one",
        included: {
            attributesSchema: z.object({ title: z.string() }),
        },
    },
    edition: {
        type: "edition",
        cardinality: "one",
        included: {
            attributesSchema: z.object({ name: z.string() }),
        },
    },
} satisfies Relationships;

const deserializeSessionHostInvitePreview = createDeserializer({
    type: "session_host_invite_preview",
    cardinality: "one",
    attributesSchema: z.object({
        emailAddress: z.string(),
        expiresAt: zt.instant(),
    }),
    relationships: sessionHostInvitePreviewRelationships,
});

export type TeamInvitePreview = ReturnType<typeof deserializeTeamInvitePreview>["data"];
export type SessionHostInvitePreview = ReturnType<
    typeof deserializeSessionHostInvitePreview
>["data"];

export const createInviteQueryOptionsFactory = (authFetch: typeof fetch) => ({
    getTeamInvite: (code: string) =>
        queryOptions({
            queryKey: ["team-invite", code],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/team-invites/${code}`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeTeamInvitePreview(await response.json()).data;
            },
        }),
    getSessionHostInvite: (code: string) =>
        queryOptions({
            queryKey: ["session-host-invite", code],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/session-host-invites/${code}`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeSessionHostInvitePreview(await response.json()).data;
            },
        }),
});
