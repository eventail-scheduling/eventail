import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdmin } from "#/utils/route-guards.ts";

export const Route = createFileRoute("/_user/erase-user")({
    component: Outlet,
    beforeLoad: requireAdmin,
});
