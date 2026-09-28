import { describe, expect, it } from "vitest";
import { changedFields, rebaseChanges, snapshotValues } from "#/utils/changed-fields.ts";

describe("snapshotValues", () => {
    it("is not reached by a later write inside a nested object or array", () => {
        const values = {
            responses: { "field-a": "Berlin" },
            availability: [{ day: "2026-11-21" }],
            duration: Temporal.Duration.from({ minutes: 30 }),
        };
        const snapshot = snapshotValues(values);

        values.responses["field-a"] = "Hamburg";
        values.availability[0] = { day: "2026-11-22" };

        expect(snapshot.responses["field-a"]).toBe("Berlin");
        expect(snapshot.availability).toEqual([{ day: "2026-11-21" }]);
        expect(snapshot.duration).toBe(values.duration);
    });
});

describe("changedFields", () => {
    // The API reads 90 minutes back as PT1H30M, and the duration field builds
    // PT90M from what is typed into it.
    it("sees an equal duration as unchanged, however it is written", () => {
        expect(
            changedFields(
                { duration: Temporal.Duration.from("PT1H30M") },
                { duration: Temporal.Duration.from({ minutes: 90 }) },
            ),
        ).toEqual({});
    });

    it("marks a Temporal value that changed or was cleared", () => {
        const seeded = {
            duration: Temporal.Duration.from({ minutes: 30 }),
            setupTime: Temporal.Duration.from({ minutes: 10 }),
        };

        expect(
            changedFields(seeded, {
                duration: Temporal.Duration.from({ minutes: 45 }),
                setupTime: null,
            }),
        ).toEqual({ duration: true, setupTime: true });
    });

    it("marks the keys that changed inside a plain object", () => {
        expect(
            changedFields(
                {
                    responses: {
                        "field-a": Temporal.PlainDate.from("2026-11-21"),
                        "field-b": "Berlin",
                    },
                },
                {
                    responses: {
                        "field-a": Temporal.PlainDate.from("2026-11-22"),
                        "field-b": "Berlin",
                    },
                },
            ),
        ).toEqual({ responses: { "field-a": true } });
    });

    it("marks an array that lost an item as a whole", () => {
        expect(
            changedFields({ items: [{ id: "one" }, { id: "two" }] }, { items: [{ id: "one" }] }),
        ).toEqual({ items: true });
    });
});

describe("rebaseChanges", () => {
    it("takes the fresh value wherever the user changed nothing", () => {
        expect(
            rebaseChanges(
                { sessionType: { id: "talk" }, title: "Old" },
                { sessionType: { id: "workshop" }, title: "Old" },
                { sessionType: { id: "talk" }, title: "New" },
            ),
        ).toEqual({ sessionType: { id: "workshop" }, title: "New" });
    });

    it("keeps an answer the user changed and takes the others fresh", () => {
        expect(
            rebaseChanges(
                { responses: { "field-a": "a projector", "field-b": "" } },
                { responses: { "field-a": "a projector", "field-b": "Berlin" } },
                { responses: { "field-a": "a whiteboard", "field-b": "" } },
                ["responses"],
            ),
        ).toEqual({ responses: { "field-a": "a whiteboard", "field-b": "Berlin" } });
    });

    // An answer kept for a deleted question would sit in the form out of sight
    // and keep every later save dirty.
    it("drops an answer whose question is gone from the fresh seed", () => {
        expect(
            rebaseChanges(
                { responses: { "field-a": "a projector", "field-gone": "" } },
                { responses: { "field-a": "a projector" } },
                { responses: { "field-a": "a projector", "field-gone": "an answer" } },
                ["responses"],
            ),
        ).toEqual({ responses: { "field-a": "a projector" } });
    });

    // A file both sides replaced has to stay the user's upload, not take the
    // other side's filename for it.
    it("takes a value both sides changed whole from the user", () => {
        expect(
            rebaseChanges(
                { teaserImage: { key: "stored/teaser.webp", filename: "teaser.webp" } },
                { teaserImage: { key: "stored/banner.webp", filename: "banner.webp" } },
                { teaserImage: { key: "temp/new.webp", filename: "teaser.webp" } },
            ),
        ).toEqual({ teaserImage: { key: "temp/new.webp", filename: "teaser.webp" } });
    });
});
