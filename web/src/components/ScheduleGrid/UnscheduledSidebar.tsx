import CloseIcon from "@mui/icons-material/Close";
import { Box, Chip, IconButton, Stack, TextField, Typography } from "@mui/material";
import { type ReactNode, useMemo, useState } from "react";
import { useLongPress } from "#/hooks/useLongPress.ts";
import type { Slot } from "#/queries/schedule.js";
import type { SlottableSession } from "#/queries/session.js";
import type { PressPoint } from "./useSlotDrag.js";

type UnscheduledSidebarProps = {
    sessions: SlottableSession[];
    slots: Slot[];
    onStartDrag: (session: SlottableSession, press: PressPoint) => void;
    /**
     * Each session with a placement on its way, and whether it waits for the connection.
     *
     * Listed whatever the filter and not offered again: the grid shows nothing of it yet, and a
     * second drop would place it twice.
     */
    pendingPlacements?: ReadonlyMap<string, boolean>;
    /** Dismisses the dialog this fills, where it fills one. */
    onClose?: () => void;
    /** Names that dialog, which has no title of its own to do it. */
    headingId?: string;
};

const noPendingPlacements: ReadonlyMap<string, boolean> = new Map();

/** The sessions still to place, searchable, with placed ones hidden by default. */
export const UnscheduledSidebar = ({
    sessions,
    slots,
    onStartDrag,
    pendingPlacements = noPendingPlacements,
    onClose,
    headingId,
}: UnscheduledSidebarProps): ReactNode => {
    const { armGesture, trackPending, finishPending, cancelPending } = useLongPress();
    const [search, setSearch] = useState("");
    const [showPlaced, setShowPlaced] = useState(false);

    const placements = useMemo(() => {
        const counted = new Map<string, number>();

        for (const slot of slots) {
            counted.set(slot.session.id, (counted.get(slot.session.id) ?? 0) + 1);
        }

        return counted;
    }, [slots]);

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase();

        return sessions.filter((session) => {
            const placed = placements.get(session.id) ?? 0;

            if (placed > 0 && !showPlaced && !pendingPlacements.has(session.id)) {
                return false;
            }

            return needle === "" || session.title.toLowerCase().includes(needle);
        });
    }, [sessions, placements, pendingPlacements, showPlaced, search]);

    return (
        <Stack
            spacing={1}
            sx={{
                flex: 1,
                // One each, because the sidebar hangs in a row beside the grid
                // and fills a column inside the dialog, so either axis is the
                // main one somewhere.
                minWidth: 0,
                minHeight: 0,
                p: 1,
            }}
        >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography id={headingId} variant="subtitle2" sx={{ mr: "auto" }}>
                    To place
                </Typography>

                {onClose && (
                    <IconButton size="small" aria-label="Close sessions to place" onClick={onClose}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                )}
            </Stack>

            <TextField
                size="small"
                placeholder="Search sessions"
                value={search}
                onChange={(event) => {
                    setSearch(event.target.value);
                }}
            />

            <Chip
                size="small"
                aria-pressed={!showPlaced}
                label={showPlaced ? "Showing placed" : "Hiding placed"}
                color={showPlaced ? "default" : "primary"}
                variant={showPlaced ? "outlined" : "filled"}
                onClick={() => {
                    setShowPlaced((current) => !current);
                }}
            />

            <Stack data-testid="unscheduled-list" spacing={0.5} sx={{ overflow: "auto" }}>
                {shown.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ p: 1 }}>
                        {sessions.length === 0
                            ? "No session is accepted or confirmed yet."
                            : "Everything is placed."}
                    </Typography>
                ) : (
                    shown.map((session) => {
                        const placed = placements.get(session.id) ?? 0;
                        const waiting = pendingPlacements.get(session.id);

                        return (
                            <Box
                                key={session.id}
                                title={session.title}
                                onPointerDown={(event) => {
                                    if (waiting !== undefined) {
                                        return;
                                    }

                                    const { pointerId, button } = event;

                                    armGesture(
                                        event,
                                        (at) => {
                                            onStartDrag(session, {
                                                pointerId,
                                                button,
                                                ...at,
                                            });
                                        },
                                        () => undefined,
                                    );
                                }}
                                onPointerMove={trackPending}
                                onPointerUp={finishPending}
                                onPointerCancel={cancelPending}
                                sx={{
                                    p: 0.75,
                                    borderRadius: 1,
                                    bgcolor: "action.hover",
                                    cursor: waiting === undefined ? "grab" : "progress",
                                    opacity: waiting === undefined ? 1 : 0.6,
                                    // A finger scrolls the list until it rests
                                    // long enough to mean otherwise, which is
                                    // the only way both gestures fit on a list
                                    // that fills a phone.
                                    touchAction: "manipulation",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.5,
                                }}
                            >
                                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                                    <Typography variant="caption" noWrap>
                                        {session.title}
                                    </Typography>

                                    {waiting !== undefined && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            role="status"
                                            noWrap
                                        >
                                            {waiting ? "Waiting for the connection" : "Placing…"}
                                        </Typography>
                                    )}
                                </Stack>

                                {placed > 0 && (
                                    <Chip
                                        size="small"
                                        label={`x${placed.toString()}`}
                                        sx={{ height: 18 }}
                                    />
                                )}
                            </Box>
                        );
                    })
                )}
            </Stack>
        </Stack>
    );
};
