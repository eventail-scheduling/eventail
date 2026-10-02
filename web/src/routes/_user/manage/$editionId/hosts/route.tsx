import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

const Root = (): ReactNode => (
    <Container>
        <Outlet />
    </Container>
);

export const Route = createFileRoute("/_user/manage/$editionId/hosts")({
    component: Root,
});
