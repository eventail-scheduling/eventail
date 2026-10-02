import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { LocaleProvider } from "#/components/LocaleProvider/index.ts";
import { collisionWarnings, findCollisions } from "#/components/ScheduleGrid/collision.ts";
import { buildScheduleAxis, instantAtMinutes } from "#/components/ScheduleGrid/geometry.ts";
import type { Candidate, MinuteSpan, MinuteStep } from "#/components/ScheduleGrid/placement.ts";
import { ScheduleGrid } from "#/components/ScheduleGrid/ScheduleGrid.tsx";
import {
    type DragSubject,
    newSlotFor,
    useSlotDrag,
} from "#/components/ScheduleGrid/useSlotDrag.ts";
import type { Location } from "#/queries/location.js";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import type { Venue } from "#/queries/venue.js";
import type { AvailabilityInterval } from "#/utils/availability.ts";
import { mouse, type Point, stopTouch, touch, wait } from "../../support/browser-input.ts";
import { assertScrollable } from "../../support/scrolling.ts";
import { createTestTheme } from "../../support/theme.ts";

const berlin = "Europe/Berlin";
const theme = createTestTheme();

beforeEach(() => {
    window.localStorage.setItem("preferredLocale", "en-US");
});

// A November edition, so no clock change complicates the arithmetic. Every
// assertion below counts minutes from midnight on its first day.
const axis = buildScheduleAxis(
    Temporal.PlainDate.from("2026-11-22"),
    Temporal.PlainDate.from("2026-11-23"),
    berlin,
);

const venueNamed = (id: string, name: string): Venue => ({
    id,
    name,
    address: null,
    externalKey: null,
});

const congress = venueNamed("venue-congress", "Congress Center");
const annexVenue = venueNamed("venue-annex-house", "Annex House");

/** Every room in one venue, which is what an edition looks like until a second is added. */
const roomsWith = (mainAvailability: AvailabilityInterval[] = []): Location[] =>
    [
        {
            id: "room-main",
            name: "Main hall",
            externalKey: null,
            venue: { id: congress.id },
            availabilities: mainAvailability,
        },
        {
            id: "room-annex",
            name: "Annex",
            externalKey: null,
            venue: { id: congress.id },
            availabilities: [],
        },
    ] as unknown as Location[];

const rooms = roomsWith();

const roomsAcross = (): Location[] => [
    { ...rooms[0], venue: { id: congress.id } },
    { ...rooms[1], venue: { id: annexVenue.id } },
];

const twoVenues = [congress, annexVenue];

type SlotAt = {
    id: string;
    locationId: string;
    from: number;
    to: number;
    title: string;
    setup?: number;
    teardown?: number;
};

const slotAt = ({ id, locationId, from, to, title, ...margins }: SlotAt): Slot => ({
    id,
    stableId: id,
    startsAt: instantAtMinutes(axis, from),
    endsAt: instantAtMinutes(axis, to),
    setupTime: Temporal.Duration.from({ minutes: margins.setup ?? 0 }),
    teardownTime: Temporal.Duration.from({ minutes: margins.teardown ?? 0 }),
    session: { id: `session-${id}`, title, state: "confirmed" as const },
    location: { id: locationId },
});

const lightningTalk: SlottableSession = {
    id: "session-new",
    title: "Lightning talk",
    duration: Temporal.Duration.from({ minutes: 60 }),
    setupTime: null,
    teardownTime: null,
    sessionType: { id: "type-talk", defaultDuration: Temporal.Duration.from({ minutes: 30 }) },
} as SlottableSession;

const workshop: SlottableSession = {
    id: "session-workshop",
    title: "Soldering workshop",
    duration: Temporal.Duration.from({ minutes: 60 }),
    setupTime: Temporal.Duration.from({ minutes: 30 }),
    teardownTime: Temporal.Duration.from({ minutes: 15 }),
    sessionType: { id: "type-talk", defaultDuration: Temporal.Duration.from({ minutes: 30 }) },
} as SlottableSession;

type ProvidersProps = {
    children: ReactNode;
};

// CssBaseline because the app mounts it, and it is what makes a row's border
// sit inside its height. Without it every row renders a pixel taller than the
// layout says and a minute is worth 2% less than the grid thinks.
const Providers = ({ children }: ProvidersProps): ReactNode => (
    <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocaleProvider>{children}</LocaleProvider>
    </ThemeProvider>
);

type EditorProps = {
    slots: Slot[];
    /** Passed straight through: `unavailableRanges` is covered on its own. */
    unavailable?: MinuteSpan[];
    /** Only what a collision is read from; the sidebar is a button here. */
    sessions?: SlottableSession[];
    locations?: Location[];
    venues?: readonly Venue[];
    step: MinuteStep;
    onPlace: (subject: DragSubject, candidate: Candidate) => void;
    onSelect: (slot: Slot) => void;
    onRemove: (slot: Slot) => void;
};

/**
 * The grid with the gesture layer the page gives it, and nothing else.
 *
 * The button stands in for a sidebar entry: both do no more than hand a session
 * and the press that started it to startCreate.
 */
const Editor = ({
    slots,
    unavailable = [],
    sessions = [],
    step,
    locations = rooms,
    venues = [congress],
    onPlace,
    onSelect,
    onRemove,
}: EditorProps): ReactNode => {
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

    // The page's own derivation rather than a copy of it, so a test reaches the
    // marker through the same slots-and-sessions path.
    const warnings = collisionWarnings(findCollisions(axis, slots, sessions));

    const controls = useSlotDrag({
        axis,
        slots,
        step,
        onPlace,
        onRefuse: () => undefined,
        onSelect: (slot) => {
            setSelectedSlotId(slot.id);
            onSelect(slot);
        },
        onRemove,
    });

    // The grid sizes itself with `flex: 1`, so it needs the column of definite
    // height the app gives it. Rendered into a bare div it grows to its content
    // and stops being a scroll container, which quietly hollows out every
    // assertion about scrolling.
    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
            <button
                type="button"
                data-testid="pick-session"
                onPointerDown={(event) => {
                    controls.startCreate(newSlotFor(lightningTalk), event);
                }}
            >
                Lightning talk
            </button>

            <button
                type="button"
                data-testid="pick-workshop"
                onPointerDown={(event) => {
                    controls.startCreate(newSlotFor(workshop), event);
                }}
            >
                Soldering workshop
            </button>

            {/* Stands in for DropCorner, which is presentation over this ref. */}
            <div
                data-testid="corner"
                ref={controls.cornerRef}
                style={{
                    position: "fixed",
                    left: "0px",
                    bottom: "0px",
                    width: "60px",
                    height: "60px",
                    // Mounted before any gesture, unlike DropCorner, so this
                    // must not take the press that starts one.
                    pointerEvents: "none",
                }}
            />

            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                <ScheduleGrid
                    axis={axis}
                    locations={locations}
                    venues={venues}
                    slots={slots}
                    step={step}
                    drag={controls.drag}
                    warnings={warnings}
                    unavailable={unavailable}
                    selectedSlotId={selectedSlotId}
                    scrollRef={controls.scrollRef}
                    gridRef={controls.gridRef}
                    handleRef={controls.handleRef}
                    gridHandlers={controls.gridHandlers}
                    onStartMove={controls.startMove}
                    onTapSlot={controls.tapSlot}
                />
            </div>
        </div>
    );
};

type Harness = {
    onPlace: ReturnType<typeof vi.fn>;
    onSelect: ReturnType<typeof vi.fn>;
    onRemove: ReturnType<typeof vi.fn>;
    picker: HTMLElement;
    workshopPicker: HTMLElement;
    /** The middle of a room's row, at the given minute inside that hour. */
    pointAt: (roomIndex: number, rowIndex: number, minuteInHour?: number) => Point;
    blockFor: (title: string) => HTMLElement;
    /** The titles of the blocks drawn as clashing, in the order they are drawn. */
    warnedTitles: () => string[];
    /** How many bands the speaker-availability overlay is drawing right now. */
    unavailableBandCount: () => number;
    ghost: () => HTMLElement | null;
    closedBands: (roomIndex: number) => HTMLElement[];
    /** Whether any closed band covers the middle of a room's row. */
    shadedAt: (roomIndex: number, rowIndex: number) => boolean;
    /** The same, for a collapsed run, found through the gutter stub it shares a top with. */
    shadedOverStub: (roomIndex: number) => boolean;
    bandCovering: (roomIndex: number, rowIndex: number) => DOMRect | null;
    cornerPoint: () => Point;
    placeCornerAt: (point: Point) => void;
    ghostShoulder: (edge: "setup" | "teardown") => HTMLElement | null;
    rowIn: (roomIndex: number, rowIndex: number) => HTMLElement | null;
    /** Inside the stub that follows a row, where no minute is on offer. */
    belowRow: (roomIndex: number, rowIndex: number) => Point;
    /** In the time gutter, which is on the grid and in no room. */
    leftOfRooms: (y: number) => Point;
    roomRect: (roomIndex: number) => DOMRect;
    roomCount: () => number;
    scroller: () => HTMLElement;
};

type MountOptions = {
    unavailable?: MinuteSpan[];
    locations?: Location[];
    venues?: readonly Venue[];
    sessions?: SlottableSession[];
};

const mount = async (
    slots: Slot[],
    step: MinuteStep = 5,
    { locations, venues, sessions, unavailable }: MountOptions = {},
): Promise<Harness> => {
    const onPlace = vi.fn();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const screen = await render(
        <Editor
            slots={slots}
            step={step}
            locations={locations}
            venues={venues}
            sessions={sessions}
            unavailable={unavailable}
            onPlace={onPlace}
            onSelect={onSelect}
            onRemove={onRemove}
        />,
        { wrapper: Providers },
    );

    const find = (selector: string): HTMLElement => {
        const element = screen.container.querySelector<HTMLElement>(selector);

        if (!element) {
            throw new Error(`nothing matching ${selector}`);
        }

        return element;
    };

    return {
        onPlace,
        onSelect,
        onRemove,
        picker: find('[data-testid="pick-session"]'),
        workshopPicker: find('[data-testid="pick-workshop"]'),
        pointAt: (roomIndex, rowIndex, minuteInHour = 0) => {
            const room = find(`[data-testid="schedule-room-${roomIndex.toString()}"]`);
            const scroller = find('[data-testid="schedule-scroller"]');
            const rowOf = () => {
                const row = room.querySelector<HTMLElement>(
                    `[data-testid="schedule-row-${rowIndex.toString()}"]`,
                );

                if (!row) {
                    throw new Error(
                        `room ${roomIndex.toString()} draws no row ${rowIndex.toString()}`,
                    );
                }

                return row.getBoundingClientRect();
            };

            // Centered first, because a gesture within fifty pixels of an edge
            // drags the grid under itself, which is the point of the auto
            // scroll and would move the row out from under a fixed target.
            const view = scroller.getBoundingClientRect();
            const rect = rowOf();
            scroller.scrollTop += rect.top - view.top - (view.height - rect.height) / 2;

            const centered = rowOf();

            return {
                x: centered.left + centered.width / 2,
                y: centered.top + (minuteInHour / 60) * centered.height,
            };
        },
        unavailableBandCount: () =>
            screen.container.querySelectorAll('[data-testid="unavailable-band"]').length,
        warnedTitles: () =>
            Array.from(
                screen.container.querySelectorAll<HTMLElement>(
                    '[data-testid="schedule-block"] [data-warned="true"]',
                ),
            ).map((block) => block.textContent ?? ""),
        blockFor: (title) => {
            const found = Array.from(
                screen.container.querySelectorAll<HTMLElement>('[data-testid="schedule-block"]'),
            ).find((block) => block.textContent?.includes(title) === true);

            if (!found) {
                throw new Error(`no block for ${title}`);
            }

            return found;
        },
        ghost: () => screen.container.querySelector<HTMLElement>('[data-testid="schedule-ghost"]'),
        closedBands: (roomIndex) =>
            Array.from(
                find(
                    `[data-testid="schedule-room-${roomIndex.toString()}"]`,
                ).querySelectorAll<HTMLElement>('[data-testid="schedule-closed"]'),
            ),
        shadedOverStub: (roomIndex) => {
            const stub = screen.container.querySelector<HTMLElement>("button[title^='Show ']");

            if (!stub) {
                throw new Error("the grid collapsed no hours");
            }

            const rect = stub.getBoundingClientRect();
            const middle = rect.top + rect.height / 2;

            return Array.from(
                find(
                    `[data-testid="schedule-room-${roomIndex.toString()}"]`,
                ).querySelectorAll<HTMLElement>('[data-testid="schedule-closed"]'),
            ).some((band) => {
                const bounds = band.getBoundingClientRect();

                return middle >= bounds.top && middle < bounds.bottom;
            });
        },
        bandCovering: (roomIndex, rowIndex) => {
            const room = find(`[data-testid="schedule-room-${roomIndex.toString()}"]`);
            const row = room.querySelector<HTMLElement>(
                `[data-testid="schedule-row-${rowIndex.toString()}"]`,
            );

            if (!row) {
                throw new Error(`room ${roomIndex.toString()} draws no row ${rowIndex.toString()}`);
            }

            const rect = row.getBoundingClientRect();

            return (
                Array.from(room.querySelectorAll<HTMLElement>('[data-testid="schedule-closed"]'))
                    .map((band) => band.getBoundingClientRect())
                    .find((bounds) => bounds.top < rect.bottom && bounds.bottom > rect.top) ?? null
            );
        },
        shadedAt: (roomIndex, rowIndex) => {
            const room = find(`[data-testid="schedule-room-${roomIndex.toString()}"]`);
            const row = room.querySelector<HTMLElement>(
                `[data-testid="schedule-row-${rowIndex.toString()}"]`,
            );

            if (!row) {
                throw new Error(`room ${roomIndex.toString()} draws no row ${rowIndex.toString()}`);
            }

            const rect = row.getBoundingClientRect();
            const middle = rect.top + rect.height / 2;

            return Array.from(
                room.querySelectorAll<HTMLElement>('[data-testid="schedule-closed"]'),
            ).some((band) => {
                const bounds = band.getBoundingClientRect();

                return middle >= bounds.top && middle < bounds.bottom;
            });
        },
        cornerPoint: () => {
            const rect = find('[data-testid="corner"]').getBoundingClientRect();

            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        },
        placeCornerAt: (point) => {
            const corner = find('[data-testid="corner"]');
            const rect = corner.getBoundingClientRect();

            corner.style.bottom = "auto";
            corner.style.left = `${(point.x - rect.width / 2).toString()}px`;
            corner.style.top = `${(point.y - rect.height / 2).toString()}px`;
        },
        ghostShoulder: (edge) =>
            screen.container.querySelector<HTMLElement>(`[data-testid="schedule-ghost-${edge}"]`),
        rowIn: (roomIndex, rowIndex) =>
            find(
                `[data-testid="schedule-room-${roomIndex.toString()}"]`,
            ).querySelector<HTMLElement>(`[data-testid="schedule-row-${rowIndex.toString()}"]`),
        belowRow: (roomIndex, rowIndex) => {
            const room = find(`[data-testid="schedule-room-${roomIndex.toString()}"]`);
            const row = room.querySelector<HTMLElement>(
                `[data-testid="schedule-row-${rowIndex.toString()}"]`,
            );

            if (!row) {
                throw new Error(`room ${roomIndex.toString()} draws no row ${rowIndex.toString()}`);
            }

            const rect = row.getBoundingClientRect();

            return { x: rect.left + rect.width / 2, y: rect.bottom + 4 };
        },
        roomRect: (roomIndex) =>
            find(`[data-testid="schedule-room-${roomIndex.toString()}"]`).getBoundingClientRect(),
        scroller: () => find('[data-testid="schedule-scroller"]'),
        roomCount: () => document.querySelectorAll('[data-testid="schedule-room-0"]').length,
        leftOfRooms: (y) => {
            const rect = find('[data-testid="schedule-room-0"]').getBoundingClientRect();

            return { x: rect.left - 8, y };
        },
    };
};

const keynote = () =>
    slotAt({
        id: "slot-keynote",
        locationId: "room-main",
        from: 10 * 60,
        to: 11 * 60,
        title: "Keynote",
    });

describe("the hours a room is not open", () => {
    it("shades neither end for a room that named no availability", async () => {
        const harness = await mount([]);

        expect(harness.closedBands(0)).toHaveLength(0);
        expect(harness.closedBands(1)).toHaveLength(0);
    });

    it("shades either side of the hours a room is open, and only that room", async () => {
        const axis2 = axis;
        const harness = await mount([], 5, {
            locations: roomsWith([
                {
                    startsAt: instantAtMinutes(axis2, 9 * 60),
                    endsAt: instantAtMinutes(axis2, 18 * 60),
                },
            ]),
        });

        // Asserted by coverage rather than by count: the grid shades a segment
        // at a time, so how many bands that takes is a layout detail.
        expect(harness.shadedAt(0, 0)).toBe(true);
        expect(harness.shadedAt(0, 12)).toBe(false);
        expect(harness.shadedAt(0, 18)).toBe(true);
        expect(harness.closedBands(1)).toHaveLength(0);
    });

    it("shades a run of hours the grid has collapsed", async () => {
        // The reason the shading walks segments rather than ranges: a stub has
        // no pixel to measure a minute against, and measuring the range would
        // drop the whole band including the part that is on screen.
        const harness = await mount([], 5, {
            locations: roomsWith([
                {
                    startsAt: instantAtMinutes(axis, 9 * 60),
                    endsAt: instantAtMinutes(axis, 18 * 60),
                },
            ]),
        });

        expect(harness.shadedOverStub(0)).toBe(true);
        expect(harness.shadedOverStub(1)).toBe(false);
    });

    it("stops the shading where the hour opens, not where the hour ends", async () => {
        // An edge that falls mid hour has to clip inside the row, or a room
        // opening at half past reads as opening on the hour.
        const harness = await mount([], 5, {
            locations: roomsWith([
                {
                    startsAt: instantAtMinutes(axis, 9 * 60 + 30),
                    endsAt: instantAtMinutes(axis, 18 * 60),
                },
            ]),
        });

        const row = harness.rowIn(0, 9)?.getBoundingClientRect();
        const band = harness.bandCovering(0, 9);

        expect(row).toBeDefined();
        expect(band).not.toBeNull();
        expect((band?.bottom ?? 0) - (row?.top ?? 0)).toBeCloseTo((row?.height ?? 0) / 2, 0);
    });
});

describe("the step a gesture lands on", () => {
    it("takes the quarter hour it was let go nearest to", async () => {
        const harness = await mount([], 15);
        const pointer = mouse();
        const target = harness.pointAt(0, 14, 24);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        await pointer.up(target);

        const [, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(candidate.span).toEqual({ from: 14 * 60 + 30, to: 15 * 60 + 30 });
    });

    it("takes the whole hour when that is the step", async () => {
        const harness = await mount([], 60);
        const pointer = mouse();
        const target = harness.pointAt(0, 14, 24);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        await pointer.up(target);

        const [, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(candidate.span).toEqual({ from: 14 * 60, to: 15 * 60 });
    });

    it("moves a slot onto the step it was let go nearest to", async () => {
        const harness = await mount([keynote()], 30);
        const pointer = mouse();
        const target = harness.pointAt(1, 14, 20);
        const block = harness.blockFor("Keynote").getBoundingClientRect();

        // Grabbed halfway down a sixty minute slot, so the drop is its middle.
        await pointer.down({ x: block.x + block.width / 2, y: block.y + block.height / 2 });
        await pointer.move(target);
        await pointer.up(target);

        const [, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(candidate.span).toEqual({ from: 14 * 60, to: 15 * 60 });
        expect(candidate.locationId).toEqual("room-annex");
    });
});

describe("placing a session by hand", () => {
    it("creates a slot in the room and hour it was let go over", async () => {
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(1, 14);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        await pointer.up(target);

        expect(harness.onPlace).toHaveBeenCalledTimes(1);

        const [subject, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(subject.kind).toEqual("create");
        expect(candidate.locationId).toEqual("room-annex");
        expect(candidate.span).toEqual({ from: 14 * 60, to: 15 * 60 });
    });

    it("moves a placed slot to another room without changing its length", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const target = harness.pointAt(1, 15, 30);
        const block = harness.blockFor("Keynote").getBoundingClientRect();

        // Grabbed halfway down, which the drop has to account for: the block
        // lands where its middle was let go, not its top.
        await pointer.down({ x: block.x + block.width / 2, y: block.y + block.height / 2 });
        await pointer.move(target);
        await pointer.up(target);

        expect(harness.onPlace).toHaveBeenCalledTimes(1);

        const [subject, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(subject.kind).toEqual("move");
        expect(candidate.locationId).toEqual("room-annex");
        expect(candidate.span).toEqual({ from: 15 * 60, to: 16 * 60 });
    });

    it("writes nothing where the room is taken, and says what has it", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const target = harness.pointAt(0, 10, 30);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);

        expect(harness.ghost()?.textContent).toContain("Keynote");

        await pointer.up(target);

        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("refuses a drop held apart only by the margins either side", async () => {
        // The bodies clear each other by fifteen minutes and the room does not:
        // the keynote is still being struck when the setup would begin. Without
        // this the refusal looks like the grid rejecting an empty gap.
        const harness = await mount([
            slotAt({
                id: "slot-keynote",
                locationId: "room-main",
                from: 10 * 60,
                to: 11 * 60,
                title: "Keynote",
                teardown: 30,
            }),
        ]);
        const pointer = mouse();
        const target = harness.pointAt(0, 11, 15);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);

        expect(harness.ghost()?.textContent).toContain("setup and teardown");

        await pointer.up(target);

        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("writes nothing for a session let go off the rooms", async () => {
        const harness = await mount([]);
        const pointer = mouse();
        const room = harness.pointAt(0, 12);
        const gutter = harness.leftOfRooms(room.y);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(room);
        await pointer.move(gutter);

        expect(harness.ghost()).toBeNull();

        await pointer.up(gutter);

        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("takes no drop on a run of hours the grid has collapsed", async () => {
        // A stub stands for hours nobody has asked to see, so there is no
        // minute under the pointer to drop onto.
        const harness = await mount([]);
        const pointer = mouse();
        const stub = harness.belowRow(0, 18);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(stub);

        expect(harness.ghost()).toBeNull();

        await pointer.up(stub);

        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("opens the hour a session runs into, so the block it would leave is drawn", async () => {
        // Business hours stop at nineteen, so an hour starting at half past six
        // ends inside a collapsed run. The grid has to reveal that hour while
        // the gesture is live or the candidate has no pixel for its end and the
        // ghost vanishes at the moment it is being aimed.
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(0, 18, 30);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        // The reveal costs a second render: the first has no pixel for the end
        // of the block, and the effect that opens the hour runs after it.
        await wait(50);

        expect(harness.ghost()).not.toBeNull();

        await pointer.up(target);

        const [, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(candidate.span).toEqual({ from: 18 * 60 + 30, to: 19 * 60 + 30 });
    });

    it("carries the margins the session holds the room for", async () => {
        // The ghost is what an organizer aims with, and a refusal can come from
        // the margins alone, so a block that has them has to show them before
        // it lands rather than only once it has.
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(0, 14);

        await pointer.down({
            x: harness.workshopPicker.getBoundingClientRect().x + 4,
            y: harness.workshopPicker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);

        // Thirty minutes of setup and fifteen of teardown, on hours of 36px.
        expect(harness.ghostShoulder("setup")?.getBoundingClientRect().height).toBeCloseTo(18, 0);
        expect(harness.ghostShoulder("teardown")?.getBoundingClientRect().height).toBeCloseTo(9, 0);

        await pointer.up(target);

        const [, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(candidate.shoulders).toEqual({ setup: 30, teardown: 15 });
    });

    it("unschedules a placed session dropped on the corner", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const target = harness.pointAt(1, 14);
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const corner = harness.cornerPoint();

        await pointer.down({ x: block.x + block.width / 2, y: block.y + block.height / 2 });
        await pointer.move(target);
        await pointer.move(corner);

        // The corner takes the whole gesture, so there is nothing left to place.
        expect(harness.ghost()).toBeNull();

        await pointer.up(corner);

        expect(harness.onRemove).toHaveBeenCalledTimes(1);
        expect((harness.onRemove.mock.lastCall as [Slot])[0].id).toEqual("slot-keynote");
        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("has nothing to unschedule for a session that was never placed", async () => {
        // The corner answers a create drag too, but with nothing to take off
        // the schedule it can only abandon what is being carried.
        const harness = await mount([]);
        const pointer = mouse();
        const corner = harness.cornerPoint();

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(corner);
        await pointer.up(corner);

        expect(harness.onRemove).not.toHaveBeenCalled();
        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("takes the ground from a create drag the corner is covering", async () => {
        // Placed over a room this time, so the assertion is that the corner
        // wins rather than that there was nothing under it to win against.
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(0, 14);
        harness.placeCornerAt(target);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);

        expect(harness.ghost()).toBeNull();

        await pointer.up(target);

        expect(harness.onRemove).not.toHaveBeenCalled();
        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("holds the grid still while the corner has the drop", async () => {
        // The target lives in a corner, which is where the grid follows a
        // gesture hardest. Scrolling there would move the schedule under a
        // pointer that has already left the rooms.
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const scroller = harness.scroller();
        const view = scroller.getBoundingClientRect();

        // Over the corner and well inside the band that would otherwise scroll.
        harness.placeCornerAt({ x: view.left + view.width / 2, y: view.bottom - 10 });

        await pointer.down({ x: block.x + block.width / 2, y: block.y + block.height / 2 });
        await pointer.move({ x: block.x + block.width / 2, y: block.y + block.height / 2 + 40 });

        const before = scroller.scrollTop;

        assertScrollable(scroller);

        await pointer.move(harness.cornerPoint());
        await wait(250);

        expect(scroller.scrollTop).toEqual(before);
    });

    it("opens a slot pressed over the corner rather than unscheduling it", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const point = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        harness.placeCornerAt(point);

        await pointer.down(point);
        await pointer.up(point);

        expect(harness.onSelect).toHaveBeenCalledTimes(1);
        expect(harness.onRemove).not.toHaveBeenCalled();
    });

    it("opens a slot that was pressed rather than dragged", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const point = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        await pointer.down(point);
        await pointer.up(point);

        expect(harness.onSelect).toHaveBeenCalledTimes(1);
        expect(harness.onPlace).not.toHaveBeenCalled();
        expect((harness.onSelect.mock.lastCall as [Slot])[0].id).toEqual("slot-keynote");
    });
});

describe("a speaker wanted in two places", () => {
    const shared = (id: string): SlottableSession =>
        ({
            id,
            title: id,
            hosts: [{ id: "host-ada", displayName: "Ada Lovelace" }],
        }) as SlottableSession;

    const overlapping = () => [
        slotAt({
            id: "slot-a",
            locationId: "room-main",
            from: 10 * 60,
            to: 11 * 60,
            title: "Keynote",
        }),
        slotAt({
            id: "slot-b",
            locationId: "room-annex",
            from: 10 * 60 + 30,
            to: 11 * 60 + 30,
            title: "Panel",
        }),
    ];

    it("marks both blocks, in whichever room they sit", async () => {
        const harness = await mount(overlapping(), 30, {
            sessions: [shared("session-slot-a"), shared("session-slot-b")],
        });

        expect(harness.warnedTitles()).toHaveLength(2);
        expect(harness.warnedTitles().join(" ")).toContain("Keynote");
        expect(harness.warnedTitles().join(" ")).toContain("Panel");
    });

    it("marks neither block when the two share no speaker", async () => {
        const harness = await mount(overlapping(), 30, {
            sessions: [
                shared("session-slot-a"),
                {
                    id: "session-slot-b",
                    title: "session-slot-b",
                    hosts: [{ id: "host-grace", displayName: "Grace Hopper" }],
                } as SlottableSession,
            ],
        });

        expect(harness.warnedTitles()).toHaveLength(0);
    });

    it("names the other speaker on the block itself", async () => {
        const harness = await mount(overlapping(), 30, {
            sessions: [shared("session-slot-a"), shared("session-slot-b")],
        });

        expect(
            harness.blockFor("Keynote").querySelector("[title]")?.getAttribute("title"),
        ).toContain("also booked: Ada Lovelace");
    });
});

describe("when a held session's speakers are not free", () => {
    // A stretch of the middle of the first day, so the bands land on rows that
    // are drawn rather than inside a collapsed run.
    const away: MinuteSpan[] = [{ from: 11 * 60, to: 13 * 60 }];

    it("draws nothing until something is held", async () => {
        const harness = await mount([], 30, { unavailable: away });

        expect(harness.unavailableBandCount()).toBe(0);
    });

    // The overlay is a fact about a person rather than a room, so it covers
    // every column instead of the one under the pointer.
    it("shades every room while a session is held", async () => {
        const harness = await mount([], 30, { unavailable: away });
        const pointer = mouse();

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(harness.pointAt(0, 11));

        expect(harness.unavailableBandCount()).toBeGreaterThanOrEqual(harness.roomCount());

        await pointer.up(harness.pointAt(0, 11));
    });

    it("takes the shading away again once the session is dropped", async () => {
        const harness = await mount([], 30, { unavailable: away });
        const pointer = mouse();
        const target = harness.pointAt(0, 11);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        await pointer.up(target);

        expect(harness.unavailableBandCount()).toBe(0);
    });
});

describe("calling a gesture off with the keyboard", () => {
    it("places nothing when a new session is dropped after escape", async () => {
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(0, 14);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);

        // Guards the rest from passing on a gesture that never began.
        expect(harness.ghost()).not.toBeNull();

        await userEvent.keyboard("{Escape}");

        expect(harness.ghost()).toBeNull();

        // The finger is still down after a cancel, so the release that follows
        // has to find nothing left to place rather than the target it was over.
        await pointer.up(target);

        expect(harness.onPlace).not.toHaveBeenCalled();
    });

    it("leaves a placed session alone when its move is called off", async () => {
        const harness = await mount([keynote()]);
        const pointer = mouse();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const target = harness.pointAt(1, 14);

        await pointer.down({ x: block.x + block.width / 2, y: block.y + block.height / 2 });
        await pointer.move(target);
        await userEvent.keyboard("{Escape}");
        await pointer.up(target);

        expect(harness.onPlace).not.toHaveBeenCalled();
        expect(harness.onRemove).not.toHaveBeenCalled();
        // A canceled move is not a click either, so nothing opens.
        expect(harness.onSelect).not.toHaveBeenCalled();
    });

    it("carries on for any other key", async () => {
        const harness = await mount([]);
        const pointer = mouse();
        const target = harness.pointAt(0, 14);

        await pointer.down({
            x: harness.picker.getBoundingClientRect().x + 4,
            y: harness.picker.getBoundingClientRect().y + 4,
        });
        await pointer.move(target);
        await userEvent.keyboard("{Enter}");

        expect(harness.ghost()).not.toBeNull();

        await pointer.up(target);

        expect(harness.onPlace).toHaveBeenCalledTimes(1);
    });
});

describe("carrying a block with a finger", () => {
    afterEach(stopTouch);

    it("leaves a finger that moves straight away to the page", async () => {
        const harness = await mount([keynote()]);
        const input = await touch();
        const scroller = harness.scroller();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        assertScrollable(scroller);

        const before = scroller.scrollTop;

        await input.down(from);
        await input.move({ x: from.x, y: from.y - 60 });
        await input.move({ x: from.x, y: from.y - 120 });
        await input.up({ x: from.x, y: from.y - 120 });
        await wait(100);

        expect(harness.onPlace).not.toHaveBeenCalled();
        expect(harness.onSelect).not.toHaveBeenCalled();
        expect(scroller.scrollTop).toBeGreaterThan(before);
    });

    it("carries one that was held first", async () => {
        const harness = await mount([keynote()]);
        const input = await touch();
        // Read after pointAt, which scrolls the grid to bring its row into view
        // and would otherwise leave this rect describing somewhere else.
        const target = harness.pointAt(1, 14);
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        await input.down(from);
        await wait(500);
        await input.move(target);
        await input.up(target);

        const [subject, candidate] = harness.onPlace.mock.lastCall as [DragSubject, Candidate];

        expect(subject.kind).toEqual("move");
        // The block was grabbed halfway down, so it keeps that half hour above
        // the point it was let go of. A press that lost its coordinate across
        // the wait grabs at the top instead, and lands half an hour later.
        expect(candidate.span).toEqual({ from: 13 * 60 + 30, to: 14 * 60 + 30 });
    });

    // Four pixels is inside the slop, so the press survives the drift and still
    // arms; one more after that is under CLICK_SLACK and is not travel either.
    // Measured from where the finger landed the two add up and the release
    // settles as a placement, writing the slot back where it already was.
    it("opens one held with a drifting finger rather than placing it", async () => {
        const harness = await mount([keynote()]);
        const input = await touch();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        await input.down(from);
        await input.move({ x: from.x, y: from.y + 3 });
        await wait(500);
        await input.move({ x: from.x, y: from.y + 5 });
        await input.up({ x: from.x, y: from.y + 5 });

        expect(harness.onPlace).not.toHaveBeenCalled();
        expect(harness.onSelect).toHaveBeenCalledTimes(1);
    });

    it("holds on when another pointer gives up its capture", async () => {
        const harness = await mount([keynote()]);
        const input = await touch();
        const target = harness.pointAt(1, 14);
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        await input.down(from);
        await wait(500);
        await input.move(target);

        expect(harness.ghost()).not.toBeNull();

        harness
            .blockFor("Keynote")
            .dispatchEvent(
                new PointerEvent("lostpointercapture", { pointerId: 99, bubbles: true }),
            );

        expect(harness.ghost()).not.toBeNull();

        await input.up(target);

        expect(harness.onPlace).toHaveBeenCalledTimes(1);
    });

    // The press never becomes a gesture, so nothing downstream ever reads it as
    // a click the way it reads a mouse that pressed and did not travel.
    it("opens one that was tapped rather than held", async () => {
        const harness = await mount([keynote()]);
        const input = await touch();
        const block = harness.blockFor("Keynote").getBoundingClientRect();
        const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };

        await input.down(from);
        await input.up(from);

        expect(harness.onSelect).toHaveBeenCalledTimes(1);
        expect((harness.onSelect.mock.lastCall as [Slot])[0].id).toEqual("slot-keynote");
    });
});

/** The caption a column header draws under its room name, or null for none. */
const captionUnder = async (roomName: string): Promise<string | null> => {
    const room = await page.getByText(roomName).element();
    const header = room.parentElement;

    return header === null ? null : (header.textContent?.slice(roomName.length) ?? null);
};

describe("naming the venue a room sits in", () => {
    // Which venue each room is in, not merely that both names are drawn: a map
    // built the wrong way round still shows every name somewhere.
    it("names it under each room once an edition has two", async () => {
        await mount([], 5, { locations: roomsAcross(), venues: twoVenues });

        expect(await captionUnder("Main hall")).toEqual("Congress Center");
        expect(await captionUnder("Annex")).toEqual("Annex House");
    });

    it("says nothing when every room is in the same venue", async () => {
        await mount([], 5, { locations: rooms, venues: [congress] });

        await expect.element(page.getByText("Main hall")).toBeVisible();
        expect(await captionUnder("Main hall")).toEqual("");
    });
});
