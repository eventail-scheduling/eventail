import { type Ref, t } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Location } from "./Location.js";

@Entity()
export class LocationAvailability {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public startsAt: Temporal.Instant;

    @Property({ type: InstantType })
    public endsAt: Temporal.Instant;

    @ManyToOne(() => Location, { ref: true, index: true, deleteRule: "cascade" })
    public readonly location: Ref<Location>;

    public constructor(values: {
        startsAt: Temporal.Instant;
        endsAt: Temporal.Instant;
        location: Ref<Location>;
    }) {
        this.startsAt = values.startsAt;
        this.endsAt = values.endsAt;
        this.location = values.location;
    }
}
