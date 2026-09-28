import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useCancelJobMutation } from "#/mutations/job.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

type ProvidersProps = {
    children: ReactNode;
};

describe("a refused job cancel", () => {
    // A retrying job is not polled, so a worker claiming it is only seen by
    // reading it again.
    it("reads the job again", async () => {
        sent.mockResolvedValue(
            new Response(
                JSON.stringify({
                    errors: [{ status: "409", code: "not_cancelable", title: "Not cancelable" }],
                }),
                { status: 409, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const Providers = ({ children }: ProvidersProps): ReactNode => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        const { result } = await renderHook(useCancelJobMutation, { wrapper: Providers });

        await expect(result.current.mutateAsync({ jobId: "job-1" })).rejects.toThrow();

        expect(invalidated.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual([
            "job",
            "job-1",
        ]);
    });
});
