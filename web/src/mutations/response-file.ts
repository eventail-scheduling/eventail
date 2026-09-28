import { useOidcFetch } from "@axa-fr/react-oidc";
import { createDeserializer, handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { z } from "zod/mini";
import { apiUrl, jsonApiAcceptHeaders } from "#/utils/api.ts";

type MintResponseFileValues = {
    editionId: string;
    responseId: string;
};

const deserializeSignedGet = createDeserializer({
    type: "signed_get",
    cardinality: "one",
    attributesSchema: z.object({
        url: z.string(),
        expiresIn: z.int(),
    }),
});

export type SignedGet = ReturnType<typeof deserializeSignedGet>["data"];

/**
 * Asks for a short-lived URL the file behind a response can be fetched from.
 *
 * A mutation rather than a query despite being a GET: the signature expires in
 * minutes, so it is minted when someone asks for the file rather than whenever
 * the answer is rendered.
 */
export const useMintResponseFileMutation = (): UseMutationResult<
    SignedGet,
    Error,
    MintResponseFileValues
> => {
    const { fetch } = useOidcFetch();

    return useMutation({
        mutationFn: async ({ editionId, responseId }) => {
            const response = await fetch(
                apiUrl(`/editions/${editionId}/responses/${responseId}/file`),
                { headers: jsonApiAcceptHeaders },
            );
            await handleJsonApiError(response);
            return deserializeSignedGet(await response.json()).data;
        },
    });
};
