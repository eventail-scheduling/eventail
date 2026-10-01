import {
    type PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { isAfter } from "temporal-extra";
import { match } from "ts-pattern";
import { useLongPress } from "#/hooks/useLongPress.ts";
import { useTouchScrollLock } from "#/hooks/useTouchScrollLock.ts";
import { type AvailabilityInterval, mergeIntervals } from "#/utils/availability.ts";
import {
    type AbsoluteRange,
    applyDrag,
    carryScroll,
    clamp,
    columnIndexAt,
    type Drag,
    drawEndWhereTimeStopped,
    edgeScrollDistance,
    type Grid,
    missingRanges,
    SNAP_MINUTES,
    snapEnd,
    splitByDay,
    TAP_MINUTES,
    toAbsolute,
    toInstant,
} from "./geometry.ts";

type PointerPosition = {
    clientX: number;
    clientY: number;
};

type UseAvailabilityDragOptions = {
    grid: Grid;
    value: readonly AvailabilityInterval[];
    onValueChange: (value: AvailabilityInterval[]) => void;
    onBlur?: () => void;
    disabled: boolean;
};

type AvailabilityDrag = {
    /** What to draw, which is the committed blocks until a gesture changes them. */
    previewRanges: AbsoluteRange[];
    /** The rows each day does not have, for the grid to shade. */
    missingByDay: AbsoluteRange[][];
    selected: number | null;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    gridRef: React.RefObject<HTMLDivElement | null>;
    columnRefs: React.RefObject<(HTMLDivElement | null)[]>;
    /** Spread onto the grid, which is where a gesture is captured. */
    gridHandlers: {
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    };
    startCreate: (dayIndex: number, event: ReactPointerEvent<HTMLDivElement>) => void;
    startMove: (
        index: number,
        dayIndex: number,
        grabOffset: number,
        event: ReactPointerEvent<HTMLElement>,
    ) => void;
    startResize: (
        index: number,
        edge: "start" | "end",
        event: ReactPointerEvent<HTMLElement>,
    ) => void;
};

/**
 * Turns pointer gestures on the caller's grid into changes to the value.
 *
 * It holds what is being drawn, what a gesture would make of it, and what is
 * committed when it ends. The grid it draws on is the caller's, so the refs
 * come back out to be hung on the elements the gestures are measured against.
 */
export const useAvailabilityDrag = ({
    grid,
    value,
    onValueChange,
    onBlur,
    disabled,
}: UseAvailabilityDragOptions): AvailabilityDrag => {
    const { days, axis } = grid;
    const { minutesPerColumn } = axis;

    const { armGesture, trackPending, finishPending, cancelPending } = useLongPress();
    const scrollRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const pointerRef = useRef<PointerPosition | null>(null);
    const draggingRef = useRef(false);
    const reachedRef = useRef({ up: false, down: false });
    const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [selected, setSelected] = useState<number | null>(null);

    const missingByDay = useMemo(
        () => grid.days.map((_day, dayIndex) => missingRanges(grid, dayIndex)),
        [grid],
    );

    const ranges = useMemo(
        () =>
            splitByDay(
                minutesPerColumn,
                value.map((interval) => ({
                    from: toAbsolute(grid, interval.startsAt),
                    to: toAbsolute(grid, interval.endsAt),
                })),
            ).map((piece) => drawEndWhereTimeStopped(minutesPerColumn, piece, missingByDay)),
        [value, grid, minutesPerColumn, missingByDay],
    );

    const gapAt = useCallback(
        (dayIndex: number, minutes: number): AbsoluteRange | undefined =>
            missingByDay[dayIndex]?.find((range) => minutes >= range.from && minutes < range.to),
        [missingByDay],
    );

    const minutesFrom = useCallback(
        (clientY: number): number | null => {
            const element = columnRefs.current[0];

            if (!element) {
                return null;
            }

            const rect = element.getBoundingClientRect();
            const raw = ((clientY - rect.top) / rect.height) * minutesPerColumn;

            // Unsnapped on purpose: which way a minute rounds depends on which
            // edge of a block it is about to become, and only the drawing knows
            // that. Snapping here would make every edge round the same way.
            return clamp(raw, 0, minutesPerColumn);
        },
        [minutesPerColumn],
    );

    const dayIndexFrom = useCallback(
        (clientX: number): number => {
            const columns = columnRefs.current.slice(0, days.length);
            const found = columnIndexAt(columns, clientX);

            if (found !== -1) {
                return found;
            }

            const first = columns[0]?.getBoundingClientRect();

            return first && clientX < first.left ? 0 : days.length - 1;
        },
        [days.length],
    );

    const commit = useCallback(
        (next: AbsoluteRange[]) => {
            const intervals = next
                .filter((range) => range.to > range.from)
                .map((range) => ({
                    startsAt: toInstant(grid, range.from),
                    endsAt: toInstant(grid, range.to),
                }))
                // Both edges of a block drawn inside an hour the clocks skip
                // land on the instant the skip ends, which is no stretch of
                // time at all.
                .filter((interval) => isAfter(interval.endsAt, interval.startsAt));

            onValueChange(mergeIntervals(intervals));
            setSelected(null);
            onBlur?.();
        },
        [grid, onValueChange, onBlur],
    );

    const startDrag = (event: ReactPointerEvent<HTMLElement>, next: Drag) => {
        // The grid outlives every gesture; a block changing column mid-move
        // would take its capture with it and strand the drag.
        try {
            gridRef.current?.setPointerCapture(event.pointerId);
        } catch {
            // The pointer went away between the press and here, so no
            // pointerup will reach the grid, and a gesture begun anyway would
            // hold the grid and refuse every gesture after it.
            return;
        }

        pointerRef.current = null;
        reachedRef.current = { up: false, down: false };
        draggingRef.current = true;
        setDrag(next);
    };

    const startCreate = (dayIndex: number, event: ReactPointerEvent<HTMLDivElement>) => {
        const minutes =
            disabled || drag !== null || event.button !== 0 ? null : minutesFrom(event.clientY);

        if (minutes === null) {
            return;
        }

        const pressedAt = dayIndex * minutesPerColumn + minutes;

        armGesture(
            event,
            () => {
                startDrag(event, {
                    pointerId: event.pointerId,
                    mode: "create",
                    dayIndex,
                    anchorMinutes: minutes,
                    minutes,
                });
            },
            () => {
                finishCreate({ from: pressedAt, to: pressedAt }, dayIndex);
            },
        );
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (trackPending(event)) {
            return;
        }

        const minutes =
            drag && drag.pointerId === event.pointerId ? minutesFrom(event.clientY) : null;

        if (minutes === null || !drag) {
            return;
        }

        const previous = pointerRef.current;
        pointerRef.current = { clientX: event.clientX, clientY: event.clientY };

        if (previous) {
            reachedRef.current.up ||= event.clientY < previous.clientY;
            reachedRef.current.down ||= event.clientY > previous.clientY;
        }

        setDrag(
            match(drag)
                .with({ mode: "create" }, (create): Drag => ({ ...create, minutes }))
                .with({ mode: "move" }, (move): Drag => {
                    const dayIndex = dayIndexFrom(event.clientX);

                    return {
                        ...move,
                        dayIndex,
                        minutes,
                        moved: move.moved || dayIndex !== move.dayIndex || minutes !== move.minutes,
                    };
                })
                .with(
                    { mode: "resize" },
                    (resize): Drag => ({
                        ...resize,
                        minutes,
                        moved: resize.moved || minutes !== resize.minutes,
                    }),
                )
                .exhaustive(),
        );
    };

    const removeAt = (index: number) => {
        commit(ranges.filter((_, position) => position !== index));
    };

    const finishClick = (index: number) => {
        if (selected === index) {
            removeAt(index);
            return;
        }

        setSelected(index);
    };

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        finishPending(event);

        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }

        if (gridRef.current?.hasPointerCapture(event.pointerId)) {
            gridRef.current.releasePointerCapture(event.pointerId);
        }

        const finished = drag;
        draggingRef.current = false;
        setDrag(null);
        pointerRef.current = null;
        reachedRef.current = { up: false, down: false };

        // A press that never left its slot is a click, which is how a block is
        // armed and then removed. An edge takes up most of a tall block, so it
        // has to answer a click the same way the middle does.
        if (finished.mode !== "create" && !finished.moved) {
            finishClick(finished.index);
            return;
        }

        const next = applyDrag(minutesPerColumn, ranges, finished, gapAt);

        if (finished.mode === "create") {
            finishCreate(next[next.length - 1], finished.dayIndex);
            return;
        }

        commit(next);
    };

    const startMove = (
        index: number,
        dayIndex: number,
        fromMinutes: number,
        event: ReactPointerEvent<HTMLElement>,
    ) => {
        const minutes =
            disabled || drag !== null || event.button !== 0 ? null : minutesFrom(event.clientY);

        if (minutes === null) {
            return;
        }

        event.stopPropagation();
        armGesture(
            event,
            () => {
                startDrag(event, {
                    pointerId: event.pointerId,
                    mode: "move",
                    index,
                    grabOffset: minutes - fromMinutes,
                    dayIndex,
                    minutes,
                    moved: false,
                });
            },
            () => {
                finishClick(index);
            },
        );
    };

    const startResize = (
        index: number,
        edge: "start" | "end",
        event: ReactPointerEvent<HTMLElement>,
    ) => {
        const minutes =
            disabled || drag !== null || event.button !== 0 ? null : minutesFrom(event.clientY);

        if (minutes === null) {
            return;
        }

        event.stopPropagation();
        armGesture(
            event,
            () => {
                startDrag(event, {
                    pointerId: event.pointerId,
                    mode: "resize",
                    index,
                    edge,
                    minutes,
                    moved: false,
                });
            },
            () => {
                finishClick(index);
            },
        );
    };

    /**
     * Commits what a press drew, or treats it as a tap if it drew nothing.
     *
     * A tap puts down a block of its own, unless something was selected, in
     * which case it lets that go instead, or unless it never left an hour the
     * clocks skip, where there is no time to put a block on.
     */
    const finishCreate = (drawn: AbsoluteRange, dayIndex: number) => {
        if (drawn.to - drawn.from >= SNAP_MINUTES) {
            commit([...ranges, drawn]);
            return;
        }

        if (selected !== null) {
            setSelected(null);
            return;
        }

        const dayStart = dayIndex * minutesPerColumn;
        // Where a drag that never left an hour the clocks skip comes back to,
        // since snapping sent its edges past each other in opposite directions.
        // The last half hour of a day holds a whole tap, so a press below it
        // lands there rather than past midnight.
        const pressed = Math.min(
            Math.min(drawn.from, drawn.to) - dayStart,
            minutesPerColumn - TAP_MINUTES,
        );

        if (gapAt(dayIndex, pressed)) {
            return;
        }

        const from = dayStart + pressed;
        const to = dayStart + snapEnd(gapAt, dayIndex, pressed + TAP_MINUTES);

        if (to > from) {
            commit([...ranges, { from, to }]);
        }
    };

    const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
        cancelPending(event);

        if (drag?.pointerId === event.pointerId) {
            draggingRef.current = false;
            pointerRef.current = null;
            reachedRef.current = { up: false, down: false };
            setDrag(null);
        }
    };

    // Deliberately without a dependency array: the handler removes a block by
    // rebuilding the list it closed over, so a listener kept across renders
    // would delete against a stale one.
    useEffect(() => {
        if (selected === null || disabled || drag) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;

            if (
                target instanceof HTMLElement &&
                target.closest("input, textarea, [contenteditable]")
            ) {
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                removeAt(selected);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    });

    const dragging = drag !== null;

    // On whether a gesture is active rather than on the gesture itself: every
    // pixel it follows updates the gesture, and restarting the loop then would
    // drop the time the render took, which on a slow device stalls it.
    useEffect(() => {
        const scroller = scrollRef.current;

        if (!(dragging && scroller)) {
            return;
        }

        let frame = 0;
        let last = performance.now();
        let carry = 0;

        const step = (now: number) => {
            const elapsed = (now - last) / 1000;
            last = now;
            const pointer = pointerRef.current;

            if (pointer) {
                const rect = scroller.getBoundingClientRect();
                const distance = edgeScrollDistance(
                    pointer.clientY - rect.top,
                    rect.bottom - pointer.clientY,
                    reachedRef.current,
                    elapsed,
                );
                const before = scroller.scrollTop;
                const scroll = carryScroll(
                    before,
                    distance,
                    carry,
                    scroller.scrollHeight - scroller.clientHeight,
                );
                carry = scroll.carry;

                if (scroll.position !== before) {
                    scroller.scrollTop = scroll.position;
                }

                if (scroller.scrollTop !== before) {
                    setDrag((current) => {
                        const nowMinutes = minutesFrom(pointer.clientY);

                        if (!current || nowMinutes === null) {
                            return current;
                        }

                        return current.mode === "create"
                            ? { ...current, minutes: nowMinutes }
                            : { ...current, minutes: nowMinutes, moved: true };
                    });
                }
            }

            frame = requestAnimationFrame(step);
        };

        frame = requestAnimationFrame(step);

        return () => {
            cancelAnimationFrame(frame);
        };
    }, [dragging, minutesFrom]);

    useTouchScrollLock(draggingRef, () => gridRef.current);

    const previewRanges = useMemo(() => {
        if (!drag) {
            return ranges;
        }

        const next = applyDrag(minutesPerColumn, ranges, drag, gapAt).map((piece) =>
            drawEndWhereTimeStopped(minutesPerColumn, piece, missingByDay),
        );

        return drag.mode === "create" && next[next.length - 1].to <= next[next.length - 1].from
            ? ranges
            : next;
    }, [ranges, drag, gapAt, missingByDay, minutesPerColumn]);

    return {
        previewRanges,
        missingByDay,
        selected,
        scrollRef,
        gridRef,
        columnRefs,
        gridHandlers: {
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onPointerCancel: handlePointerCancel,
        },
        startCreate,
        startMove,
        startResize,
    };
};
