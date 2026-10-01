import { describe, expect, it } from "vitest";
import type { ListEdition } from "#/queries/edition.ts";
import { groupEditions } from "#/routes/_user/_public/-utils/group-editions.ts";

const now = Temporal.Instant.from("2027-06-15T12:00:00Z");

const edition = (
    name: string,
    startDate: string,
    endDate: string,
    timeZone = "UTC",
): ListEdition => ({
    id: name,
    name,
    startDate: Temporal.PlainDate.from(startDate),
    endDate: Temporal.PlainDate.from(endDate),
    timeZone,
});

const groupOf = (name: string, editions: ListEdition[]): string | undefined =>
    groupEditions(editions, now).find((group) =>
        group.editions.some((candidate) => candidate.name === name),
    )?.key;

describe("groupEditions", () => {
    it("treats an edition starting today as running", () => {
        const subject = edition("starts today", "2027-06-15", "2027-06-18");

        expect(groupOf("starts today", [subject])).toBe("running");
    });

    it("treats an edition ending today as running", () => {
        const subject = edition("ends today", "2027-06-12", "2027-06-15");

        expect(groupOf("ends today", [subject])).toBe("running");
    });

    it("treats a single day edition on today as running", () => {
        const subject = edition("single day", "2027-06-15", "2027-06-15");

        expect(groupOf("single day", [subject])).toBe("running");
    });

    it("treats an edition starting tomorrow as upcoming", () => {
        const subject = edition("starts tomorrow", "2027-06-16", "2027-06-18");

        expect(groupOf("starts tomorrow", [subject])).toBe("upcoming");
    });

    it("treats an edition that ended yesterday as past", () => {
        const subject = edition("ended yesterday", "2027-06-12", "2027-06-14");

        expect(groupOf("ended yesterday", [subject])).toBe("past");
    });

    it("puts the soonest upcoming edition first", () => {
        const groups = groupEditions(
            [
                edition("later", "2027-09-01", "2027-09-03"),
                edition("sooner", "2027-07-01", "2027-07-03"),
            ],
            now,
        );

        expect(groups[0].editions.map(({ name }) => name)).toEqual(["sooner", "later"]);
    });

    it("puts the most recent past edition first", () => {
        const groups = groupEditions(
            [
                edition("older", "2026-01-01", "2026-01-03"),
                edition("recent", "2027-01-01", "2027-01-03"),
            ],
            now,
        );

        expect(groups[0].editions.map(({ name }) => name)).toEqual(["recent", "older"]);
    });

    it("drops groups that no edition falls into", () => {
        const groups = groupEditions([edition("only upcoming", "2027-07-01", "2027-07-03")], now);

        expect(groups.map(({ key }) => key)).toEqual(["upcoming"]);
    });

    it("orders the groups running, upcoming, then past", () => {
        const groups = groupEditions(
            [
                edition("past", "2026-01-01", "2026-01-03"),
                edition("upcoming", "2027-07-01", "2027-07-03"),
                edition("running", "2027-06-14", "2027-06-16"),
            ],
            now,
        );

        expect(groups.map(({ key }) => key)).toEqual(["running", "upcoming", "past"]);
    });

    // It is already the 16th in Tokyo while it is still the 15th in UTC.
    it("dates an edition by its own time zone rather than the viewer's", () => {
        const subject = edition("in Tokyo", "2027-06-16", "2027-06-18", "Asia/Tokyo");

        expect(groupOf("in Tokyo", [subject])).toBe("upcoming");
        expect(
            groupEditions([subject], Temporal.Instant.from("2027-06-15T20:00:00Z"))[0]?.key,
        ).toBe("running");
    });
});
