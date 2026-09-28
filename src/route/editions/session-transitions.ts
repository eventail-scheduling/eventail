import { jsonApiResource } from "@jsonapi-serde/integration-taxum";
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
import { Schedule } from "../../entity/Schedule.js";
import { Session, type SessionState, sessionStates } from "../../entity/Session.js";
import { SessionTransition } from "../../entity/SessionTransition.js";
import { serialize } from "../../json-api/index.js";
import { sessionTransitionResourceSchema } from "../../json-api/session-transition.js";
import { namedUserResourceSchema } from "../../json-api/user.js";
import { bumpEditionRevision, reachesIntegration } from "../../support/edition-revision.js";
import { hostsSession } from "../../support/hosts.js";
import { queueMail, sessionUrl } from "../../support/mail.js";
import {
    actorMayTransition,
    type TransitionActorContext,
    transitionMatrix,
} from "../../support/session-transitions.js";
import { JWT_PAYLOAD, requiredUser, userProvidesRole } from "../../util/auth.js";
import { assertExists } from "../../util/helpers.js";
import { em } from "../../util/mikro-orm.js";
import { createUuidPathParameter } from "../../util/openapi.js";
import { EDITION } from "./resolve-edition-layer.js";

const attributesSchema = z.strictObject({
    state: z.enum(sessionStates),
    note: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .nullish()
        .transform((value) => value ?? null),
});

const assertTransitionAllowed = (
    session: Session,
    actor: TransitionActorContext,
    targetState: SessionState,
): void => {
    // Before the matrix check: the 409 below spells out the session's state,
    // which unrelated users must not see.
    if (!(actor.isHost || actor.isManager)) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You are not involved with this session",
        });
    }

    const allowedActors = transitionMatrix[session.state][targetState];

    if (!allowedActors) {
        throw new JsonApiError({
            status: "409",
            code: "illegal_transition",
            title: "Illegal transition",
            detail: `Cannot transition from ${session.state} to ${targetState}`,
        });
    }

    if (!actorMayTransition(allowedActors, actor)) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: `You are not allowed to transition this session to ${targetState}`,
        });
    }
};

type TransitionMove = {
    fromState: SessionState;
    toState: SessionState;
};

/** Mails the speakers a decision; returning a confirmed session to accepted decides nothing new. */
const queueTransitionMails = async (
    em: EntityManager,
    session: Loaded<Session, "hosts">,
    edition: Edition,
    { fromState, toState: targetState }: TransitionMove,
    note: string | null,
): Promise<void> => {
    const reopened = fromState === "confirmed" && targetState === "accepted";

    if (reopened || (targetState !== "accepted" && targetState !== "rejected")) {
        return;
    }

    const url = sessionUrl(edition.id, session.id);

    for (const host of session.hosts) {
        const variables = {
            hostName: host.displayName,
            sessionTitle: session.title,
            editionName: edition.name,
            sessionUrl: url,
            note,
        };

        await queueMail(em, {
            template: targetState === "accepted" ? "session-accepted" : "session-rejected",
            recipient: host.emailAddress,
            variables,
        });
    }
};

const transitionResourceOptions = {
    type: "session_transition",
    attributesSchema,
} satisfies AnyParseResourceRequestOptions;

export const createTransitionHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    jsonApiResource(transitionResourceOptions),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, { attributes }, user, jwtPayload, edition) => {
    const transition = await em.transactional(async (em) => {
        // Slot writers and publish lock the draft schedule first; taking it
        // here too, before the session, serializes state changes against
        // them under one lock order, so a slot cannot be created for a
        // session that is being moved out of a slottable state.
        //
        // Locked by id rather than by predicate: a predicate match blocked
        // behind a publish re-evaluates against the published
        // row, no longer matches, and returns null while the successor stays
        // invisible to the same statement, which would leave this handler
        // holding no schedule lock at all. Each retry lands on a row that
        // was published mid-wait, so the loop terminates.
        for (;;) {
            const draft = await em.findOne(
                Schedule,
                { edition, publishedAt: null },
                { fields: ["id"] },
            );

            if (!draft) {
                break;
            }

            // Gone rather than published: the edition was deleted while we
            // waited for the lock. The next pass finds no draft and breaks,
            // leaving the session lookup below to report the 404.
            const locked = await em.findOne(Schedule, draft.id, {
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            });

            if (locked?.publishedAt === null) {
                break;
            }
        }

        const lockedSession = await em.findOne(
            Session,
            { id: sessionId, edition },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        assertExists(lockedSession, "Session", sessionId);
        const session = await em.populate(lockedSession, ["hosts"]);

        assertTransitionAllowed(
            session,
            {
                isHost: hostsSession(session, user),
                isManager: userProvidesRole(jwtPayload, user, "manager"),
            },
            attributes.state,
        );

        const transition = new SessionTransition({
            session: ref(session),
            actor: ref(user),
            fromState: session.state,
            toState: attributes.state,
            note: attributes.note,
        });
        session.state = attributes.state;
        em.persist([session, transition]);

        await queueTransitionMails(em, session, edition, transition, attributes.note);

        if (reachesIntegration(transition.fromState, transition.toState)) {
            await bumpEditionRevision(em, edition);
        }

        return transition;
    });

    return [StatusCode.CREATED, serialize("session_transition", transition)];
});

export const listTransitionsHandler = createExtractHandler(
    pathParams(z.object({ sessionId: z.uuid() })),
    requiredUser,
    extension(JWT_PAYLOAD, true),
    extension(EDITION, true),
).handler(async ({ sessionId }, user, jwtPayload, edition) => {
    const session = await em.findOne(Session, { id: sessionId, edition }, { populate: ["hosts"] });
    assertExists(session, "Session", sessionId);

    if (!(hostsSession(session, user) || userProvidesRole(jwtPayload, user, "manager"))) {
        throw new JsonApiError({
            status: "403",
            code: "forbidden",
            title: "Forbidden",
            detail: "You are not involved with this session",
        });
    }

    const transitions = await em.find(
        SessionTransition,
        { session },
        { orderBy: { createdAt: "asc" }, populate: ["actor"] },
    );

    return serialize("session_transition", transitions, {
        include: ["actor"],
        // A speaker reads their own session's history, and a user resource
        // carries an email address they have no business with.
        fields: { user: ["displayName"] },
    });
});

const transitionMatrixDescription =
    "Allowed targets depend on the current state and the caller: a submitted session is accepted " +
    "or rejected by a manager and withdrawn by a host; an accepted one is confirmed or canceled " +
    "by either and sent back to submitted by a manager; a confirmed one is canceled by either and " +
    "reopened to accepted by a manager; rejected, withdrawn and canceled sessions are revived by " +
    "a manager only.";

export const addOpenapiSessionTransitionPaths = (builder: OpenApiBuilder): void => {
    builder.addPath("/editions/{editionId}/sessions/{sessionId}/transitions", {
        get: {
            tags: ["Session Transitions"],
            summary: "List session transitions",
            description:
                "Lists the session's state changes in chronological order. Requires an " +
                "authenticated user who hosts the session, or the manager role. The actor " +
                "is included under their display name alone, and is null where the change " +
                "had none.",
            operationId: "listSessionTransitions",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            responses: {
                200: buildDataResponseObject({
                    description: "OK",
                    cardinality: "many",
                    resourceSchema: sessionTransitionResourceSchema,
                    included: [namedUserResourceSchema],
                }),
                403: buildErrorResponseObject({ description: "Forbidden" }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
            },
        },
        post: {
            tags: ["Session Transitions"],
            summary: "Transition a session",
            description:
                "Moves the session into another state and records the transition with an optional " +
                `note. Requires an authenticated user who hosts the session, or the manager role; ${transitionMatrixDescription} ` +
                "Rejecting mails every host, and so does accepting, except returning a confirmed " +
                "session to accepted, which mails nobody. Leaving a slottable state keeps the " +
                "session's slots in the draft schedule, where they cannot be reshaped until the " +
                "session is slottable again.",
            operationId: "transitionSession",
            parameters: [
                createUuidPathParameter("editionId"),
                createUuidPathParameter("sessionId"),
            ],
            requestBody: {
                required: true,
                content: buildResourceRequestContentObject(transitionResourceOptions),
            },
            responses: {
                201: buildDataResponseObject({
                    description: "Created",
                    cardinality: "one",
                    resourceSchema: sessionTransitionResourceSchema,
                }),
                403: buildErrorResponseObject({
                    description:
                        "Forbidden; users not involved with the session get this " +
                        "before any state is disclosed",
                }),
                404: buildErrorResponseObject({ description: "Edition or session not found" }),
                409: buildErrorResponseObject({
                    description: "Illegal transition (illegal_transition)",
                }),
                422: buildErrorResponseObject({ description: "Unprocessable request" }),
            },
        },
    });
};
