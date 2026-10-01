import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Detail, ResponseValue } from "#/components/ResponseValue/index.js";
import type { CustomField } from "#/queries/custom-field.ts";

vi.mock("@axa-fr/react-oidc", () => ({
    useOidcFetch: () => ({ fetch: vi.fn() }),
}));

const customField = (options: CustomField["options"]): CustomField =>
    ({ id: "field-1", title: "A question", options }) as unknown as CustomField;

const show = (options: CustomField["options"], value: unknown) =>
    render(
        <ResponseValue
            customField={customField(options)}
            editionId="edition-1"
            responseId="answer-1"
            value={value}
        />,
    );

describe("ResponseValue", () => {
    it("says an empty text answer was not given", async () => {
        const screen = await show({ type: "single_line_text" }, "");

        await expect.element(screen.getByText("Not given")).toBeVisible();
    });

    it("says a multiple choice with nothing chosen was not given", async () => {
        const screen = await show(
            { type: "multiple_choice", items: [{ id: "item-1", label: "Kotlin" }] },
            [],
        );

        await expect.element(screen.getByText("Not given")).toBeVisible();
    });
});

describe("Detail", () => {
    // A multi-line answer, abstract or biography keeps the paragraphs its
    // author typed rather than running them together.
    it("keeps the line breaks in what it shows", async () => {
        const heightOf = async (text: string) => {
            const screen = await render(<Detail label="Notes">{text}</Detail>);
            const height = screen
                .getByText(/^First/)
                .element()
                .getBoundingClientRect().height;
            screen.unmount();

            return height;
        };

        expect(await heightOf("First line\nSecond line")).toBeGreaterThan(
            (await heightOf("First line Second line")) * 1.5,
        );
    });
});
