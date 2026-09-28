import { htmlToText } from "html-to-text";
import juice from "juice";
import { Liquid } from "liquidjs";
import { createTransport } from "nodemailer";
import { appConfig } from "../../util/app-config.js";
import { type JobConsumer, UnrecoverableJobError } from "../processor.js";

const liquid = new Liquid({
    root: "email-templates",
    strictFilters: true,
    strictVariables: true,
    outputEscape: "escape",
});
const transport = createTransport(appConfig.email.smtp);

/**
 * Returns the inlined HTML first and the plain-text fallback second.
 *
 * The text is derived from the body alone, so the layout's chrome stays out of
 * it. Exported so a test can reach the templates.
 */
export const renderBodies = async (
    template: string,
    subject: string,
    variables: Record<string, unknown>,
): Promise<[string, string]> => {
    const htmlContent = (await liquid.renderFile(`${template}.html.liquid`, variables)) as string;
    const emailHtml = await liquid.renderFile("layout.html.liquid", {
        subject: subject,
        htmlContent,
    });
    const inlinedEmailHtml = juice(emailHtml);
    const emailText = htmlToText(htmlContent);

    return [inlinedEmailHtml, emailText];
};

/**
 * Reports whether the relay refused the recipient for good, classified conservatively.
 *
 * Only a permanent reply to the recipient counts. One to the login, the sender or the message
 * retries with the transient ones, since a rejected login or sender fails every mail alike. A
 * relay refusing all mail at the recipient, as "relay access denied" does, still reads as a
 * refused recipient.
 */
export const isRecipientRefusal = (error: unknown): boolean =>
    error instanceof Error &&
    "command" in error &&
    error.command === "RCPT TO" &&
    "responseCode" in error &&
    typeof error.responseCode === "number" &&
    error.responseCode >= 500;

export const sendEmailJobConsumer: JobConsumer<"send_email"> = async (payload) => {
    let htmlContent: string;
    let textContent: string;

    try {
        [htmlContent, textContent] = await renderBodies(
            payload.template,
            payload.subject,
            payload.variables,
        );
    } catch (error) {
        throw new UnrecoverableJobError("Failed to render email template", { cause: error });
    }

    try {
        await transport.sendMail({
            from: appConfig.email.sender,
            to: payload.recipient,
            subject: payload.subject,
            html: htmlContent,
            text: textContent,
        });
    } catch (error) {
        if (isRecipientRefusal(error)) {
            throw new UnrecoverableJobError(
                `Delivery to ${payload.recipient} rejected permanently`,
                { cause: error },
            );
        }

        throw error;
    }
};
