import { randomUUID } from "node:crypto";
import { type Ref, t } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Team } from "./Team.js";

@Entity()
@Unique({ properties: ["team", "emailAddress"] })
export class TeamInvite {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @Property({ type: t.text })
    public emailAddress: string;

    @Property({ type: t.text })
    public readonly code: string = randomUUID();

    @ManyToOne(() => Team, { ref: true, index: true, deleteRule: "cascade" })
    public readonly team: Ref<Team>;

    public constructor(values: { emailAddress: string; team: Ref<Team> }) {
        this.emailAddress = values.emailAddress;
        this.team = values.team;
    }
}
