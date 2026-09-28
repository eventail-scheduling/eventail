import { Collection, DeferMode, type Ref, t } from "@mikro-orm/core";
import {
    Entity,
    Enum,
    Index,
    ManyToMany,
    ManyToOne,
    PrimaryKey,
    Property,
    Unique,
} from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { isAfter } from "temporal-extra";
import { match } from "ts-pattern";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import { type CustomFieldOptions, createResponseSchema } from "../support/custom-fields.js";
import { Edition } from "./Edition.js";
import { SessionType } from "./SessionType.js";
import { Track } from "./Track.js";

export const customFieldTargets = ["per_proposal", "per_host"] as const;
export type CustomFieldTarget = (typeof customFieldTargets)[number];

export const customFieldRequirements = [
    "always_optional",
    "always_required",
    "required_after_deadline",
] as const;
export type CustomFieldRequirement = (typeof customFieldRequirements)[number];

@Entity()
@Index({ properties: ["edition", "id"] })
@Unique({
    properties: ["edition", "target", "position"],
    deferMode: DeferMode.INITIALLY_DEFERRED,
})
// A per_proposal and a per_host field can both reasonably be keyed "dietary",
// which is why target is in the scope.
@Unique({ properties: ["edition", "target", "externalKey"] })
export class CustomField {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: t.text, nullable: true })
    public externalKey: string | null;

    @Enum({ items: () => customFieldTargets, nativeEnumName: "custom_field_target" })
    public readonly target: CustomFieldTarget;

    @Property({ type: t.json })
    public options: CustomFieldOptions;

    @Enum({ items: () => customFieldRequirements, nativeEnumName: "custom_field_requirement" })
    public requirement: CustomFieldRequirement;

    @Property({ type: t.text })
    public title: string;

    @Property({ type: t.text })
    public helperText: string;

    @Property({ type: InstantType, nullable: true })
    public deadline: Temporal.Instant | null;

    @Property({ type: InstantType, nullable: true })
    public freezeAfter: Temporal.Instant | null;

    @Property({ type: t.boolean })
    public confidential: boolean;

    @Property({ type: t.integer })
    public position: number;

    @ManyToOne(() => Edition, { ref: true, deleteRule: "cascade" })
    public readonly edition: Ref<Edition>;

    @ManyToMany(() => SessionType)
    public readonly sessionTypes = new Collection<SessionType>(this);

    @ManyToMany(() => Track)
    public readonly tracks = new Collection<Track>(this);

    public constructor(values: {
        externalKey: string | null | undefined;
        target: CustomFieldTarget;
        requirement: CustomFieldRequirement;
        options: CustomFieldOptions;
        title: string;
        helperText: string;
        deadline: Temporal.Instant | null | undefined;
        freezeAfter: Temporal.Instant | null | undefined;
        confidential?: boolean;
        position: number;
        edition: Ref<Edition>;
    }) {
        this.externalKey = values.externalKey ?? null;
        this.target = values.target;
        this.requirement = values.requirement;
        this.options = values.options;
        this.title = values.title;
        this.helperText = values.helperText;
        this.deadline = values.deadline ?? null;
        this.freezeAfter = values.freezeAfter ?? null;
        this.confidential = values.confidential ?? false;
        this.position = values.position;
        this.edition = values.edition;
    }

    public copyToEdition(edition: Ref<Edition>): CustomField {
        // Stale dates make no sense in a new edition: a past freezeAfter
        // would make the copy impossible to respond to, a past deadline immediately
        // required. Dropping the deadline also demotes required_after_deadline,
        // which is invalid without one; managers re-set dates per edition.
        return new CustomField({
            ...this,
            options: structuredClone(this.options),
            requirement:
                this.requirement === "required_after_deadline"
                    ? "always_optional"
                    : this.requirement,
            deadline: null,
            freezeAfter: null,
            edition,
        });
    }

    public get frozen(): boolean {
        return this.freezeAfter !== null && isAfter(Temporal.Now.instant(), this.freezeAfter);
    }

    public get required(): boolean {
        if (this.frozen) {
            return false;
        }

        return match(this.requirement)
            .with("always_optional", () => false)
            .with("always_required", () => true)
            .with(
                "required_after_deadline",
                () => this.deadline !== null && isAfter(Temporal.Now.instant(), this.deadline),
            )
            .exhaustive();
    }

    public getResponseSchema(): z.ZodType {
        return createResponseSchema(this.options, this.required);
    }
}
