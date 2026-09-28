import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Scaffold } from "#/components/Scaffold/index.js";
import { useQueryOptionsFactory } from "#/queries/index.js";
import { DrawerContent } from "./-components/DrawerContent.tsx";
import { EditionProvider } from "./-components/EditionProvider.tsx";

const SCHEDULE_ROUTE_ID = "/_user/manage/$editionId/schedule";

const Root = (): ReactNode => {
    const { editionId } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const { edition } = useSuspenseQuery(qof.edition.get(editionId)).data;

    const onSchedule = useMatches({
        select: (matches) => matches.some((match) => match.routeId === SCHEDULE_ROUTE_ID),
    });

    return (
        <EditionProvider edition={edition}>
            <Scaffold
                overlayNavigation={onSchedule}
                fillViewport={onSchedule}
                drawerContent={<DrawerContent edition={edition} />}
            >
                <Outlet />
            </Scaffold>
        </EditionProvider>
    );
};

export const Route = createFileRoute("/_user/manage/$editionId")({
    component: Root,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.edition.list()),
            context.queryClient.ensureQueryData(context.qof.edition.get(params.editionId)),
        ]);
    },
});
