import { SnackbarProvider } from "notistack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { EditionIdField } from "#/routes/_user/manage/$editionId/settings/-components/EditionIdField.tsx";

const editionId = "01a00548-4998-72d4-ad19-52975e052880";

const mount = () =>
    render(
        <SnackbarProvider>
            <EditionIdField editionId={editionId} />
        </SnackbarProvider>,
    );

/**
 * Replaces `navigator.clipboard`, which is read-only and, in an insecure
 * context, absent entirely. `undefined` is the case a deployment still being
 * set up over plain http hits.
 */
const withClipboard = (clipboard: { writeText: () => Promise<void> } | undefined): void => {
    Object.defineProperty(navigator, "clipboard", {
        value: clipboard,
        configurable: true,
    });
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe("EditionIdField", () => {
    it("shows the edition's id without letting it be edited", async () => {
        const screen = await mount();

        const field = screen.getByLabelText("Edition ID");
        await expect.element(field).toHaveValue(editionId);
        await expect.element(field).toHaveAttribute("readonly");
    });

    it("copies the id and says so", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        withClipboard({ writeText });
        const screen = await mount();

        await screen.getByRole("button", { name: "Copy edition ID" }).click();

        expect(writeText).toHaveBeenCalledWith(editionId);
        await expect.element(screen.getByText("Edition ID copied")).toBeVisible();
    });

    it("asks the reader to copy by hand where there is no clipboard", async () => {
        withClipboard(undefined);
        const screen = await mount();

        await screen.getByRole("button", { name: "Copy edition ID" }).click();

        await expect
            .element(screen.getByText("Could not copy. Select the ID and copy it yourself."))
            .toBeVisible();
    });

    it("says so when the clipboard refuses", async () => {
        withClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
        const screen = await mount();

        await screen.getByRole("button", { name: "Copy edition ID" }).click();

        await expect
            .element(screen.getByText("Could not copy. Select the ID and copy it yourself."))
            .toBeVisible();
    });
});
