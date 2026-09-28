import { Paper } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { isAfter } from "temporal-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AvailabilityField } from "#/components/AvailabilityField/AvailabilityField.tsx";
import { buildGrid } from "#/components/AvailabilityField/geometry.ts";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import {
    mouse,
    type Point,
    type PointerInput,
    stopTouch,
    touch,
    wait,
} from "../../support/browser-input.ts";
import { createTestTheme } from "../../support/theme.ts";
import { restoreViewportAfterEach } from "../../support/viewport.ts";

const berlin = "Europe/Berlin";
const theme = createTestTheme();

// Every label these tests read is formatted by the locale, so the machine's own
// would decide what they assert. Pinned through the same stored preference a
// user sets, rather than around it.
beforeEach(() => {
    window.localStorage.setItem("preferredLocale", "en-US");
});

type ProvidersProps = {
    children: ReactNode;
};

const Providers = ({ children }: ProvidersProps): ReactNode => (
    <ThemeProvider theme={theme}>
        <LocaleProvider>{children}</LocaleProvider>
    </ThemeProvider>
);

type Edition = {
    startDate: Temporal.PlainDate;
    endDate: Temporal.PlainDate;
    timeZone: string;
};

const november: Edition = {
    startDate: Temporal.PlainDate.from("2026-11-22"),
    endDate: Temporal.PlainDate.from("2026-11-24"),
    timeZone: berlin,
};

// 2027-03-28 is the spring forward, and sits in the middle of this one.
const springForward: Edition = {
    startDate: Temporal.PlainDate.from("2027-03-27"),
    endDate: Temporal.PlainDate.from("2027-03-29"),
    timeZone: berlin,
};

const fallBack: Edition = {
    startDate: Temporal.PlainDate.from("2027-10-30"),
    endDate: Temporal.PlainDate.from("2027-11-01"),
    timeZone: berlin,
};

const instantAt = (
    edition: Edition,
    dayOffset: number,
    hour: number,
    minute = 0,
): Temporal.Instant =>
    edition.startDate
        .add({ days: dayOffset })
        .toPlainDateTime({ hour, minute })
        .toZonedDateTime(edition.timeZone)
        .toInstant();

const readable =
    (edition: Edition) =>
    (interval: AvailabilityInterval): string => {
        const from = interval.startsAt.toZonedDateTimeISO(edition.timeZone).toPlainDateTime();
        const to = interval.endsAt.toZonedDateTimeISO(edition.timeZone).toPlainDateTime();

        return `${from.toString()} - ${to.toString()}`;
    };

type Harness = {
    onValueChange: ReturnType<typeof vi.fn>;
    columnAt: (dayIndex: number) => HTMLElement;
    blocks: () => HTMLElement[];
    scroller: HTMLElement;
    showColumn: (dayIndex: number) => void;
    pointAt: (dayIndex: number, minutes: number) => Point;
    /** What the field last reported, one readable line per interval. */
    committed: () => string[];
    isOverSkippedHour: (dayIndex: number, point: Point) => boolean;
};

type ControlledProps = {
    edition: Edition;
    initial: readonly AvailabilityInterval[];
    report: (value: AvailabilityInterval[]) => void;
};

const Controlled = ({ edition, initial, report }: ControlledProps): ReactNode => {
    const [value, setValue] = useState<readonly AvailabilityInterval[]>(initial);
    const [shown, setShown] = useState(edition);

    return (
        <>
            <input aria-label="Name" />

            {/* Stands in for the edition being moved under an open form. */}
            <button
                type="button"
                onClick={() => {
                    setShown(fallBack);
                }}
            >
                Move the edition
            </button>

            <AvailabilityField
                emptyText="Usable at any time during the edition."
                drawnText="Usable only at the times drawn below."
                value={value}
                onValueChange={(next) => {
                    setValue(next);
                    report(next);
                }}
                startDate={shown.startDate}
                endDate={shown.endDate}
                timeZone={shown.timeZone}
            />
        </>
    );
};

const mount = async (
    edition: Edition,
    initial: readonly AvailabilityInterval[] = [],
): Promise<Harness> => {
    const onValueChange = vi.fn();
    const screen = await render(
        <Controlled edition={edition} initial={initial} report={onValueChange} />,
        { wrapper: Providers },
    );

    const columnAt = (dayIndex: number): HTMLElement => {
        const column = screen.container.querySelector<HTMLElement>(
            `[data-testid="availability-day-${dayIndex}"]`,
        );

        if (!column) {
            throw new Error(`no column for day ${dayIndex}`);
        }

        return column;
    };

    const scroller = screen.container.querySelector<HTMLElement>(
        '[data-testid="availability-scroller"]',
    );

    if (!scroller) {
        throw new Error("no scroller");
    }

    return {
        onValueChange,
        columnAt,
        scroller,
        blocks: () =>
            Array.from(
                screen.container.querySelectorAll<HTMLElement>(
                    '[data-testid="availability-block"]',
                ),
            ),
        showColumn: (dayIndex) => {
            const column = columnAt(dayIndex).getBoundingClientRect();
            const view = scroller.getBoundingClientRect();

            scroller.scrollLeft += column.left - view.left - (view.width - column.width) / 2;
        },
        pointAt: (dayIndex, minutes) => {
            const rect = columnAt(dayIndex).getBoundingClientRect();
            const { minutesPerColumn } = buildGrid(
                edition.startDate,
                edition.endDate,
                edition.timeZone,
            ).axis;

            return {
                x: rect.left + rect.width / 2,
                y: rect.top + (minutes / minutesPerColumn) * rect.height,
            };
        },
        committed: () => {
            const last: AvailabilityInterval[] = onValueChange.mock.lastCall?.[0] ?? [];

            return last.map(readable(edition));
        },
        isOverSkippedHour: (dayIndex, point) => {
            const shaded = columnAt(dayIndex).querySelector("[title]")?.getBoundingClientRect();

            return (
                shaded !== undefined &&
                point.x >= shaded.left &&
                point.x < shaded.right &&
                point.y >= shaded.top &&
                point.y < shaded.bottom
            );
        },
    };
};

const drag = async (input: PointerInput, from: Point, ...through: Point[]): Promise<void> => {
    await input.down(from);

    for (const point of through) {
        await input.move(point);
    }

    await input.up(through.at(-1) ?? from);
};

const HEADER_HEIGHT = 44;
// The same number as the header today, kept apart because scrolling by rows and
// measuring against the header are different questions.
const ROW_HEIGHT = 44;

type HourLabels = {
    /** Every hour label in the gutter, whether the header reaches it or not. */
    all: string[];
    /** The ones the header cuts in half wherever the grid is scrolled to. */
    cut: string[];
};

const hourLabels = (scroller: HTMLElement): HourLabels => {
    const view = scroller.getBoundingClientRect();
    const all = Array.from(scroller.querySelectorAll("*")).filter(
        (element) =>
            element.children.length === 0 &&
            /^\d{1,2}:\d{2}\s?[AP]M$/.test(element.textContent ?? ""),
    );

    const cut = all.filter((element) => {
        const rect = element.getBoundingClientRect();

        return rect.top - view.top < HEADER_HEIGHT && rect.bottom - view.top > HEADER_HEIGHT;
    });

    return {
        all: all.map((element) => element.textContent ?? ""),
        cut: cut.map((element) => element.textContent ?? ""),
    };
};

const settled = (): Promise<void> =>
    new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });

const click = async (input: PointerInput, point: Point): Promise<void> => {
    await input.down(point);
    await input.up(point);
};

describe("drawing with a mouse", () => {
    it("starts a block at the slot the press was inside", async () => {
        const harness = await mount(november);

        await click(mouse(), harness.pointAt(0, 9 * 60 + 50));

        expect(harness.committed()).toEqual(["2026-11-22T09:30:00 - 2026-11-22T10:00:00"]);
    });

    // The line explains what an empty grid means, so it has to go once a block
    // exists. Taking it away would move the grid, and the first block is drawn
    // by a pointer that is still over the grid when it goes.
    it("holds the grid still as the first block appears", async () => {
        const harness = await mount(november);
        const before = harness.scroller.getBoundingClientRect().top;

        await click(mouse(), harness.pointAt(0, 9 * 60));
        await settled();

        expect(harness.committed()).toHaveLength(1);
        expect(harness.scroller.getBoundingClientRect().top).toBeCloseTo(before, 0);
    });

    // Every slot the gesture was inside, so which end it started from cannot
    // change what it covered.
    it.each([
        { named: "downward", first: 9 * 60 + 50, second: 10 * 60 + 10 },
        { named: "upward", first: 10 * 60 + 10, second: 9 * 60 + 50 },
    ])("covers each slot a drag touched, drawn $named", async ({ first, second }) => {
        const harness = await mount(november);

        await drag(mouse(), harness.pointAt(0, first), harness.pointAt(0, second));

        expect(harness.committed()).toEqual(["2026-11-22T09:30:00 - 2026-11-22T10:30:00"]);
    });

    it("stops a drag at the line it was released on", async () => {
        const harness = await mount(november);

        await drag(mouse(), harness.pointAt(0, 9 * 60), harness.pointAt(0, 10 * 60));

        expect(harness.committed()).toEqual(["2026-11-22T09:00:00 - 2026-11-22T10:00:00"]);
    });

    it("draws nothing from a press whose pointer the grid can no longer capture", async () => {
        const harness = await mount(november);
        const capture = vi
            .spyOn(Element.prototype, "setPointerCapture")
            .mockImplementationOnce(() => {
                throw new DOMException("The pointer is no longer active", "NotFoundError");
            });

        try {
            await drag(mouse(), harness.pointAt(0, 9 * 60), harness.pointAt(0, 10 * 60));
            expect(harness.onValueChange).not.toHaveBeenCalled();
        } finally {
            capture.mockRestore();
        }

        await drag(mouse(), harness.pointAt(0, 12 * 60), harness.pointAt(0, 13 * 60));
        expect(harness.committed()).toEqual(["2026-11-22T12:00:00 - 2026-11-22T13:00:00"]);
    });

    it("draws a block over the stretch the pointer covered", async () => {
        const harness = await mount(november);

        await drag(
            mouse(),
            harness.pointAt(0, 9 * 60),
            harness.pointAt(0, 10 * 60),
            harness.pointAt(0, 11 * 60),
        );

        expect(harness.committed()).toEqual(["2026-11-22T09:00:00 - 2026-11-22T11:00:00"]);
    });

    it.each([0, 1, 2])("draws in the column the press started in (%i)", async (dayIndex) => {
        const harness = await mount(november);

        harness.showColumn(dayIndex);

        await drag(mouse(), harness.pointAt(dayIndex, 9 * 60), harness.pointAt(dayIndex, 10 * 60));

        const day = 22 + dayIndex;

        expect(harness.committed()).toEqual([`2026-11-${day}T09:00:00 - 2026-11-${day}T10:00:00`]);
    });

    it.each([0, 2])(
        "lands a tap in the last half hour on the day it was made (%i)",
        async (dayIndex) => {
            const harness = await mount(november);

            harness.scroller.scrollTop = harness.scroller.scrollHeight;
            harness.showColumn(dayIndex);

            const rect = harness.columnAt(dayIndex).getBoundingClientRect();

            await click(mouse(), { x: rect.left + rect.width / 2, y: rect.bottom - 2 });

            const day = 22 + dayIndex;

            expect(harness.committed()).toEqual([
                `2026-11-${day}T23:30:00 - 2026-11-${day + 1}T00:00:00`,
            ]);
        },
    );

    it("moves a block by the distance the pointer traveled", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await drag(
            mouse(),
            harness.pointAt(0, 11 * 60),
            harness.pointAt(0, 12 * 60),
            harness.pointAt(0, 13 * 60),
        );

        expect(harness.committed()).toEqual(["2026-11-22T12:00:00 - 2026-11-22T14:00:00"]);
    });

    it("keeps a moved block in the column it was dropped in", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await drag(
            mouse(),
            harness.pointAt(0, 11 * 60),
            harness.pointAt(1, 11 * 60),
            harness.pointAt(1, 11 * 60 + 30),
        );

        expect(harness.committed()).toEqual(["2026-11-23T10:30:00 - 2026-11-23T12:30:00"]);
    });

    it("resizes a block from its end edge", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await drag(
            mouse(),
            harness.pointAt(0, 12 * 60),
            harness.pointAt(0, 12 * 60 + 30),
            harness.pointAt(0, 13 * 60),
        );

        expect(harness.committed()).toEqual(["2026-11-22T10:00:00 - 2026-11-22T13:00:00"]);
    });

    it("takes the whole slot an edge was dragged into", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await drag(
            mouse(),
            harness.pointAt(0, 12 * 60),
            harness.pointAt(0, 12 * 60 + 20),
            harness.pointAt(0, 12 * 60 + 40),
        );

        expect(harness.committed()).toEqual(["2026-11-22T10:00:00 - 2026-11-22T13:00:00"]);
    });

    it("pulls a start edge back to the top of the slot it reached", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await drag(
            mouse(),
            harness.pointAt(0, 10 * 60),
            harness.pointAt(0, 9 * 60 + 50),
            harness.pointAt(0, 9 * 60 + 40),
        );

        expect(harness.committed()).toEqual(["2026-11-22T09:30:00 - 2026-11-22T12:00:00"]);
    });

    it("follows a gesture held against the bottom edge", async () => {
        const harness = await mount(november);

        harness.scroller.scrollTop = 0;

        const rect = harness.scroller.getBoundingClientRect();
        const column = harness.columnAt(0).getBoundingClientRect();
        const x = column.left + column.width / 2;
        const middle = rect.top + rect.height / 2;
        const edge = rect.bottom - 10;
        const input = mouse();

        await input.down({ x, y: middle });
        await input.move({ x, y: middle + 20 });
        await input.move({ x, y: edge });

        // Waiting on the distance rather than on a stopwatch, since how far it
        // gets in a given moment is up to the frame budget.
        await expect.poll(() => harness.scroller.scrollTop, { timeout: 2000 }).toBeGreaterThan(100);

        await input.up({ x, y: edge });

        const [interval]: AvailabilityInterval[] = harness.onValueChange.mock.lastCall?.[0] ?? [];
        const drawnTo = interval.endsAt.toZonedDateTimeISO(berlin).toPlainTime();

        expect(harness.onValueChange).toHaveBeenCalledTimes(1);
        expect(isAfter(drawnTo, Temporal.PlainTime.from("11:30"))).toBe(true);
    });

    // Forty pixels from the edge, the grid asks for twelve pixels a second, a
    // fifth of a pixel per frame at 60 fps. Chrome snaps every scrollTop write
    // to a whole pixel at a pixel ratio of 1, so those steps only add up if the
    // fractions carry over.
    it("follows a gesture resting in the slow outer part of the edge", async () => {
        const harness = await mount(november);

        harness.scroller.scrollTop = 0;

        const rect = harness.scroller.getBoundingClientRect();
        const column = harness.columnAt(0).getBoundingClientRect();
        const x = column.left + column.width / 2;
        const middle = rect.top + rect.height / 2;
        const outer = rect.bottom - 40;
        const input = mouse();

        await input.down({ x, y: middle });
        await input.move({ x, y: middle + 20 });
        await input.move({ x, y: outer });

        await expect.poll(() => harness.scroller.scrollTop, { timeout: 2000 }).toBeGreaterThan(5);

        await input.up({ x, y: outer });
    });

    // Every pixel the grid follows renders it again, and on a slow device that
    // render outlasts a frame. Chrome's CPU is throttled here so the follow has
    // to keep moving across those renders.
    it("follows a gesture held against the bottom edge on a slow device", async () => {
        const harness = await mount(november);

        harness.scroller.scrollTop = 0;

        const rect = harness.scroller.getBoundingClientRect();
        const column = harness.columnAt(0).getBoundingClientRect();
        const x = column.left + column.width / 2;
        const middle = rect.top + rect.height / 2;
        const edge = rect.bottom - 10;
        const input = mouse();

        await cdp().send("Emulation.setCPUThrottlingRate", { rate: 20 });

        try {
            await input.down({ x, y: middle });
            await input.move({ x, y: middle + 20 });
            await input.move({ x, y: edge });

            await expect
                .poll(() => harness.scroller.scrollTop, { timeout: 5000 })
                .toBeGreaterThan(100);

            await input.up({ x, y: edge });
        } finally {
            await cdp().send("Emulation.setCPUThrottlingRate", { rate: 1 });
        }
    });
});

describe("removing a block", () => {
    it("arms a block on the first click and removes it on the second", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);
        const input = mouse();

        await click(input, harness.pointAt(0, 11 * 60));

        expect(harness.onValueChange).not.toHaveBeenCalled();
        expect(harness.blocks()[0].querySelector("svg")).not.toBeNull();

        await click(input, harness.pointAt(0, 11 * 60));

        expect(harness.committed()).toEqual([]);
        expect(harness.blocks()).toHaveLength(0);
    });

    it("removes an armed block on Delete", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);

        await click(mouse(), harness.pointAt(0, 11 * 60));

        expect(harness.blocks()[0].querySelector("svg")).not.toBeNull();

        await userEvent.keyboard("{Delete}");

        expect(harness.onValueChange).toHaveBeenCalledWith([]);
        expect(harness.blocks()).toHaveLength(0);
    });

    it("leaves an armed block alone while a field is being typed into", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 0, 10), endsAt: instantAt(november, 0, 12) },
        ]);
        const field = document.querySelector("input");

        if (!field) {
            throw new Error("no field");
        }

        await click(mouse(), harness.pointAt(0, 11 * 60));

        expect(harness.blocks()[0].querySelector("svg")).not.toBeNull();

        await userEvent.click(field);
        await userEvent.keyboard("{Backspace}{Delete}");

        expect(harness.onValueChange).not.toHaveBeenCalled();
        expect(harness.blocks()).toHaveLength(1);
    });
});

describe("the edges of a day", () => {
    it("holds a block dragged up off midnight on its own day", async () => {
        const harness = await mount(november, [
            { startsAt: instantAt(november, 1, 0), endsAt: instantAt(november, 1, 4, 30) },
        ]);

        harness.scroller.scrollTop = 0;

        harness.showColumn(1);

        await drag(
            mouse(),
            harness.pointAt(1, 2 * 60),
            harness.pointAt(1, 60),
            harness.pointAt(1, 0),
        );

        expect(harness.committed()).toEqual(["2026-11-23T00:00:00 - 2026-11-23T04:30:00"]);
    });

    it("counts a block drawn across the skipped hour by the time it really covers", async () => {
        const harness = await mount(springForward);

        harness.scroller.scrollTop = 0;

        harness.showColumn(1);

        await drag(
            mouse(),
            harness.pointAt(1, 60),
            harness.pointAt(1, 2 * 60),
            harness.pointAt(1, 4 * 60),
        );

        const [interval]: AvailabilityInterval[] = harness.onValueChange.mock.lastCall?.[0] ?? [];

        expect(harness.committed()).toEqual(["2027-03-28T01:00:00 - 2027-03-28T04:00:00"]);
        expect(interval.endsAt.since(interval.startsAt).total({ unit: "hour" })).toBe(2);
    });

    it("leaves a drag wholly inside the skipped hour alone", async () => {
        const harness = await mount(springForward);

        harness.scroller.scrollTop = 0;

        harness.showColumn(1);

        const from = harness.pointAt(1, 2 * 60);
        const to = harness.pointAt(1, 2 * 60 + 30);

        expect(harness.isOverSkippedHour(1, from)).toBe(true);
        expect(harness.isOverSkippedHour(1, to)).toBe(true);

        await drag(mouse(), from, to);

        expect(harness.onValueChange).not.toHaveBeenCalled();
    });

    it.each([2 * 60, 2 * 60 + 30])(
        "leaves a tap in the skipped hour alone (%i)",
        async (minutes) => {
            const harness = await mount(springForward);

            harness.scroller.scrollTop = 0;

            harness.showColumn(1);

            const inTheSkip = harness.pointAt(1, minutes);

            expect(harness.isOverSkippedHour(1, inTheSkip)).toBe(true);

            await click(mouse(), inTheSkip);

            expect(harness.onValueChange).not.toHaveBeenCalled();
        },
    );

    // The row above the shading holds real time all the way down to it.
    it("takes a press in the half hour just above the skip", async () => {
        const harness = await mount(springForward);

        harness.scroller.scrollTop = 0;

        harness.showColumn(1);

        const justAbove = harness.pointAt(1, 105);

        expect(harness.isOverSkippedHour(1, justAbove)).toBe(false);

        await click(mouse(), justAbove);

        // Half an hour long, and it reads as ending at three because the clock
        // has no two on this day: the minute after 01:59 is 03:00.
        expect(harness.committed()).toEqual(["2027-03-28T01:30:00 - 2027-03-28T03:00:00"]);
    });

    it("still lands a tap on the minute the clocks jump to", async () => {
        const harness = await mount(springForward);

        harness.scroller.scrollTop = 0;

        harness.showColumn(1);

        await click(mouse(), harness.pointAt(1, 3 * 60));

        expect(harness.committed()).toEqual(["2027-03-28T03:00:00 - 2027-03-28T03:30:00"]);
    });
});

describe("the hour labels while the grid scrolls", () => {
    // Inside its row a label survives every such position whole, and is only
    // ever clipped part way through a scroll.
    it("stays whole wherever a row lines up with the header", async () => {
        const harness = await mount(november);
        const cut: string[] = [];
        let seen = 0;

        for (let row = 0; row < 12; row += 1) {
            harness.scroller.scrollTop = row * ROW_HEIGHT;
            await settled();

            const labels = hourLabels(harness.scroller);
            seen += labels.all.length;
            cut.push(...labels.cut);
        }

        // Without this the emptiness below passes on a gutter it never found:
        // the labels are matched by their formatted text, so anything that
        // stops them looking like a time empties the candidates instead of the
        // result.
        expect(seen).toBeGreaterThan(0);
        expect(cut).toEqual([]);
    });
});

describe("the surfaces that stay put while the grid scrolls", () => {
    // Two things at once: a dark theme lightens a Paper with an overlay that a
    // bare background color does not carry, so without it these read as darker
    // patches on the card; and they carry a tint of their own on top, so that a
    // label sliding under the header reads as one surface passing behind
    // another rather than as something broken.
    it("sits on the card's surface with a tint of its own", async () => {
        const dark = createTheme({
            cssVariables: { colorSchemeSelector: "class" },
            colorSchemes: { light: true, dark: true },
        });

        document.documentElement.classList.add("mui-dark");

        const screen = await render(
            <Paper sx={{ p: 3 }}>
                <AvailabilityField
                    emptyText="Usable at any time during the edition."
                    drawnText="Usable only at the times drawn below."
                    value={[]}
                    onValueChange={vi.fn()}
                    startDate={november.startDate}
                    endDate={november.endDate}
                    timeZone={november.timeZone}
                />
            </Paper>,
            {
                wrapper: ({ children }) => (
                    <ThemeProvider theme={dark} defaultMode="dark">
                        <LocaleProvider>{children}</LocaleProvider>
                    </ThemeProvider>
                ),
            },
        );

        const paper = screen.container.querySelector<HTMLElement>(".MuiPaper-root");
        const scroller = screen.container.querySelector<HTMLElement>(
            '[data-testid="availability-scroller"]',
        );

        if (!(paper && scroller)) {
            throw new Error("no paper");
        }

        const view = scroller.getBoundingClientRect();
        const corner = document.elementFromPoint(view.left + 30, view.top + 20);
        const behind = window.getComputedStyle(paper);
        const inFront = window.getComputedStyle(corner as Element);

        expect(inFront.backgroundColor).toBe(behind.backgroundColor);
        expect(inFront.backgroundImage.endsWith(behind.backgroundImage)).toBe(true);
        expect(inFront.backgroundImage).not.toBe(behind.backgroundImage);

        document.documentElement.classList.remove("mui-dark");
    });

    // A pixel past the row rather than on it, so the rule the row draws for
    // itself ends up behind the header rather than beside its border.
    it("opens one pixel past the eight o'clock row", async () => {
        const harness = await mount(november);

        await settled();

        expect(harness.scroller.scrollTop).toBe(8 * ROW_HEIGHT + 1);
    });
});

describe("a viewport too narrow to hold every day", () => {
    restoreViewportAfterEach();

    it("draws in the column the press started in once the grid scrolls sideways", async () => {
        await page.viewport(360, 640);

        const harness = await mount(november);

        harness.showColumn(2);

        expect(harness.scroller.scrollWidth).toBeGreaterThan(harness.scroller.clientWidth);
        expect(harness.scroller.scrollLeft).toBeGreaterThan(0);

        await drag(mouse(), harness.pointAt(2, 9 * 60), harness.pointAt(2, 10 * 60));

        expect(harness.committed()).toEqual(["2026-11-24T09:00:00 - 2026-11-24T10:00:00"]);
    });
});

describe("the day the clocks go back", () => {
    // The two readings have a row each, so which one an edge lands on is a
    // matter of where it was put rather than of a rule about ambiguity.
    it.each([
        { endRow: 2, hours: 1, endsOn: "+02:00" },
        { endRow: 3, hours: 2, endsOn: "+01:00" },
        { endRow: 4, hours: 3, endsOn: "+01:00" },
    ])("ends on the row it was dragged to (row $endRow)", async ({ endRow, hours, endsOn }) => {
        const harness = await mount(fallBack);

        harness.scroller.scrollTop = 0;
        harness.showColumn(1);

        await drag(
            mouse(),
            harness.pointAt(1, 60),
            harness.pointAt(1, 90),
            harness.pointAt(1, endRow * 60),
        );

        const [interval]: AvailabilityInterval[] = harness.onValueChange.mock.lastCall?.[0] ?? [];

        expect(interval.startsAt.toZonedDateTimeISO(berlin).offset).toBe("+02:00");
        expect(interval.endsAt.toZonedDateTimeISO(berlin).offset).toBe(endsOn);
        expect(interval.endsAt.since(interval.startsAt).total({ unit: "hour" })).toBe(hours);
    });

    // The rows above it absorb a wrong column width at four percent an hour,
    // so only a row far enough down the column moves by more than the snap.
    it("reads a press in the evening off the right row", async () => {
        const harness = await mount(fallBack);

        harness.showColumn(1);
        harness.scroller.scrollTop = 700;
        await settled();

        await click(mouse(), harness.pointAt(1, 20 * 60));

        expect(harness.committed()).toEqual(["2027-10-31T19:00:00 - 2027-10-31T19:30:00"]);
    });

    it("moves a block by the rows the pointer traveled", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 1, 10), endsAt: instantAt(fallBack, 1, 12) },
        ]);

        harness.showColumn(1);
        harness.scroller.scrollTop = 400;
        await settled();

        await drag(
            mouse(),
            harness.pointAt(1, 12 * 60),
            harness.pointAt(1, 13 * 60),
            harness.pointAt(1, 14 * 60),
        );

        expect(harness.committed()).toEqual(["2027-10-31T12:00:00 - 2027-10-31T14:00:00"]);
    });

    // The extra row is an extra hour of column, so a block pushed past the
    // bottom settles an hour later than a day's worth of rows would allow.
    it("stops a block dragged past the bottom at the column's last row", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 1, 10), endsAt: instantAt(fallBack, 1, 12) },
        ]);

        harness.showColumn(1);
        harness.scroller.scrollTop = 400;
        await settled();

        await drag(
            mouse(),
            harness.pointAt(1, 12 * 60),
            harness.pointAt(1, 20 * 60),
            harness.pointAt(1, 30 * 60),
        );

        expect(harness.committed()).toEqual(["2027-10-31T22:00:00 - 2027-11-01T00:00:00"]);
    });

    // Which day a block sits on is the column's answer, not a day's: this one
    // starts past the twenty fourth hour and still belongs to the first column.
    it("resizes a block held in the first column's last hour", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 0, 23), endsAt: instantAt(fallBack, 0, 23, 30) },
        ]);

        harness.showColumn(0);
        harness.scroller.scrollTop = 700;
        await settled();

        await drag(
            mouse(),
            harness.pointAt(0, 24 * 60 + 30),
            harness.pointAt(0, 24 * 60 + 45),
            harness.pointAt(0, 25 * 60),
        );

        expect(harness.committed()).toEqual(["2027-10-30T23:00:00 - 2027-10-31T00:00:00"]);
    });

    // Day zero hides a wrong column width, since its start is nought either
    // way. A later column is where the two disagree.
    it("resizes a block in a later column by the rows it was dragged", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 1, 10), endsAt: instantAt(fallBack, 1, 12) },
        ]);

        harness.showColumn(1);
        harness.scroller.scrollTop = 400;
        await settled();

        await drag(
            mouse(),
            harness.pointAt(1, 13 * 60),
            harness.pointAt(1, 14 * 60),
            harness.pointAt(1, 15 * 60),
        );

        expect(harness.committed()).toEqual(["2027-10-31T10:00:00 - 2027-10-31T14:00:00"]);
    });

    // Drawn to where the shaded row begins, since the hour past it is one this
    // day never reads. On the last column rather than the first, whose start is
    // nought whatever the width.
    it("ends a stored block where the row the day lacks begins", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 2, 1), endsAt: instantAt(fallBack, 2, 2) },
        ]);

        harness.scroller.scrollTop = 0;
        harness.showColumn(2);

        const column = harness.columnAt(2).getBoundingClientRect();
        const block = harness.blocks()[0].getBoundingClientRect();

        expect(harness.blocks()).toHaveLength(1);
        expect(block.height).toBeCloseTo(column.height / 25, 0);
        expect(block.top - column.top).toBeCloseTo(column.height / 25, 0);
    });

    it("draws a block past the twenty fourth hour in the column it belongs to", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 0, 23), endsAt: instantAt(fallBack, 0, 23, 30) },
        ]);

        harness.scroller.scrollTop = 0;

        const first = harness.columnAt(0).getBoundingClientRect();
        const block = harness.blocks()[0].getBoundingClientRect();

        expect(harness.blocks()).toHaveLength(1);
        expect(block.left).toBeGreaterThanOrEqual(first.left);
        expect(block.right).toBeLessThanOrEqual(first.right);
    });

    // The preview draws from its own arithmetic, so it can disagree with what
    // the release commits. Read while the pointer is still down.
    it("previews a drag on the rows it is over", async () => {
        const harness = await mount(fallBack);
        const input = mouse();

        harness.showColumn(1);
        harness.scroller.scrollTop = 400;
        await settled();

        await input.down(harness.pointAt(1, 11 * 60));
        await input.move(harness.pointAt(1, 12 * 60));
        await input.move(harness.pointAt(1, 13 * 60));

        const column = harness.columnAt(1).getBoundingClientRect();
        const preview = harness.blocks()[0].getBoundingClientRect();

        expect(harness.blocks()[0].textContent).toBe("10:00 AM – 12:00 PM");
        expect(preview.top - column.top).toBeCloseTo((11 * column.height) / 25, 0);

        await input.up(harness.pointAt(1, 13 * 60));
    });

    it("previews an end at the row the day lacks where it begins", async () => {
        const harness = await mount(fallBack);
        const input = mouse();

        harness.scroller.scrollTop = 0;
        harness.showColumn(2);

        await input.down(harness.pointAt(2, 60));
        await input.move(harness.pointAt(2, 120));
        await input.move(harness.pointAt(2, 180));

        const column = harness.columnAt(2).getBoundingClientRect();
        const preview = harness.blocks()[0].getBoundingClientRect();

        expect(preview.height).toBeCloseTo(column.height / 25, 0);

        await input.up(harness.pointAt(2, 180));
    });

    // Everything the grid measures is derived from the dates it was given, so
    // a form open while the edition moves has to follow rather than keep the
    // width it started with.
    it("reads a press off the new axis after the edition moves", async () => {
        const harness = await mount(november);

        await userEvent.click(page.getByRole("button", { name: "Move the edition" }));
        await settled();

        harness.showColumn(1);
        harness.scroller.scrollTop = 700;
        await settled();

        // Against the axis the grid holds now, which the harness's own helper
        // still measures with the dates it was mounted on.
        const column = harness.columnAt(1).getBoundingClientRect();

        await click(mouse(), {
            x: column.left + column.width / 2,
            y: column.top + ((20 * 60) / 1500) * column.height,
        });

        expect(harness.committed()).toEqual(["2027-10-31T19:00:00 - 2027-10-31T19:30:00"]);
    });

    it("lands a tap in the last half hour of a taller column", async () => {
        const harness = await mount(fallBack);

        harness.showColumn(1);
        harness.scroller.scrollTop = 1000;
        await settled();

        // Just inside the last row, so the press has a column to land on, and
        // far enough down it that snapping sends it to the column's very end.
        await click(mouse(), harness.pointAt(1, 25 * 60 - 5));

        expect(harness.committed()).toEqual(["2027-10-31T23:30:00 - 2027-11-01T00:00:00"]);
    });

    // Split where the column ends rather than where a day would: cut at the
    // twenty fourth hour both pieces land on the first column and the second
    // draws nothing.
    it("splits a block crossing into the next column at the column's end", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 0, 22), endsAt: instantAt(fallBack, 1, 2) },
        ]);

        harness.scroller.scrollTop = 0;

        const onFirst = harness.blocks().filter((block) => {
            const column = harness.columnAt(0).getBoundingClientRect();
            const rect = block.getBoundingClientRect();

            return rect.left >= column.left && rect.right <= column.right;
        });

        expect(harness.blocks()).toHaveLength(2);
        expect(onFirst).toHaveLength(1);
        expect(harness.blocks().map((block) => block.textContent)).toEqual([
            "10:00 PM – 12:00 AM",
            "12:00 – 2:00 AM",
        ]);
    });

    it("labels a block by the reading it actually covers", async () => {
        const harness = await mount(fallBack, [
            {
                startsAt: Temporal.ZonedDateTime.from(
                    `2027-10-31T02:00:00+02:00[${berlin}]`,
                ).toInstant(),
                endsAt: Temporal.ZonedDateTime.from(
                    `2027-10-31T02:30:00+01:00[${berlin}]`,
                ).toInstant(),
            },
        ]);

        harness.scroller.scrollTop = 0;

        expect(harness.blocks()[0].textContent).toBe("2:00 – 2:30 AM");
    });

    // A column an hour taller than a day draws every block about four percent
    // off if the arithmetic falls back on 1440, which reads as a plausible
    // position rather than a broken one.
    it("draws a block against the rows it covers, not against a day", async () => {
        const harness = await mount(fallBack, [
            { startsAt: instantAt(fallBack, 1, 20), endsAt: instantAt(fallBack, 1, 22) },
        ]);

        harness.scroller.scrollTop = 0;
        harness.showColumn(1);

        const column = harness.columnAt(1).getBoundingClientRect();
        const block = harness.blocks()[0].getBoundingClientRect();

        // 20:00 sits a row later than the clock says, because the repeated hour
        // put an extra row above it.
        expect(block.top - column.top).toBeCloseTo((21 * 60 * column.height) / 1500, 0);
        expect(block.height).toBeCloseTo((120 * column.height) / 1500, 0);
    });

    // noWrap on the hour sets overflow hidden, so the offset has to be its
    // sibling rather than its child.
    it("shows the offset that tells the two readings apart", async () => {
        const harness = await mount(fallBack);

        harness.scroller.scrollTop = 0;

        const offsets = Array.from(harness.scroller.querySelectorAll("*")).filter((element) =>
            /^[+-]\d\d:\d\d$/.test(element.textContent ?? ""),
        );

        expect(offsets.map((element) => element.textContent)).toEqual(["+02:00", "+01:00"]);

        for (const offset of offsets) {
            // Laid out and sized, which is what lets it widen the gutter.
            expect(offset.getBoundingClientRect().width).toBeGreaterThan(0);
            expect(window.getComputedStyle(offset.parentElement as Element).overflow).not.toBe(
                "hidden",
            );
        }
    });

    // Which reading a day means is a question of what its clocks were doing, so
    // the day before the change keeps the earlier row and the day after it the
    // later one.
    it("shades the reading each day does not have", async () => {
        const harness = await mount(fallBack);

        harness.scroller.scrollTop = 0;

        const shadedBand = (dayIndex: number): DOMRect | null => {
            const shade = harness.columnAt(dayIndex).querySelector("[title]");

            return shade === null ? null : shade.getBoundingClientRect();
        };

        const column = harness.columnAt(0).getBoundingClientRect();
        const rowHeight = column.height / 25;

        // In pixels rather than rounded to a row, and against a stated row
        // rather than against each other: a column an hour too short puts the
        // band four percent out, which both rounding and an inequality between
        // two equally wrong bands would let through.
        expect(shadedBand(0)?.top).toBeCloseTo(column.top + 3 * rowHeight, 0);
        expect(shadedBand(0)?.height).toBeCloseTo(rowHeight, 0);

        expect(shadedBand(1)).toBeNull();

        expect(shadedBand(2)?.top).toBeCloseTo(column.top + 2 * rowHeight, 0);
        expect(shadedBand(2)?.height).toBeCloseTo(rowHeight, 0);
    });

    it("gives the repeated hour a row of its own and shades it on the other days", async () => {
        const harness = await mount(fallBack);

        harness.scroller.scrollTop = 0;

        const column = harness.columnAt(1).getBoundingClientRect();

        expect(Math.round(column.height / ROW_HEIGHT)).toBe(25);
        expect(harness.columnAt(1).querySelector("[title]")).toBeNull();
        expect(harness.columnAt(0).querySelector("[title]")).not.toBeNull();
        expect(harness.columnAt(2).querySelector("[title]")).not.toBeNull();
    });
});

describe("drawing with a finger", () => {
    afterEach(stopTouch);

    it("leaves a finger that moves straight away to the page", async () => {
        const harness = await mount(november);
        const input = await touch();

        await drag(
            input,
            harness.pointAt(0, 9 * 60),
            harness.pointAt(0, 10 * 60),
            harness.pointAt(0, 11 * 60),
        );

        expect(harness.onValueChange).not.toHaveBeenCalled();
    });

    // Both of these move by a few pixels on purpose. Below about ten Chrome
    // keeps the gesture and delivers it whole; above about fifteen it takes the
    // gesture over for panning and cancels the pointer, and the slop never gets
    // a say. In between is the only window where the slop is the one deciding,
    // which is what these two measure.
    it("lets a finger that barely moved settle into a block", async () => {
        const harness = await mount(november);
        const input = await touch();
        const start = harness.pointAt(0, 9 * 60);

        await input.down(start);
        await input.move({ x: start.x, y: start.y + 4 });
        await wait(500);
        await input.up({ x: start.x, y: start.y + 4 });

        expect(harness.committed()).toEqual(["2026-11-22T09:00:00 - 2026-11-22T09:30:00"]);
    });

    it("leaves a finger that wandered while it waited to the page", async () => {
        const harness = await mount(november);
        const input = await touch();
        const start = harness.pointAt(0, 9 * 60);

        await input.down(start);
        await input.move({ x: start.x, y: start.y + 14 });
        await wait(500);
        await input.up({ x: start.x, y: start.y + 14 });

        expect(harness.onValueChange).not.toHaveBeenCalled();
    });

    it("leaves a finger that wandered along its own row to the page", async () => {
        const harness = await mount(november);
        const input = await touch();
        const start = harness.pointAt(0, 9 * 60);

        await input.down(start);
        await input.move({ x: start.x + 14, y: start.y });
        await wait(500);
        await input.up({ x: start.x + 14, y: start.y });

        expect(harness.onValueChange).not.toHaveBeenCalled();
    });

    it("draws once a finger has rested long enough", async () => {
        const harness = await mount(november);
        const input = await touch();

        await input.down(harness.pointAt(0, 9 * 60));
        await wait(500);
        await input.move(harness.pointAt(0, 10 * 60));
        await input.move(harness.pointAt(0, 11 * 60));
        await input.up(harness.pointAt(0, 11 * 60));

        expect(harness.committed()).toEqual(["2026-11-22T09:00:00 - 2026-11-22T11:00:00"]);
    });

    it("lands a half hour block on a tap", async () => {
        const harness = await mount(november);
        const input = await touch();

        await click(input, harness.pointAt(0, 9 * 60));

        expect(harness.committed()).toEqual(["2026-11-22T09:00:00 - 2026-11-22T09:30:00"]);
    });

    // A finger reaches a path a mouse never does: a press only becomes a tap
    // when it was waiting to see whether it would become a gesture, and a mouse
    // is never asked to wait.
    it("lands a tap on the row it touched in a taller column", async () => {
        const harness = await mount(fallBack);
        const input = await touch();

        harness.showColumn(1);
        harness.scroller.scrollTop = 700;
        await settled();

        await click(input, harness.pointAt(1, 20 * 60));

        expect(harness.committed()).toEqual(["2027-10-31T19:00:00 - 2027-10-31T19:30:00"]);
    });
});
