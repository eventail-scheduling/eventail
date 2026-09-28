import { jsonApiRelationships, jsonApiResource } from "@jsonapi-serde/integration-taxum";
import {
    buildDataResponseObject,
    buildErrorResponseObject,
    buildResourceRequestContentObject,
} from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import type { AnyParseResourceRequestOptions } from "@jsonapi-serde/server/request";
import { type Loaded, LockMode, ref } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import { extension, pathParams } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler } from "@taxum/core/routing";
import type { OpenApiBuilder } from "openapi3-ts/oas31";
import { z } from "zod";
import type { Edition } from "../../entity/Edition.js";
import { Session, type SessionState } from "../../entity/Session.js";
import { SessionHostInvite } from "../../entity/SessionHostInvite.js";
import { User } from "../../entity/User.js";
import { serialize } from "../../json-api/index.js";
import { sessionHostInviteResourceSchema } from "../../json-api/session-host-invite.js";
import { bumpEditionRevision, reachesIntegration } from "../../support/edition-revision.js";
import { hostsSession } from "../../support/hosts.js";
import { clearExistingInvite } from "../../support/invites.js";
import { queueMail, sessionHostInviteAcceptUrl } from "../../support/mail.js";
import { JWT_PAYLOAD, type JwtPayload, requiredUser, userProvidesRole } from "../../util/auth.js";
import { assertExists } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter, noContentResponseObject } from "../../util/openapi.js";
import { emailAddressSchema } from "../../util/zod.js";
import { EDITION } from "./resolve-edition-layer.js";

// Hosts invite co-hosts only while the session is in one of these states,
// submission deadline or not; listing and revoking invites are open in any
// state. Managers are held to none of it.
const hostManageableStates: readonly SessionState[] = ["submitted", "accepted"];

type HostAccess = {
    session: Loaded<Session, "hosts">;
    isManager: boolean;
};

const inviteQuotaWindow = Temporal.Duration.from({ hours: 1 });
const maxInvitesPerWindow = 10;

/**
 * Bounds how much mail one person can send, whatever they address it to.
 *
 * Counting the recipient instead would be defeated by plus-addressing, and
 * counting per session by making another session. Revoked invites count, since
 * the loop this exists to stop is create, revoke, create. Organizers are exempt:
 * a manager already commands far more than the mailer.
 */
const assertInviteQuota = async (
    em: EntityManager,
    user: Loaded<User, "teams">,
    isManager: boolean,
): Promise<void> => {
    if (isManager) {
        return;
    }

    // Serializes one sender against themselves. Two invites on one session
    // already queue on its lock, but a host of several could send from each at
    // once and every request would read the same count. User rows sit after
    // the session's own and its invites in the order, so the caller takes this
    // after clearing an expired invite, not before.
    await em.findOne(User, { id: user.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });

    const sent = await em.count(SessionHostInvite, {
        createdBy: user,
        createdAt: { $gte: Temporal.Now.instant().subtract(inviteQuotaWindow) },
    });

    if (sent >= maxInvitesPerWindow) {
        throw new JsonApiError({
            status: "429",
            code: "invite_quota_reached",
            title: "Invite quota reached",
            detail: "You have sent too many invites recently; try again later",
        });
    }
};

const loadSessionForHostManagement = async (
    sessionId: string,
    edition: Edition,
    user: Loaded<User, "teams">,
    jwtPayload: JwtPayload,
    lock: boolean,
    requireManageable = true,
): Promise<HostAccess> => {
    const found = await em.findOne(
        Session,
        { id: sessionId, edition },
        lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
    );
    assertExists(found, "Session", sessionId);
    const session = await em.populate(found, ["hosts"]);

    const isManager = userProvidesRole(jwtPayload, user, "manager");

    if (!(isManager || hostsSession(session, user))) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You are not involved with this session",
        });
    }

    if (requireManageable && !(isManager || hostManageableStates.includes(session.state))) {
        throw new JsonApiError({
            status: "403",
            code: "session_frozen",
            title: "Session frozen",
            detail: "Hosts can no longer be managed in this session state",
        });
    }

    return { session, isManager };
};

const inviteAttributesSchema = z.object({
    emailAddress: emailAddressSchema,
});

const inviteResourceOptions = {
    type: "session_host_invite",
    attributesSchema: inviteAttributesSchema,
} satisfies AnyParseResourceRequestOptions;

const createHostInviteHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    jsonApiResource(inviteResourceOptions),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, { attributes }, user, jwtPayload, edition) => {
    const invite = await em.transactional(async (em) => {
        const { session, isManager } = await loadSessionForHostManagement(
            sessionId,
            edition,
            user,
            jwtPayload,
            true,
        );

        const existingInvite = await em.findOne(SessionHostInvite, {
            session,
            emailAddress: attributes.emailAddress,
            revokedAt: null,
        });
        await clearExistingInvite(em, existingInvite, "session");
        await assertInviteQuota(em, user, isManager);

        const invite = new SessionHostInvite({
            emailAddress: attributes.emailAddress,
            session: ref(session),
            createdBy: ref(user),
        });
        em.persist(invite);

        await queueMail(em, {
            template: "session-host-invite",
            recipient: invite.emailAddress,
            variables: {
                sessionTitle: session.title,
                editionName: edition.name,
                acceptUrl: sessionHostInviteAcceptUrl(invite.code),
            },
        });

        return invite;
    });

    return [StatusCode.CREATED, serialize("session_host_invite", invite)];
});

const listHostInvitesHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, user, jwtPayload, edition) => {
    const { session } = await loadSessionForHostManagement(
        sessionId,
        edition,
        user,
        jwtPayload,
        false,
        false,
    );
    const invites = await em.find(
        SessionHostInvite,
        { session, revokedAt: null },
        { orderBy: { createdAt: "asc" } },
    );

    return serialize("session_host_invite", invites);
});

const deleteHostInviteHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid(), inviteId: z.uuid() })),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId, inviteId }, user, jwtPayload, edition) => {
    await em.transactional(async (em) => {
        // Revocation stays possible in every state; a wrong-address invite
        // must not survive just because the session froze meanwhile.
        await loadSessionForHostManagement(sessionId, edition, user, jwtPayload, true, false);

        const invite = await em.findOne(
            SessionHostInvite,
            { id: inviteId, session: sessionId, revokedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(invite, "Session host invite", inviteId);
        invite.revokedAt = Temporal.Now.instant();
    });

    return StatusCode.NO_CONTENT;
});

const removeHostsHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    jsonApiRelationships("host", z.uuid()),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, hostIds, user, jwtPayload, edition) => {
    await em.transactional(async (em) => {
        // The route admits managers alone, so the involvement and frozen checks
        // inside pass by construction; what is wanted here is the 404 and the
        // write lock they come with.
        const { session } = await loadSessionForHostManagement(
            sessionId,
            edition,
            user,
            jwtPayload,
            true,
        );

        session.hosts.remove((host) => hostIds.includes(host.id));
        em.persist(session);

        if (reachesIntegration(session.state)) {
            await bumpEditionRevision(em, edition);
        }
    });

    return StatusCode.NO_CONTENT;
});

export {
    createHostInviteHandler,
    deleteHostInviteHandler,
    listHostInvitesHandler,
    removeHostsHandler,
};

const sessionPathParameters = [
    createUuidPathParameter("editionId"),
    createUuidPathParameter("sessionId"),
];

export const addOpenapiSessionHostInvitePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/sessions/{sessionId}/host-invites", {
        get: {
            tags: ["Session Host Invites"],
            summary: "List session host invites",
            description:
                "Lists the invites pending for the session, oldest first. Requires an " +
                "authenticated user who hosts the session, or the manager role.",
            operationId: "listSessionHostInvites",
            parameters: sessionPathParameters,
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: sessionHostInviteResourceSchema,
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
            },
        },
        post: {
            tags: ["Session Host Invites"],
            summary: "Invite a session host",
            description:
                "Invites an email address to co-host the session and mails it an acceptance link. " +
                "Requires an authenticated user who hosts the session, or the manager role; hosts " +
                "can only invite while the session is submitted or accepted. An expired invite to " +
                "the same address is replaced, a pending one is not.",
            operationId: "inviteSessionHost",
            parameters: sessionPathParameters,
            requestBody: {
                required: true,
                content: buildResourceRequestContentObject(inviteResourceOptions),
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: sessionHostInviteResourceSchema,
                }),
                403: buildErrorResponseObject({
                    description: "Forbidden (forbidden, session_frozen)",
                }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
                409: buildErrorResponseObject({ description: "Invite exists (invite_exists)" }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
                429: buildErrorResponseObject({
                    description: "Invite quota reached (invite_quota_reached)",
                }),
            },
        },
    });

    builder.addPath("/editions/{editionId}/sessions/{sessionId}/host-invites/{inviteId}", {
        delete: {
            tags: ["Session Host Invites"],
            summary: "Revoke a session host invite",
            description:
                "Revokes a pending invite. Requires an authenticated user who hosts the session, " +
                "or the manager role; unlike inviting, this stays possible in every session state.",
            operationId: "revokeSessionHostInvite",
            parameters: [...sessionPathParameters, createUuidPathParameter("inviteId")],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({
                    description: "Edition, session or invite not found",
                }),
            },
        },
    });
};
