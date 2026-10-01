import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { UnscheduledSidebar } from "#/components/ScheduleGrid/UnscheduledSidebar.tsx";
import type { SlottableSession } from "#/queries/session.ts";

const talk = { id: "session-1", title: "Temporal in practice" } as unknown as SlottableSession;

const mount = async (pending: ReadonlyMap<string, boolean>) => {
    const onStartDrag = vi.fn();
    const screen = await render(
        <UnscheduledSidebar
            sessions={[talk]}
            slots={[]}
            onStartDrag={onStartDrag}
            pendingPlacements={pending}
        />,
    );

    return { screen, onStartDrag };
};

describe("a placement on its way", () => {
    // The grid shows nothing of it until the draft is read again, so it stays
    // listed under the default filter, where hiding it would read as placed.
    it("stays listed while placed ones are hidden, saying it is placing", async () => {
        const { screen } = await mount(new Map([["session-1", false]]));

        await expect.element(screen.getByRole("status")).toHaveTextContent("Placing…");
    });

    // A second drop would place the session twice once the connection is back.
    it("says it waits for the connection, and cannot be picked up again", async () => {
        const { screen, onStartDrag } = await mount(new Map([["session-1", true]]));

        await expect
            .element(screen.getByRole("status"))
            .toHaveTextContent("Waiting for the connection");

        screen
            .getByTitle("Temporal in practice")
            .element()
            .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

        expect(onStartDrag).not.toHaveBeenCalled();
    });
});
