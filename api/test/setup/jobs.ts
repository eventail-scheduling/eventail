import type { SendEmailJobPayload } from "../../src/entity/Job.js";

/** Pins the template and leaves the variables empty, since no job test depends on either. */
export const buildEmailPayload = (recipient: string, subject: string): SendEmailJobPayload => ({
    type: "send_email",
    recipient,
    subject,
    template: "team-invite",
    variables: {},
});
