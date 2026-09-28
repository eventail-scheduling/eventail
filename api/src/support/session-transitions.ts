import { type SessionState, sessionStates } from "../entity/Session.js";

export type TransitionActor = "host" | "manager";

export type TransitionActorContext = {
    isHost: boolean;
    isManager: boolean;
};

export const transitionMatrix: Readonly<
    Record<SessionState, Readonly<Partial<Record<SessionState, readonly TransitionActor[]>>>>
> = {
    submitted: {
        accepted: ["manager"],
        rejected: ["manager"],
        withdrawn: ["host"],
    },
    accepted: {
        confirmed: ["host", "manager"],
        canceled: ["host", "manager"],
        submitted: ["manager"],
    },
    confirmed: {
        accepted: ["manager"],
        canceled: ["host", "manager"],
    },
    rejected: {
        submitted: ["manager"],
    },
    withdrawn: {
        submitted: ["manager"],
    },
    canceled: {
        accepted: ["manager"],
    },
};

export const actorMayTransition = (
    actors: readonly TransitionActor[],
    actor: TransitionActorContext,
): boolean =>
    (actors.includes("host") && actor.isHost) || (actors.includes("manager") && actor.isManager);

/**
 * Lists the states this caller may move a session to from where it stands.
 *
 * The endpoint can still answer differently, because what a caller is to a
 * session is worked out per endpoint.
 */
export const allowedTransitions = (
    state: SessionState,
    actor: TransitionActorContext,
): SessionState[] => {
    if (!(actor.isHost || actor.isManager)) {
        return [];
    }

    return sessionStates.filter((target) => {
        const actors = transitionMatrix[state][target];

        return actors !== undefined && actorMayTransition(actors, actor);
    });
};
