import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { requireManager } from "#/utils/route-guards.ts";

const Root = (): ReactNode => (
    <Container>
        <Outlet />
    </Container>
);

export const Route = createFileRoute("/_user/manage/$editionId/venues")({
    beforeLoad: requireManager,
    component: Root,
});
