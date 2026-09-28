import { Collection, type Ref, t } from "@mikro-orm/core";
import {
    Entity,
    Enum,
    Index,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryKey,
    Property,
} from "@mikro-orm/decorators/es";
import { DurationType, InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import type { ImageFileDescriptor } from "../support/file-upload.js";
import { Edition } from "./Edition.js";
import { Host } from "./Host.js";
import { Response } from "./Response.js";
import { SessionType } from "./SessionType.js";
import { Track } from "./Track.js";

export const sessionStates = [
    "submitted",
    "accepted",
    "confirmed",
    "rejected",
    "withdrawn",
    "canceled",
] as const;
export type SessionState = (typeof sessionStates)[number];

export const slottableStates: readonly SessionState[] = ["accepted", "confirmed"];

@Entity()
@Index({ properties: ["edition", "id"] })
@Index({ properties: ["edition", "createdAt"] })
@Index({ properties: ["edition", "state"] })
export class Session {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Enum({ items: () => sessionStates, nativeEnumName: "session_state" })
    public state: SessionState = "submitted";

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @Property({ type: InstantType, onUpdate: () => Temporal.Now.instant() })
    public readonly updatedAt = Temporal.Now.instant();

    @Property({ type: InstantType, nullable: true })
    public confirmationRemindedAt: Temporal.Instant | null = null;

    @Property({ type: t.text })
    public title: string;

    @Property({ type: t.text })
    public abstract: string;

    @Property({ type: t.text })
    public description: string;

    @Property({ type: t.text })
    public notes: string;

    @Property({ type: DurationType, nullable: true })
    public duration: Temporal.Duration | null;

    @Property({ type: DurationType, nullable: true })
    public setupTime: Temporal.Duration | null;

    @Property({ type: DurationType, nullable: true })
    public teardownTime: Temporal.Duration | null;

    @Property({ type: t.json, nullable: true })
    public teaserImage: ImageFileDescriptor | null;

    @ManyToMany(() => Host)
    public readonly hosts = new Collection<Host>(this);

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    @ManyToOne(() => SessionType, { ref: true, index: true })
    public sessionType: Ref<SessionType>;

    @ManyToOne(() => Track, { ref: true, nullable: true })
    public track: Ref<Track> | null;

    @OneToMany(
        () => Response,
        (response) => response.session,
    )
    public readonly responses = new Collection<Response>(this);

    public constructor(values: {
        title: string;
        abstract: string;
        description: string;
        notes: string;
        duration: Temporal.Duration | null;
        setupTime: Temporal.Duration | null;
        teardownTime: Temporal.Duration | null;
        teaserImage: ImageFileDescriptor | null;
        edition: Ref<Edition>;
        sessionType: Ref<SessionType>;
        track: Ref<Track> | null;
    }) {
        this.title = values.title;
        this.abstract = values.abstract;
        this.description = values.description;
        this.notes = values.notes;
        this.duration = values.duration;
        this.setupTime = values.setupTime;
        this.teardownTime = values.teardownTime;
        this.teaserImage = values.teaserImage;
        this.edition = values.edition;
        this.sessionType = values.sessionType;
        this.track = values.track;
    }
}
