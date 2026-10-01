const RESUME_PATH_KEY = "signInResumePath";

/**
 * Keeps a path for the next sign-in to land on, across a sign-out through the provider.
 *
 * A sign-out returns to the start page, since not every provider accepts a deep return address,
 * so the path waits here until the app starts there. A provider without a sign-out endpoint
 * reloads the page in place instead, which is already where the path leads.
 */
export const rememberSignInResumePath = (path: string): void => {
    window.localStorage.setItem(RESUME_PATH_KEY, path);
};

/**
 * Removes the path a sign-out left, returning it when the app starts on the start page.
 *
 * Removed on every start, so a sign-out that never came back leaves nothing for a later sign-in
 * elsewhere to land on. A path that does not stay on this app is dropped as well.
 */
export const takeSignInResumePath = (): string | undefined => {
    const path = window.localStorage.getItem(RESUME_PATH_KEY);
    window.localStorage.removeItem(RESUME_PATH_KEY);
    const { origin, pathname } = window.location;

    if (path === null || pathname !== "/") {
        return undefined;
    }

    // Parsed rather than probed: `URL.canParse` arrived in Safari 17 and the
    // build targets 16.4, and this runs before the app renders.
    try {
        return new URL(path, origin).origin === origin ? path : undefined;
    } catch {
        return undefined;
    }
};
