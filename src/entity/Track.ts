import { type Ref, t } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { v7 as uuidv7 } from "uuid";
import { Edition } from "./Edition.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "externalKey"] })
export class Track {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public name: string;

    @Property({ type: t.text, nullable: true })
    public externalKey: string | null;

    @Property({ type: t.text })
    public description: string;

    @Property({ type: t.character, length: 7, check: "color ~ '^#[0-9A-Fa-f]{6}$'" })
    public color: string;

    @Property({ type: t.boolean })
    public internal: boolean;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    public constructor(values: {
        name: string;
        externalKey: string | null | undefined;
        description: string;
        color: string;
        internal: boolean;
        edition: Ref<Edition>;
    }) {
        this.name = values.name;
        this.externalKey = values.externalKey ?? null;
        this.description = values.description;
        this.color = values.color;
        this.internal = values.internal;
        this.edition = values.edition;
    }

    public copyToEdition(edition: Ref<Edition>): Track {
        return new Track({ ...this, edition });
    }
}
