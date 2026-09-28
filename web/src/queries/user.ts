import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";
import { teamRoleSchema } from "./team.ts";

export const userAttributesSchema = z.object({
    displayName: z.string(),
    emailAddress: z.string(),
});

const deserializeUser = createDeserializer({
    type: "user",
    cardinality: "one_nullable",
    attributesSchema: userAttributesSchema,
    documentMetaSchema: z.object({
        editableFields: z.array(z.enum(["displayName", "emailAddress"])),
        highestRole: z.nullable(teamRoleSchema),
        superAdmin: z.boolean(),
    }),
});

export type User = NonNullable<ReturnType<typeof deserializeUser>["data"]>;
export type UserMeta = ReturnType<typeof deserializeUser>["meta"];
export type UserEditableFields = ReturnType<typeof deserializeUser>["meta"]["editableFields"];

export type CurrentUser = {
    data: User;
    meta: UserMeta;
};

export const createUserQueryOptionsFactory = (authFetch: typeof fetch) => ({
    getCurrentUser: () =>
        queryOptions({
            queryKey: ["current-user"],
            queryFn: async ({ signal }) => {
                const response = await authFetch(apiUrl("/user"), {
                    signal,
                    headers: jsonApiAcceptHeaders,
                });
                await handleJsonApiError(response);
                return deserializeUser(await response.json());
            },
        }),
});
