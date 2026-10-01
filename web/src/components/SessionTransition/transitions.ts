import type { SessionState } from "#/queries/session.ts";

type TransitionAction = {
    /** On the control that opens the dialog, where nothing else names the move. */
    label: string;
    /** The dialog's heading. */
    title: string;
    /** On the button that commits, which names the action. */
    commit: string;
};

const transitionActions: Record<SessionState, TransitionAction> = {
    submitted: {
        label: "Return to submitted",
        title: "Return this session to submitted",
        commit: "Return to submitted",
    },
    accepted: {
        label: "Accept",
        title: "Accept this session",
        commit: "Accept session",
    },
    confirmed: {
        label: "Confirm",
        title: "Confirm this session",
        commit: "Confirm session",
    },
    rejected: {
        label: "Reject",
        title: "Reject this session",
        commit: "Reject session",
    },
    withdrawn: {
        label: "Withdraw",
        title: "Withdraw this session",
        commit: "Withdraw session",
    },
    canceled: {
        label: "Cancel",
        title: "Cancel this session",
        commit: "Cancel session",
    },
};

const returnToAccepted: TransitionAction = {
    label: "Return to accepted",
    title: "Return this session to accepted",
    commit: "Return to accepted",
};

/** Names a move by where it starts as well: returning a confirmed session to accepted accepts nothing. */
export const transitionAction = (from: SessionState, to: SessionState): TransitionAction =>
    from === "confirmed" && to === "accepted" ? returnToAccepted : transitionActions[to];

/** Reports whether the API mails the speakers about this move, which it does for a decision only. */
export const announcesTransition = (from: SessionState, to: SessionState): boolean =>
    (to === "accepted" && from !== "confirmed") || to === "rejected";
