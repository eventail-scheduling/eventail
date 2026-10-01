import { Container } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryOptionsFactory } from "#/queries";
import { EditionBreadcrumbs } from "./-components/EditionBreadcrumbs.tsx";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;

    return (
        <Container>
            <EditionBreadcrumbs edition={edition} />
            <Outlet />
        </Container>
    );
};

export const Route = createFileRoute("/_user/_public/editions/$editionId")({
    component: Root,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.edition.get(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.customField.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.sessionType.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.track.list(params.editionId)),
        ]);
    },
});
