import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import {
    buildScheduleAxis,
    type Collision,
    type SlotShape,
} from "#/components/ScheduleGrid/index.js";
import type { Location } from "#/queries/location.js";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import { SlotDetail } from "#/routes/_user/manage/$editionId/schedule/-components/SlotDetail.tsx";
import { durationToMinutes } from "#/utils/duration.ts";
import { createTestTheme } from "../../../support/theme.ts";

const berlin = "Europe/Berlin";

/** Longer than the slot it is placed at, so the two are told apart. */
const asksForNinety = {
    id: "session-subject",
    title: "Closing panel",
    hosts: [],
    duration: Temporal.Duration.from({ minutes: 90 }),
    setupTime: null,
    teardownTime: null,
    sessionType: { defaultDuration: Temporal.Duration.from({ minutes: 30 }) },
} as unknown as SlottableSession;

const axis = buildScheduleAxis(
    Temporal.PlainDate.from("2026-11-22"),
    Temporal.PlainDate.from("2026-11-22"),
    berlin,
);
const theme = createTestTheme();

beforeEach(() => {
    window.localStorage.setItem("preferredLocale", "en-US");
});

type ProvidersProps = {
    children: ReactNode;
};

const Providers = ({ children }: ProvidersProps): ReactNode => (
    <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocaleProvider>{children}</LocaleProvider>
    </ThemeProvider>
);

const rooms = [
    { id: "room-a", name: "Room A", externalKey: null, availabilities: [] },
    { id: "room-b", name: "Room B", externalKey: null, availabilities: [] },
    { id: "hall", name: "Main hall", externalKey: null, availabilities: [] },
] as unknown as Location[];

type SlotAt = {
    id: string;
    locationId: string;
    /** Clock time on 2026-11-22 in Berlin, which no clock change falls on. */
    from: string;
    to: string;
    title: string;
};

const at = (time: string): Temporal.Instant =>
    Temporal.ZonedDateTime.from(`2026-11-22T${time}[${berlin}]`).toInstant();

const slotAt = ({ id, locationId, from, to, title }: SlotAt): Slot =>
    ({
        id,
        stableId: id,
        startsAt: at(from),
        endsAt: at(to),
        setupTime: Temporal.Duration.from({ minutes: 0 }),
        teardownTime: Temporal.Duration.from({ minutes: 0 }),
        session: { id: `session-${id}`, title, state: "confirmed" },
        location: { id: locationId },
    }) as Slot;

const subject = slotAt({
    id: "subject",
    locationId: "hall",
    from: "10:00",
    to: "11:00",
    title: "Closing panel",
});

const mount = async (collisions: Collision[]) => {
    const screen = await render(
        <SlotDetail
            slot={subject}
            session={undefined}
            axis={axis}
            slots={[subject]}
            locations={rooms}
            collisions={collisions}
            timeZone={berlin}
            removing={false}
            saving={false}
            onRemove={vi.fn()}
            onSave={vi.fn()}
            onClose={vi.fn()}
        />,
        { wrapper: Providers },
    );

    return {
        /** Dialog content renders in a portal, so this reads the document. */
        lines: () =>
            Array.from(document.querySelectorAll<HTMLElement>(".MuiAlert-message p")).map(
                (line) => line.textContent ?? "",
            ),
        alerts: () => document.querySelectorAll(".MuiAlert-root").length,
        screen,
    };
};

describe("the clashes a slot detail names", () => {
    it("says nothing when the slot clashes with nobody", async () => {
        const harness = await mount([]);

        expect(harness.alerts()).toBe(0);
    });

    it("tells two rooms apart when the same session clashes from both", async () => {
        const harness = await mount([
            {
                slot: slotAt({
                    id: "in-a",
                    locationId: "room-a",
                    from: "10:00",
                    to: "11:00",
                    title: "Registration",
                }),
                hostNames: ["Ada Lovelace"],
                marginOnly: false,
            },
            {
                slot: slotAt({
                    id: "in-b",
                    locationId: "room-b",
                    from: "10:00",
                    to: "11:00",
                    title: "Registration",
                }),
                hostNames: ["Ada Lovelace"],
                marginOnly: false,
            },
        ]);

        const lines = harness.lines();
        expect(lines).toHaveLength(2);
        expect(lines[0]).not.toBe(lines[1]);
        expect(lines[0]).toContain("Room A");
        expect(lines[1]).toContain("Room B");
    });

    it("names every host the two sessions share", async () => {
        const harness = await mount([
            {
                slot: slotAt({
                    id: "other",
                    locationId: "room-a",
                    from: "10:30",
                    to: "11:30",
                    title: "Workshop",
                }),
                hostNames: ["Ada Lovelace", "Grace Hopper"],
                marginOnly: false,
            },
        ]);

        expect(harness.lines()[0]).toBe(
            'Also booked: Ada Lovelace and Grace Hopper on "Workshop" in Room A at 10:30 AM',
        );
    });

    it("explains a clash the margins make and the clock does not show", async () => {
        const harness = await mount([
            {
                slot: slotAt({
                    id: "other",
                    locationId: "room-a",
                    from: "11:15",
                    to: "12:00",
                    title: "Workshop",
                }),
                hostNames: ["Ada Lovelace"],
                marginOnly: true,
            },
        ]);

        const line = harness.lines()[0];
        expect(line).toContain("11:15 AM");
        expect(line).toContain("setup or teardown either side overlaps");
    });
});

describe("changing how long a slot runs", () => {
    const withNeighbor = async (session?: SlottableSession) => {
        const onSave = vi.fn();
        const neighbor = slotAt({
            id: "next",
            locationId: "hall",
            from: "11:30",
            to: "12:30",
            title: "Lightning talks",
        });

        await render(
            <SlotDetail
                slot={subject}
                session={session}
                axis={axis}
                slots={[subject, neighbor]}
                locations={rooms}
                collisions={[]}
                timeZone={berlin}
                removing={false}
                saving={false}
                onRemove={vi.fn()}
                onSave={onSave}
                onClose={vi.fn()}
            />,
            { wrapper: Providers },
        );

        return { onSave };
    };

    const length = () => page.getByRole("textbox", { name: /Length/ });
    const setup = () => page.getByRole("textbox", { name: /Setup/ });

    /**
     * Replaces the minutes in the length field and leaves it.
     *
     * Cleared first because filling this one appends rather than replaces. The
     * clear never reaches React: it blanks the text so the fill that follows
     * starts from nothing. Leaving the field afterwards is what clamps and
     * reformats the number, not what commits it.
     */
    const typeLength = async (minutes: string) => {
        await length().clear();
        await length().fill(minutes);
        await userEvent.tab();
    };
    const save = () => page.getByRole("button", { name: "Save" });

    it("offers nothing to save until something changes", async () => {
        await withNeighbor();

        await expect.element(save()).toBeDisabled();
    });

    it("saves a length the room has time for", async () => {
        const { onSave } = await withNeighbor();

        await typeLength("75");
        await save().click();

        expect(durationToMinutes((onSave.mock.lastCall as [Slot, SlotShape])[1].length)).toEqual(
            75,
        );
    });

    it("holds still while a field is empty", async () => {
        const { onSave } = await withNeighbor();

        // Emptied by real keys rather than by `clear`, which blanks the text
        // without the form hearing of it.
        await length().click();
        await userEvent.keyboard("{Control>}a{/Control}{Backspace}");

        await expect.element(save()).toBeDisabled();
        expect(onSave).not.toHaveBeenCalled();
        // Still standing: reading a shape out of that emptiness would take the
        // whole dialog down, and every other field with it.
        await expect.element(page.getByRole("dialog")).toBeVisible();
    });

    it("refuses a length of nothing", async () => {
        const { onSave } = await withNeighbor();

        await typeLength("0");

        await expect.element(page.getByText(/needs a length/i)).toBeVisible();
        await expect.element(save()).toBeDisabled();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("saves the margins that were typed, not the ones it opened with", async () => {
        const { onSave } = await withNeighbor();

        await setup().clear();
        await setup().fill("20");
        await userEvent.tab();
        await save().click();

        const [, saved] = onSave.mock.lastCall as [Slot, SlotShape];

        expect(durationToMinutes(saved.setupTime)).toEqual(20);
        expect(durationToMinutes(saved.length)).toEqual(60);
    });

    it("says what the session asks for, and puts it back", async () => {
        const { onSave } = await withNeighbor(asksForNinety);

        await expect.element(page.getByText("Session asks for 90 min")).toBeVisible();

        await page.getByRole("button", { name: "Use the session's" }).click();
        await save().click();

        expect(durationToMinutes((onSave.mock.lastCall as [Slot, SlotShape])[1].length)).toEqual(
            90,
        );
    });

    it("refuses one that reaches into the next session, and says so", async () => {
        const { onSave } = await withNeighbor();

        await typeLength("120");

        await expect.element(page.getByText(/Overlaps "?Lightning talks/)).toBeVisible();
        await expect.element(save()).toBeDisabled();
        expect(onSave).not.toHaveBeenCalled();
    });
});
