import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { compile } from "@jmespath-community/jmespath";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { HttpRequest, HttpResponse, StatusCode } from "@taxum/core/http";
import { Team } from "../../src/entity/Team.js";
import { User } from "../../src/entity/User.js";
import { appConfig } from "../../src/util/app-config.js";
import {
    isIntegrationToken,
    isSuperAdmin,
    JWT_PAYLOAD,
    type JwtPayload,
    RequireAuthorizationLayer,
    USER,
} from "../../src/util/auth.js";
import { em } from "../../src/util/mikro-orm.js";

/**
 * Reduces the layer's decision on a probe request to the status a caller sees.
 *
 * The layer is exercised directly rather than through a route, so what is under
 * test is the authorization decision itself and not the stack that happens to
 * sit in front of it.
 *
 * A refusal leaves as a thrown JsonApiError, which a layer further out turns
 * into a response, so both outcomes reduce to the status a caller ends up with.
 */
const statusFor = async (
    layer: RequireAuthorizationLayer,
    payload: JwtPayload,
    user: User | null,
): Promise<number> => {
    const service = layer.layer({
        invoke: () => Promise.resolve(HttpResponse.from(StatusCode.NO_CONTENT)),
    });

    const request = HttpRequest.builder()
        .method("GET")
        .path("/probe")
        .extension(JWT_PAYLOAD, payload)
        .extension(USER, user as never)
        .body(null);

    try {
        const response = await service.invoke(request);

        return response.status.code;
    } catch (error) {
        if (error instanceof JsonApiError) {
            return Number(error.errors[0]?.status);
        }

        throw error;
    }
};

describe("predicate evaluation", () => {
    it("applies JMESPath truthiness, not JavaScript's", () => {
        const original = appConfig.jwt.superAdminPredicate;

        try {
            // The filter-projection shape a groups claim invites: it answers
            // [] for a non-member, which JavaScript would coerce to true.
            appConfig.jwt.superAdminPredicate = compile("groups[?@=='superadmin']");
            assert.equal(
                isSuperAdmin({ sub: "x", groups: ["other"] } as unknown as JwtPayload),
                false,
            );
            assert.equal(
                isSuperAdmin({ sub: "x", groups: ["superadmin"] } as unknown as JwtPayload),
                true,
            );

            appConfig.jwt.superAdminPredicate = compile("`{}`");
            assert.equal(isSuperAdmin({ sub: "x" } as unknown as JwtPayload), false);

            appConfig.jwt.superAdminPredicate = compile("''");
            assert.equal(isSuperAdmin({ sub: "x" } as unknown as JwtPayload), false);
        } finally {
            appConfig.jwt.superAdminPredicate = original;
        }
    });

    it("denies instead of throwing when a predicate errors at evaluation", () => {
        const original = appConfig.jwt.superAdminPredicate;
        // Compiles fine, throws at evaluation: contains() rejects the null it
        // receives when the token lacks the claim.
        appConfig.jwt.superAdminPredicate = compile("contains(realm_access.roles, 'superadmin')");

        try {
            assert.equal(isSuperAdmin({ sub: "testuser" } as unknown as JwtPayload), false);
        } finally {
            appConfig.jwt.superAdminPredicate = original;
        }
    });

    it("denies a throwing integration predicate the same way", () => {
        const original = appConfig.jwt.integrationPredicate;

        try {
            appConfig.jwt.integrationPredicate = compile(
                "contains(realm_access.roles, 'integration')",
            );
            assert.equal(isIntegrationToken({ sub: "x" } as unknown as JwtPayload), false);
        } finally {
            appConfig.jwt.integrationPredicate = original;
        }
    });
});

describe("superadmin authorization", () => {
    // What config/development.toml points superAdminPredicate at.
    const superAdminPayload = { sub: "admin" } as unknown as JwtPayload;
    const plainPayload = { sub: "testuser" } as unknown as JwtPayload;

    let teamAdmin: User;

    beforeEach(async () => {
        const fork = em.fork();
        const user = new User({
            externalId: "testuser",
            displayName: "Team Lead",
            emailAddress: "lead@example.test",
        });
        const team = new Team({ name: "Organizers", role: "admin" });
        team.users.add(user);
        await fork.persist([user, team]).flush();

        teamAdmin = await fork.findOneOrFail(User, user.id, { populate: ["teams"] });
    });

    const superAdminOnly = new RequireAuthorizationLayer({ user: { superAdmin: true } });
    const adminRole = new RequireAuthorizationLayer({ user: { role: "admin" } });

    it("refuses the admin team role", async () => {
        // The distinction the gate exists for: an admin appoints admins, so a
        // gate they can pass is one they can grant themselves.
        assert.equal(await statusFor(superAdminOnly, plainPayload, teamAdmin), 403);
    });

    it("admits the claim", async () => {
        assert.equal(await statusFor(superAdminOnly, superAdminPayload, teamAdmin), 204);
    });

    it("still lets the claim satisfy an ordinary role gate", async () => {
        // The reason the two cannot be the same option: the claim lifts role
        // gates, while a role never reaches this one.
        const stranger = new User({
            externalId: "stranger",
            displayName: "No Teams",
            emailAddress: "stranger@example.test",
        });
        const fork = em.fork();
        await fork.persist(stranger).flush();
        const loaded = await fork.findOneOrFail(User, stranger.id, { populate: ["teams"] });

        assert.equal(await statusFor(adminRole, superAdminPayload, loaded), 204);
        assert.equal(await statusFor(adminRole, plainPayload, loaded), 403);
    });

    it("refuses a subject with no user row, claim or not", async () => {
        assert.equal(await statusFor(superAdminOnly, superAdminPayload, null), 403);
    });
});
