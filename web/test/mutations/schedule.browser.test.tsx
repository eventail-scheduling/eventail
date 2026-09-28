import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { usePublishScheduleMutation, useRevertScheduleMutation } from "#/mutations/schedule.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";
const scheduleId = "schedule-1";

type ProvidersProps = {
    children: ReactNode;
};

const refused = (code: string): Response =>
    new Response(JSON.stringify({ errors: [{ status: "409", code, title: "Conflict" }] }), {
        status: 409,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

/** Mounts a mutation hook and records every key it invalidates. */
const mountRecording = async <TResult,>(useHook: () => TResult) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const Providers = ({ children }: ProvidersProps): ReactNode => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = await renderHook(useHook, { wrapper: Providers });

    return {
        mutation: result,
        keys: () => invalidated.mock.calls.map(([filters]) => filters?.queryKey),
    };
};

beforeEach(() => {
    sent.mockReset();
});

// Another organizer publishing first is what these refusals mean, and only a
// refetch shows the page what happened.
describe("what a refused schedule write refreshes", () => {
    it("refreshes the schedules after a refused publish", async () => {
        sent.mockResolvedValue(refused("already_final"));
        const { mutation, keys } = await mountRecording(usePublishScheduleMutation);

        await expect(
            mutation.current.mutateAsync({ editionId, scheduleId, preliminary: true }),
        ).rejects.toThrow();

        expect(keys()).toContainEqual(["schedules", editionId]);
    });

    it("refreshes the schedules after a refused revert", async () => {
        sent.mockResolvedValue(refused("already_published"));
        const { mutation, keys } = await mountRecording(useRevertScheduleMutation);

        await expect(mutation.current.mutateAsync({ editionId, scheduleId })).rejects.toThrow();

        expect(keys()).toContainEqual(["schedules", editionId]);
    });
});
