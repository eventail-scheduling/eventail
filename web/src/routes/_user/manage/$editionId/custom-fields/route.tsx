import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { requireManager } from "#/utils/route-guards.ts";

const Root = (): ReactNode => (
    <Container>
        <Outlet />
    </Container>
);

export const Route = createFileRoute("/_user/manage/$editionId/custom-fields")({
    beforeLoad: requireManager,
    component: Root,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.sessionType.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.track.list(params.editionId)),
        ]);
    },
});
