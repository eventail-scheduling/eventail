import { type Ref, t } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Session, type SessionState, sessionStates } from "./Session.js";
import { User } from "./User.js";

@Entity()
@Index({ properties: ["session", "createdAt"] })
export class SessionTransition {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @ManyToOne(() => Session, { ref: true, deleteRule: "cascade" })
    public readonly session: Ref<Session>;

    // Nullable so a deleted user leaves the transition record intact.
    @ManyToOne(() => User, { ref: true, nullable: true })
    public readonly actor: Ref<User> | null;

    @Enum({ items: () => sessionStates, nativeEnumName: "session_state" })
    public readonly fromState: SessionState;

    @Enum({ items: () => sessionStates, nativeEnumName: "session_state" })
    public readonly toState: SessionState;

    @Property({ type: t.text, nullable: true })
    public readonly note: string | null;

    public constructor(values: {
        session: Ref<Session>;
        actor: Ref<User>;
        fromState: SessionState;
        toState: SessionState;
        note: string | null;
    }) {
        this.session = values.session;
        this.actor = values.actor;
        this.fromState = values.fromState;
        this.toState = values.toState;
        this.note = values.note;
    }
}
