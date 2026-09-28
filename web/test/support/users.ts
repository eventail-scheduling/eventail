import type { TeamRole } from "#/queries/team.ts";
import type { CurrentUser } from "#/queries/user.ts";

/** Builds a signed in user from the two things the guards read; the rest is filler. */
export const userWithRole = (highestRole: TeamRole | null, superAdmin = false): CurrentUser => ({
    data: {
        id: "01a00200-0000-7000-8000-000000000001",
        displayName: "Test User",
        emailAddress: "test@example.com",
    },
    meta: { highestRole, editableFields: [], superAdmin },
});
