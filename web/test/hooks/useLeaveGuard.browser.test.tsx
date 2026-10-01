import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
    useRouter,
} from "@tanstack/react-router";
import { ConfirmProvider } from "material-ui-confirm";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useLeaveGuard } from "#/hooks/useLeaveGuard.ts";

type TitleValues = {
    title: string;
};

const FormPage = (): ReactNode => {
    const router = useRouter();
    const form = useForm<TitleValues>({ defaultValues: { title: "" } });
    const leaveGuard = useLeaveGuard(form);
    const leave = () => {
        void router.navigate({ to: "/elsewhere" } as never);
    };

    return (
        <>
            <input aria-label="Title" {...form.register("title")} />
            <button type="button" onClick={leave}>
                Leave the page
            </button>
            <button
                type="button"
                onClick={() => {
                    leaveGuard.release();
                    leave();
                }}
            >
                Leave after saving
            </button>
        </>
    );
};

const mount = async () => {
    const rootRoute = createRootRoute({
        component: () => (
            <ConfirmProvider>
                <Outlet />
            </ConfirmProvider>
        ),
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([
            createRoute({ getParentRoute: () => rootRoute, path: "/", component: FormPage }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: "/elsewhere",
                component: () => <p>Somewhere else</p>,
            }),
        ]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    return render(<RouterProvider router={router as never} />);
};

describe("leaving a form with unsaved changes", () => {
    it("lets a form nobody changed go without asking", async () => {
        const screen = await mount();

        await screen.getByRole("button", { name: "Leave the page" }).click();

        await expect.element(screen.getByText("Somewhere else")).toBeVisible();
    });

    it("asks first, and stays when told to", async () => {
        const screen = await mount();
        await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Draft");

        await screen.getByRole("button", { name: "Leave the page" }).click();
        await expect.element(screen.getByText("Leave without saving?")).toBeVisible();
        await screen.getByRole("button", { name: "Stay" }).click();
        await expect.element(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Draft");

        await screen.getByRole("button", { name: "Leave the page" }).click();
        await screen.getByRole("button", { name: "Leave" }).click();
        await expect.element(screen.getByText("Somewhere else")).toBeVisible();
    });

    it("lets a released form go without asking", async () => {
        const screen = await mount();
        await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Draft");

        await screen.getByRole("button", { name: "Leave after saving" }).click();

        await expect.element(screen.getByText("Somewhere else")).toBeVisible();
    });
});
