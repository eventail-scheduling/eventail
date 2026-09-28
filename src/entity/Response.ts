import { type Ref, t } from "@mikro-orm/core";
import { Check, Entity, ManyToOne, PrimaryKey, Property, Unique } from "@mikro-orm/decorators/es";
import { v7 as uuidv7 } from "uuid";
import { CustomField } from "./CustomField.js";
import { Host } from "./Host.js";
import { Session } from "./Session.js";

@Entity()
@Unique({ properties: ["customField", "host"] })
@Unique({ properties: ["customField", "session"] })
@Check({ expression: "(host_id IS NULL) <> (session_id IS NULL)" })
export class Response {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.json, nullable: true })
    public value: unknown;

    @ManyToOne(() => CustomField, { ref: true, index: true, deleteRule: "cascade" })
    public readonly customField: Ref<CustomField>;

    @ManyToOne(() => Host, { ref: true, nullable: true, index: true, deleteRule: "cascade" })
    public readonly host: Ref<Host> | null;

    @ManyToOne(() => Session, { ref: true, nullable: true, index: true, deleteRule: "cascade" })
    public readonly session: Ref<Session> | null;

    public constructor(values: {
        value: unknown;
        customField: Ref<CustomField>;
        host: Ref<Host> | null;
        session: Ref<Session> | null;
    }) {
        this.value = values.value;
        this.customField = values.customField;
        this.host = values.host;
        this.session = values.session;
    }

    public static hostResponse(
        customField: Ref<CustomField>,
        host: Ref<Host>,
        value: unknown,
    ): Response {
        return new Response({ value, customField, host, session: null });
    }

    public static sessionResponse(
        customField: Ref<CustomField>,
        session: Ref<Session>,
        value: unknown,
    ): Response {
        return new Response({ value, customField, host: null, session });
    }
}
