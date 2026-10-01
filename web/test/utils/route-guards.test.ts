import { type AnyRedirect, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    requireAdmin,
    requireAnyTeamRole,
    requireManager,
    requireManagerRole,
    requireSuperAdmin,
} from "#/utils/route-guards.ts";
import { userWithRole } from "../support/users.ts";

const { enqueueSnackbar } = vi.hoisted(() => ({ enqueueSnackbar: vi.fn() }));

vi.mock("notistack", () => ({ enqueueSnackbar }));

const editionId = "01a00100-0000-7000-8000-000000000001";

const denialOf = (guard: () => void): AnyRedirect["options"] => {
    try {
        guard();
    } catch (error) {
        if (isRedirect(error)) {
            return error.options;
        }

        throw error;
    }

    throw new Error("the guard let the caller through");
};

beforeEach(() => {
    enqueueSnackbar.mockClear();
});

describe("requireManager", () => {
    it.each(["manager", "admin"] as const)("lets a %s through in silence", (role) => {
        expect(() => {
            requireManager({
                context: { currentUser: userWithRole(role) },
                params: { editionId },
                preload: false,
            });
        }).not.toThrow();

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    // A viewer is on the team and so passes the guard above, which is what
    // makes the edition root the right place to put them back.
    it.each([userWithRole("viewer"), userWithRole(null), undefined])(
        "sends anyone below manager back to the edition",
        (currentUser) => {
            expect(
                denialOf(() => {
                    requireManager({
                        context: { currentUser },
                        params: { editionId },
                        preload: false,
                    });
                }),
            ).toMatchObject({ to: "/manage/$editionId", params: { editionId } });
        },
    );
});

describe("requireAnyTeamRole", () => {
    it.each(["viewer", "manager", "admin"] as const)("lets a %s through in silence", (role) => {
        expect(() => {
            requireAnyTeamRole({ context: { currentUser: userWithRole(role) }, preload: false });
        }).not.toThrow();

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    it.each([userWithRole(null), undefined])(
        "sends anyone on no team to the start page",
        (currentUser) => {
            expect(
                denialOf(() => {
                    requireAnyTeamRole({ context: { currentUser }, preload: false });
                }),
            ).toMatchObject({ to: "/" });
        },
    );
});

describe("requireManagerRole", () => {
    it.each(["manager", "admin"] as const)("lets a %s through in silence", (role) => {
        expect(() => {
            requireManagerRole({ context: { currentUser: userWithRole(role) }, preload: false });
        }).not.toThrow();

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    it.each([userWithRole("viewer"), userWithRole(null), undefined])(
        "sends anyone below manager to the start page",
        (currentUser) => {
            expect(
                denialOf(() => {
                    requireManagerRole({ context: { currentUser }, preload: false });
                }),
            ).toMatchObject({ to: "/" });
        },
    );
});

describe("requireAdmin", () => {
    it("lets an admin through in silence", () => {
        expect(() => {
            requireAdmin({ context: { currentUser: userWithRole("admin") }, preload: false });
        }).not.toThrow();

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    // Every role below admin, rather than a sample: this is the only guard that
    // names one role instead of a floor, so a rewrite to a floor would still
    // pass a test that skipped manager.
    it.each([userWithRole("manager"), userWithRole("viewer"), userWithRole(null), undefined])(
        "sends anyone below admin to the start page",
        (currentUser) => {
            expect(
                denialOf(() => {
                    requireAdmin({ context: { currentUser }, preload: false });
                }),
            ).toMatchObject({ to: "/" });
        },
    );
});

describe("requireSuperAdmin", () => {
    it("lets the superadmin claim through in silence", () => {
        expect(() => {
            requireSuperAdmin({
                context: { currentUser: userWithRole("admin", true) },
                preload: false,
            });
        }).not.toThrow();

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    // An admin team role first: highestRole reads "admin" for it and for the
    // claim alike, so a guard written against the role would let it through.
    it.each([
        userWithRole("admin"),
        userWithRole("manager"),
        userWithRole("viewer"),
        userWithRole(null),
        undefined,
    ])("sends anyone without the claim to the start page", (currentUser) => {
        expect(
            denialOf(() => {
                requireSuperAdmin({ context: { currentUser }, preload: false });
            }),
        ).toMatchObject({ to: "/" });
    });
});

describe("the explanation", () => {
    it("says why on a navigation", () => {
        denialOf(() => {
            requireManager({ context: {}, params: { editionId }, preload: false });
        });

        expect(enqueueSnackbar).toHaveBeenCalledWith("You need the manager role for that.", {
            variant: "warning",
        });
    });

    // Two routes share this guard, so the message cannot name either.
    it("names the role rather than what the route is for", () => {
        denialOf(() => {
            requireAdmin({ context: {}, preload: false });
        });

        expect(enqueueSnackbar).toHaveBeenCalledWith("You need the admin role for that.", {
            variant: "warning",
        });
    });

    it.each([
        [
            "requireManager",
            () => {
                requireManager({ context: {}, params: { editionId }, preload: true });
            },
        ],
        [
            "requireAnyTeamRole",
            () => {
                requireAnyTeamRole({ context: {}, preload: true });
            },
        ],
        [
            "requireManagerRole",
            () => {
                requireManagerRole({ context: {}, preload: true });
            },
        ],
        [
            "requireAdmin",
            () => {
                requireAdmin({ context: {}, preload: true });
            },
        ],
        [
            "requireSuperAdmin",
            () => {
                requireSuperAdmin({ context: {}, preload: true });
            },
        ],
    ] as const)("stays quiet when %s runs on a preload", (_name, guard) => {
        denialOf(guard);

        expect(enqueueSnackbar).not.toHaveBeenCalled();
    });
});
