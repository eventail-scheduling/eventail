import type { MutationKey, QueryKey, UseMutationOptions } from "@tanstack/react-query";

export type OptimisticRollback<TCached> = {
    previous: TCached | undefined;
};

type QueuedOptimisticUpdateOptions<TCached, TVariables> = {
    queryKey: QueryKey;
    mutationKey: MutationKey;
    apply: (previous: TCached, variables: TVariables) => TCached;
    invalidate: () => Promise<void>;
};

type QueuedOptimisticCallbacks<TResult, TCached, TVariables> = Pick<
    UseMutationOptions<TResult, Error, TVariables, OptimisticRollback<TCached>>,
    "onMutate" | "onError" | "onSettled"
>;

/**
 * Writes a mutation's outcome into the cache ahead of the server, and rolls it back on failure.
 *
 * Spread into a `useMutation` whose `scope` queues siblings. With nothing cached
 * yet there is no optimistic write, and `apply` is not called. It refetches
 * only once the queue drains: a mutation is still pending inside its own
 * `onSettled`, so more than one pending under the key means a later write is
 * queued, and refetching now would land a server state that predates that
 * write's optimistic one on top of it.
 */
export const queuedOptimisticUpdate = <TResult, TCached, TVariables>({
    queryKey,
    mutationKey,
    apply,
    invalidate,
}: QueuedOptimisticUpdateOptions<TCached, TVariables>): QueuedOptimisticCallbacks<
    TResult,
    TCached,
    TVariables
> => ({
    onMutate: async (variables, context) => {
        await context.client.cancelQueries({ queryKey });

        const previous = context.client.getQueryData<TCached>(queryKey);

        if (previous !== undefined) {
            context.client.setQueryData<TCached>(queryKey, apply(previous, variables));
        }

        return { previous };
    },
    onError: (_error, _variables, rollback, context) => {
        context.client.setQueryData(queryKey, rollback?.previous);
    },
    onSettled: async (_data, _error, _variables, _rollback, context) => {
        if (context.client.isMutating({ mutationKey }) > 1) {
            return;
        }

        await invalidate();
    },
});
