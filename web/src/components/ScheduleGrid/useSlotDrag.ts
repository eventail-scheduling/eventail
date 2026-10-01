import {
    type PointerEvent as ReactPointerEvent,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";
import { match } from "ts-pattern";
import {
    carryScroll,
    type EdgesReached,
    edgeScrollDistance,
} from "#/components/AvailabilityField/geometry.js";
import { useTouchScrollLock } from "#/hooks/useTouchScrollLock.js";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import type { ScheduleAxis } from "./geometry.js";
import {
    type Candidate,
    clampSpan,
    type MinuteStep,
    type Refusal,
    refusePlacement,
    type Shoulders,
    slotShoulders,
    slotSpan,
    snapToStep,
} from "./placement.js";
import { sessionShape } from "./session-shape.js";

/**
 * What a gesture has to ask the grid, since only the grid knows its own layout.
 *
 * An hour's height depends on the shortest slot in it and a run of hours may be
 * collapsed away, so pixels cannot be turned into minutes by arithmetic out
 * here.
 */
export type ScheduleGridHandle = {
    minutesAt: (clientY: number) => number | undefined;
    locationIdAt: (clientX: number) => string | undefined;
};

/** A session about to get a slot, at its own length or else its type's. */
export type NewSlot = {
    session: SlottableSession;
    length: number;
    shoulders: Shoulders;
};

/** Shapes a session dragged out of the list, in the minutes the grid works in. */
export const newSlotFor = (session: SlottableSession): NewSlot => {
    const shape = sessionShape(session);

    return {
        session,
        length: shape.length.total("minutes"),
        shoulders: {
            setup: shape.setupTime.total("minutes"),
            teardown: shape.teardownTime.total("minutes"),
        },
    };
};

export type DragSubject =
    | ({ kind: "create" } & NewSlot)
    | { kind: "move"; slot: Slot; grabMinutes: number };

export type SlotDrag = {
    subject: DragSubject;
    /** Where the pointer is, for anything that has to keep out of its way. */
    at: PointerPosition;
    /** Over the one target that is not a room, so the release does not place. */
    overCorner: boolean;
    /** Nothing while the pointer is off the rooms or over a collapsed run. */
    candidate: Candidate | null;
    refusal: Refusal | null;
    moved: boolean;
};

/** What letting go on the corner target does. */
export type DropAction = "remove" | "cancel";

/**
 * Says what the corner target offers, or nothing where it is not offered.
 *
 * One reading for both, so what the corner means and when it is on screen
 * cannot drift apart: the hit test asks this, and so does the decision to draw
 * the target at all. A press that has not traveled is still a click on a block,
 * which is why a move earns the corner only once it moves, where a new session
 * has no block to open and earns it at once.
 */
const actionFor = (subject: DragSubject, moved: boolean): DropAction | null =>
    match(subject)
        .with({ kind: "create" }, (): DropAction | null => "cancel")
        .with({ kind: "move" }, (): DropAction | null => (moved ? "remove" : null))
        .exhaustive();

export const cornerAction = (drag: SlotDrag | null): DropAction | null =>
    drag === null ? null : actionFor(drag.subject, drag.moved);

export const draggedTitle = (subject: DragSubject): string =>
    subject.kind === "create" ? subject.session.title : subject.slot.session.title;

type UseSlotDragOptions = {
    axis: ScheduleAxis;
    slots: readonly Slot[];
    step: MinuteStep;
    onPlace: (subject: DragSubject, candidate: Candidate) => void;
    onRefuse: (refusal: Refusal) => void;
    onSelect: (slot: Slot) => void;
    /** Only ever a slot that is already placed, which alone can be removed. */
    onRemove: (slot: Slot) => void;
};

export type GridHandlers = {
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
};

type SlotDragControls = {
    drag: SlotDrag | null;
    scrollRef: RefObject<HTMLDivElement | null>;
    gridRef: RefObject<HTMLDivElement | null>;
    handleRef: RefObject<ScheduleGridHandle | null>;
    gridHandlers: GridHandlers;
    /** For the corner target, which is dropped onto rather than pressed. */
    cornerRef: RefObject<HTMLDivElement | null>;
    startCreate: (newSlot: NewSlot, press: PressPoint) => void;
    startMove: (slot: Slot, press: PressPoint) => void;
    tapSlot: (slot: Slot) => void;
};

export type PointerPosition = {
    clientX: number;
    clientY: number;
};

export type PressPoint = PointerPosition & {
    pointerId: number;
    button: number;
};

type PlanarEdgesReached = EdgesReached & {
    left: boolean;
    right: boolean;
};

const noEdgesReached: PlanarEdgesReached = { up: false, down: false, left: false, right: false };

/** How far a pointer may wander and still be a click rather than a drag. */
const CLICK_SLACK = 3;

export const useSlotDrag = ({
    axis,
    slots,
    step,
    onPlace,
    onRefuse,
    onSelect,
    onRemove,
}: UseSlotDragOptions): SlotDragControls => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<ScheduleGridHandle>(null);
    const cornerRef = useRef<HTMLDivElement>(null);
    /**
     * Never reset, because nothing can read it stale.
     *
     * The scrolling loop is the only reader and runs only while a drag is live,
     * and begin writes this through withRefusal before it sets the state that
     * starts the loop. A reset in finish would look like it guarded the drop,
     * and would not: handlePointerUp resolves once more after finish returns.
     */
    const overCornerRef = useRef(false);
    const pointerRef = useRef<number | null>(null);
    const originRef = useRef<PointerPosition | null>(null);
    const positionRef = useRef<PointerPosition | null>(null);
    const reachedRef = useRef<PlanarEdgesReached>({ ...noEdgesReached });
    const [drag, setDrag] = useState<SlotDrag | null>(null);

    const resolve = (subject: DragSubject, position: PointerPosition): Candidate | null => {
        const handle = handleRef.current;
        const minutes = handle?.minutesAt(position.clientY);

        if (!handle || minutes === undefined) {
            return null;
        }

        const locationId = handle.locationIdAt(position.clientX);

        if (locationId === undefined) {
            return null;
        }

        return match(subject)
            .with({ kind: "create" }, (create): Candidate => {
                const from = snapToStep(minutes, step);

                return {
                    locationId,
                    span: clampSpan(
                        axis,
                        { from, to: from + create.length },
                        create.shoulders,
                        step,
                    ),
                    shoulders: create.shoulders,
                };
            })
            .with({ kind: "move" }, (move): Candidate => {
                const shoulders = slotShoulders(move.slot);
                const current = slotSpan(axis, move.slot);
                const from = snapToStep(minutes - move.grabMinutes, step);

                return {
                    locationId,
                    span: clampSpan(
                        axis,
                        { from, to: from + (current.to - current.from) },
                        shoulders,
                        step,
                    ),
                    shoulders,
                };
            })
            .exhaustive();
    };

    /**
     * Tests whether the pointer is over the corner target.
     *
     * Read from the element rather than tracked by enter and leave events: the
     * gesture holds the grid's pointer capture, so nothing the pointer passes
     * over hears about it. Asked of the same predicate that decides whether to
     * draw the target, so a gesture the corner does not answer keeps reading
     * the rooms under it however the caller chose to mount things.
     */
    const overCorner = (
        subject: DragSubject,
        position: PointerPosition,
        moved: boolean,
    ): boolean => {
        const corner = cornerRef.current;

        if (!corner || actionFor(subject, moved) === null) {
            return false;
        }

        const rect = corner.getBoundingClientRect();

        return (
            position.clientX >= rect.left &&
            position.clientX < rect.right &&
            position.clientY >= rect.top &&
            position.clientY < rect.bottom
        );
    };

    const withRefusal = (
        subject: DragSubject,
        position: PointerPosition,
        moved: boolean,
    ): SlotDrag => {
        const cornered = overCorner(subject, position, moved);
        const candidate = cornered ? null : resolve(subject, position);

        overCornerRef.current = cornered;

        return {
            subject,
            at: position,
            overCorner: cornered,
            candidate,
            moved,
            refusal:
                candidate === null
                    ? null
                    : refusePlacement({
                          axis,
                          candidate,
                          slots,
                          exceptSlotId: subject.kind === "create" ? undefined : subject.slot.id,
                      }),
        };
    };

    const begin = (subject: DragSubject, press: PressPoint) => {
        if (press.button !== 0 || pointerRef.current !== null) {
            return;
        }

        const grid = gridRef.current;

        if (!grid) {
            return;
        }

        // Captured on the grid rather than on what was pressed: a sidebar entry
        // is not on the grid at all, and a block being moved leaves the column
        // it started in. Nothing routes to the grid without it, so a gesture
        // begun anyway could never reach the pointerup that ends it, and the
        // held pointer would refuse every gesture after it.
        try {
            grid.setPointerCapture(press.pointerId);
        } catch {
            return;
        }

        const position = { clientX: press.clientX, clientY: press.clientY };
        pointerRef.current = press.pointerId;
        originRef.current = position;
        positionRef.current = position;
        reachedRef.current = { ...noEdgesReached };
        setDrag(withRefusal(subject, position, false));
    };

    const startCreate = (newSlot: NewSlot, press: PressPoint) => {
        begin({ kind: "create", ...newSlot }, press);
    };

    const startMove = (slot: Slot, press: PressPoint) => {
        const minutes = handleRef.current?.minutesAt(press.clientY);
        const span = slotSpan(axis, slot);

        begin(
            { kind: "move", slot, grabMinutes: minutes === undefined ? 0 : minutes - span.from },
            press,
        );
    };

    /**
     * Opens a slot without carrying it, which on touch nothing else can do.
     *
     * A press that never travels is a click, and `settle` reads it as one. A
     * finger never gets that far: it has to rest before it becomes a gesture at
     * all, so a tap ends before anything is held and never reaches a release to
     * be read.
     */
    const tapSlot = (slot: Slot) => {
        onSelect(slot);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        const origin = originRef.current;

        if (!(drag && origin) || pointerRef.current !== event.pointerId) {
            return;
        }

        const previous = positionRef.current;
        const position = { clientX: event.clientX, clientY: event.clientY };
        positionRef.current = position;

        if (previous) {
            reachedRef.current.up ||= position.clientY < previous.clientY;
            reachedRef.current.down ||= position.clientY > previous.clientY;
            reachedRef.current.left ||= position.clientX < previous.clientX;
            reachedRef.current.right ||= position.clientX > previous.clientX;
        }

        const traveled =
            Math.hypot(position.clientX - origin.clientX, position.clientY - origin.clientY) >
            CLICK_SLACK;

        setDrag(withRefusal(drag.subject, position, drag.moved || traveled));
    };

    /**
     * Puts the gesture down without deciding anything about what it held.
     *
     * Releasing the capture matters beyond tidiness: the pointer is still down
     * after an abandoned gesture, and the pointerup that follows has to reach
     * whatever is under it rather than the grid.
     */
    const abort = () => {
        const pointerId = pointerRef.current;

        if (pointerId !== null && gridRef.current?.hasPointerCapture(pointerId) === true) {
            gridRef.current.releasePointerCapture(pointerId);
        }

        pointerRef.current = null;
        originRef.current = null;
        positionRef.current = null;
        setDrag(null);
    };

    const finish = (event: ReactPointerEvent<HTMLElement>): SlotDrag | null => {
        if (!drag || pointerRef.current !== event.pointerId) {
            return null;
        }

        abort();

        return drag;
    };

    const settle = (finished: SlotDrag) => {
        if (!finished.moved) {
            if (finished.subject.kind !== "create") {
                onSelect(finished.subject.slot);
            }

            return;
        }

        if (finished.overCorner) {
            if (finished.subject.kind === "move") {
                onRemove(finished.subject.slot);
            }

            return;
        }

        if (finished.refusal) {
            onRefuse(finished.refusal);
            return;
        }

        if (finished.candidate) {
            onPlace(finished.subject, finished.candidate);
        }
    };

    const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
        const held = finish(event);

        if (!held) {
            return;
        }

        const at = { clientX: event.clientX, clientY: event.clientY };

        // Read again from the release rather than reusing the last move, which
        // a pointer coalescing its moves can leave a few minutes behind.
        settle(withRefusal(held.subject, at, held.moved));
    };

    const handlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
        finish(event);
    };

    /**
     * Ends a gesture only for a capture that is really gone.
     *
     * A finger holds an implicit capture on whatever it landed on, so taking
     * that capture for the grid makes the browser report a loss at the pressed
     * element. The event bubbles, and the pressed element is inside the grid,
     * so that loss arrives here while the grid already holds the capture the
     * gesture needs. Only a loss that leaves the grid without it ends anything.
     *
     * Every other pointer's loss arrives here too, including a second finger
     * landing elsewhere in the grid and letting go again, which is why this
     * answers for one pointer rather than for whichever event turned up.
     */
    const handleLostCapture = (event: ReactPointerEvent<HTMLElement>) => {
        if (pointerRef.current !== event.pointerId) {
            return;
        }

        if (gridRef.current?.hasPointerCapture(event.pointerId) !== true) {
            abort();
        }
    };

    /**
     * Reads the candidate again for a pointer that has not moved.
     *
     * Held through a ref because the scrolling loop below must not be torn down
     * and rebuilt between frames: it measures how long a frame took, and a
     * restart puts that back to nothing.
     */
    const rescan = () => {
        const pointer = positionRef.current;

        if (!pointer) {
            return;
        }

        setDrag((current) =>
            current ? withRefusal(current.subject, pointer, current.moved) : current,
        );
    };

    const rescanRef = useRef(rescan);

    useEffect(() => {
        rescanRef.current = rescan;
    });

    const abortRef = useRef(abort);

    useEffect(() => {
        abortRef.current = abort;
    });

    const dragging = drag !== null;
    const draggingRef = useRef(false);
    draggingRef.current = dragging;

    useTouchScrollLock(draggingRef, () => document);

    /**
     * Lets go of a gesture without placing what it holds.
     *
     * On the window rather than the grid, which never has focus: the gesture
     * holds the grid's pointer capture, not its focus, and a key pressed
     * mid-drag goes wherever focus already was.
     */
    useEffect(() => {
        if (!dragging) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                abortRef.current();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [dragging]);

    /**
     * Scrolls the grid toward whichever edge a held gesture reaches.
     *
     * Holding a session is the one time the scrollbar is out of reach, and an
     * edition is taller and wider than the viewport by design.
     */
    useEffect(() => {
        if (!dragging) {
            return;
        }

        let frame = 0;
        let previous = performance.now();
        let carryTop = 0;
        let carryLeft = 0;

        const follow = (now: number) => {
            const scroller = scrollRef.current;
            const pointer = positionRef.current;
            const elapsed = (now - previous) / 1000;
            previous = now;

            // The target sits in the corner, which is exactly where the grid
            // follows a gesture hardest. Scrolling while it holds the drop
            // would churn the schedule under a pointer that has already left
            // the rooms and is only deciding whether to let go.
            if (scroller && pointer && !overCornerRef.current) {
                const rect = scroller.getBoundingClientRect();
                const reached = reachedRef.current;
                const before = { top: scroller.scrollTop, left: scroller.scrollLeft };

                const top = carryScroll(
                    before.top,
                    edgeScrollDistance(
                        pointer.clientY - rect.top,
                        rect.bottom - pointer.clientY,
                        reached,
                        elapsed,
                    ),
                    carryTop,
                    scroller.scrollHeight - scroller.clientHeight,
                );
                // edgeScrollDistance names its two directions up and down.
                // Across the rooms they are left and right, and the arithmetic
                // is the same.
                const left = carryScroll(
                    before.left,
                    edgeScrollDistance(
                        pointer.clientX - rect.left,
                        rect.right - pointer.clientX,
                        { up: reached.left, down: reached.right },
                        elapsed,
                    ),
                    carryLeft,
                    scroller.scrollWidth - scroller.clientWidth,
                );
                carryTop = top.carry;
                carryLeft = left.carry;
                scroller.scrollTop = top.position;
                scroller.scrollLeft = left.position;

                if (scroller.scrollTop !== before.top || scroller.scrollLeft !== before.left) {
                    rescanRef.current();
                }
            }

            frame = requestAnimationFrame(follow);
        };

        frame = requestAnimationFrame(follow);

        return () => {
            cancelAnimationFrame(frame);
        };
    }, [dragging]);

    return {
        drag,
        scrollRef,
        gridRef,
        handleRef,
        cornerRef,
        gridHandlers: {
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onPointerCancel: handlePointerCancel,
            onLostPointerCapture: handleLostCapture,
        },
        startCreate,
        startMove,
        tapSlot,
    };
};
