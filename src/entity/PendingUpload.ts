import { type Ref, t } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { User } from "./User.js";

/**
 * A temporary object someone has been given a presigned upload for.
 *
 * Recorded so attaching it can be tied to the person who asked, since knowing
 * the key proves nothing: it travels to the client and could leak. The row is
 * consumed when the object is attached, and swept by age like the objects
 * themselves, which an operator or a lifecycle rule can delete without telling
 * us.
 */
@Entity()
export class PendingUpload {
    @PrimaryKey({ type: t.text })
    public readonly key: string;

    @ManyToOne(() => User, { ref: true, index: true, deleteRule: "cascade" })
    public readonly user: Ref<User>;

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    public constructor(values: { key: string; user: Ref<User> }) {
        this.key = values.key;
        this.user = values.user;
    }
}
