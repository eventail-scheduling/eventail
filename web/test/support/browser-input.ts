import { cdp } from "vitest/browser";

export type Point = {
    x: number;
    y: number;
};

export type PointerInput = {
    down: (point: Point) => Promise<void>;
    move: (point: Point) => Promise<void>;
    up: (point: Point) => Promise<void>;
};

export const mouse = (): PointerInput => {
    const session = cdp();
    const dispatch = async (
        type: "mousePressed" | "mouseMoved" | "mouseReleased",
        point: Point,
        buttons: number,
    ): Promise<void> => {
        await session.send("Input.dispatchMouseEvent", {
            type,
            ...point,
            button: "left",
            buttons,
            clickCount: 1,
        });
    };

    return {
        down: (point) => dispatch("mousePressed", point, 1),
        move: (point) => dispatch("mouseMoved", point, 1),
        up: (point) => dispatch("mouseReleased", point, 0),
    };
};

/**
 * Turns on touch emulation and returns a finger; pair with `stopTouch` in `afterEach`.
 */
export const touch = async (): Promise<PointerInput> => {
    const session = cdp();

    await session.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
    });

    const dispatch = async (
        type: "touchStart" | "touchMove" | "touchEnd",
        point: Point,
    ): Promise<void> => {
        await session.send("Input.dispatchTouchEvent", {
            type,
            // A release carries no points, which is how Chrome tells the last
            // finger apart from one that is still down.
            touchPoints: type === "touchEnd" ? [] : [{ ...point, id: 1 }],
        });
    };

    return {
        down: (point) => dispatch("touchStart", point),
        move: (point) => dispatch("touchMove", point),
        up: (point) => dispatch("touchEnd", point),
    };
};

/**
 * Turns touch emulation back off, for `afterEach` in any file that called `touch`.
 *
 * The emulation outlives the test that turned it on, so later tests in the same
 * file would otherwise still see a touch device. Measured: this brings back
 * maxTouchPoints and (pointer: coarse), but NOT (hover: hover), which stays
 * false for the rest of the file. Test files each get their own browser
 * context, so nothing escapes this one.
 */
export const stopTouch = async (): Promise<void> => {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
};

export const wait = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
