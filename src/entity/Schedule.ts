import { Collection, type Ref, t } from "@mikro-orm/core";
import {
    Check,
    Entity,
    Index,
    ManyToOne,
    OneToMany,
    PrimaryKey,
    Property,
    Unique,
} from "@mikro-orm/decorators/es";
import { InstantType, PlainDateType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Edition } from "./Edition.js";
import { Slot } from "./Slot.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "sequence"] })
@Check({ expression: "num_nonnulls(published_at, start_date, end_date, time_zone) in (0, 4)" })
export class Schedule {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    /**
     * Orders every schedule for an edition without consulting a clock.
     *
     * Monotonic per edition, assigned under locks that already serialize
     * schedule creation: publish holds the edition lock and the draft row. The
     * highest sequence is the working draft, the highest published one is
     * current. createdAt and publishedAt are display metadata with no ordering
     * role, so a stepped wall clock cannot reorder publications.
     */
    @Property({ type: t.integer })
    public readonly sequence: number;

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @Property({ type: InstantType, nullable: true })
    public publishedAt: Temporal.Instant | null = null;

    /**
     * The window this publication was announced for, stamped as it was published.
     *
     * The publication's slots can then be read without the edition, which is
     * free to move afterwards. Null while the schedule is a draft, which tracks
     * the edition instead; the check constraint keeps the four in step.
     */
    @Property({ type: PlainDateType, nullable: true })
    public startDate: Temporal.PlainDate | null = null;

    @Property({ type: PlainDateType, nullable: true })
    public endDate: Temporal.PlainDate | null = null;

    @Property({ type: t.text, nullable: true })
    public timeZone: string | null = null;

    @Property({ type: t.boolean })
    public preliminary = false;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    @OneToMany(
        () => Slot,
        (slot) => slot.schedule,
    )
    public readonly slots = new Collection<Slot>(this);

    public constructor(values: { edition: Ref<Edition>; sequence: number }) {
        this.edition = values.edition;
        this.sequence = values.sequence;
    }

    public publish(edition: Edition, publishedAt: Temporal.Instant, preliminary = false): void {
        this.publishedAt = publishedAt;
        this.preliminary = preliminary;
        this.startDate = edition.startDate;
        this.endDate = edition.endDate;
        this.timeZone = edition.timeZone;
    }
}
