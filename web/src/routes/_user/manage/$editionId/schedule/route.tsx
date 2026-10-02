import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Uncapped, unlike the other sections.
 *
 * A grid gets a column per room, and an edition with a dozen of them wants the
 * width a wide screen has.
 *
 * No heading of its own. Both readings put one in their own row beside their
 * own controls, which is what every other page in this section does and what
 * keeps the chrome to a single row.
 */
const Root = (): ReactNode => (
    <Container
        maxWidth={false}
        sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
        <Outlet />
    </Container>
);

export const Route = createFileRoute("/_user/manage/$editionId/schedule")({
    // Both readings want the rooms and the venues they sit in, and the picker
    // in each wants the list, so ensuring them here keeps either child off the
    // router's full page spinner.
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.schedule.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.location.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.venue.list(params.editionId)),
        ]);
    },
    component: Root,
});
