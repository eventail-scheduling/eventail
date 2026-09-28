import { match } from "ts-pattern";
import type { TeamRole } from "#/queries/team.ts";
import type { UserMeta } from "#/queries/user.ts";

const roleToLevel = (role: TeamRole | null): number =>
    match(role)
        .with(null, () => -1)
        .with("viewer", () => 0)
        .with("manager", () => 1)
        .with("admin", () => 2)
        .exhaustive();

export type RoleBearer = {
    meta: Pick<UserMeta, "highestRole">;
};

export const fulfillsRole = (currentUser: RoleBearer | undefined, role: TeamRole): boolean => {
    if (currentUser === undefined) {
        return false;
    }

    const currentLevel = roleToLevel(currentUser.meta.highestRole);
    const requiredLevel = roleToLevel(role);

    return currentLevel >= requiredLevel;
};
