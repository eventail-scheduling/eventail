import { Collection, type Ref, t } from "@mikro-orm/core";
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
import type { ImageFileDescriptor } from "../support/file-upload.js";
import { Edition } from "./Edition.js";
import { HostAvailability } from "./HostAvailability.js";
import { Response } from "./Response.js";
import { User } from "./User.js";

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({ properties: ["edition", "user"] })
export class Host {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text })
    public displayName: string;

    @Property({ type: t.text })
    public emailAddress: string;

    @Property({ type: t.text })
    public biography: string;

    @Property({ type: t.json, nullable: true })
    public avatar: ImageFileDescriptor | null = null;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    @ManyToOne(() => User, { ref: true, index: true, deleteRule: "cascade" })
    public readonly user: Ref<User>;

    @OneToMany(
        () => Response,
        (response) => response.host,
    )
    public readonly responses = new Collection<Response>(this);

    @OneToMany(
        () => HostAvailability,
        (availability) => availability.host,
        { orphanRemoval: true },
    )
    public readonly availabilities = new Collection<HostAvailability>(this);

    public constructor(values: {
        displayName: string;
        emailAddress: string;
        biography: string;
        edition: Ref<Edition>;
        user: Ref<User>;
    }) {
        this.displayName = values.displayName;
        this.emailAddress = values.emailAddress;
        this.biography = values.biography;
        this.edition = values.edition;
        this.user = values.user;
    }
}
