import { type Ref, t } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { DurationType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import { Edition } from "./Edition.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "externalKey"] })
@Index({
    name: "unique_selection_default_per_edition",
    expression:
        "CREATE UNIQUE INDEX unique_selection_default_per_edition ON session_type (edition_id, selection_default) WHERE selection_default = TRUE",
})
export class SessionType {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public name: string;

    @Property({ type: t.text, nullable: true })
    public externalKey: string | null;

    @Property({ type: DurationType })
    public defaultDuration: Temporal.Duration;

    /**
     * Kept from submitters: only a team member or an integration is served one.
     *
     * A speaker filing a session neither sees it listed nor may name it, which
     * is how registration and breaks stay something an organizer places rather
     * than something a speaker proposes. Naming one is narrower still and stays
     * with a manager, so reading these is not permission to assign one.
     */
    @Property({ type: t.boolean })
    public internal: boolean;

    @Property({ type: t.boolean })
    public selectionDefault: boolean;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    public constructor(values: {
        name: string;
        externalKey: string | null | undefined;
        defaultDuration: Temporal.Duration;
        internal: boolean;
        selectionDefault: boolean;
        edition: Ref<Edition>;
    }) {
        this.name = values.name;
        this.externalKey = values.externalKey ?? null;
        this.defaultDuration = values.defaultDuration;
        this.internal = values.internal;
        this.selectionDefault = values.selectionDefault;
        this.edition = values.edition;
    }

    public static default(edition: Ref<Edition>): SessionType {
        return new SessionType({
            name: "Default",
            externalKey: "default",
            defaultDuration: Temporal.Duration.from({ minutes: 60 }),
            internal: false,
            selectionDefault: true,
            edition,
        });
    }

    public copyToEdition(edition: Ref<Edition>): SessionType {
        return new SessionType({ ...this, edition });
    }
}
