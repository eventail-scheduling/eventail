import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQueryOptionsFactory } from "#/queries";

const Root = (): ReactNode => {
    // Watched here, above every page, so the reading is taken again every
    // quarter hour and whenever the tab becomes visible.
    useQuery(useQueryOptionsFactory().clock.get());

    return <Outlet />;
};

export const Route = createFileRoute("/_user")({
    component: Root,
    loader: async ({ context }) => {
        // Prefetched rather than ensured: serverNow falls back to the local
        // clock, so a clock the API fails to serve must not fail every page.
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.user.getCurrentUser()),
            context.queryClient.prefetchQuery(context.qof.clock.get()),
        ]);
    },
    beforeLoad: async ({ context, location }) => {
        const currentUser = await context.queryClient.ensureQueryData(
            context.qof.user.getCurrentUser(),
        );

        if (!currentUser.data) {
            return redirect({
                to: "/create-profile",
                search: {
                    editableFields: currentUser.meta.editableFields,
                    returnTo: location.href,
                },
            }) as never;
        }

        return { currentUser };
    },
});
