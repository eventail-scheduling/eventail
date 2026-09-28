import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import { Paper } from "@mui/material";
import type { ReactNode, RefObject } from "react";
import type { DropAction } from "#/components/ScheduleGrid/index.js";

/** Bigger than a button that gets clicked, because this one gets aimed at. */
export const CORNER_SIZE = 72;

export const CORNER_INSET = 32;

type DropCornerProps = {
    cornerRef: RefObject<HTMLDivElement | null>;
    over: boolean;
    action: DropAction;
};

/**
 * Where a held session goes to stop being held.
 *
 * pretalx makes its unassigned list the drop target and says nothing about it.
 * Ours hides placed sessions by default, so dropping one into a list that will
 * not show it reads as losing it, and the list is already where a gesture comes
 * from. This appears only for a gesture it answers, which is the only time it
 * means anything and the only way anyone would learn it is there.
 *
 * One corner for both readings, since a gesture is only ever carrying one of
 * them: removal is dangerous and wears the color that says so, while abandoning
 * a session that was never placed costs nothing and should not look as though
 * it does.
 *
 * Deliberately not a button: nothing can press it, it has no accessible name,
 * and only its rectangle is ever read.
 */
export const DropCorner = ({ cornerRef, over, action }: DropCornerProps): ReactNode => (
    <Paper
        ref={cornerRef}
        data-testid="drop-corner"
        elevation={over ? 12 : 6}
        aria-hidden
        sx={{
            position: "fixed",
            right: CORNER_INSET,
            bottom: CORNER_INSET,
            width: CORNER_SIZE,
            height: CORNER_SIZE,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: (theme) => theme.zIndex.drawer + 1,
            ...(action === "remove" && { bgcolor: "error.main", color: "error.contrastText" }),
            pointerEvents: "none",
            transform: over ? "scale(1.15)" : "none",
            transition: "transform 120ms",
            "& svg": { fontSize: 32 },
        }}
    >
        {action === "remove" ? <DeleteOutlinedIcon /> : <CloseIcon />}
    </Paper>
);
