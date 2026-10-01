import { describe, expect, it } from "vitest";
import {
    announcesTransition,
    transitionAction,
} from "#/components/SessionTransition/transitions.ts";

describe("a move back to accepted", () => {
    // Reopening a confirmation takes the speaker's confirmation away; it does
    // not accept anything, and the API mails nothing for it.
    it("reads as a return from confirmed, and is not announced", () => {
        expect(transitionAction("confirmed", "accepted").label).toBe("Return to accepted");
        expect(announcesTransition("confirmed", "accepted")).toBe(false);
    });

    it("reads as an acceptance from anywhere else, and is announced", () => {
        expect(transitionAction("canceled", "accepted").label).toBe("Accept");
        expect(announcesTransition("canceled", "accepted")).toBe(true);
        expect(announcesTransition("submitted", "accepted")).toBe(true);
        expect(announcesTransition("submitted", "rejected")).toBe(true);
    });
});
