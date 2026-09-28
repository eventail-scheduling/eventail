import { randomUUID } from "node:crypto";
import { type Ref, t } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Session } from "./Session.js";
import { User } from "./User.js";

/**
 * Revoked invites stay, which is what makes the send limit countable.
 *
 * The unique index therefore covers live rows alone, so one address may hold a
 * history of revoked invites beside at most one that can still be accepted.
 */
@Entity()
@Index({
    name: "unique_live_session_host_invite",
    expression:
        "CREATE UNIQUE INDEX unique_live_session_host_invite ON session_host_invite (session_id, email_address) WHERE revoked_at IS NULL",
})
export class SessionHostInvite {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @Property({ type: InstantType, nullable: true })
    public revokedAt: Temporal.Instant | null = null;

    @Property({ type: t.text })
    public readonly emailAddress: string;

    @Property({ type: t.text })
    public readonly code: string = randomUUID();

    @ManyToOne(() => Session, { ref: true, index: true, deleteRule: "cascade" })
    public readonly session: Ref<Session>;

    /**
     * Who sent it, kept only to count how much one person has sent.
     *
     * Null rather than cascading: an invite belongs to the session, so erasing
     * the person who typed it must not withdraw an invitation its recipient may
     * be about to accept.
     */
    @ManyToOne(() => User, { ref: true, index: true, nullable: true, deleteRule: "set null" })
    public readonly createdBy: Ref<User> | null;

    public constructor(values: {
        emailAddress: string;
        session: Ref<Session>;
        createdBy: Ref<User>;
    }) {
        this.emailAddress = values.emailAddress;
        this.session = values.session;
        this.createdBy = values.createdBy;
    }
}
