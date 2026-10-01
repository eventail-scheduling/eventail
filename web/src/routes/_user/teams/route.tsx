import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Scaffold } from "#/components/Scaffold/index.js";
import { requireAdmin } from "#/utils/route-guards.ts";

const Root = (): ReactNode => {
    return (
        <Scaffold>
            <Outlet />
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/teams")({
    component: Root,
    beforeLoad: requireAdmin,
});
