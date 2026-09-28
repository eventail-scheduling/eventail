import { Collection, t } from "@mikro-orm/core";
import {
    Entity,
    Enum,
    ManyToMany,
    OneToMany,
    PrimaryKey,
    Property,
} from "@mikro-orm/decorators/es";
import { v7 as uuidv7 } from "uuid";
import { TeamInvite } from "./TeamInvite.js";
import { User } from "./User.js";

export const teamRoles = ["admin", "manager", "viewer"] as const;
export type TeamRole = (typeof teamRoles)[number];

@Entity()
export class Team {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public name: string;

    @Enum({ items: () => teamRoles, nativeEnumName: "team_role" })
    public role: TeamRole;

    @ManyToMany(() => User)
    public readonly users = new Collection<User>(this);

    @OneToMany(
        () => TeamInvite,
        (invite) => invite.team,
    )
    public readonly invites = new Collection<TeamInvite>(this);

    public constructor(values: { name: string; role: TeamRole }) {
        this.name = values.name;
        this.role = values.role;
    }

    public providesRole(role: TeamRole): boolean {
        if (role === this.role || role === "viewer") {
            return true;
        }

        return role === "manager" && this.role === "admin";
    }

    public maxRole(role: TeamRole | null): TeamRole {
        if (role === null || role === "viewer") {
            return this.role;
        }

        if (role === "manager" && this.role === "admin") {
            return this.role;
        }

        return role;
    }
}
