import { describe, expect, it } from "vitest";
import {
    buildScheduleAxis,
    instantAtMinutes,
    type ScheduleAxis,
} from "#/components/ScheduleGrid/geometry.js";
import {
    candidateMissingNote,
    hostsUnavailableDuring,
    missingHostsNote,
    unavailableRanges,
} from "#/components/ScheduleGrid/host-availability.js";
import type { Candidate } from "#/components/ScheduleGrid/placement.js";
import type { SlottableSession } from "#/queries/session.js";

const berlin = "Europe/Berlin";

// Clear of any clock change, so a minute on the axis is a minute of the day.
const twoDays = (): ScheduleAxis =>
    buildScheduleAxis(
        Temporal.PlainDate.from("2027-06-01"),
        Temporal.PlainDate.from("2027-06-02"),
        berlin,
    );

type Window = [number, number];

const host = (axis: ScheduleAxis, displayName: string, windows: Window[]) =>
    ({
        id: displayName,
        displayName,
        availabilities: windows.map(([from, to]) => ({
            startsAt: instantAtMinutes(axis, from),
            endsAt: instantAtMinutes(axis, to),
        })),
    }) as unknown as SlottableSession["hosts"][number];

describe("unavailableRanges", () => {
    it("closes the time either side of a lone host's window", () => {
        const axis = twoDays();
        const ranges = unavailableRanges(axis, [host(axis, "Ada", [[540, 1080]])]);

        expect(ranges).toEqual([
            { from: 0, to: 540 },
            { from: 1080, to: 48 * 60 },
        ]);
    });

    it("closes a stretch either host is missing for", () => {
        const axis = twoDays();
        const ranges = unavailableRanges(axis, [
            host(axis, "Ada", [[0, 48 * 60]]),
            host(axis, "Grace", [
                [0, 600],
                [720, 48 * 60],
            ]),
        ]);

        expect(ranges).toEqual([{ from: 600, to: 720 }]);
    });

    it("treats a host who named no windows as free throughout", () => {
        const axis = twoDays();

        expect(unavailableRanges(axis, [host(axis, "Ada", [])])).toEqual([]);
    });

    it("says nothing at all when the session has no hosts", () => {
        expect(unavailableRanges(twoDays(), [])).toEqual([]);
    });

    it("joins two closed stretches that touch", () => {
        const axis = twoDays();
        // Ada is away 600 to 720 and Grace 720 to 840, so the two closed bands
        // meet on the minute and must come back as one.
        const ranges = unavailableRanges(axis, [
            host(axis, "Ada", [
                [0, 600],
                [720, 48 * 60],
            ]),
            host(axis, "Grace", [
                [0, 720],
                [840, 48 * 60],
            ]),
        ]);

        expect(ranges).toEqual([{ from: 600, to: 840 }]);
    });
});

describe("hostsUnavailableDuring", () => {
    const axis = twoDays();
    const hosts = [host(axis, "Ada", [[540, 1080]]), host(axis, "Grace", [[0, 48 * 60]])];

    it("names only the host actually missing for the stretch", () => {
        expect(hostsUnavailableDuring(axis, hosts, { from: 0, to: 60 })).toEqual(["Ada"]);
    });

    it("names nobody where everyone is free", () => {
        expect(hostsUnavailableDuring(axis, hosts, { from: 600, to: 660 })).toEqual([]);
    });

    // Half open, so a stretch ending where a window opens has not reached it.
    it("leaves a stretch ending as the window opens alone", () => {
        expect(hostsUnavailableDuring(axis, hosts, { from: 540, to: 600 })).toEqual([]);
    });

    it("names a host whose window the stretch only partly overlaps", () => {
        expect(hostsUnavailableDuring(axis, hosts, { from: 1020, to: 1140 })).toEqual(["Ada"]);
    });
});

describe("missingHostsNote", () => {
    const axis = twoDays();
    const hosts = [host(axis, "Ada", [[540, 1080]]), host(axis, "Grace", [[600, 1080]])];

    it("says nothing when everyone on the session is free", () => {
        expect(missingHostsNote(axis, hosts, { from: 700, to: 800 })).toBeUndefined();
    });

    it("names the one who is missing", () => {
        expect(missingHostsNote(axis, hosts, { from: 560, to: 580 })).toBe("Grace not free");
    });

    it("names both where neither is free", () => {
        expect(missingHostsNote(axis, hosts, { from: 0, to: 60 })).toBe("Ada and Grace not free");
    });

    // Only that the span given is the span read. Which span the caller chooses
    // is the decision, and `candidateMissingNote` is where that is pinned.
    it("reads the whole of the stretch it is given", () => {
        expect(missingHostsNote(axis, hosts, { from: 530, to: 700 })).toBe(
            "Ada and Grace not free",
        );
    });
});

describe("candidateMissingNote", () => {
    const axis = twoDays();
    const hosts = [host(axis, "Ada", [[600, 1080]])];

    const candidateAt = (from: number, to: number, setup = 0): Candidate => ({
        locationId: "hall",
        span: { from, to },
        shoulders: { setup, teardown: 0 },
    });

    it("says nothing while nothing is being pointed at", () => {
        expect(candidateMissingNote(axis, hosts, null, false)).toBeUndefined();
    });

    it("says nothing when no session is held", () => {
        expect(candidateMissingNote(axis, undefined, candidateAt(0, 60), false)).toBeUndefined();
    });

    it("stays quiet while the drop is refused", () => {
        expect(candidateMissingNote(axis, hosts, candidateAt(0, 60), true)).toBeUndefined();
    });

    it("names the host a candidate would take from elsewhere", () => {
        expect(candidateMissingNote(axis, hosts, candidateAt(0, 60), false)).toBe("Ada not free");
    });

    // The body sits entirely inside Ada's hours and the setup does not.
    it("counts the setup the slot holds the room for, not only its body", () => {
        expect(candidateMissingNote(axis, hosts, candidateAt(600, 660), false)).toBeUndefined();
        expect(candidateMissingNote(axis, hosts, candidateAt(600, 660, 30), false)).toBe(
            "Ada not free",
        );
    });
});
