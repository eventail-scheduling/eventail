import { type AnyRedirect, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "#/queries/edition.ts";
import type { TeamRole } from "#/queries/team.ts";
import { Route } from "#/routes/_user/manage/index.tsx";
import { userWithRole } from "../../support/users.ts";

type Marker = { asks: "editions" | "user" };

type LoaderOptions = {
    context: unknown;
};

const runLoader = Route.options.loader as (options: LoaderOptions) => Promise<void>;

/**
 * Runs the loader and gives the redirect it threw, or null where it let go.
 *
 * The two queries are told apart by what the factory was asked for rather than
 * by a query key, so nothing here has to stay in step with how the keys are
 * built.
 */
const load = async (
    editions: Pick<Edition, "id">[],
    highestRole: TeamRole | null,
): Promise<AnyRedirect["options"] | null> => {
    const context = {
        queryClient: {
            ensureQueryData: async ({ asks }: Marker) =>
                asks === "editions" ? editions : userWithRole(highestRole),
        },
        qof: {
            edition: { list: (): Marker => ({ asks: "editions" }) },
            user: { getCurrentUser: (): Marker => ({ asks: "user" }) },
        },
    };

    try {
        await runLoader({ context });
    } catch (error) {
        if (isRedirect(error)) {
            return error.options;
        }

        throw error;
    }

    return null;
};

beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
});

describe("opening the management area", () => {
    // Creating an edition is behind the manager role in the API and on the
    // create page, so an installation with no editions is a manager's to fix.
    it("sends a manager with nothing to manage on to create an edition", async () => {
        await expect(load([], "manager")).resolves.toMatchObject({
            to: "/manage/create-edition",
        });
    });

    it("leaves a viewer with nothing to manage where they are", async () => {
        await expect(load([], "viewer")).resolves.toBeNull();
    });

    it("sends anyone to the first edition there is", async () => {
        await expect(
            load([{ id: "01a00100-0000-7000-8000-000000000001" }], "viewer"),
        ).resolves.toMatchObject({
            to: "/manage/$editionId",
            params: { editionId: "01a00100-0000-7000-8000-000000000001" },
        });
    });
});
