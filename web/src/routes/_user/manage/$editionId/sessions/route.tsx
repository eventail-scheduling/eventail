import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/mini";
import { sessionStates } from "#/queries/session.ts";

const Root = (): ReactNode => (
    <Container>
        <Outlet />
    </Container>
);

export const Route = createFileRoute("/_user/manage/$editionId/sessions")({
    /**
     * The filters and the page a reader is on, carried in the url.
     *
     * Every one of them falls back rather than refusing, because these arrive
     * from an address bar as often as from the controls, and a list that
     * refuses to draw is a worse answer than one drawn unfiltered.
     */
    validateSearch: z.object({
        state: z.catch(z.optional(z.array(z.enum(sessionStates))), undefined),
        search: z.catch(z.optional(z.string()), undefined),
        sessionType: z.catch(z.optional(z.string()), undefined),
        track: z.catch(z.optional(z.string()), undefined),
        after: z.catch(z.optional(z.string()), undefined),
        before: z.catch(z.optional(z.string()), undefined),
    }),
    component: Root,
    loader: async ({ context, params }) => {
        await Promise.all([
            context.queryClient.ensureQueryData(context.qof.sessionType.list(params.editionId)),
            context.queryClient.ensureQueryData(context.qof.track.list(params.editionId)),
        ]);
    },
});
