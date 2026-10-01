import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import { UnscheduledPanel } from "#/routes/_user/manage/$editionId/schedule/-components/UnscheduledPanel.tsx";
import { mouse } from "../../../support/browser-input.ts";
import { createTestTheme } from "../../../support/theme.ts";
import { restoreViewportAfterEach, suiteViewport } from "../../../support/viewport.ts";
import { onShow } from "../../../support/visibility.ts";

const theme = createTestTheme();

const roomy = suiteViewport;

/** A phone, where the sidebar would leave the grid too little to drop onto. */
const narrow = { width: 414, height: 720 };

const sessions = [
    { id: "session-a", title: "Opening keynote", hosts: [] },
    { id: "session-b", title: "Lightning talks", hosts: [] },
] as unknown as SlottableSession[];

const placed: Slot[] = [];

type ProvidersProps = {
    children: ReactNode;
};

const Providers = ({ children }: ProvidersProps): ReactNode => (
    <QueryClientProvider client={new QueryClient()}>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    </QueryClientProvider>
);

type MountOptions = {
    dragging?: boolean;
};

const mount = async ({ width, height }: typeof roomy, { dragging = false }: MountOptions = {}) => {
    await page.viewport(width, height);
    const onStartDrag = vi.fn();

    await render(
        <UnscheduledPanel
            sessions={sessions}
            slots={placed}
            dragging={dragging}
            onStartDrag={onStartDrag}
        />,
        { wrapper: Providers },
    );

    return { onStartDrag };
};

const pressOn = async (locator: ReturnType<typeof page.getByText>): Promise<void> => {
    const rect = (await locator.element()).getBoundingClientRect();
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const pointer = mouse();

    await pointer.down(point);
    await pointer.up(point);
};

restoreViewportAfterEach();

describe("where the list to place goes", () => {
    it("stands beside the grid where there is room for both", async () => {
        await mount(roomy);

        await expect.element(page.getByText("To place")).toBeVisible();
        expect(page.getByRole("button", { name: "Open sessions to place" }).query()).toBeNull();
    });

    it("waits behind a button where there is not", async () => {
        await mount(narrow);

        expect(onShow(page.getByText("To place"))).toBe(false);

        await page.getByRole("button", { name: "Open sessions to place" }).click();

        await expect.element(page.getByText("To place")).toBeVisible();
        // Named by its own heading, since a full screen dialog with no title
        // is announced as an unnamed one and then read out of context.
        await expect.element(page.getByRole("dialog")).toHaveAccessibleName("To place");
    });

    it("leaves the corner to the drop target while anything is held", async () => {
        await mount(narrow, { dragging: true });

        expect(page.getByRole("button", { name: "Open sessions to place" }).query()).toBeNull();
    });
});

describe("carrying a session out of the dialog", () => {
    it("takes the dialog away as the gesture begins", async () => {
        const { onStartDrag } = await mount(narrow);
        await page.getByRole("button", { name: "Open sessions to place" }).click();

        await pressOn(page.getByText("Lightning talks"));

        expect(onStartDrag.mock.lastCall?.[0]).toMatchObject({ id: "session-b" });

        // Polled, because the dialog is still fading when the gesture that
        // dismissed it is already under way.
        await expect.poll(() => onShow(page.getByText("To place"))).toBe(false);
    });

    it("keeps the search it was dismissed with", async () => {
        await mount(narrow);
        await page.getByRole("button", { name: "Open sessions to place" }).click();
        await page.getByPlaceholder("Search sessions").fill("Lightning");

        await pressOn(page.getByText("Lightning talks"));
        // Waited out rather than relied on: reopening before this settles
        // would leave the test proving a search survived a dismissal that had
        // not happened.
        await expect.poll(() => onShow(page.getByText("To place"))).toBe(false);

        await page.getByRole("button", { name: "Open sessions to place" }).click();

        await expect.element(page.getByPlaceholder("Search sessions")).toHaveValue("Lightning");
    });
});
