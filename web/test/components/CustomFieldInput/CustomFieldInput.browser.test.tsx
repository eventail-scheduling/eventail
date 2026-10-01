import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CustomFieldInput } from "#/components/CustomFieldInput/index.js";
import type { CustomField } from "#/queries/custom-field.ts";
import type { UploadLimits } from "#/queries/edition.ts";

type AnswerValues = {
    responses: Record<string, unknown>;
};

type HarnessProps = {
    customField: CustomField;
};

const uploadLimits: UploadLimits = {
    maxFileSize: 1,
    fileContentTypes: [],
    imageContentTypes: [],
};

const Harness = ({ customField }: HarnessProps): ReactNode => {
    const form = useForm<AnswerValues>({ defaultValues: { responses: {} } });

    return (
        <CustomFieldInput
            control={form.control}
            customField={customField}
            uploadLimits={uploadLimits}
        />
    );
};

const textQuestion = (type: "single_line_text" | "multi_line_text"): CustomField =>
    ({
        id: "field-1",
        title: "Equipment needed",
        helperText: "",
        requirement: "always_optional",
        deadline: null,
        freezeAfter: null,
        options: { type },
        answerMaxLength: 200,
    }) as unknown as CustomField;

describe("CustomFieldInput", () => {
    // A single-line input collapses pasted paragraphs and submits the form on Enter.
    it("takes a multi line answer in a text area", async () => {
        const screen = await render(<Harness customField={textQuestion("multi_line_text")} />);

        const field = screen.getByRole("textbox", { name: "Equipment needed" }).element();
        expect(field.tagName).toBe("TEXTAREA");
    });

    it("keeps a single line answer in an input", async () => {
        const screen = await render(<Harness customField={textQuestion("single_line_text")} />);

        const field = screen.getByRole("textbox", { name: "Equipment needed" }).element();
        expect(field.tagName).toBe("INPUT");
    });
});
