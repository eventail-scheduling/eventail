import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useCreateLocationMutation, useReorderLocationsMutation } from "#/mutations/location.ts";
import type { Location } from "#/queries/location.ts";

const { sent } = vi.hoisted(() => ({ sent: vi.fn() }));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

const editionId = "edition-1";
const queryKey = ["locations", editionId];

const locationNamed = (id: string): Location => ({
    id,
    name: id,
    externalKey: null,
    venue: { id: "venue-1" },
    availabilities: [],
});

const placed = ["hall", "lab", "annex"].map(locationNamed);

const accepted = () => new Response(null, { status: 204 });

const refused = () =>
    new Response(
        JSON.stringify({
            errors: [
                {
                    status: "422",
                    code: "incomplete_order",
                    detail: "The order must name every location of the edition exactly once",
                },
            ],
        }),
        { status: 422, headers: { "Content-Type": "application/vnd.api+json" } },
    );

type ProbeProps = {
    order: string[];
};

const Probe = ({ order }: ProbeProps): ReactNode => {
    const mutation = useReorderLocationsMutation(editionId);

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    mutation.mutate({ locationIds: order }, { onError: () => undefined });
                }}
            >
                Reorder
            </button>
            <output>{mutation.isPending ? "sending" : "settled"}</output>
        </>
    );
};

const names = (client: QueryClient) =>
    (client.getQueryData<Location[]>(queryKey) ?? []).map((location) => location.id);

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

describe("putting the rooms in a new order", () => {
    it("names every location, in the order they now sit in", async () => {
        sent.mockResolvedValue(accepted());
        const { reorder } = await mount(["annex", "hall", "lab"]);

        await reorder();
        await expect.poll(() => sent.mock.calls.length).toEqual(1);

        const [url, request] = sent.mock.lastCall as [URL, RequestInit];

        expect(url.pathname).toEqual(`/editions/${editionId}/relationships/locations`);
        expect(request.method).toEqual("PATCH");
        expect(JSON.parse(request.body as string)).toEqual({
            data: [
                { type: "location", id: "annex" },
                { type: "location", id: "hall" },
                { type: "location", id: "lab" },
            ],
        });
    });

    it("shows the new order before the server has answered", async () => {
        const { promise, resolve: answer } = Promise.withResolvers<Response>();
        sent.mockReturnValue(promise);

        const { client, reorder, screen } = await mount(["annex", "hall", "lab"]);

        await reorder();

        await expect.element(screen.getByText("sending")).toBeVisible();
        expect(names(client)).toEqual(["annex", "hall", "lab"]);

        answer(accepted());
    });

    it("puts the list back when the server refuses the order", async () => {
        sent.mockResolvedValue(refused());
        const { client, reorder } = await mount(["annex", "hall", "lab"]);

        await reorder();

        await expect.poll(() => names(client)).toEqual(["hall", "lab", "annex"]);
    });
});

type CreateProbeProps = {
    venue: string;
};

const CreateProbe = ({ venue }: CreateProbeProps): ReactNode => {
    const mutation = useCreateLocationMutation();

    return (
        <button
            type="button"
            onClick={() => {
                mutation.mutate(
                    {
                        editionId,
                        name: "Main Hall",
                        externalKey: null,
                        venue,
                        availabilities: [],
                    },
                    { onError: () => undefined },
                );
            }}
        >
            Create
        </button>
    );
};

describe("creating a location", () => {
    // The API refuses a body without a venue, and nothing on this side of the
    // boundary would say so: both halves typecheck on their own.
    it("names the venue it was given", async () => {
        sent.mockResolvedValue(new Response(null, { status: 201 }));
        const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

        const screen = await render(
            <QueryClientProvider client={client}>
                <CreateProbe venue="venue-1" />
            </QueryClientProvider>,
        );

        await screen.getByRole("button", { name: "Create" }).click();
        await expect.poll(() => sent.mock.calls.length).toEqual(1);

        const [, request] = sent.mock.lastCall as [URL, RequestInit];
        const body = JSON.parse(request.body as string) as {
            data: { relationships: Record<string, unknown> };
        };

        expect(body.data.relationships.venue).toEqual({
            data: { type: "venue", id: "venue-1" },
        });
    });
});
