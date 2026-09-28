import { userEvent } from "vitest/browser";
import type { RenderResult } from "vitest-browser-react";

/** Clears the textbox with the given label and types the value into it. */
export const replace = async (
    screen: Pick<RenderResult, "getByRole">,
    label: string,
    value: string,
): Promise<void> => {
    const input = screen.getByRole("textbox", { name: label });
    await userEvent.clear(input);
    await userEvent.type(input, value);
};
