import { Collection, t } from "@mikro-orm/core";
import { Entity, ManyToMany, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Team } from "./Team.js";

@Entity()
export class User {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text, unique: true })
    public readonly externalId: string;

    @Property({ type: InstantType })
    public lastSeenAt = Temporal.Now.instant();

    @Property({ type: t.text })
    public displayName: string;

    @Property({ type: t.text })
    public emailAddress: string;

    @ManyToMany(
        () => Team,
        (team) => team.users,
    )
    public readonly teams = new Collection<Team>(this);

    public constructor(values: {
        externalId: string;
        displayName: string;
        emailAddress: string;
    }) {
        this.externalId = values.externalId;
        this.displayName = values.displayName;
        this.emailAddress = values.emailAddress;
    }

    public hasGlobalAccess(): boolean {
        return this.teams.length > 0;
    }
}
