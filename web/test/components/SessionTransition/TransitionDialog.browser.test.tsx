import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TransitionDialog } from "#/components/SessionTransition/index.ts";

const { sent, enqueueSnackbar } = vi.hoisted(() => ({
    sent: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
    enqueueSnackbar: vi.fn(),
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

vi.mock("notistack", () => ({ enqueueSnackbar }));

const editionId = "edition-1";
const sessionId = "session-1";

const listSessions = vi.fn<() => Promise<string[]>>();
const readSchedules = vi.fn<() => Promise<string[]>>();

const refused = (): Response =>
    new Response(
        JSON.stringify({
            errors: [{ status: "409", code: "illegal_transition", title: "Illegal" }],
        }),
        { status: 409, headers: { "Content-Type": "application/vnd.api+json" } },
    );

/**
 * A list filtered by state, holding the dialog on the row it was opened from.
 *
 * The schedules are read too, so a test can hold the mutation's refetch open
 * after the list has already answered.
 */
const SessionList = (): ReactNode => {
    const [open, setOpen] = useState(true);
    const listed = useQuery({ queryKey: ["sessions", editionId], queryFn: listSessions });
    useQuery({ queryKey: ["schedules", editionId], queryFn: readSchedules });

    if (!(listed.data?.includes(sessionId) && open)) {
        return null;
    }

    return (
        <TransitionDialog
            editionId={editionId}
            sessionId={sessionId}
            sessionTitle="Temporal in practice"
            from="submitted"
            target="accepted"
            author="organizer"
            onClose={() => {
                setOpen(false);
            }}
        />
    );
};

const mount = async () => {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const screen = await render(
        <QueryClientProvider client={client}>
            <SessionList />
        </QueryClientProvider>,
    );

    await expect.element(page.getByRole("dialog")).toBeInTheDocument();

    return screen;
};

beforeEach(() => {
    sent.mockReset();
    enqueueSnackbar.mockReset();
    listSessions.mockReset();
    readSchedules.mockReset();
    readSchedules.mockResolvedValue([]);
});

describe("a refused session transition", () => {
    it("closes its dialog and warns that the session changed", async () => {
        listSessions.mockResolvedValue([sessionId]);
        sent.mockResolvedValue(refused());
        await mount();

        await page.getByRole("button", { name: "Accept session" }).click();

        await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
        await expect
            .poll(() => enqueueSnackbar)
            .toHaveBeenCalledWith(expect.stringContaining("changed while this was open"), {
                variant: "warning",
            });
    });

    // The mutation settles only once every refetch it asked for has answered,
    // and the list can answer first and drop the row that holds the dialog.
    it("still warns when the refetch drops the row before the refusal settles", async () => {
        const { promise: schedulesReread, resolve: answerSchedules } =
            Promise.withResolvers<string[]>();
        listSessions.mockResolvedValueOnce([sessionId]).mockResolvedValue([]);
        readSchedules.mockResolvedValueOnce([]).mockReturnValue(schedulesReread);
        sent.mockResolvedValue(refused());
        await mount();

        await page.getByRole("button", { name: "Accept session" }).click();

        await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
        expect(enqueueSnackbar).not.toHaveBeenCalled();

        answerSchedules([]);

        await expect
            .poll(() => enqueueSnackbar)
            .toHaveBeenCalledWith(expect.stringContaining("changed while this was open"), {
                variant: "warning",
            });
    });
});
