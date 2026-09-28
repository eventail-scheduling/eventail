import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useCreateSlotMutation, usePendingPlacements } from "#/mutations/slot.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

type ProvidersProps = {
    children: ReactNode;
};

describe("usePendingPlacements", () => {
    it("names the session of a create still on its way", async () => {
        const { promise, resolve: answer } = Promise.withResolvers<Response>();
        sent.mockReturnValue(promise);
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const Providers = ({ children }: ProvidersProps): ReactNode => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        const { result, act } = await renderHook(
            () => ({ create: useCreateSlotMutation(), pending: usePendingPlacements() }),
            { wrapper: Providers },
        );

        await act(() => {
            result.current.create.mutate({
                editionId: "edition-1",
                scheduleId: "schedule-1",
                sessionId: "session-1",
                locationId: "room-a",
                startsAt: Temporal.Instant.from("2026-11-22T09:00:00Z"),
                endsAt: Temporal.Instant.from("2026-11-22T10:00:00Z"),
                setupTime: Temporal.Duration.from("PT0M"),
                teardownTime: Temporal.Duration.from("PT0M"),
            });
        });

        await expect.poll(() => result.current.pending.get("session-1")).toBe(false);

        answer(new Response(null, { status: 204 }));

        await expect.poll(() => result.current.pending.has("session-1")).toBe(false);
    });
});
