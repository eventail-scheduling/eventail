import { type Ref, t } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Host } from "./Host.js";

@Entity()
export class HostAvailability {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public startsAt: Temporal.Instant;

    @Property({ type: InstantType })
    public endsAt: Temporal.Instant;

    @ManyToOne(() => Host, { ref: true, index: true, deleteRule: "cascade" })
    public readonly host: Ref<Host>;

    public constructor(values: {
        startsAt: Temporal.Instant;
        endsAt: Temporal.Instant;
        host: Ref<Host>;
    }) {
        this.startsAt = values.startsAt;
        this.endsAt = values.endsAt;
        this.host = values.host;
    }
}
