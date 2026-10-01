import { type FormEventHandler, type ReactNode, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
    CurrentUserForm,
    type CurrentUserTransformedValues,
} from "#/components/CurrentUser/CurrentUserForm.tsx";
import type { UserEditableFields } from "#/queries/user.ts";
import { replace } from "../../support/forms.ts";

type HarnessProps = {
    onSubmit: (data: CurrentUserTransformedValues) => void;
    editableFields?: UserEditableFields;
};

const Harness = ({ onSubmit, editableFields = ["emailAddress"] }: HarnessProps): ReactNode => {
    const submitRef = useRef<FormEventHandler | undefined>(undefined);

    return (
        <form noValidate onSubmit={(event) => submitRef.current?.(event)}>
            <CurrentUserForm
                user={null}
                editableFields={editableFields}
                onSubmit={onSubmit}
                onSubmitRef={submitRef}
            />
            <button type="submit">Save</button>
        </form>
    );
};

describe("CurrentUserForm", () => {
    it("trims an email address before checking it", async () => {
        const onSubmit = vi.fn();
        const screen = await render(<Harness onSubmit={onSubmit} />);

        await replace(screen, "Email address", "  ada@example.test  ");
        await screen.getByRole("button", { name: "Save" }).click();

        await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
        expect(onSubmit.mock.calls[0]?.[0]).toEqual({ emailAddress: "ada@example.test" });
    });

    it("refuses an email address of spaces alone", async () => {
        const onSubmit = vi.fn();
        const screen = await render(<Harness onSubmit={onSubmit} />);

        await replace(screen, "Email address", "   ");
        await screen.getByRole("button", { name: "Save" }).click();

        await expect
            .element(screen.getByRole("textbox", { name: "Email address" }))
            .toHaveAttribute("aria-invalid", "true");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    // A field the provider supplies is not rendered, so a refusal on it would
    // leave the save doing nothing with no message anywhere.
    it("saves the one field it offers when the provider supplies the other", async () => {
        const onSubmit = vi.fn();
        const screen = await render(
            <Harness onSubmit={onSubmit} editableFields={["displayName"]} />,
        );

        await replace(screen, "Display name", "Ada");
        await screen.getByRole("button", { name: "Save" }).click();

        await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
        expect(onSubmit.mock.calls[0]?.[0]).toEqual({ displayName: "Ada" });
    });

    it("saves with nothing to offer when the provider supplies both fields", async () => {
        const onSubmit = vi.fn();
        const screen = await render(<Harness onSubmit={onSubmit} editableFields={[]} />);

        await screen.getByRole("button", { name: "Save" }).click();

        await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
        expect(onSubmit.mock.calls[0]?.[0]).toEqual({});
    });
});
