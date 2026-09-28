import { t } from "@mikro-orm/core";
import { Entity, Enum, Index, PrimaryKey, Property } from "@mikro-orm/decorators/es";
import { InstantType } from "mikro-orm-temporal";
import { v7 as uuidv7 } from "uuid";
import type { EmailTemplate } from "./email-template.js";

export type SendEmailJobPayload = {
    type: "send_email";
    recipient: string;
    subject: string;
    template: EmailTemplate;
    variables: Record<string, unknown>;
};

export type ProcessTeaserImageJobPayload = {
    type: "process_teaser_image";
    sessionId: string;
    key: string;
};

export type ProcessAvatarJobPayload = {
    type: "process_avatar";
    hostId: string;
    key: string;
};

export type JobPayload =
    | SendEmailJobPayload
    | ProcessTeaserImageJobPayload
    | ProcessAvatarJobPayload;
export type JobType = JobPayload["type"];

/**
 * Every payload type, which the union cannot give at runtime.
 *
 * Written as a record so a new payload type fails the build here: the OpenAPI
 * enum is built from this, and a list that quietly fell behind would publish
 * the wrong enum.
 */
const declaredJobTypes: Record<JobType, true> = {
    send_email: true,
    process_teaser_image: true,
    process_avatar: true,
};

export const jobTypes = Object.keys(declaredJobTypes) as JobType[];

export const jobStates = [
    "available",
    "running",
    "retryable",
    "scheduled",
    "completed",
    "canceled",
    "discarded",
] as const;
export type JobState = (typeof jobStates)[number];

@Entity()
@Index({ properties: ["state", "scheduledAt"] })
@Index({ properties: ["state", "finalizedAt"] })
@Index({ properties: ["state", "attemptedAt"] })
export class Job {
    @PrimaryKey({ type: t.uuid })
    public readonly id = uuidv7();

    @Property({ type: InstantType })
    public readonly createdAt = Temporal.Now.instant();

    @Property({ type: InstantType, nullable: true })
    public attemptedAt: Temporal.Instant | null = null;

    @Property({ type: InstantType })
    public scheduledAt: Temporal.Instant;

    @Property({ type: InstantType, nullable: true })
    public finalizedAt: Temporal.Instant | null = null;

    @Property({ type: t.integer })
    public attempt = 0;

    @Enum({ items: () => jobStates, nativeEnumName: "job_state" })
    public state: JobState;

    @Property({ type: t.text, nullable: true })
    public lastError: string | null = null;

    @Property({ type: t.json })
    public readonly payload: JobPayload;

    public constructor(values: { payload: JobPayload; scheduledAt?: Temporal.Instant }) {
        this.payload = values.payload;
        this.scheduledAt = values.scheduledAt ?? Temporal.Now.instant();
        this.state = values.scheduledAt ? "scheduled" : "available";
    }
}
