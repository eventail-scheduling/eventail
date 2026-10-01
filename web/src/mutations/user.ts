import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

type UpdateCurrentUserValues = {
    displayName?: string;
    emailAddress?: string;
};

export const useUpdateCurrentUserMutation = (): UseMutationResult<
    void,
    Error,
    UpdateCurrentUserValues
> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (values) => {
            const response = await fetch(apiUrl("/user"), {
                method: "PUT",
                body: JSON.stringify({
                    data: {
                        type: "user",
                        attributes: values,
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["current-user"] }),
                // Team pages show the name and address, and a transition names
                // its actor.
                queryClient.invalidateQueries({ queryKey: ["team"] }),
                queryClient.invalidateQueries({ queryKey: ["session"] }),
            ]);
        },
    });
};
