import { JsonApiError } from "@jsonapi-serde/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ErrorCard } from "#/components/ErrorCard.tsx";

const logout = vi.fn<(callbackPath?: string) => Promise<void>>();

vi.mock("@axa-fr/react-oidc", () => ({
    useOidc: () => ({ logout }),
}));

const missingClaimDetail =
    "Your sign-in provider did not send a usable email, which this app reads from it. Ask" +
    " whoever runs the provider to add it, then sign in again.";

const missingClaim = new JsonApiError("Forbidden", 403, [
    {
        status: "403",
        code: "missing_profile_claim",
        title: "Missing profile claim",
        detail: missingClaimDetail,
        meta: { claim: "email" },
    },
]);

const renderCard = (error: unknown) =>
    render(
        <QueryClientProvider client={new QueryClient()}>
            <ErrorCard error={error} reset={() => undefined} />
        </QueryClientProvider>,
    );

beforeEach(() => {
    logout.mockReset();
    logout.mockResolvedValue(undefined);
});

describe("the error card for a missing profile claim", () => {
    it("explains the missing detail with the API's message", async () => {
        const screen = await renderCard(missingClaim);

        await expect.element(screen.getByText("Your account is missing details")).toBeVisible();
        await expect.element(screen.getByRole("alert")).toMatchTextContent(missingClaimDetail);
        await expect.element(screen.getByText("Something went wrong")).not.toBeInTheDocument();
        await expect
            .element(screen.getByRole("button", { name: "Try again" }))
            .not.toBeInTheDocument();
    });

    it("signs out back to the start page", async () => {
        const screen = await renderCard(missingClaim);

        await screen.getByRole("button", { name: "Sign out" }).click();

        expect(logout).toHaveBeenCalledExactlyOnceWith("/");
    });
});
