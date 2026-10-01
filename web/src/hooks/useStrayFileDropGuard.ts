import { useEffect } from "react";

/**
 * Stops a file dropped outside a drop target from replacing the page.
 *
 * A browser's default for a dropped file is to open it, so a drop that misses
 * by a few pixels navigates away and takes an unsaved form with it. A target
 * that wants the file has already handled the event by the time this runs, and
 * preventing the default twice costs nothing.
 */
export const useStrayFileDropGuard = (): void => {
    useEffect(() => {
        const swallow = (event: DragEvent) => {
            event.preventDefault();
        };

        // Both: without the dragover half the drop never fires at all.
        window.addEventListener("dragover", swallow);
        window.addEventListener("drop", swallow);

        return () => {
            window.removeEventListener("dragover", swallow);
            window.removeEventListener("drop", swallow);
        };
    }, []);
};
