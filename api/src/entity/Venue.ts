import { DeferMode, type Ref, t } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { v7 as uuidv7 } from "uuid";
import { Edition } from "./Edition.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "externalKey"] })
@Unique({
    properties: ["edition", "position"],
    deferMode: DeferMode.INITIALLY_DEFERRED,
})
export class Venue {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public name: string;

    @Property({ type: t.text, nullable: true })
    public address: string | null;

    @Property({ type: t.text, nullable: true })
    public externalKey: string | null;

    @Property({ type: t.integer })
    public position: number;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    public constructor(values: {
        name: string;
        address: string | null;
        externalKey: string | null;
        position: number;
        edition: Ref<Edition>;
    }) {
        this.name = values.name;
        this.address = values.address;
        this.externalKey = values.externalKey;
        this.position = values.position;
        this.edition = values.edition;
    }

    public copyToEdition(edition: Ref<Edition>): Venue {
        return new Venue({ ...this, edition });
    }
}
