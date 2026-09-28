import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

export const teamRoleSchema = z.enum(["admin", "manager", "viewer"]);
export type TeamRole = z.output<typeof teamRoleSchema>;

const attributesSchema = z.object({
    name: z.string(),
    role: teamRoleSchema,
});

const deserializeTeams = createDeserializer({
    type: "team",
    cardinality: "many",
    attributesSchema,
});

const deserializeTeam = createDeserializer({
    type: "team",
    cardinality: "one",
    attributesSchema,
    relationships: {
        users: {
            type: "user",
            cardinality: "many",
            included: {
                attributesSchema: z.object({
                    displayName: z.string(),
                    emailAddress: z.string(),
                }),
            },
        },
        invites: {
            type: "team_invite",
            cardinality: "many",
            included: {
                attributesSchema: z.object({
                    emailAddress: z.string(),
                }),
            },
        },
    },
});

export type Team = ReturnType<typeof deserializeTeam>["data"];
export type ListTeam = ReturnType<typeof deserializeTeams>["data"][number];

export const createTeamQueryOptionsFactory = (authFetch: typeof fetch) => ({
    list: () =>
        queryOptions({
            queryKey: ["teams"],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl("/teams"), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeTeams(await response.json()).data;
            },
        }),
    get: (teamId: string) =>
        queryOptions({
            queryKey: ["team", teamId],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl(`/teams/${teamId}`), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeTeam(await response.json()).data;
            },
        }),
});
