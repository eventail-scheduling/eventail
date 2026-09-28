import { type Ref, t } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { DurationType, InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Location } from "./Location.js";
import { Schedule } from "./Schedule.js";
import { Session } from "./Session.js";

@Entity()
@Unique({ properties: ["stableId", "schedule"] })
@Index({ properties: ["schedule", "location"] })
export class Slot {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.uuid })
    public stableId = uuidv7();

    @Property({ type: InstantType })
    public startsAt: Temporal.Instant;

    @Property({ type: InstantType })
    public endsAt: Temporal.Instant;

    @Property({ type: DurationType })
    public setupTime: Temporal.Duration;

    @Property({ type: DurationType })
    public teardownTime: Temporal.Duration;

    @ManyToOne(() => Schedule, { ref: true, deleteRule: "cascade" })
    public readonly schedule: Ref<Schedule>;

    @ManyToOne(() => Session, { ref: true })
    public session: Ref<Session>;

    @ManyToOne(() => Location, { ref: true })
    public location: Ref<Location>;

    public constructor(values: {
        startsAt: Temporal.Instant;
        endsAt: Temporal.Instant;
        setupTime: Temporal.Duration;
        teardownTime: Temporal.Duration;
        schedule: Ref<Schedule>;
        session: Ref<Session>;
        location: Ref<Location>;
    }) {
        this.startsAt = values.startsAt;
        this.endsAt = values.endsAt;
        this.setupTime = values.setupTime;
        this.teardownTime = values.teardownTime;
        this.schedule = values.schedule;
        this.session = values.session;
        this.location = values.location;
    }

    /**
     * Copies onto another schedule, keeping the stableId every consumer reads.
     */
    public copyToSchedule(schedule: Ref<Schedule>): Slot {
        const slot = new Slot({ ...this, schedule });
        slot.stableId = this.stableId;
        return slot;
    }
}
