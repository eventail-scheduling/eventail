import AddIcon from "@mui/icons-material/Add";
import { Dialog, Fab, Paper, useMediaQuery, useTheme } from "@mui/material";
import { type ReactNode, useId, useState } from "react";
import { type PressPoint, UnscheduledSidebar } from "#/components/ScheduleGrid/index.js";
import { usePendingPlacements } from "#/mutations/slot.ts";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import { CORNER_INSET } from "./DropCorner.tsx";

const SIDEBAR_WIDTH = 240;

type CompactPanelProps = UnscheduledPanelProps & {
    pendingPlacements: ReadonlyMap<string, boolean>;
};

/**
 * The narrow reading, a component of its own so its state goes when it does.
 *
 * Crossing the breakpoint unmounts this, which is what stops a dialog opened on
 * a phone from standing open again after a turn to landscape and back.
 */
const CompactPanel = ({
    sessions,
    slots,
    dragging,
    onStartDrag,
    pendingPlacements,
}: CompactPanelProps): ReactNode => {
    const [open, setOpen] = useState(false);
    const headingId = useId();

    const close = () => {
        setOpen(false);
    };

    /**
     * Takes the dialog away as the gesture leaves it.
     *
     * The gesture survives that because `useSlotDrag` captures the pointer on
     * the grid rather than on what was pressed, and the grid stays mounted
     * behind the dialog throughout. Dropping needs the whole width on a phone,
     * so the alternative is choosing a session and then a place for it as two
     * separate acts, with nothing holding them together.
     */
    const startDrag = (session: SlottableSession, press: PressPoint) => {
        // Nothing but the primary button carries a session anywhere, and a
        // right click that dismissed the list would cost the reader their
        // place for nothing.
        if (press.button !== 0) {
            return;
        }

        setOpen(false);
        onStartDrag(session, press);
    };

    return (
        <>
            {/* The same corner the drop target takes, which is free
                whenever this is shown: nothing is held, so nothing can be
                dropped. */}
            {!dragging && (
                <Fab
                    color="primary"
                    aria-label="Open sessions to place"
                    onClick={() => {
                        setOpen(true);
                    }}
                    sx={{
                        position: "fixed",
                        right: CORNER_INSET,
                        bottom: CORNER_INSET,
                        zIndex: (theme) => theme.zIndex.drawer + 1,
                    }}
                >
                    <AddIcon />
                </Fab>
            )}

            {/* Kept mounted, so a search survives the drag that dismisses the
                dialog. Placing a run of sessions means reopening after every
                one of them, and a search retyped each time is no search. */}
            <Dialog fullScreen keepMounted open={open} onClose={close} aria-labelledby={headingId}>
                <UnscheduledSidebar
                    sessions={sessions}
                    slots={slots}
                    onStartDrag={startDrag}
                    pendingPlacements={pendingPlacements}
                    onClose={close}
                    headingId={headingId}
                />
            </Dialog>
        </>
    );
};

type UnscheduledPanelProps = {
    sessions: SlottableSession[];
    slots: Slot[];
    dragging: boolean;
    onStartDrag: (session: SlottableSession, press: PressPoint) => void;
};

/**
 * The list of what is still to place, beside the grid or behind a button.
 *
 * Sits inside the row it shares with the grid either way: the dialog is
 * portalled and the button is fixed, so neither takes any of that row.
 */
export const UnscheduledPanel = ({
    sessions,
    slots,
    dragging,
    onStartDrag,
}: UnscheduledPanelProps): ReactNode => {
    const theme = useTheme();
    const compact = useMediaQuery(theme.breakpoints.down("md"));
    const pendingPlacements = usePendingPlacements();

    if (compact) {
        return (
            <CompactPanel
                sessions={sessions}
                slots={slots}
                dragging={dragging}
                onStartDrag={onStartDrag}
                pendingPlacements={pendingPlacements}
            />
        );
    }

    return (
        <Paper sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, display: "flex" }}>
            <UnscheduledSidebar
                sessions={sessions}
                slots={slots}
                onStartDrag={onStartDrag}
                pendingPlacements={pendingPlacements}
            />
        </Paper>
    );
};
