/**
 * Resolves a redirect target against our own origin.
 *
 * Returns the path, query and hash when the value stays on the given origin,
 * or null when it points elsewhere or cannot be parsed. Resolution is used
 * rather than inspecting the string because the URL parser strips tab, line
 * feed and carriage return before parsing, which lets values like "/\t/host"
 * pass a character check and then collapse into a protocol-relative URL.
 */
export const resolveSameOriginPath = (value: string, origin: string): string | null => {
    let url: URL;

    try {
        url = new URL(value, origin);
    } catch {
        return null;
    }

    if (url.origin !== origin) {
        return null;
    }

    return `${url.pathname}${url.search}${url.hash}`;
};
