import { type RefObject, useEffect, useRef } from "react";

/**
 * Stops the page scrolling under a gesture that has already been armed.
 *
 * A finger only reaches a gesture by resting first, which means the browser
 * was left free to pan until then, and `touch-action` is read once when the
 * touch begins rather than consulted as it moves. Only preventing the move
 * itself still takes the scroll back. Attached for as long as the caller
 * lives rather than for the length of a gesture: one added on arming is a
 * frame late, and the browser has already begun scrolling by then.
 *
 * The target is asked for once, on mount, and has to contain every place a
 * gesture's touch can start from.
 */
export const useTouchScrollLock = (
    activeRef: RefObject<boolean>,
    target: () => EventTarget | null,
): void => {
    const targetRef = useRef(target);

    useEffect(() => {
        const eventTarget = targetRef.current();

        if (!eventTarget) {
            return;
        }

        const suppressScroll = (event: Event) => {
            if (activeRef.current) {
                event.preventDefault();
            }
        };

        eventTarget.addEventListener("touchmove", suppressScroll, { passive: false });

        return () => {
            eventTarget.removeEventListener("touchmove", suppressScroll);
        };
    }, [activeRef]);
};
