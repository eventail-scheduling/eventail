import type { EntityManager } from "@mikro-orm/postgresql";
import type { EmailTemplate } from "../entity/email-template.js";
import { Job } from "../entity/Job.js";
import { appConfig } from "../util/app-config.js";
import { publishJob } from "../worker/util.js";

/**
 * What a template variable may hold.
 *
 * Every value reaches the template as text and is escaped there, so nothing
 * here can carry markup. `null` renders as the empty string, and `URL` exists
 * so a link is a deliberate choice at the call site rather than any string
 * that happens to look like one.
 */
type MailVariable = string | null | URL;

type MailVariables = Record<string, MailVariable>;

/**
 * A type-level `satisfies`.
 *
 * The constraint makes a template without variables, or a variable of an
 * unsupported type, a compile error while each template keeps its exact
 * variable shape.
 */
type CoveringAllTemplates<T extends Record<EmailTemplate, MailVariables>> = T;

/**
 * The variables every template references.
 *
 * Liquid renders with strictVariables, so a variable used by a template and
 * missing here fails the job at render time.
 */
type TemplateVariables = CoveringAllTemplates<{
    "team-invite": {
        teamName: string;
        acceptUrl: URL;
    };
    "session-host-invite": {
        sessionTitle: string;
        editionName: string;
        acceptUrl: URL;
    };
    "session-accepted": {
        hostName: string;
        sessionTitle: string;
        editionName: string;
        sessionUrl: URL;
        note: string | null;
    };
    "session-rejected": {
        hostName: string;
        sessionTitle: string;
        editionName: string;
        sessionUrl: URL;
        note: string | null;
    };
    "session-confirm-reminder": {
        hostName: string;
        sessionTitle: string;
        editionName: string;
        sessionUrl: URL;
    };
}>;

const subjects = {
    "team-invite": "You were invited to join a team",
    "session-host-invite": "You were invited to co-host a session",
    "session-accepted": "Your session has been accepted",
    "session-rejected": "Your session has not been selected",
    "session-confirm-reminder": "Please confirm your session",
} as const satisfies Record<EmailTemplate, string>;

const frontendUrl = (path: string): URL => {
    const url = new URL(appConfig.frontend.baseUrl);
    // A base URL without a subpath already has "/" as its pathname, which
    // doubles the separator when a rooted path is appended to it.
    url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;

    return url;
};

/** Links to the page where a host reviews, confirms or withdraws one of their sessions. */
export const sessionUrl = (editionId: string, sessionId: string): URL =>
    frontendUrl(`/editions/${editionId}/sessions/${sessionId}`);

export const teamInviteAcceptUrl = (code: string): URL =>
    frontendUrl(`/accept-team-invite/${code}`);

export const sessionHostInviteAcceptUrl = (code: string): URL =>
    frontendUrl(`/accept-host-invite/${code}`);

const serializeVariable = (value: MailVariable): string => {
    if (value === null) {
        return "";
    }

    if (value instanceof URL) {
        return value.toString();
    }

    return value;
};

const serializeVariables = (variables: MailVariables): Record<string, string> =>
    Object.fromEntries(
        Object.entries(variables).map(([name, value]) => [name, serializeVariable(value)]),
    );

type QueueMailOptions<T extends EmailTemplate> = {
    template: T;
    recipient: string;
    variables: TemplateVariables[T];
};

/** Enqueues one mail, its subject taken from the template's entry in `subjects`. */
export const queueMail = async <T extends EmailTemplate>(
    em: EntityManager,
    { template, recipient, variables }: QueueMailOptions<T>,
): Promise<void> => {
    await publishJob(
        new Job({
            payload: {
                type: "send_email",
                recipient,
                subject: subjects[template],
                template,
                variables: serializeVariables(variables),
            },
        }),
        em,
    );
};
