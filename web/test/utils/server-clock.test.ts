import { afterEach, describe, expect, it, vi } from "vitest";
import { onServerClockSync, serverNow, syncServerClock } from "#/utils/server-clock.ts";

describe("serverNow", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // Before the first reading lands there is nothing better than the local
    // clock, and tests that never sync rely on it following fake timers.
    it("reads the local clock until a reading lands", () => {
        vi.useFakeTimers();
        vi.setSystemTime(Temporal.Instant.from("2020-01-01T00:00:00Z").epochMilliseconds);

        expect(serverNow().toString()).toBe("2020-01-01T00:00:00Z");
    });

    // The server read its clock somewhere during the trip; halfway is the
    // estimate with the smallest worst case.
    it("runs on from the middle of the trip that read it", () => {
        const now = vi.spyOn(performance, "now");
        const server = Temporal.Instant.from("2026-10-01T10:00:00Z");

        syncServerClock(server, 1000, 1100);
        now.mockReturnValue(1600);

        expect(serverNow().epochMilliseconds).toBe(
            server.add({ milliseconds: 550 }).epochMilliseconds,
        );
    });

    it("tells whoever waits on it that a new reading landed", () => {
        const listener = vi.fn();
        const stop = onServerClockSync(listener);

        syncServerClock(Temporal.Instant.from("2026-10-01T10:00:00Z"), 0, 0);
        stop();
        syncServerClock(Temporal.Instant.from("2026-10-01T10:00:00Z"), 0, 0);

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
