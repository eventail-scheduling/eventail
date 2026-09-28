import { expect } from "vitest";

/**
 * Fails when the element has nowhere to scroll.
 *
 * A scroll assertion over an element that already fits holds still whatever the
 * input did, so it would pass on a gesture that never worked.
 */
export const assertScrollable = (element: HTMLElement): void => {
    expect(element.scrollHeight).toBeGreaterThan(element.clientHeight);
};
