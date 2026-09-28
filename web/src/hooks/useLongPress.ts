import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";

/**
 * How long a finger has to rest before it means a gesture instead of a scroll.
 *
 * FullCalendar waits a second and react-big-calendar a quarter of one. This
 * sits between them, and under the 500ms both Android and iOS take for their
 * own long press, so a gesture here arms before the platform offers its menu.
 */
const LONG_PRESS_MS = 400;
/** How far a finger may wander in that time and still count as resting. */
const LONG_PRESS_SLOP = 10;

/** Where a press is, which is not where it landed once a finger has drifted. */
export type PressAt = {
    clientX: number;
    clientY: number;
};

type PendingPress = {
    pointerId: number;
    /** Where it landed, which is what the slop is measured against. */
    clientX: number;
    clientY: number;
    /** Where it has drifted to since, which is what the gesture begins from. */
    at: PressAt;
    /** What the press becomes once it has been held long enough. */
    arm: (at: PressAt) => void;
    /** What it meant instead, if it was let go first. */
    tap: (at: PressAt) => void;
    timer: ReturnType<typeof setTimeout>;
};

type LongPress = {
    armGesture: (
        event: ReactPointerEvent<HTMLElement>,
        arm: (at: PressAt) => void,
        tap: (at: PressAt) => void,
    ) => void;
    trackPending: (event: ReactPointerEvent<HTMLElement>) => boolean;
    finishPending: (event: ReactPointerEvent<HTMLElement>) => void;
    cancelPending: (event: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * Tells a press that is a gesture from one that starts a scroll.
 *
 * Nothing here knows what the gesture would be: it takes both answers from the
 * caller and runs whichever the press turns out to mean.
 */
export const useLongPress = (): LongPress => {
    const pendingRef = useRef<PendingPress | null>(null);

    const dropPending = () => {
        if (pendingRef.current) {
            clearTimeout(pendingRef.current.timer);
            pendingRef.current = null;
        }
    };

    /**
     * Arms a mouse or pen press at once, and makes a touch rest first.
     *
     * A finger means to scroll until it has held still long enough to mean
     * otherwise.
     */
    const armGesture = (
        event: ReactPointerEvent<HTMLElement>,
        arm: (at: PressAt) => void,
        tap: (at: PressAt) => void,
    ) => {
        const { pointerId, clientX, clientY } = event;

        if (event.pointerType !== "touch") {
            arm({ clientX, clientY });
            return;
        }

        dropPending();
        const pending: PendingPress = {
            pointerId,
            clientX,
            clientY,
            at: { clientX, clientY },
            arm,
            tap,
            timer: setTimeout(() => {
                pendingRef.current = null;
                arm(pending.at);
            }, LONG_PRESS_MS),
        };
        pendingRef.current = pending;
    };

    /**
     * Follows a move against the pending press, and reports whether it belonged to one.
     *
     * Slop past the threshold gives up on the press and still reports true: the
     * move belonged to it either way.
     */
    const trackPending = (event: ReactPointerEvent<HTMLElement>): boolean => {
        const pending = pendingRef.current;

        if (pending?.pointerId !== event.pointerId) {
            return false;
        }

        if (
            Math.abs(event.clientX - pending.clientX) > LONG_PRESS_SLOP ||
            Math.abs(event.clientY - pending.clientY) > LONG_PRESS_SLOP
        ) {
            dropPending();

            return true;
        }

        // Tracked separately from the landing point, which the slop above stays
        // anchored to. A gesture that began where the finger landed would read
        // the drift it allowed as travel, and a hold that ends without moving
        // would settle as a placement rather than a click.
        pending.at = { clientX: event.clientX, clientY: event.clientY };

        return true;
    };

    const finishPending = (event: ReactPointerEvent<HTMLElement>) => {
        const pending = pendingRef.current;

        if (pending?.pointerId !== event.pointerId) {
            return;
        }

        dropPending();
        pending.tap(pending.at);
    };

    const cancelPending = (event: ReactPointerEvent<HTMLElement>) => {
        if (pendingRef.current?.pointerId === event.pointerId) {
            dropPending();
        }
    };

    useEffect(
        () => () => {
            if (pendingRef.current) {
                clearTimeout(pendingRef.current.timer);
            }
        },
        [],
    );

    return { armGesture, trackPending, finishPending, cancelPending };
};
