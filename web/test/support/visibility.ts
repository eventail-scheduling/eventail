import type { page } from "vitest/browser";

/**
 * Tells whether the located element is visible, not only present in the document.
 *
 * A dialog that is kept mounted leaves its contents in the document while it is
 * closed, so an assertion that they are merely present would pass in tests it
 * has nothing to do with.
 */
export const onShow = (locator: ReturnType<typeof page.getByText>): boolean =>
    locator.query()?.checkVisibility({ visibilityProperty: true }) === true;
