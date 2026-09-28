import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { FullPageSpinner } from "#/components/FullPageSpinner.js";
import { useStrayFileDropGuard } from "#/hooks/useStrayFileDropGuard.ts";
import type { QueryOptionsFactory } from "#/queries";
import type { CurrentUser } from "#/queries/user.ts";

export type RootRouterContext = {
    queryClient: QueryClient;
    qof: QueryOptionsFactory;
    currentUser?: CurrentUser;
};

const Root = (): ReactNode => {
    useStrayFileDropGuard();

    return <Outlet />;
};

export const Route = createRootRouteWithContext<RootRouterContext>()({
    component: Root,
    pendingComponent: FullPageSpinner,
});
