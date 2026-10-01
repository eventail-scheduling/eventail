import invariant from "tiny-invariant";
import { describe, expect, it } from "vitest";
import { resolveSameOriginPath } from "#/utils/url.ts";

const origin = "https://app.example.test";

// What reaches the schema is already percent-decoded by the router, so the
// hostile inputs are raw control characters rather than their escapes.
const decodeSearchValue = (raw: string): string => {
    const value = new URLSearchParams(`returnTo=${raw}`).get("returnTo");
    invariant(value !== null);

    return value;
};

describe("resolveSameOriginPath", () => {
    it("keeps same-origin paths intact", () => {
        expect(resolveSameOriginPath("/", origin)).toBe("/");
        expect(resolveSameOriginPath("/manage?x=1", origin)).toBe("/manage?x=1");
        expect(resolveSameOriginPath("/manage#frag", origin)).toBe("/manage#frag");
        expect(resolveSameOriginPath("/manage/123?tab=a#b", origin)).toBe("/manage/123?tab=a#b");
    });

    it("reduces an absolute same-origin URL to its path", () => {
        expect(resolveSameOriginPath(`${origin}/manage?x=1`, origin)).toBe("/manage?x=1");
    });

    it("normalizes relative and traversing paths onto the origin", () => {
        expect(resolveSameOriginPath("manage", origin)).toBe("/manage");
        expect(resolveSameOriginPath("/../../evil", origin)).toBe("/evil");
    });

    it("rejects protocol-relative and backslash escapes", () => {
        expect(resolveSameOriginPath("//evil.test", origin)).toBeNull();
        expect(resolveSameOriginPath("/\\evil.test", origin)).toBeNull();
        expect(resolveSameOriginPath("\\\\evil.test", origin)).toBeNull();
    });

    it("rejects control characters the URL parser strips before parsing", () => {
        expect(resolveSameOriginPath(decodeSearchValue("/%09/evil.test"), origin)).toBeNull();
        expect(resolveSameOriginPath(decodeSearchValue("/%0A/evil.test"), origin)).toBeNull();
        expect(resolveSameOriginPath(decodeSearchValue("/%0D/evil.test"), origin)).toBeNull();
    });

    it("rejects foreign origins", () => {
        expect(resolveSameOriginPath("https://evil.test", origin)).toBeNull();
        expect(resolveSameOriginPath("https://evil.test/manage", origin)).toBeNull();
        expect(resolveSameOriginPath("http://app.example.test", origin)).toBeNull();
        expect(resolveSameOriginPath("https://app.example.test.evil.test", origin)).toBeNull();
    });

    it("rejects opaque schemes", () => {
        expect(resolveSameOriginPath("javascript:alert(1)", origin)).toBeNull();
        expect(resolveSameOriginPath("data:text/html,<script></script>", origin)).toBeNull();
    });

    it("resolves an empty value to the origin root", () => {
        expect(resolveSameOriginPath("", origin)).toBe("/");
    });

    it("rejects values the URL parser refuses outright", () => {
        expect(resolveSameOriginPath("http://", origin)).toBeNull();
        expect(resolveSameOriginPath("//", origin)).toBeNull();
        expect(resolveSameOriginPath("https://exa mple.test", origin)).toBeNull();
        expect(resolveSameOriginPath("https://[:::]", origin)).toBeNull();
    });
});
