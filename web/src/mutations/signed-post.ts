import { useOidcFetch } from "@axa-fr/react-oidc";
import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

// The API derives the key's extension from the content type; the original
// filename travels in the descriptor at attach time instead.
type CreateSignedPostValues = {
    contentType: string;
    md5Hash: string;
};

const deserializeSignedPost = createDeserializer({
    type: "signed_post",
    cardinality: "one",
    attributesSchema: z.object({
        key: z.string(),
        url: z.string(),
        fields: z.record(z.string(), z.string()),
        expiresIn: z.int(),
    }),
});

export type SignedPost = ReturnType<typeof deserializeSignedPost>["data"];

export const useCreateSignedPostMutation = (): UseMutationResult<
    SignedPost,
    Error,
    CreateSignedPostValues
> => {
    const { fetch } = useOidcFetch();

    return useMutation({
        mutationFn: async (attributes) => {
            const response = await fetch(apiUrl("/signed-posts"), {
                method: "POST",
                body: JSON.stringify({
                    data: {
                        type: "signed_post",
                        attributes,
                    },
                }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
            return deserializeSignedPost(await response.json()).data;
        },
    });
};
