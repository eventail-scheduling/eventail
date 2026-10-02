import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider, useIsMutating, useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { buildScheduleAxis } from "#/components/ScheduleGrid/index.js";
import type { Edition } from "#/queries/edition.js";
import type { Location } from "#/queries/location.js";
import type { Schedule, ScheduleSummary } from "#/queries/schedule.js";
import { ScheduleEditor } from "#/routes/_user/manage/$editionId/schedule/-components/ScheduleEditor.tsx";
import { createTestTheme } from "../../../support/theme.ts";

const { sent, enqueueSnackbar } = vi.hoisted(() => ({
    sent: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
    enqueueSnackbar: vi.fn(),
}));

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: sent }),
}));

vi.mock("notistack", () => ({ enqueueSnackbar }));

// The real hook wants a provider this has no use for, and nothing here takes
// a slot off.
vi.mock("material-ui-confirm", () => ({ useConfirm: () => async () => ({ confirmed: false }) }));

const editionId = "edition-1";
const berlin = "Europe/Berlin";
const theme = createTestTheme();

type EditionDays = Pick<Edition, "startDate" | "endDate" | "timeZone">;

const readEdition = vi.fn<() => Promise<EditionDays>>();

const daysFrom = (startDate: string): EditionDays => {
    const start = Temporal.PlainDate.from(startDate);

    return { startDate: start, endDate: start.add({ days: 1 }), timeZone: berlin };
};

const cached = daysFrom("2026-11-22");
/** Where another organizer moved the edition after this page read it. */
const moved = daysFrom("2026-11-29");

const locations = [
    { id: "room-a", name: "Main hall", externalKey: null, availabilities: [] },
] as unknown as Location[];

const draft = {
    id: "draft",
    slots: [],
    publishedAt: null,
    preliminary: false,
} as unknown as Schedule;

const schedules = [
    {
        id: "publication",
        publishedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
        preliminary: false,
        timeZone: berlin,
    },
] as unknown as ScheduleSummary[];

const refused = (code: string, meta?: Record<string, string>): Response =>
    new Response(JSON.stringify({ errors: [{ status: "409", code, title: "Conflict", meta }] }), {
        status: 409,
        headers: { "Content-Type": "application/vnd.api+json" },
    });

/** Published on the 15th, a week before the edition this page cached begins. */
const startDateRequired = (): Response =>
    refused("start_date_required", {
        previousStartDate: "2026-11-15",
        earliest: "2026-11-01",
        latest: "2026-11-30",
    });

/** Builds the axis from the cached edition the way the route does, so a reread reaches it. */
const EditorOverEdition = (): ReactNode => {
    const edition = useQuery({ queryKey: ["edition", editionId], queryFn: readEdition }).data;
    const settled = useIsMutating() === 0;
    const axis = useMemo(
        () =>
            edition === undefined
                ? null
                : buildScheduleAxis(edition.startDate, edition.endDate, edition.timeZone),
        [edition],
    );

    if (axis === null) {
        return null;
    }

    return (
        <>
            <ScheduleEditor
                editionId={editionId}
                axis={axis}
                locations={locations}
                venues={[]}
                draft={draft}
                sessions={[]}
                schedules={schedules}
                unpublishedChanges
                picker={null}
            />
            {settled && <span>No request in flight</span>}
        </>
    );
};

const mount = async () => {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    await render(
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <LocaleProvider>
                <QueryClientProvider client={client}>
                    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                        <EditorOverEdition />
                    </div>
                </QueryClientProvider>
            </LocaleProvider>
        </ThemeProvider>,
    );
};

const revertDialog = () => page.getByRole("dialog", { name: "Go back to what is published" });
const questionDialog = () => page.getByRole("dialog", { name: "Where does the first day land?" });

const askToRevert = async () => {
    await page.getByRole("button", { name: "Revert" }).click();
    await revertDialog().getByRole("button", { name: "Go back" }).click();
};

beforeEach(() => {
    sent.mockReset();
    enqueueSnackbar.mockReset();
    readEdition.mockReset();
});

describe("a draft another organizer already published", () => {
    it("closes the publish dialog", async () => {
        readEdition.mockResolvedValue(cached);
        sent.mockResolvedValue(refused("already_published"));
        await mount();

        await page.getByRole("button", { name: "Publish" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();

        await expect.poll(() => sent).toHaveBeenCalled();
        await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    });

    it("closes the revert dialog", async () => {
        readEdition.mockResolvedValue(cached);
        sent.mockResolvedValue(refused("already_published"));
        await mount();

        await askToRevert();

        await expect.poll(() => sent).toHaveBeenCalled();
        await expect.element(revertDialog()).not.toBeInTheDocument();
    });
});

describe("the question of where the days went", () => {
    it("is asked against the edition as read again", async () => {
        readEdition.mockResolvedValueOnce(cached).mockResolvedValue(moved);
        sent.mockResolvedValue(startDateRequired());
        await mount();

        await askToRevert();

        // Counted from the 15th: the cached edition would offer a week.
        await expect
            .element(questionDialog().getByText(/Everything scheduled moves 14 days later/))
            .toBeInTheDocument();
    });

    it("holds the revert pending until the edition has been read again", async () => {
        const { promise: reread, resolve: answerReread } = Promise.withResolvers<EditionDays>();
        readEdition.mockResolvedValueOnce(cached).mockReturnValue(reread);
        sent.mockResolvedValue(startDateRequired());
        await mount();

        await askToRevert();
        await expect.poll(() => readEdition).toHaveBeenCalledTimes(2);
        // The refused request has settled here, which would re-enable the
        // dialog if only the request held it.
        await expect.element(page.getByText("No request in flight")).toBeInTheDocument();

        expect(revertDialog().getByRole("button", { name: "Cancel" }).element()).toBeDisabled();
        expect(questionDialog().query()).toBeNull();

        answerReread(moved);

        await expect.element(questionDialog()).toBeInTheDocument();
    });

    it("is not asked when the edition cannot be read again, and says so", async () => {
        readEdition.mockResolvedValueOnce(cached).mockRejectedValue(new Error("offline"));
        sent.mockResolvedValue(startDateRequired());
        await mount();

        await askToRevert();

        await expect
            .poll(() => enqueueSnackbar)
            .toHaveBeenCalledWith(expect.stringContaining("could not be read again"), {
                variant: "error",
            });
        await expect.element(revertDialog().getByRole("button", { name: "Cancel" })).toBeEnabled();
        expect(questionDialog().query()).toBeNull();
    });
});
