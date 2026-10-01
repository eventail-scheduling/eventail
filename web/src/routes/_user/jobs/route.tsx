import { Container } from "@mui/material";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/mini";
import { Scaffold } from "#/components/Scaffold/index.js";
import { jobStates } from "#/queries/job.ts";
import { requireSuperAdmin } from "#/utils/route-guards.ts";

const Root = (): ReactNode => (
    <Scaffold>
        <Container sx={{ my: 4 }}>
            <Outlet />
        </Container>
    </Scaffold>
);

export const Route = createFileRoute("/_user/jobs")({
    component: Root,
    beforeLoad: requireSuperAdmin,
    // An absent state list is the default view; an empty one is every state.
    validateSearch: z.object({
        state: z.catch(z.optional(z.array(z.enum(jobStates))), undefined),
        after: z.catch(z.optional(z.string()), undefined),
        before: z.catch(z.optional(z.string()), undefined),
    }),
});
