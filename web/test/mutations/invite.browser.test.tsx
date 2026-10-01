import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
    useAcceptSessionHostInviteMutation,
    useAcceptTeamInviteMutation,
} from "#/mutations/invite.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";

const Probe = (): ReactNode => {
    const mutation = useAcceptSessionHostInviteMutation();

    return (
        <button
            type="button"
            onClick={() => {
                mutation.mutate(
                    { code: "invite-code", editionId, sessionId: "session-1" },
                    { onError: () => undefined },
                );
            }}
        >
            Accept
        </button>
    );
};

describe("accepting a session host invite", () => {
    it("refreshes the hosts once accepted", async () => {
        sent.mockResolvedValue(new Response(null, { status: 204 }));
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        vi.spyOn(client, "refetchQueries").mockResolvedValue();
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();

        await expect
            .poll(() => invalidated.mock.calls.map(([filters]) => filters?.queryKey))
            .toContainEqual(["hosts", editionId]);
        // Read again, the spent invite answers a refusal the page would show
        // on its way out.
        expect(invalidated.mock.calls.map(([filters]) => filters)).toContainEqual({
            queryKey: ["session-host-invite", "invite-code"],
            refetchType: "none",
        });
    });

    // The page holds its questions for as long as it is open, so only this
    // refetch can bring in the one the refusal is about.
    it("refetches what the profile form holds when the profile is refused", async () => {
        sent.mockResolvedValue(
            new Response(
                JSON.stringify({
                    errors: [{ status: "422", code: "incomplete_profile", title: "Incomplete" }],
                }),
                { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();

        await expect
            .poll(() => invalidated.mock.calls.map(([filters]) => filters?.queryKey))
            .toEqual([
                ["session-host-invite", "invite-code"],
                ["edition", editionId],
                ["customFields", editionId],
                ["me", "host", editionId],
            ]);
    });
});

const expired = (): Response =>
    new Response(
        JSON.stringify({ errors: [{ status: "403", code: "invite_expired", title: "Expired" }] }),
        { status: 403, headers: { "Content-Type": "application/vnd.api+json" } },
    );

const TeamProbe = (): ReactNode => {
    const mutation = useAcceptTeamInviteMutation();

    return (
        <button
            type="button"
            onClick={() => {
                mutation.mutate({ code: "team-code" }, { onError: () => undefined });
            }}
        >
            Accept
        </button>
    );
};

// Joining a team shows its internal session types and tracks, and every
// session and host in the edition.
describe("accepting a team invite", () => {
    it("marks the reads that depend on team standing stale", async () => {
        sent.mockResolvedValue(new Response(null, { status: 204 }));
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <TeamProbe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();

        await expect
            .poll(() => invalidated.mock.calls.map(([filters]) => filters?.queryKey))
            .toEqual(
                expect.arrayContaining([["sessions"], ["hosts"], ["session-types"], ["tracks"]]),
            );
    });
});

// A refused acceptance may mean the invite is gone under the page, which only
// reading the preview again tells, and which takes the Accept button away.
describe("a refused invite acceptance", () => {
    it("reads the team invite again", async () => {
        sent.mockResolvedValue(expired());
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <TeamProbe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();

        await expect
            .poll(() => invalidated.mock.calls.map(([filters]) => filters?.queryKey))
            .toContainEqual(["team-invite", "team-code"]);
    });

    // Nothing answered, so nothing says the invite is gone.
    it("leaves the offer standing when the API never answered", async () => {
        sent.mockRejectedValue(new TypeError("Failed to fetch"));
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <TeamProbe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(invalidated).not.toHaveBeenCalled();
    });

    it("reads the session host invite again", async () => {
        sent.mockResolvedValue(expired());
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
        const invalidated = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
        const screen = await render(
            <QueryClientProvider client={client}>
                <Probe />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Accept" }).click();

        await expect
            .poll(() => invalidated.mock.calls.map(([filters]) => filters?.queryKey))
            .toContainEqual(["session-host-invite", "invite-code"]);
    });
});
