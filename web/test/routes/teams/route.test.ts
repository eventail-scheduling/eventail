import { type AnyRedirect, isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "#/queries/user.ts";
import { Route } from "#/routes/_user/teams/route.tsx";
import { userWithRole } from "../../support/users.ts";

vi.mock("notistack", () => ({ enqueueSnackbar: vi.fn() }));

type GuardOptions = {
    context: { currentUser: CurrentUser | undefined };
    preload: boolean;
};

const runBeforeLoad = Route.options.beforeLoad as (options: GuardOptions) => void;

const beforeLoad = (currentUser: CurrentUser | undefined): AnyRedirect["options"] | null => {
    try {
        runBeforeLoad({ context: { currentUser }, preload: false });
    } catch (error) {
        if (isRedirect(error)) {
            return error.options;
        }

        throw error;
    }

    return null;
};

// Every route inside this section asks the API for something only an admin may
// read, so without a guard here the first thing a manager arriving by address
// sees is the error card.
describe("the teams section", () => {
    it("turns away anyone below admin", () => {
        expect(beforeLoad(userWithRole("manager"))).toMatchObject({ to: "/" });
    });

    it("lets an admin in", () => {
        expect(beforeLoad(userWithRole("admin"))).toBeNull();
    });
});
