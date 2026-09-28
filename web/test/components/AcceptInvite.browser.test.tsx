import { JsonApiError } from "@jsonapi-serde/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AcceptInvite } from "#/components/AcceptInvite.tsx";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import { takeSignInResumePath } from "#/utils/sign-in-resume.ts";
import { userWithRole } from "../support/users.ts";

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidc: () => ({ logout }),
}));

type ProvidersProps = {
    children: ReactNode;
};

const mismatch = new JsonApiError("Forbidden", 403, [
    { code: "invite_email_mismatch", title: "Invite email mismatch" },
]);

const testerAddress = window.location.href;

beforeEach(() => {
    logout.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("preferredLocale", "en-US");
});

afterEach(() => {
    window.history.replaceState(null, "", testerAddress);
});

describe("an invite sent to another address", () => {
    it("leaves the invite for the next sign-in before signing out", async () => {
        const client = new QueryClient();
        client.setQueryData(["current-user"], userWithRole(null));
        const factory = createQueryOptionsFactory(vi.fn());
        const Providers = ({ children }: ProvidersProps): ReactNode => (
            <QueryClientProvider client={client}>
                <QueryOptionsFactoryProvider factory={factory}>
                    <LocaleProvider>{children}</LocaleProvider>
                </QueryOptionsFactoryProvider>
            </QueryClientProvider>
        );
        window.history.replaceState(null, "", "/accept-host-invite/invite-code?from=mail");
        const screen = await render(
            <AcceptInvite
                title="Host invite"
                subject="A talk"
                error={mismatch}
                isPending={false}
                onAccept={vi.fn()}
            />,
            { wrapper: Providers },
        );

        await screen.getByRole("button", { name: "Sign in as someone else" }).click();

        expect(logout).toHaveBeenCalledWith("/");

        window.history.replaceState(null, "", "/");
        expect(takeSignInResumePath()).toBe("/accept-host-invite/invite-code?from=mail");
    });
});
