import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnackbarProvider } from "notistack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ResponseFileLink } from "#/components/ResponseValue/ResponseFileLink.tsx";

const sent = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const signedUrl = "https://files.example.test/slides.pdf?signature=abc";

const minted = (): Response =>
    new Response(
        JSON.stringify({
            jsonapi: { version: "1.1" },
            data: {
                type: "signed_get",
                id: "answer-file",
                attributes: { url: signedUrl, expiresIn: 300 },
            },
        }),
        { status: 200, headers: { "Content-Type": "application/vnd.api+json" } },
    );

type FakeTab = {
    closed: boolean;
    opener: unknown;
    location: { href: string };
    close: () => void;
};

let tab: FakeTab;

const mount = () =>
    render(
        <QueryClientProvider
            client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
        >
            <SnackbarProvider>
                <ResponseFileLink
                    editionId="edition-1"
                    responseId="answer-file"
                    filename="slides.pdf"
                />
            </SnackbarProvider>
        </QueryClientProvider>,
    );

beforeEach(() => {
    sent.mockReset();
    tab = {
        closed: false,
        opener: window,
        location: { href: "" },
        close: vi.fn(() => {
            tab.closed = true;
        }),
    };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("ResponseFileLink", () => {
    it("sends the tab it opened to the minted URL", async () => {
        sent.mockResolvedValue(minted());
        const screen = await mount();

        await screen.getByRole("button", { name: "slides.pdf" }).click();

        await expect.poll(() => tab.location.href).toBe(signedUrl);
        expect(tab.opener).toBeNull();
    });

    it("does not navigate a tab the reader already closed", async () => {
        const { promise, resolve: respond } = Promise.withResolvers<Response>();
        sent.mockReturnValue(promise);
        const screen = await mount();

        const button = screen.getByRole("button", { name: "slides.pdf" });
        await button.click();
        await expect.element(button).toBeDisabled();
        tab.closed = true;
        respond(minted());

        await expect.element(button).toBeEnabled();
        expect(tab.location.href).toBe("");
    });

    it("still sends the tab on when the link unmounts before the URL arrives", async () => {
        const { promise, resolve: respond } = Promise.withResolvers<Response>();
        sent.mockReturnValue(promise);
        const screen = await mount();

        const button = screen.getByRole("button", { name: "slides.pdf" });
        await button.click();
        await expect.element(button).toBeDisabled();
        await screen.unmount();
        respond(minted());

        await expect.poll(() => tab.location.href).toBe(signedUrl);
    });

    it("closes the tab when the URL cannot be minted", async () => {
        sent.mockResolvedValue(
            new Response(
                JSON.stringify({
                    errors: [{ status: "404", code: "not_found", title: "Not found" }],
                }),
                { status: 404, headers: { "Content-Type": "application/vnd.api+json" } },
            ),
        );
        const screen = await mount();

        await screen.getByRole("button", { name: "slides.pdf" }).click();

        await expect.poll(() => tab.closed).toBe(true);
    });
});
