import { t } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType, PlainDateType } from "mikro-orm-temporal";
import { isAfter } from "temporal-extra";
import { v7 as uuidv7 } from "uuid";
import { initialProfileFieldOptions, type ProfileFieldOptions } from "../support/profile-fields.js";
import { initialSessionFieldOptions, type SessionFieldOptions } from "../support/session-fields.js";

@Entity()
export class Edition {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.integer, version: true })
    public version = 1;

    @Property({ type: t.text })
    public name: string;

    @Property({ type: PlainDateType })
    public startDate: Temporal.PlainDate;

    @Property({ type: PlainDateType })
    public endDate: Temporal.PlainDate;

    @Property({ type: t.text })
    public timeZone: string;

    @Property({ type: InstantType, nullable: true })
    public submissionDeadline: Temporal.Instant | null;

    @Property({ type: t.json })
    public sessionFieldOptions: SessionFieldOptions;

    @Property({ type: t.json })
    public profileFieldOptions: ProfileFieldOptions;

    public constructor(values: {
        name: string;
        startDate: Temporal.PlainDate;
        endDate: Temporal.PlainDate;
        timeZone: string;
        submissionDeadline: Temporal.Instant | null;
        sessionFieldOptions?: SessionFieldOptions;
        profileFieldOptions?: ProfileFieldOptions;
    }) {
        this.name = values.name;
        this.startDate = values.startDate;
        this.endDate = values.endDate;
        this.timeZone = values.timeZone;
        this.submissionDeadline = values.submissionDeadline;
        this.sessionFieldOptions =
            values.sessionFieldOptions ?? structuredClone(initialSessionFieldOptions);
        this.profileFieldOptions =
            values.profileFieldOptions ?? structuredClone(initialProfileFieldOptions);
    }

    public get deadlinePassed(): boolean {
        if (!this.submissionDeadline) {
            return false;
        }

        return isAfter(Temporal.Now.instant(), this.submissionDeadline);
    }
}
