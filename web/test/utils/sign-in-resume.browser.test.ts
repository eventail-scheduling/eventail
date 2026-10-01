import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberSignInResumePath, takeSignInResumePath } from "#/utils/sign-in-resume.ts";

const testerAddress = window.location.href;

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
});

afterEach(() => {
    window.history.replaceState(null, "", testerAddress);
});

describe("the sign-in resume path", () => {
    it("is handed out once", () => {
        rememberSignInResumePath("/accept-team-invite/code");

        expect(takeSignInResumePath()).toBe("/accept-team-invite/code");
        expect(takeSignInResumePath()).toBeUndefined();
    });

    it("is absent when nothing was left", () => {
        expect(takeSignInResumePath()).toBeUndefined();
    });

    // A sign-out that never came back to the start page leaves the path
    // behind, and a later sign-in from a deep link has somewhere of its own
    // to land.
    it("is dropped when the app starts anywhere but the start page", () => {
        rememberSignInResumePath("/accept-team-invite/code");
        window.history.replaceState(null, "", "/manage");

        expect(takeSignInResumePath()).toBeUndefined();
        expect(window.localStorage.getItem("signInResumePath")).toBeNull();
    });

    // The storage is the whole origin's, so whatever else writes to it could
    // aim the sign-in's landing somewhere else, or at nothing parseable.
    it.each([
        "https://elsewhere.example/",
        "//elsewhere.example/",
        "/\\elsewhere.example/",
        "http://[",
    ])("is dropped when it does not lead within this app: %s", (path) => {
        rememberSignInResumePath(path);

        expect(takeSignInResumePath()).toBeUndefined();
        expect(window.localStorage.getItem("signInResumePath")).toBeNull();
    });
});
