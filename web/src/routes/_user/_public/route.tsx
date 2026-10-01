import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Scaffold } from "#/components/Scaffold/index.js";

const Root = (): ReactNode => {
    return (
        <Scaffold>
            <Outlet />
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/_public")({
    component: Root,
});
