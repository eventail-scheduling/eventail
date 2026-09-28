import { describe, expect, it } from "vitest";
import { teamFormSchema } from "#/routes/_user/teams/-components/TeamFormFields.tsx";

describe("teamFormSchema", () => {
    it("refuses a name of spaces alone", () => {
        expect(teamFormSchema.safeParse({ name: "   ", role: "viewer" }).success).toBe(false);
    });

    it("trims the name it keeps", () => {
        expect(teamFormSchema.parse({ name: "  Standing Crew  ", role: "viewer" })).toEqual({
            name: "Standing Crew",
            role: "viewer",
        });
    });
});
