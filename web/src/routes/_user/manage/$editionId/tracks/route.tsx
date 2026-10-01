import { Container, Stack, Typography } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ButtonLink } from "#/components/Link/index.js";
import { requireManager } from "#/utils/route-guards.ts";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();

    return (
        <Container>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5" sx={{ mr: "auto" }}>
                    Tracks
                </Typography>
                <ButtonLink
                    variant="contained"
                    to="/manage/$editionId/tracks/create"
                    params={{ editionId }}
                >
                    Add track
                </ButtonLink>
            </Stack>

            <Outlet />
        </Container>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId/tracks")({
    beforeLoad: requireManager,
    component: Root,
});
