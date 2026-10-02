import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import { Container, CssBaseline, IconButton } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { buildScheduleAxis } from "#/components/ScheduleGrid/index.js";
import type { Location } from "#/queries/location.js";
import type { Schedule, ScheduleSummary, Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import { ScheduleEditor } from "#/routes/_user/manage/$editionId/schedule/-components/ScheduleEditor.tsx";
import {
    mouse,
    type PointerInput,
    stopTouch,
    touch,
    wait,
} from "../../../support/browser-input.ts";
import { assertScrollable } from "../../../support/scrolling.ts";
import { createTestTheme } from "../../../support/theme.ts";
import { restoreViewportAfterEach } from "../../../support/viewport.ts";
import { onShow } from "../../../support/visibility.ts";

// Captured rather than sent: what reaches the mutation is the whole of what
// this suite can check about a write.
const { updateSlot } = vi.hoisted(() => ({ updateSlot: vi.fn() }));

vi.mock("#/mutations/slot.ts", () => ({
    useCreateSlotMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateSlotMutation: () => ({ mutate: updateSlot, isPending: false }),
    useDeleteSlotMutation: () => ({ mutate: vi.fn(), isPending: false }),
    usePendingPlacements: () => new Map(),
}));

// Declines, so a placed slot let go on the corner is never deleted. The real
// hook wants a provider this has no use for.
vi.mock("material-ui-confirm", () => ({ useConfirm: () => async () => ({ confirmed: false }) }));
// Never reached: the slot mutations are replaced above and nothing here
// publishes or reverts. The real hook wants a provider this has no use for,
// and this throws so that stays true.
vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({
        fetch: () => {
            throw new Error("this suite writes nothing");
        },
    }),
}));

const berlin = "Europe/Berlin";
const theme = createTestTheme();

/**
 * A phone, and short enough that Vitest does not scale the frame.
 *
 * A scaled frame puts the pointer somewhere other than where these tests aim
 * it, which reads as a broken hit test rather than a broken measurement.
 */
const phone = { width: 414, height: 600 };

const axis = buildScheduleAxis(
    Temporal.PlainDate.from("2026-11-22"),
    Temporal.PlainDate.from("2026-11-23"),
    berlin,
);

const locations = [
    { id: "room-a", name: "Main hall", externalKey: null, availabilities: [] },
    { id: "room-b", name: "Lab", externalKey: null, availabilities: [] },
] as unknown as Location[];

const at = (time: string): Temporal.Instant =>
    Temporal.ZonedDateTime.from(`2026-11-22T${time}[${berlin}]`).toInstant();

const placed = [
    {
        id: "slot-keynote",
        stableId: "slot-keynote",
        startsAt: at("10:00"),
        endsAt: at("11:00"),
        setupTime: Temporal.Duration.from({ minutes: 0 }),
        teardownTime: Temporal.Duration.from({ minutes: 0 }),
        session: { id: "session-keynote", title: "Keynote", state: "confirmed" },
        location: { id: "room-a" },
    },
] as unknown as Slot[];

/** A one hour window, so every drop these tests make falls outside it. */
const earlyOnly = [{ startsAt: at("08:00"), endsAt: at("09:00") }];

const filler = Array.from({ length: 40 }, (_, index) => ({
    id: `session-${index.toString()}`,
    title: `Filler ${index.toString()}`,
    hosts: [],
    sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 60 }) },
}));

const sessions = [
    {
        id: "session-busy",
        title: "Panel",
        hosts: [
            { id: "host-ada", displayName: "Ada Lovelace", availabilities: earlyOnly },
            { id: "host-grace", displayName: "Grace Hopper", availabilities: earlyOnly },
        ],
        sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 60 }) },
    },
    {
        id: "session-duet",
        title: "Duet",
        hosts: [{ id: "host-ada", displayName: "Ada Lovelace", availabilities: earlyOnly }],
        sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 60 }) },
    },
    {
        id: "session-keynote",
        title: "Keynote",
        hosts: [],
        sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 60 }) },
    },
    {
        id: "session-talks",
        title: "Lightning talks",
        hosts: [],
        sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 60 }) },
    },
    ...filler,
] as unknown as SlottableSession[];

type ProvidersProps = {
    children: ReactNode;
};

const Providers = ({ children }: ProvidersProps): ReactNode => (
    <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocaleProvider>
            <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
        </LocaleProvider>
    </ThemeProvider>
);

restoreViewportAfterEach();

const draftOf = (slots: Slot[]) =>
    ({
        id: "draft",
        slots,
        publishedAt: null,
        preliminary: false,
    }) as unknown as Schedule;

type MountOptions = {
    picker?: ReactNode;
    unpublishedChanges?: boolean;
    viewport?: typeof phone;
};

const mount = async (
    slots: Slot[],
    { picker = null, unpublishedChanges = true, viewport = phone }: MountOptions = {},
) => {
    await page.viewport(viewport.width, viewport.height);

    const draft = draftOf(slots);

    return render(
        <div
            style={{
                height: "100vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
            }}
        >
            <Container
                sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", py: 2 }}
            >
                <ScheduleEditor
                    editionId="edition"
                    axis={axis}
                    locations={locations}
                    venues={[]}
                    draft={draft}
                    sessions={sessions}
                    schedules={[] as unknown as ScheduleSummary[]}
                    unpublishedChanges={unpublishedChanges}
                    picker={picker}
                />
            </Container>
        </div>,
        { wrapper: Providers },
    );
};

const corner = () => document.querySelector<HTMLElement>('[data-testid="drop-corner"]');
/** Throws rather than defaulting, so an absent note cannot read as a placed one. */
const noteRect = (): DOMRect => {
    const element = document.querySelector<HTMLElement>(".MuiAlert-root");

    if (element === null) {
        throw new Error("no host warning is showing");
    }

    return element.getBoundingClientRect();
};
const roomNames = () => document.querySelector<HTMLElement>('[data-testid="schedule-header"]');
const scroller = () => document.querySelector<HTMLElement>('[data-testid="schedule-scroller"]');
const ghost = () => document.querySelector('[data-testid="schedule-ghost"]');

const iconIn = (element: HTMLElement | null): string =>
    element?.querySelector("svg")?.dataset.testid ?? "none";

const centerOf = (element: Element) => {
    const rect = element.getBoundingClientRect();

    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

/** Far from every edge, so the grid never follows the pointer mid-gesture. */
const middle = { x: 160, y: 300 };

/**
 * Ends a gesture on the corner, which is the one release that writes nothing.
 *
 * Letting go over a room would place the session. That reaches only a spy
 * here, but it is still a write the test did not ask for, and the corner is
 * the release reachable from anywhere a gesture has got to. For a placed slot
 * it asks a confirm that is stubbed to decline.
 */
const letGoOnTheCorner = async (pointer: PointerInput) => {
    const target = centerOf(corner() as HTMLElement);

    await pointer.move(target);
    await pointer.up(target);
};

const carryNewSession = async () => {
    await page.getByRole("button", { name: "Open sessions to place" }).click();

    const entry = await page.getByText("Lightning talks").element();
    const pointer = mouse();

    await pointer.down(centerOf(entry));
    await pointer.move(middle);
    await pointer.move({ x: middle.x + 4, y: middle.y + 4 });

    return pointer;
};

/** Carries the session whose speakers are free only at 08:00, to a height. */
const carryBusyTo = async (clientY: number) => {
    await page.getByRole("button", { name: "Open sessions to place" }).click();

    const entry = await page.getByText("Panel").element();
    const pointer = mouse();

    await pointer.down(centerOf(entry));
    await pointer.move({ x: middle.x, y: clientY });
    await pointer.move({ x: middle.x + 4, y: clientY });

    return pointer;
};

describe("the heading on a narrow screen", () => {
    it("leaves the row to the controls without leaving the document", async () => {
        await mount([]);

        // Throws where the heading is not in the accessibility tree at all,
        // which is what `display: none` would leave behind.
        const heading = await page.getByRole("heading", { name: "Schedule" }).element();

        expect(getComputedStyle(heading).position).toEqual("absolute");
        expect(heading.getBoundingClientRect().width).toBeLessThan(2);
    });

    it("still holds the controls against the right edge", async () => {
        await mount([]);

        const row = (await page.getByRole("heading", { name: "Schedule" }).element())
            .parentElement as HTMLElement;
        const last = row.lastElementChild as HTMLElement;

        // The last control rather than a named one, which would fail for
        // anything added to its right.
        expect(last.getBoundingClientRect().right).toEqual(row.getBoundingClientRect().right);
    });

    it("shows the heading where the row has room for it", async () => {
        await mount([]);
        // Widened after mounting, which sets the phone viewport itself. The
        // rule is a media query, so the change lands without a re-render.
        await page.viewport(1024, 640);

        const heading = await page.getByRole("heading", { name: "Schedule" }).element();

        // Hiding it at every width would satisfy the narrow case just as well.
        expect(heading.getBoundingClientRect().width).toBeGreaterThan(40);
    });
});

describe("the draft's actions on a phone", () => {
    // Two sessions sharing a speaker at the same hour, so the row carries its
    // clash chip as well.
    const clashing = [
        {
            ...placed[0],
            id: "slot-panel",
            stableId: "slot-panel",
            session: { id: "session-busy", title: "Panel", state: "confirmed" },
        },
        {
            ...placed[0],
            id: "slot-duet",
            stableId: "slot-duet",
            session: { id: "session-duet", title: "Duet", state: "confirmed" },
            location: { id: "room-b" },
        },
    ] as unknown as Slot[];

    // What the publication picker renders, which a draft without a
    // publication behind it would not show at all.
    const pickerStandIn = (
        <IconButton aria-label="Showing: Working draft">
            <LayersOutlinedIcon />
        </IconButton>
    );

    // The widest the row gets, at the narrowest phone: a clash and a
    // publication. The shell clips rather than scrolls, so a control past
    // either edge could not be reached.
    it("keeps every control on screen at 320px", async () => {
        await mount(clashing, {
            picker: pickerStandIn,
            viewport: { width: 320, height: 600 },
        });
        await expect.element(page.getByLabelText("1 speaker clash")).toBeVisible();

        const row = (await page.getByRole("heading", { name: "Schedule" }).element())
            .parentElement as HTMLElement;
        const rowRect = row.getBoundingClientRect();
        const controls = (row.lastElementChild as HTMLElement).getBoundingClientRect();

        expect(controls.left).toBeGreaterThanOrEqual(rowRect.left);
        expect(controls.right).toBeLessThanOrEqual(rowRect.right);
    });

    it("says in the menu why publishing is unavailable", async () => {
        await mount([], { unpublishedChanges: false });
        await page.getByRole("button", { name: "Schedule actions" }).click();

        const publish = page.getByRole("menuitem", { name: /^Publish/ });

        await expect.element(publish).toHaveAttribute("aria-disabled", "true");
        await expect
            .element(publish.getByText("Nothing has changed since the last publication"))
            .toBeVisible();
    });
});

describe("the note naming who is not free", () => {
    it("sits at the far end from the pointer", async () => {
        await mount([]);
        const view = scroller() as HTMLElement;
        const middleOfGrid =
            view.getBoundingClientRect().top + view.getBoundingClientRect().height / 2;

        const pointingLow = await carryBusyTo(middleOfGrid + 60);

        expect(noteRect().top).toBeLessThan(middleOfGrid);

        await letGoOnTheCorner(pointingLow);

        const pointingHigh = await carryBusyTo(middleOfGrid - 60);
        const lowered = noteRect();

        expect(lowered.bottom).toBeGreaterThan(middleOfGrid);

        // The low band exists to leave the corner alone, which a note merely
        // below the middle would satisfy while sitting right on top of it.
        expect(lowered.bottom).toBeLessThan((corner() as HTMLElement).getBoundingClientRect().top);

        await letGoOnTheCorner(pointingHigh);
    });

    it("stops under the room names when it moves up", async () => {
        // The ghost shows which column a drag is in, and only the room names
        // say which room that column is.
        await mount([]);
        const view = scroller() as HTMLElement;

        // Scrolled first, because the header and the top of the room columns
        // sit at the same height only while the grid is at its start, and
        // anything measured from the columns drifts up from there.
        view.scrollTop = 400;

        // Clear of the band where the grid follows the pointer, so nothing
        // scrolls under these assertions while they run.
        const pointer = await carryBusyTo(
            view.getBoundingClientRect().top + view.getBoundingClientRect().height - 120,
        );

        const raised = noteRect();
        const names = (roomNames() as HTMLElement).getBoundingClientRect();

        expect(raised.top).toBeGreaterThanOrEqual(names.bottom);
        // Under them rather than merely somewhere below: a note measured off
        // anything that scrolls drifts away from the header it is clearing.
        expect(raised.top).toBeLessThan(names.bottom + 24);

        await letGoOnTheCorner(pointer);
    });
});

describe("the corner a gesture can be let go on", () => {
    it("offers to abandon a session that is not on the schedule yet", async () => {
        await mount([]);
        const pointer = await carryNewSession();

        expect(iconIn(corner())).toEqual("CloseIcon");

        await letGoOnTheCorner(pointer);
    });

    it("offers to unschedule one that is", async () => {
        await mount(placed);
        const pointer = mouse();
        const block = await page.getByText("Keynote").first().element();

        await pointer.down(centerOf(block));
        await pointer.move(middle);

        expect(iconIn(corner())).toEqual("DeleteOutlinedIcon");

        await letGoOnTheCorner(pointer);
    });

    it("takes the drop from the rooms once the pointer reaches it", async () => {
        await mount([]);
        const pointer = await carryNewSession();

        // Guards the assertion below: a ghost that was never drawn would go
        // missing over the corner for reasons that have nothing to do with it.
        expect(ghost()).not.toBeNull();

        const target = centerOf(corner() as HTMLElement);

        await pointer.move(target);

        expect(ghost()).toBeNull();

        await pointer.up(target);
    });

    it("is offered from the moment a new session is picked up", async () => {
        await mount([]);
        await page.getByRole("button", { name: "Open sessions to place" }).click();

        const entry = await page.getByText("Lightning talks").element();
        const pointer = mouse();
        const from = centerOf(entry);

        await pointer.down(from);

        expect(iconIn(corner())).toEqual("CloseIcon");

        await letGoOnTheCorner(pointer);
    });
});

describe("reaching the list with a finger", () => {
    afterEach(stopTouch);

    const openList = async () => {
        await page.getByRole("button", { name: "Open sessions to place" }).click();

        return centerOf(await page.getByText("Lightning talks").element());
    };

    // The list fills the screen here, so a finger that carried a session the
    // moment it landed would leave nothing to scroll the list by, and every
    // attempt at scrolling would dismiss the dialog with nothing picked up.
    it("scrolls the list rather than carrying what it landed on", async () => {
        await mount([]);
        const from = await openList();
        const input = await touch();
        const list = document.querySelector<HTMLElement>(
            '.MuiDialog-paper [data-testid="unscheduled-list"]',
        );

        if (list === null) {
            throw new Error("the dialog has no list to scroll");
        }

        assertScrollable(list);

        await input.down(from);
        await input.move({ x: from.x, y: from.y - 60 });
        await input.move({ x: from.x, y: from.y - 120 });
        await input.up({ x: from.x, y: from.y - 120 });
        await wait(100);

        expect(list.scrollTop).toBeGreaterThan(0);
        expect(onShow(page.getByText("To place"))).toBe(true);
        expect(corner()).toBeNull();
    });

    it("carries a session that was held first, and takes the list away", async () => {
        await mount([]);
        const from = await openList();
        const input = await touch();

        await input.down(from);
        await wait(500);

        expect(iconIn(corner())).toEqual("CloseIcon");

        await input.move({ x: middle.x, y: middle.y });
        await input.move({ x: middle.x + 4, y: middle.y });

        expect(onShow(page.getByText("To place"))).toBe(false);

        const target = centerOf(corner() as HTMLElement);

        await input.move(target);
        await input.up(target);

        // Abandoned rather than merely let go of: the corner goes with the
        // gesture, and the list stays away until it is asked for again.
        expect(corner()).toBeNull();
        expect(onShow(page.getByText("To place"))).toBe(false);
    });
});

describe("what a changed length writes", () => {
    beforeEach(() => {
        updateSlot.mockClear();
    });

    const openDetail = async () => {
        const pointer = mouse();
        const block = await page.getByText("Keynote").first().element();

        await pointer.down(centerOf(block));
        await pointer.up(centerOf(block));

        return page.getByRole("textbox", { name: /Length/ });
    };

    it("moves the end and leaves the start where it was", async () => {
        await mount(placed);
        const length = await openDetail();

        await length.clear();
        await length.fill("90");
        await userEvent.tab();
        await page.getByRole("button", { name: "Save" }).click();

        const [values] = updateSlot.mock.lastCall as [Record<string, unknown>];

        expect(values.slotId).toEqual("slot-keynote");
        expect(values.locationId).toEqual("room-a");
        expect((values.startsAt as Temporal.Instant).toString()).toEqual(at("10:00").toString());
        expect((values.endsAt as Temporal.Instant).toString()).toEqual(at("11:30").toString());
    });

    // A draft refetches on its own and after every write, so another organizer's
    // change can land under an open dialog. Seeded once, the fields would keep
    // the numbers they opened with and saving would write that change back out.
    it("starts again when the slot changes underneath", async () => {
        const screen = await mount(placed);
        const length = await openDetail();

        await length.clear();
        await length.fill("90");
        await userEvent.tab();

        await screen.rerender(
            <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
                <Container sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <ScheduleEditor
                        editionId="edition"
                        axis={axis}
                        locations={locations}
                        venues={[]}
                        draft={draftOf([{ ...placed[0], endsAt: at("10:30") } as Slot])}
                        sessions={sessions}
                        schedules={[] as unknown as ScheduleSummary[]}
                        unpublishedChanges
                        picker={null}
                    />
                </Container>
            </div>,
        );

        await expect.element(page.getByRole("textbox", { name: /Length/ })).toHaveValue("30");
    });
});
