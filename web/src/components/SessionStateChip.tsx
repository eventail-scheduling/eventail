import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { Chip, type ChipProps, chipClasses } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionState } from "#/queries/session.ts";

export const sessionStateLabels: Record<SessionState, string> = {
    submitted: "Submitted",
    accepted: "Accepted",
    confirmed: "Confirmed",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    canceled: "Canceled",
};

type StateAppearance = {
    color: ChipProps["color"];
    variant: ChipProps["variant"];
};

/**
 * Accepted and confirmed are both good news, so both are green.
 *
 * They differ in weight rather than in hue, because the difference between them
 * is how far the session has got: the organizer said yes, then the speaker
 * committed. An outline reads as the lighter of the two without implying that
 * anything went wrong. Withdrawn and canceled share the plain chip for the same
 * reason in reverse: which side walked away is not what a reader scanning a list
 * is after.
 */
const stateAppearance: Record<SessionState, StateAppearance> = {
    submitted: { color: "info", variant: "filled" },
    accepted: { color: "success", variant: "outlined" },
    confirmed: { color: "success", variant: "filled" },
    rejected: { color: "error", variant: "filled" },
    withdrawn: { color: "default", variant: "filled" },
    canceled: { color: "default", variant: "filled" },
};

/**
 * What a caller spreads in to make the chip open a menu.
 *
 * `bindTrigger` covers everything but the name and the expanded state, which it
 * does not set.
 */
type TriggerProps = Pick<
    ChipProps,
    "onClick" | "onTouchStart" | "aria-controls" | "aria-haspopup" | "aria-expanded" | "aria-label"
>;

type SessionStateChipProps = {
    state: SessionState;
    size?: ChipProps["size"];

    fullWidth?: boolean;

    /** Set to turn the chip into the control that opens the state menu. */
    trigger?: TriggerProps;
};

export const SessionStateChip = ({
    state,
    size,
    fullWidth = false,
    trigger,
}: SessionStateChipProps): ReactNode => (
    <Chip
        {...trigger}
        size={size}
        label={sessionStateLabels[state]}
        color={stateAppearance[state].color}
        variant={stateAppearance[state].variant}
        icon={trigger === undefined ? undefined : <ArrowDropDownIcon />}
        sx={{
            // Pushed apart rather than centered as a pair, so a column of these
            // carries one line of labels and one of carets rather than shifting
            // both with the length of the word.
            ...(fullWidth ? { width: "100%", justifyContent: "space-between" } : {}),
            // The caret belongs after the label, where a disclosure control puts
            // it, but the only slot that leaves it inside the chip's own click
            // target renders it first. The delete slot sits on the right and
            // would stop the click reaching the chip.
            [`& .${chipClasses.icon}`]: {
                order: 1,
                marginLeft: "-4px",
                marginRight: "8px",
            },
        }}
    />
);
