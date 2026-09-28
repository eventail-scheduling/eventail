import { buildDataResponseObject, buildErrorResponseObject } from "@jsonapi-serde/openapi";
import { JsonApiError } from "@jsonapi-serde/server/common";
import { LockMode } from "@mikro-orm/postgresql";
import { pathParam } from "@taxum/core/extract";
import { StatusCode } from "@taxum/core/http";
import { createExtractHandler, m, Router } from "@taxum/core/routing";
import type { OpenApiBuilder, ParameterObject } from "openapi3-ts/oas31";
import { z } from "zod";
import { Edition } from "../../entity/Edition.js";
import { Session, type SessionState } from "../../entity/Session.js";
import { SessionHostInvite } from "../../entity/SessionHostInvite.js";
import { serialize } from "../../json-api/index.js";
import {
    sessionHostInvitePreviewIncludedSchemas,
    sessionHostInvitePreviewResourceSchema,
    sessionHostInvitePreviewSerializeOptions,
} from "../../json-api/session-host-invite-preview.js";
import { bumpEditionRevision, reachesIntegration } from "../../support/edition-revision.js";
import { assertHostProfileComplete, resolveHost } from "../../support/hosts.js";
import { requireAcceptableInvite } from "../../support/invites.js";
import { RequireAuthorizationLayer, requiredUser } from "../../util/auth.js";
import { em } from "../../util/mikro-orm.js";
import { noContentResponseObject } from "../../util/openapi.js";

// Acceptance additionally works for confirmed sessions, where pre-freeze or
// manager invites can still be pending; dead sessions take no new hosts.
const acceptableStates: readonly SessionState[] = ["submitted", "accepted", "confirmed"];

const sessionNotAcceptableError = (): JsonApiError =>
    new JsonApiError({
        status: "409",
        code: "session_not_acceptable",
        title: "Session not acceptable",
        detail: "This session no longer takes new hosts",
    });

const showInvitePreviewHandler = createExtractHandler(pathParam(z.uuid()), requiredUser).handler(
    async (code, user) => {
        const invite = requireAcceptableInvite(
            await em.findOne(SessionHostInvite, { code }, { populate: ["session.edition"] }),
            user,
        );

        if (!acceptableStates.includes(invite.session.unwrap().state)) {
            throw sessionNotAcceptableError();
        }

        return serialize(
            "session_host_invite_preview",
            invite,
            sessionHostInvitePreviewSerializeOptions,
        );
    },
);

const acceptInviteHandler = createExtractHandler(pathParam(z.uuid()), requiredUser).handler(
    async (code, user) => {
        await em.transactional(async (em) => {
            // The locking read below takes invite, session and edition FOR
            // UPDATE in one statement, in that row order, which is the order
            // reversed: the invite is the last of the three, not the first. Both
            // rows ahead of it are taken here instead, off an unlocked pre-read,
            // since neither is reachable without the invite. FOR UPDATE on the
            // edition rather than the key share, because the locking read
            // upgrades to it regardless and an upgrade behind a waiting publish
            // deadlocks.
            const preview = await em.findOne(
                SessionHostInvite,
                { code },
                { populate: ["session"] },
            );

            if (preview) {
                const previewSession = preview.session.unwrap();

                await em.findOneOrFail(Edition, previewSession.edition.id, {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                });
                await em.findOneOrFail(Session, previewSession.id, {
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                });
            }

            const invite = requireAcceptableInvite(
                await em.findOne(
                    SessionHostInvite,
                    { code },
                    { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ["session.edition"] },
                ),
                user,
            );

            // The state read below decides both the 409 and the bump. Today the
            // invite's populate happens to lock and refresh the session, but only
            // because the session relation is non-nullable, which makes the ORM
            // emit an inner join and include the session in the FOR UPDATE. Were
            // that relation ever nullable, the lock would cover the invite alone
            // and this would quietly become a stale read. The explicit refreshing
            // read makes freshness a property of this handler rather than of the
            // join planner.
            const session = await em.findOneOrFail(Session, invite.session.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            });

            if (!acceptableStates.includes(session.state)) {
                throw sessionNotAcceptableError();
            }

            const edition = session.edition.unwrap();
            const host = await resolveHost(em, session.edition, user);
            await assertHostProfileComplete(em, edition, host);
            session.hosts.add(host);
            em.persist(session);
            em.remove(invite);

            // This route is nested outside resolveEditionLayer, so there is no
            // EDITION extension to read; the invite carries the edition.
            if (reachesIntegration(session.state)) {
                await bumpEditionRevision(em, edition);
            }
        });

        return StatusCode.NO_CONTENT;
    },
);

export const sessionHostInvitesRouter = new Router()
    .route("/:code", m.get(showInvitePreviewHandler))
    .route("/:code/acceptance", m.post(acceptInviteHandler))
    .layer(new RequireAuthorizationLayer({ user: true }));

const codePathParameter: ParameterObject = {
    name: "code",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
    description: "The invite code from the invite email",
};

export const addOpenapiSessionHostInviteAcceptancePaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/session-host-invites/{code}", {
        get: {
            tags: ["Session Host Invites"],
            summary: "Preview a session host invite",
            description:
                "Describes what an invite code grants, so the acceptance page can name the " +
                "session and look up what the edition asks of a host, before the user " +
                "accepts. Requires an authenticated user whose email address matches the invite, " +
                "and refuses a session that no longer takes new hosts, as the acceptance does.",
            operationId: "previewSessionHostInvite",
            parameters: [codePathParameter],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "one",
                    resourceSchema: sessionHostInvitePreviewResourceSchema,
                    included: sessionHostInvitePreviewIncludedSchemas,
                }),
                403: buildErrorResponseObject({
                    description: "Forbidden (invalid_code, invite_expired, invite_email_mismatch)",
                }),
                409: buildErrorResponseObject({
                    description: "Session takes no new hosts (session_not_acceptable)",
                }),
            },
        },
    });

    builder.addPath("/session-host-invites/{code}/acceptance", {
        post: {
            tags: ["Session Host Invites"],
            summary: "Accept a session host invite",
            description:
                "Accepts an invite by its code and adds the calling user to the session's hosts. " +
                "Requires an authenticated user whose email address matches the invite, and the " +
                "profile the edition asks them for to be complete; the session must still be " +
                "submitted, accepted or confirmed.",
            operationId: "acceptSessionHostInvite",
            parameters: [codePathParameter],
            responses: {
                204: noContentResponseObject,
                403: buildErrorResponseObject({
                    description: "Forbidden (invalid_code, invite_expired, invite_email_mismatch)",
                }),
                409: buildErrorResponseObject({
                    description: "Session takes no new hosts (session_not_acceptable)",
                }),
                422: buildErrorResponseObject({
                    description: "Unprocessable request (incomplete_profile)",
                }),
            },
        },
    });
};
