import { useOidcFetch } from "@axa-fr/react-oidc";
import { handleJsonApiError } from "@jsonapi-serde/client";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl, jsonApiHeaders } from "#/utils/api.ts";

type JobActionValues = {
    jobId: string;
};

type JobAction = "retry" | "cancellation";

const useJobActionMutation = (
    action: JobAction,
): UseMutationResult<void, Error, JobActionValues> => {
    const { fetch } = useOidcFetch();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ jobId }) => {
            const response = await fetch(apiUrl(`/jobs/${jobId}/${action}`), {
                method: "POST",
                body: JSON.stringify({ data: { type: `job_${action}` } }),
                headers: jsonApiHeaders,
            });
            await handleJsonApiError(response);
        },
        // Refetched whatever the outcome: a 409 means a worker settled the job
        // under the page, which still offers what it was refused for.
        onSettled: async (_result, _error, { jobId }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["jobs"] }),
                queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
            ]);
        },
    });
};

/** Puts a discarded or canceled job back into the queue. */
export const useRetryJobMutation = (): UseMutationResult<void, Error, JobActionValues> =>
    useJobActionMutation("retry");

/** Takes a job that is still waiting out of the queue. */
export const useCancelJobMutation = (): UseMutationResult<void, Error, JobActionValues> =>
    useJobActionMutation("cancellation");
