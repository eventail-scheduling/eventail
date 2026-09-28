import { redirect } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { RootRouterContext } from "#/routes/__root.tsx";
import { fulfillsRole } from "#/utils/role.ts";

type GuardOptions = {
    context: Pick<RootRouterContext, "currentUser">;
    preload: boolean;
};

type EditionGuardOptions = GuardOptions & {
    params: { editionId: string };
};

/**
 * Says why the reader is about to land somewhere they did not ask for.
 *
 * Links preload on intent, so these guards run on hover as well as on
 * navigation. A message sent without the check would appear over a page nobody
 * is leaving.
 */
const explain = (preload: boolean, message: string): void => {
    if (preload) {
        return;
    }

    enqueueSnackbar(message, { variant: "warning" });
};

/**
 * Sends anyone below manager back to the edition they came in through.
 *
 * The API refuses every write below manager, so a viewer who reached one of
 * these by its address would fill a form in only to be turned away on save.
 */
export const requireManager = ({ context, params, preload }: EditionGuardOptions): void => {
    if (fulfillsRole(context.currentUser, "manager")) {
        return;
    }

    explain(preload, "You need the manager role for that.");

    throw redirect({
        to: "/manage/$editionId",
        params: { editionId: params.editionId },
    });
};

/** Sends anyone on no team at all back to the start page. */
export const requireAnyTeamRole = ({ context, preload }: GuardOptions): void => {
    if (fulfillsRole(context.currentUser, "viewer")) {
        return;
    }

    explain(preload, "You need a team role to open the management area.");

    throw redirect({ to: "/" });
};

/**
 * Sends anyone below manager back to the start page.
 *
 * The edition-scoped `requireManager` cannot serve a route with no edition in
 * its path, and the role it reads is global anyway.
 */
export const requireManagerRole = ({ context, preload }: GuardOptions): void => {
    if (fulfillsRole(context.currentUser, "manager")) {
        return;
    }

    explain(preload, "You need the manager role for that.");

    throw redirect({ to: "/" });
};

/**
 * Sends anyone without the superadmin claim back to the start page.
 *
 * An admin team role is not enough, and `highestRole` cannot tell them apart:
 * it reads "admin" for the claim as well. The job queue is the operator's,
 * because only the operator can fix what a job failed on.
 */
export const requireSuperAdmin = ({ context, preload }: GuardOptions): void => {
    if (context.currentUser?.meta.superAdmin === true) {
        return;
    }

    explain(preload, "Only the operator can open that.");

    throw redirect({ to: "/" });
};

/** Sends anyone but an admin back to the start page. */
export const requireAdmin = ({ context, preload }: GuardOptions): void => {
    if (context.currentUser?.meta.highestRole === "admin") {
        return;
    }

    explain(preload, "You need the admin role for that.");

    throw redirect({ to: "/" });
};
