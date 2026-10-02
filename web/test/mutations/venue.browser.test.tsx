import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useReorderVenuesMutation } from "#/mutations/venue.ts";
import type { Venue } from "#/queries/venue.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";
const queryKey = ["venues", editionId];

const venueNamed = (id: string): Venue => ({ id, name: id, address: null, externalKey: null });

const placed = ["congress", "annex", "outdoors"].map(venueNamed);

const accepted = () => new Response(null, { status: 204 });

const refused = () =>
    new Response(
        JSON.stringify({
            errors: [
                {
                    status: "422",
                    code: "incomplete_order",
                    detail: "The order must name every venue of the edition exactly once",
                },
            ],
        }),
        { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
    );

type ProbeProps = {
    order: string[];
};

const Probe = ({ order }: ProbeProps): ReactNode => {
    const mutation = useReorderVenuesMutation(editionId);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    mutation.mutate({ venueIds: order }, { onError: () => undefined });
                }}
            >
                Reorder
            </button>
            <output>{mutation.isPending ? "sending" : "settled"}</output>
        </>
    );
};

const names = (client: QueryClient) =>
    (client.getQueryData<Venue[]>(queryKey) ?? []).map((venue) => venue.id);

const mount = async (order: string[]) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(queryKey, placed);

    const screen = await render(
        <QueryClientProvider client={client}>
            <Probe order={order} />
        </QueryClientProvider>,
    );

    return {
        client,
        reorder: () => screen.getByRole("button", { name: "Reorder" }).click(),
        screen,
    };
};

beforeEach(() => {
    sent.mockReset();
});

describe("putting the venues in a new order", () => {
    it("names every venue, in the order they now sit in", async () => {
        sent.mockResolvedValue(accepted());
        const { reorder } = await mount(["outdoors", "congress", "annex"]);

        await reorder();
        await expect.poll(() => sent.mock.calls.length).toEqual(1);

        const [url, request] = sent.mock.lastCall as [URL, RequestInit];

        expect(url.pathname).toEqual(`/editions/${editionId}/relationships/venues`);
        expect(request.method).toEqual("PATCH");
        expect(JSON.parse(request.body as string)).toEqual({
            data: [
                { type: "venue", id: "outdoors" },
                { type: "venue", id: "congress" },
                { type: "venue", id: "annex" },
            ],
        });
    });

    it("shows the new order before the server has answered", async () => {
        const { promise, resolve: answer } = Promise.withResolvers<Response>();
        sent.mockReturnValue(promise);

        const { client, reorder, screen } = await mount(["outdoors", "congress", "annex"]);

        await reorder();

        await expect.element(screen.getByText("sending")).toBeVisible();
        expect(names(client)).toEqual(["outdoors", "congress", "annex"]);

        answer(accepted());
    });

    it("puts the list back when the server refuses the order", async () => {
        sent.mockResolvedValue(refused());
        const { client, reorder } = await mount(["outdoors", "congress", "annex"]);

        await reorder();

        await expect.poll(() => names(client)).toEqual(["congress", "annex", "outdoors"]);
    });
});
