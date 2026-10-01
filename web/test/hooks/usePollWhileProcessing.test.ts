import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPollPolicy } from "#/hooks/usePollWhileProcessing.ts";

const start = Temporal.Instant.from("2026-09-22T12:00:00Z");

const advance = (seconds: number): void => {
    vi.setSystemTime(start.add({ seconds }).epochMilliseconds);
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start.epochMilliseconds);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("an image still being processed", () => {
    it("asks again while the wait is young", () => {
        const poll = createPollPolicy();

        expect(poll(true, "a")).toBe(2_000);

        advance(30);

        expect(poll(true, "a")).toBe(2_000);
    });

    it("gives up once the wait runs long", () => {
        const poll = createPollPolicy();
        poll(true, "a");

        advance(61);

        expect(poll(true, "a")).toBe(false);
    });
});

describe("a replacement image", () => {
    it("waits on its own clock rather than what is left of the last one", () => {
        const poll = createPollPolicy();
        poll(true, "a");

        advance(61);
        expect(poll(true, "a")).toBe(false);

        expect(poll(true, "b")).toBe(2_000);
    });
});

describe("an image that finished", () => {
    it("leaves nothing behind for the next upload to inherit", () => {
        const poll = createPollPolicy();
        poll(true, "a");

        advance(61);
        expect(poll(true, "a")).toBe(false);

        expect(poll(false, "a")).toBe(false);

        advance(62);

        expect(poll(true, "a")).toBe(2_000);
    });
});
