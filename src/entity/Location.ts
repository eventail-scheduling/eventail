import { Collection, DeferMode, type Ref, t } from "@mikro-orm/core";
import {
    Entity,
    Index,
    ManyToOne,
    OneToMany,
    PrimaryKey,
    Property,
    Unique,
} from "@mikro-orm/decorators/es";
import { v7 as uuidv7 } from "uuid";
import { Edition } from "./Edition.js";
import { LocationAvailability } from "./LocationAvailability.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "externalKey"] })
// Deferred because a reorder renumbers the whole edition in one statement run,
// which holds two locations on the same position part way through.
@Unique({
    properties: ["edition", "position"],
    deferMode: DeferMode.INITIALLY_DEFERRED,
})
export class Location {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public name: string;

    @Property({ type: t.text, nullable: true })
    public externalKey: string | null;

    @Property({ type: t.integer })
    public position: number;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    @OneToMany(
        () => LocationAvailability,
        (availability) => availability.location,
        { orphanRemoval: true },
    )
    public readonly availabilities = new Collection<LocationAvailability>(this);

    public constructor(values: {
        name: string;
        externalKey: string | null | undefined;
        position: number;
        edition: Ref<Edition>;
    }) {
        this.name = values.name;
        this.externalKey = values.externalKey ?? null;
        this.position = values.position;
        this.edition = values.edition;
    }

    public copyToEdition(edition: Ref<Edition>): Location {
        return new Location({ ...this, edition });
    }
}
