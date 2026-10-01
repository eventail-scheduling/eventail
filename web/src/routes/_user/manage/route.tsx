import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAnyTeamRole } from "#/utils/route-guards.ts";

export const Route = createFileRoute("/_user/manage")({
    component: Outlet,
    beforeLoad: requireAnyTeamRole,
});
