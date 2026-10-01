import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { createQueryOptionsFactory, QueryOptionsFactoryProvider } from "#/queries";
import type { SessionHostInvitePreview } from "#/queries/invite.ts";
import { Route } from "#/routes/_user/accept-host-invite.$code.tsx";
import { userWithRole } from "../support/users.ts";

const { sent, code } = vi.hoisted(() => ({ sent: vi.fn(), code: "invite-code" }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
    useOidc: () => ({ logout: vi.fn() }),
}));

// Lets the route component render without a router around it.
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
    ...(await importOriginal()),
    createFileRoute: (() => (options: unknown) => ({
        options,
        useParams: () => ({ code }),
    })) as never,
    useNavigate: () => vi.fn(),
}));

// The app chrome subscribes to the router, which these tests render without.
vi.mock("#/components/Scaffold/index.js", () => ({
    Scaffold: ({ children }: ProvidersProps) => children,
}));

// What is under test is whether the form stays mounted, not what it holds.
vi.mock("#/routes/_user/-components/CompleteHostProfile.tsx", () => ({
    CompleteHostProfile: () => <p>Profile form</p>,
}));

const AcceptPage = Route.options.component as ComponentType;
const inviteKey = ["session-host-invite", code];

const invite = {
    id: "invite-1",
    emailAddress: "test@example.com",
    expiresAt: Temporal.Instant.from("2026-12-01T10:00:00Z"),
    session: { id: "session-1", title: "A talk" },
    edition: { id: "edition-1", name: "Dev Edition" },
} as unknown as SessionHostInvitePreview;

const failed = (status: number, errorCode: string, title: string): Response =>
    new Response(JSON.stringify({ errors: [{ status: String(status), code: errorCode, title }] }), {
        status,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

type ProvidersProps = {
    children: ReactNode;
};

/** Renders the page on a cached preview, whose mount refetch answers with `refetched`. */
const mountRefetching = async (refetched: Response) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["current-user"], userWithRole(null));
    client.setQueryData(inviteKey, invite);
    sent.mockImplementation(async (url: URL) =>
        url.pathname.endsWith(`/session-host-invites/${code}`)
            ? refetched
            : new Promise<never>(() => undefined),
    );
    const factory = createQueryOptionsFactory(sent);

    const Providers = ({ children }: ProvidersProps): ReactNode => (
        <QueryClientProvider client={client}>
            <QueryOptionsFactoryProvider factory={factory}>
                <LocaleProvider>{children}</LocaleProvider>
            </QueryOptionsFactoryProvider>
        </QueryClientProvider>
    );

    const screen = await render(<AcceptPage />, { wrapper: Providers });
    await expect.poll(() => client.getQueryState(inviteKey)?.status).toBe("error");

    return screen;
};

beforeEach(() => {
    sent.mockReset();
    window.localStorage.setItem("preferredLocale", "en-US");
});

describe("a failed refetch of the host invite page", () => {
    it.each([
        [500, "internal_server_error", "Internal Server Error"],
        [401, "unauthorized", "Authentication required"],
    ])("keeps the profile form through a %i", async (status, errorCode, title) => {
        const screen = await mountRefetching(failed(status, errorCode, title));

        await expect.element(screen.getByText("Profile form")).toBeVisible();
        await expect.element(screen.getByText(title)).not.toBeInTheDocument();
    });

    it("replaces the form with a refusal of the invite itself", async () => {
        const screen = await mountRefetching(failed(403, "invite_expired", "Invite expired"));

        await expect.element(screen.getByText("Invite expired")).toBeVisible();
        await expect.element(screen.getByText("Profile form")).not.toBeInTheDocument();
    });
});
