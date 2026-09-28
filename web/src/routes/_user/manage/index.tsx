import { Alert, Container } from "@mui/material";
import { createFileRoute, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Scaffold } from "#/components/Scaffold/index.js";
import { fulfillsRole } from "#/utils/role.ts";
import { readLastSelectedEditionId } from "./$editionId/-components/EditionProvider.js";

const Root = (): ReactNode => (
    <Scaffold>
        <Container maxWidth="sm">
            <Alert severity="info">
                There are no editions at the moment. Please ask a manager to create one.
            </Alert>
        </Container>
    </Scaffold>
);

export const Route = createFileRoute("/_user/manage/")({
    component: Root,
    loader: async ({ context }) => {
        const editions = await context.queryClient.ensureQueryData(context.qof.edition.list());
        const lastSelectedEditionId = readLastSelectedEditionId();

        if (
            lastSelectedEditionId &&
            editions.some((edition) => edition.id === lastSelectedEditionId)
        ) {
            throw redirect({
                to: "/manage/$editionId",
                params: { editionId: lastSelectedEditionId },
            });
        }

        if (editions.length > 0) {
            throw redirect({ to: "/manage/$editionId", params: { editionId: editions[0].id } });
        }

        const currentUser = await context.queryClient.ensureQueryData(
            context.qof.user.getCurrentUser(),
        );

        if (fulfillsRole(currentUser, "manager")) {
            throw redirect({ to: "/manage/create-edition" });
        }
    },
});
