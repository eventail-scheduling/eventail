import assert from "node:assert";
import { type JSONObject, TreeInterpreter } from "@jmespath-community/jmespath";
import { JsonApiError } from "@jsonapi-serde/server/common";
import type { Loaded } from "@mikro-orm/core";
import type { Extractor } from "@taxum/core/extract";
import { ExtensionKey, type HttpRequest, type HttpResponse } from "@taxum/core/http";
import type { HttpLayer } from "@taxum/core/layer";
import { fromFn } from "@taxum/core/middleware/from-fn";
import type { HttpService } from "@taxum/core/service";
import { JWT, JwtLayer, UnauthorizedError } from "@taxum/jwt";
import { createRemoteJWKSet } from "jose";
import { z } from "zod";
import type { TeamRole } from "../entity/Team.js";
import { User } from "../entity/User.js";
import { appConfig } from "./app-config.js";
import { logger } from "./logger.js";
import { em } from "./mikro-orm.js";

const openIdConfigurationSchema = z.object({
    jwks_uri: z.url(),
    userinfo_endpoint: z.url(),
});

type OpenIdConfiguration = z.output<typeof openIdConfigurationSchema>;

const loadOpenIdConfiguration = async (issuer: string): Promise<OpenIdConfiguration> => {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`);

    if (!response.ok) {
        throw new Error("failed to load OpenID configuration");
    }

    return openIdConfigurationSchema.parse(await response.json());
};

export const openIdConfiguration = await loadOpenIdConfiguration(appConfig.jwt.issuer);

export const jwtLayer = new JwtLayer(createRemoteJWKSet(new URL(openIdConfiguration.jwks_uri)))
    .verifyOptions({
        issuer: appConfig.jwt.issuer,
        audience: appConfig.jwt.audience,
        algorithms: appConfig.jwt.algorithms,
    })
    .debug(appConfig.jwt.debug);

// Loose so the role predicates can evaluate against the full verified
// payload; a plain object would strip every claim but sub.
const jwtPayloadSchema = z.looseObject({
    sub: z.string(),
});

export type JwtPayload = { sub: string } & JSONObject;

export const JWT_PAYLOAD = new ExtensionKey<JwtPayload>("JWT Payload");

export const jwtPayloadLayer = fromFn(
    async (req: HttpRequest, next: HttpService): Promise<HttpResponse> => {
        const jwt = req.extensions.get(JWT);
        assert(jwt);

        const parseResult = jwtPayloadSchema.safeParse(jwt.payload);

        if (!parseResult.success) {
            logger.warn("failed to parse JWT payload", { error: parseResult.error });
            throw new UnauthorizedError("JWT payload failed validation", false);
        }

        req.extensions.insert(JWT_PAYLOAD, parseResult.data as JwtPayload);
        return next.invoke(req);
    },
);

export const USER = new ExtensionKey<Loaded<User, "teams"> | null>("User");

type JmesPathExpression = Parameters<typeof TreeInterpreter.search>[0];

// JMESPath truthiness, not JavaScript's. A filter projection like
// groups[?@=='superadmin'] answers [] for a non-member, and Boolean([]) is
// true, so the JS coercion would grant that natural predicate spelling to
// every token. What counts as false is JMESPath's own list (specification,
// "Or Expressions").
const isJmesPathTruthy = (value: unknown): boolean => {
    if (value === null || value === undefined || value === false || value === "") {
        return false;
    }

    if (Array.isArray(value)) {
        return value.length > 0;
    }

    if (typeof value === "object") {
        return Object.keys(value).length > 0;
    }

    return true;
};

// A predicate can throw at evaluation time even though it compiled, e.g.
// contains() on a claim the token lacks. That is a config defect, and it fails
// closed: denying beats turning every request into a 500.
const evaluatePredicate = (
    name: string,
    predicate: JmesPathExpression,
    payload: JwtPayload,
): boolean => {
    try {
        return isJmesPathTruthy(TreeInterpreter.search(predicate, payload));
    } catch (error) {
        logger.error(`the ${name} expression threw and denies`, { error });
        return false;
    }
};

export const isIntegrationToken = (payload: JwtPayload): boolean =>
    evaluatePredicate("jwt.integrationPredicate", appConfig.jwt.integrationPredicate, payload);

/**
 * Reads a claim granted at the identity provider, not inside eventail.
 *
 * That is what makes it a different thing from the admin team role: the events
 * lead hands out team roles, including to themselves, and cannot hand out this
 * one.
 */
export const isSuperAdmin = (payload: JwtPayload): boolean =>
    evaluatePredicate("jwt.superAdminPredicate", appConfig.jwt.superAdminPredicate, payload);

const forbiddenError = (): JsonApiError =>
    new JsonApiError({
        status: "403",
        code: "forbidden",
        title: "Forbidden",
        detail: "You are not allowed to access this resource",
    });

export type Caller = Loaded<User, "teams"> | "integration";

/**
 * Reads the caller on routes serving both users and the integration.
 *
 * It carries the guarantee locally that the handler otherwise inherits from
 * the route's authorization layer: the caller is either a resolved user or
 * the integration, never an authenticated subject without a user row.
 */
export const caller: Extractor<Caller> = (req) => {
    const user = req.extensions.get(USER);
    assert(user !== undefined, "resolveUserLayer must run before the caller extractor");

    if (user) {
        return user;
    }

    const payload = req.extensions.get(JWT_PAYLOAD);
    assert(payload);

    if (isIntegrationToken(payload)) {
        return "integration";
    }

    throw forbiddenError();
};

/**
 * Reads the user on routes only a user reaches.
 *
 * The USER extension is nullable because both an integration token and a
 * subject without a user row resolve to null, so `extension(USER, true)`
 * guarantees the extension is present but not that it holds a user. The
 * route's layer is what turns those callers away.
 */
export const requiredUser: Extractor<Loaded<User, "teams">> = (req) => {
    const user = req.extensions.get(USER);
    assert(user !== undefined, "resolveUserLayer must run before the requiredUser extractor");
    assert(user, "this route requires an authorization layer demanding a user");

    return user;
};

export const resolveUserLayer = fromFn(
    async (req: HttpRequest, next: HttpService): Promise<HttpResponse> => {
        const payload = req.extensions.get(JWT_PAYLOAD);
        assert(payload);

        // An integration token stays a machine identity even when a User row
        // with its subject exists; resolving one would silently flip every
        // integration-capable route onto the user path.
        const user = isIntegrationToken(payload)
            ? null
            : await em.findOne(User, { externalId: payload.sub }, { populate: ["teams"] });

        req.extensions.insert(USER, user);
        return next.invoke(req);
    },
);

type UserAuthorizationOptions =
    | { role: TeamRole }
    /**
     * The claim and nothing else, so an admin team role does not reach it.
     *
     * For what an operator owns rather than what the organizing team owns: an
     * admin can appoint admins, and anything they must not be able to grant
     * themselves belongs behind this.
     */
    | { superAdmin: true };

type AuthorizationOptions = {
    user?: UserAuthorizationOptions | true;
    integration?: boolean;
};

export const userProvidesRole = (
    payload: JwtPayload,
    user: Loaded<User, "teams">,
    role: TeamRole,
): boolean => isSuperAdmin(payload) || user.teams.exists((team) => team.providesRole(role));

/**
 * Reports whether a caller reads beyond their own sessions and responses.
 *
 * Both are clamped to the caller's own without global access. The superadmin
 * claim lifts that clamp the same way it lifts the role gates, so a superadmin
 * without team memberships is not clamped.
 */
export const hasGlobalReadAccess = (payload: JwtPayload, user: Loaded<User, "teams">): boolean =>
    isSuperAdmin(payload) || user.hasGlobalAccess();

/**
 * Hides internal tracks and session types from submitters.
 *
 * Anyone on a team is on the organizing side, and the session list already
 * serves every track and session type an included session names, internal ones
 * among them, so a viewer who could not read the lists could not filter by what
 * the rows already showed them. The integration receives them as display hints.
 *
 * Reading them is not permission to assign one: findSessionType and findTrack
 * in the session write handlers stay on the manager role, and the speaker form
 * drops what it may not offer.
 *
 * The nullable user is deliberate: the consuming routes carry no
 * authorization layer, so null covers both the integration and authenticated
 * subjects without a user row. They must stay on the plain USER extension
 * rather than the {@link caller} extractor, which would 403 the latter.
 */
export const seesInternal = (user: Loaded<User, "teams"> | null, payload: JwtPayload): boolean => {
    if (user) {
        return userProvidesRole(payload, user, "viewer");
    }

    return isIntegrationToken(payload);
};

export class RequireAuthorizationLayer implements HttpLayer {
    private readonly options: AuthorizationOptions;

    public constructor(options: AuthorizationOptions) {
        this.options = options;
    }

    public layer(inner: HttpService): HttpService {
        return new RequireAuthorizationService(inner, this.options);
    }
}

class RequireAuthorizationService implements HttpService {
    private readonly inner: HttpService;
    private readonly options: AuthorizationOptions;

    public constructor(inner: HttpService, options: AuthorizationOptions) {
        this.inner = inner;
        this.options = options;
    }

    public async invoke(req: HttpRequest): Promise<HttpResponse> {
        const user = req.extensions.get(USER);
        assert(user !== undefined);

        if (this.options.user && user) {
            if (this.options.user !== true) {
                this.verifyUser(req, user, this.options.user);
            }

            return this.inner.invoke(req);
        }

        if (this.options.integration) {
            const payload = req.extensions.get(JWT_PAYLOAD);
            assert(payload);

            if (isIntegrationToken(payload)) {
                return this.inner.invoke(req);
            }
        }

        throw forbiddenError();
    }

    private verifyUser(
        req: HttpRequest,
        user: Loaded<User, "teams">,
        options: UserAuthorizationOptions,
    ): void {
        const payload = req.extensions.get(JWT_PAYLOAD);
        assert(payload);

        if ("superAdmin" in options) {
            if (!isSuperAdmin(payload)) {
                throw forbiddenError();
            }

            return;
        }

        if (userProvidesRole(payload, user, options.role)) {
            return;
        }

        throw forbiddenError();
    }
}
