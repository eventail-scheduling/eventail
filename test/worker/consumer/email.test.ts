import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRecipientRefusal, renderBodies } from "../../../src/worker/consumer/email.js";

const acceptedVariables = (overrides: Record<string, string> = {}) => ({
    hostName: "Ben",
    sessionTitle: "Scheduling at scale",
    editionName: "Eventail 2026",
    sessionUrl: "https://app.example.test/sessions/1",
    note: "",
    ...overrides,
});

describe("mail rendering", () => {
    // The values are a speaker's and an organizer's own words, so anything the
    // renderer treats as markup is markup they chose for mail sent from the
    // organizer's address to every co-host.
    //
    // Both fields are walked because they take different routes: the note is
    // the one value rendered through `raw`, so it is the one whose escaping a
    // later edit can drop without anything else noticing.
    it("renders every construct in a value as text", async () => {
        const constructs = [
            "[Confirm your slot](https://evil.example)",
            "<a href='https://evil.example'>Confirm</a>",
            "<script>alert(1)</script>",
            "</p><p><b>injected</b>",
            "~~withdrawn~~",
            "**urgent**",
            "# Heading",
            "<https://evil.example>",
        ];

        for (const template of ["session-accepted", "session-rejected"] as const) {
            for (const field of ["sessionTitle", "note"] as const) {
                for (const construct of constructs) {
                    const [html] = await renderBodies(
                        template,
                        "Your session was accepted",
                        acceptedVariables({ [field]: construct }),
                    );
                    const where = `${template} ${field}: ${construct}`;

                    // The text may well read "evil.example"; what it may not
                    // do is become a link to it, or any other element.
                    assert.doesNotMatch(html, /<a\b[^>]*evil\.example/, where);
                    assert.doesNotMatch(html, /<(script|s|del|em|strong|b|h1)\b/, where);
                }
            }
        }
    });

    it("escapes an ampersand for the HTML body and restores it for the text one", async () => {
        const [html, text] = await renderBodies(
            "session-accepted",
            "Your session was accepted",
            acceptedVariables({ sessionTitle: "Q&A with the chair" }),
        );

        assert.match(html, /Q&amp;A with the chair/);
        assert.match(text, /Q&A with the chair/);
    });

    it("keeps the line breaks an organizer typed in a note", async () => {
        const [html, text] = await renderBodies(
            "session-accepted",
            "Your session was accepted",
            acceptedVariables({ note: "Cut it to 30 minutes.\nBring your own adapter." }),
        );

        assert.match(html, /Cut it to 30 minutes\.<br\s*\/?>/);
        assert.match(text, /Cut it to 30 minutes\.\nBring your own adapter\./);
    });

    it("leaves the note's heading out when there is no note", async () => {
        const [html] = await renderBodies(
            "session-accepted",
            "Your session was accepted",
            acceptedVariables(),
        );

        assert.doesNotMatch(html, /A note from the organizers/);
    });

    it("carries the link the template owns", async () => {
        const [html] = await renderBodies(
            "session-accepted",
            "Your session was accepted",
            acceptedVariables(),
        );

        assert.match(html, /href="https:\/\/app\.example\.test\/sessions\/1"/);
    });
});

const smtpError = (command: string, responseCode: number): Error =>
    Object.assign(new Error("SMTP refusal"), { command, responseCode });

describe("which delivery failures are permanent", () => {
    it("gives up on a recipient the relay refuses outright", () => {
        assert.equal(isRecipientRefusal(smtpError("RCPT TO", 550)), true);
    });

    // A rotated credential or a refused sender fails every queued mail at
    // once, and discarding them all would lose mail a fixed relay could send.
    it("retries a permanent refusal of the relay's own login or sender", () => {
        assert.equal(isRecipientRefusal(smtpError("AUTH PLAIN", 535)), false);
        assert.equal(isRecipientRefusal(smtpError("MAIL FROM", 553)), false);
    });

    it("retries a permanent refusal of the message itself", () => {
        assert.equal(isRecipientRefusal(smtpError("DATA", 552)), false);
    });

    it("retries a transient refusal of the recipient", () => {
        assert.equal(isRecipientRefusal(smtpError("RCPT TO", 450)), false);
    });
});
