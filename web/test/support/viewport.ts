import { afterEach } from "vitest";
import { page } from "vitest/browser";

/**
 * The viewport every browser test starts in, matching the one in vitest.config.ts.
 *
 * Tests measure themselves against it, so a file that changes it has to put it
 * back.
 */
export const suiteViewport = { width: 1024, height: 640 };

/**
 * Restores {@link suiteViewport} after every test in the calling file.
 *
 * The viewport outlives the test that set it, so without this a later test in
 * the same file reads whatever the last one left.
 */
export const restoreViewportAfterEach = (): void => {
    afterEach(async () => {
        await page.viewport(suiteViewport.width, suiteViewport.height);
    });
};
