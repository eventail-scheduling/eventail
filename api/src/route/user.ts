import assert from "node:assert";
import { type JSONValue, TreeInterpreter } from "@jmespath-community/jmespath";
import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
    type MetaSchemaObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { type EntityManager, LockMode, UniqueConstraintViolationException } from "@mikro-orm/core";
import { extension, header } from "@taxum/core/extract";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import { CacheableMemory } from "cacheable";
import type { OpenApiBuilder, SchemaObject } from "openapi3-ts/oas31";
import { z } from "zod";
import { type TeamRole, teamRoles } from "../entity/Team.js";
import { User } from "../entity/User.js";
import { serialize } from "../json-api/index.js";
import { restrictedTeamResourceSchema } from "../json-api/team.js";
import { userProfileResourceSchema } from "../json-api/user.js";
import { appConfig } from "../util/app-config.js";
import {
    isIntegrationToken,
    isSuperAdmin,
    JWT_PAYLOAD,
    type JwtPayload,
    openIdConfiguration,
} from "../util/auth.js";
import { logger } from "../util/logger.js";
import { em } from "../util/mikro-orm.js";
import { emailAddressSchema, nameSchema } from "../util/zod.js";

const fetchUserInfo = async (authorization: string): Promise<JSONValue> => {
    const response = await fetch(openIdConfiguration.userinfo_endpoint, {
        headers: {
            authorization,
        },
    });

    if (!response.ok) {
        throw new Error("failed to retrieve user info");
    }

    return (await response.json()) as JSONValue;
};

type UserInfo = {
    displayName: string | null;
    emailAddress: string | null;
};

/**
 * Unbounded on purpose, unlike the name and address a user types.
 *
 * A failed parse here refuses the profile read, and `loadUserInfo` runs on
 * every uncached one. So a ceiling on what the provider sends would lock out
 * whoever exceeds it rather than refusing one write.
 */
const claimedDisplayNameSchema = z.string().trim().min(1);
const claimedEmailAddressSchema = z.email().toLowerCase();

type JmesPathExpression = Parameters<typeof TreeInterpreter.search>[0];
type UserInfoPathSetting = "displayNamePath" | "emailAddressPath";

/**
 * Answers nothing when the expression throws, so the claim counts as missing.
 *
 * A path can compile and still throw on what a provider sends, such as join()
 * over a claim that is not a string. The person then sees the missing-claim
 * refusal rather than a server error, and the log names the setting.
 */
const searchUserInfo = (
    path: JmesPathExpression,
    rawUserInfo: JSONValue,
    setting: UserInfoPathSetting,
): JSONValue | undefined => {
    try {
        return TreeInterpreter.search(path, rawUserInfo);
    } catch (error) {
        logger.error(`userInfo.${setting} threw, counting the claim as missing`, { error });
        return undefined;
    }
};

/**
 * Reads one configured claim, refusing with a code the web explains when it is missing or
 * unusable.
 */
const resolveUserInfoField = (
    setting: UserInfoPathSetting,
    schema: z.ZodType<string>,
    rawUserInfo: JSONValue,
    label: string,
): string | null => {
    const path = appConfig.userInfo[setting];

    if (!path) {
        return null;
    }

    const result = schema.safeParse(searchUserInfo(path, rawUserInfo, setting));

    if (!result.success) {
        throw new JsonApiError({
            status: "403",
            code: "missing_profile_claim",
            title: "Missing profile claim",
            detail:
                `Your sign-in provider did not send a usable ${label}, which this app reads` +
                " from it. Ask whoever runs the provider to add it, then sign in again.",
            meta: { claim: label },
        });
    }

    return result.data;
};

const parseUserInfo = (rawUserInfo: JSONValue): UserInfo => ({
    displayName: resolveUserInfoField(
        "displayNamePath",
        claimedDisplayNameSchema,
        rawUserInfo,
        "display name",
    ),
    emailAddress: resolveUserInfoField(
        "emailAddressPath",
        claimedEmailAddressSchema,
        rawUserInfo,
        "email address",
    ),
});

/** Exported as a test seam; production code never touches it directly. */
export const userInfoCache = new CacheableMemory({
    ttl: appConfig.userInfo.cacheTtl.total("milliseconds"),
});

const loadUserInfo = async (authorization: string): Promise<UserInfo> => {
    const rawUserInfo = await fetchUserInfo(authorization);
    // Names without values: the question this answers is which claims the
    // provider returns, and the document itself carries an email address and a
    // name into a log stream this service does not control the retention of.
    logger.debug("received user info", {
        claims:
            typeof rawUserInfo === "object" && rawUserInfo !== null ? Object.keys(rawUserInfo) : [],
    });

    return parseUserInfo(rawUserInfo);
};

type EditableFields = "displayName" | "emailAddress";
const editableFields: EditableFields[] = [];

if (!appConfig.userInfo.displayNamePath) {
    editableFields.push("displayName");
}

if (!appConfig.userInfo.emailAddressPath) {
    editableFields.push("emailAddress");
}

const handleNewUser = (em: EntityManager, externalId: string, userInfo: UserInfo): User | null => {
    if (userInfo.displayName === null || userInfo.emailAddress === null) {
        return null;
    }

    const user = new User({
        externalId,
        displayName: userInfo.displayName,
        emailAddress: userInfo.emailAddress,
    });
    em.persist(user);
    return user;
};

const handleExistingUser = (em: EntityManager, user: User, userInfo: UserInfo): void => {
    let changed = false;

    if (userInfo.displayName !== null && user.displayName !== userInfo.displayName) {
        user.displayName = userInfo.displayName;
        changed = true;
    }

    if (userInfo.emailAddress !== null && user.emailAddress !== userInfo.emailAddress) {
        user.emailAddress = userInfo.emailAddress;
        changed = true;
    }

    if (changed) {
        em.persist(user);
    }
};

const getHighestRole = async (
    jwtPayload: JwtPayload,
    user: User | null,
): Promise<TeamRole | null> => {
    if (isSuperAdmin(jwtPayload)) {
        return "admin";
    }

    if (user === null) {
        return null;
    }

    const teams = await user.teams.load();

    let highestRole = null;

    for (const team of teams) {
        highestRole = team.maxRole(highestRole);
    }

    return highestRole;
};

const assertNotIntegration = (payload: JwtPayload): void => {
    // A profile row for the integration subject would shadow its machine
    // identity on every integration-capable route.
    if (isIntegrationToken(payload)) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "Machine tokens cannot have a user profile",
        });
    }
};

// A pessimistic lock reserves nothing when the row does not exist yet, so two
// first-time requests for the same subject both insert and the loser hits the
// unique constraint on the external id. Its retry finds and locks the winner's
// row.
const retryOnUniqueViolation = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
        return await run();
    } catch (error) {
        if (!(error instanceof UniqueConstraintViolationException)) {
            throw error;
        }

        return run();
    }
};

const showUserHandler = createExtractHandler(
    header("authorization", true),
    extension(JWT_PAYLOAD, true),
).handler(async (authorization, jwtPayload) => {
    assertNotIntegration(jwtPayload);
    const cachedUserInfo = userInfoCache.get<UserInfo>(jwtPayload.sub);
    const userInfo = cachedUserInfo ?? (await loadUserInfo(authorization));

    const user = await retryOnUniqueViolation(() =>
        em.transactional(async (em) => {
            let user = await em.findOne(
                User,
                { externalId: jwtPayload.sub },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );

            if (!user) {
                user = handleNewUser(em, jwtPayload.sub, userInfo);

                // Only a fresh fetch may sync the row: a cached value could
                // overwrite a profile another instance refreshed meanwhile.
            } else if (cachedUserInfo === undefined) {
                // Bumping here rather than on every read keeps a warm cache
                // free of writes, so the cache TTL bounds how stale the
                // timestamp gets. Retention is measured in months.
                user.lastSeenAt = Temporal.Now.instant();
                em.persist(user);

                handleExistingUser(em, user, userInfo);
            }

            return user;
        }),
    );

    // Warmed only once the row it describes is committed: an entry over a row
    // that failed to sync would answer with the stale profile for the rest of
    // the TTL.
    if (cachedUserInfo === undefined) {
        userInfoCache.set(jwtPayload.sub, userInfo);
    }

    const highestRole = await getHighestRole(jwtPayload, user);

    // The auth layer populates teams today; the load is insurance against
    // that changing, not the thing that fills the collection.
    if (user) {
        await user.teams.load();
    }

    return serialize("user", user, {
        meta: { editableFields, highestRole, superAdmin: isSuperAdmin(jwtPayload) },
        include: ["teams"],
    });
});

const attributesSchema = z
    .strictObject({
        displayName: nameSchema.optional(),
        emailAddress: emailAddressSchema.optional(),
    })
    .check((context) => {
        if (editableFields.includes("displayName") && !context.value.displayName) {
            context.issues.push({
                code: "custom",
                path: ["displayName"],
                message: "Required",
                input: context.value.displayName,
            });
        }

        if (editableFields.includes("emailAddress") && !context.value.emailAddress) {
            context.issues.push({
                code: "custom",
                path: ["emailAddress"],
                message: "Required",
                input: context.value.emailAddress,
            });
        }
    });

const replaceUserResourceOptions = {
    type: "user",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;
const replaceUserContentObject = buildResourceRequestContentObject(replaceUserResourceOptions);

const replaceUserHandler = createExtractHandler(
    jsonApiResource(replaceUserResourceOptions),
    header("authorization", true),
    extension(JWT_PAYLOAD, true),
).handler(async ({ attributes }, authorization, jwtPayload) => {
    assertNotIntegration(jwtPayload);

    const userInfo = await loadUserInfo(authorization);
    const displayName = userInfo.displayName ?? attributes.displayName;
    const emailAddress = userInfo.emailAddress ?? attributes.emailAddress;

    assert(displayName, "display name missing");
    assert(emailAddress, "email address missing");

    const user = await retryOnUniqueViolation(() =>
        em.transactional(async (em) => {
            let user = await em.findOne(
                User,
                { externalId: jwtPayload.sub },
                { lockMode: LockMode.PESSIMISTIC_WRITE },
            );

            if (!user) {
                user = new User({
                    externalId: jwtPayload.sub,
                    displayName,
                    emailAddress,
                });
            } else {
                user.displayName = displayName;
                user.emailAddress = emailAddress;
                user.lastSeenAt = Temporal.Now.instant();
            }

            em.persist(user);

            return user;
        }),
    );

    userInfoCache.set(jwtPayload.sub, userInfo);
    await user.teams.load();

    return serialize("user", user, {
        meta: { editableFields },
        include: ["teams"],
    });
});

export const userRouter = new Router().route("/", m.get(showUserHandler).put(replaceUserHandler));

const editableFieldsSchemaObject: SchemaObject = {
    type: "array",
    description: "Profile fields the identity provider does not supply, so the caller may set them",
    items: {
        type: "string",
        enum: ["displayName", "emailAddress"],
    },
};

const showUserMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        editableFields: editableFieldsSchemaObject,
        highestRole: {
            type: ["string", "null"],
            enum: [...teamRoles, null],
        },
        superAdmin: {
            description:
                "Whether the claim itself grants operator access. Not derivable from highestRole, which reads `admin` for a superadmin with no team at all.",
            type: "boolean",
        },
    },
    required: ["editableFields", "highestRole", "superAdmin"],
};

const replaceUserMetaSchemaObject: MetaSchemaObject = {
    type: "object",
    properties: {
        editableFields: editableFieldsSchemaObject,
    },
    required: ["editableFields"],
};

export const addOpenapiCurrentUserPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/user", {
        get: {
            tags: ["Users"],
            summary: "Show the current user",
            description:
                "Returns the profile of the authenticated caller, creating it on first call and syncing display name and email address from the identity provider. The data is null as long as the identity provider does not supply both of them. The caller's teams are included. Open to any authenticated subject; integration tokens are rejected.",
            operationId: "showCurrentUser",
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one_nullable",
                    resourceSchema: userProfileResourceSchema,
                    included: [restrictedTeamResourceSchema],
                    meta: showUserMetaSchemaObject,
                }),
                403: buildErrorResponseObject({
                    description:
                        "Machine tokens cannot have a user profile (forbidden), or the sign-in" +
                        " provider sent no usable value for a claim the configuration reads" +
                        " (missing_profile_claim)",
                }),
            },
        },
        put: {
            tags: ["Users"],
            summary: "Replace the current user",
            description:
                "Creates or replaces the profile of the authenticated caller. Values the identity provider supplies take precedence over the request body, which only has to carry the fields listed in the response meta. The request always refetches the identity provider profile instead of using the cached one. Open to any authenticated subject; integration tokens are rejected.",
            operationId: "replaceCurrentUser",
            requestBody: {
                required: true,
                content: replaceUserContentObject,
            },
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: userProfileResourceSchema,
                    included: [restrictedTeamResourceSchema],
                    meta: replaceUserMetaSchemaObject,
                }),
                403: buildErrorResponseObject({
                    description:
                        "Machine tokens cannot have a user profile (forbidden), or the sign-in" +
                        " provider sent no usable value for a claim the configuration reads" +
                        " (missing_profile_claim)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
