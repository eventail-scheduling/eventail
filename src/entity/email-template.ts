/**
 * The liquid templates in email-templates/, without their extension.
 *
 * The variables each one takes live in support/mail.ts.
 */
export type EmailTemplate =
    | "team-invite"
    | "session-host-invite"
    | "session-accepted"
    | "session-rejected"
    | "session-confirm-reminder";
