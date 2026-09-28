import { ListItemText, Menu, MenuItem, TableCell, TableRow } from "@mui/material";
import { bindMenu, bindTrigger, usePopupState } from "material-ui-popup-state/hooks";
import { type ReactNode, useState } from "react";
import { Link } from "#/components/Link/index.js";
import { SessionStateChip, sessionStateLabels } from "#/components/SessionStateChip.tsx";
import { TransitionDialog, transitionAction } from "#/components/SessionTransition/index.js";
import type { ListSession, SessionState } from "#/queries/session.ts";

type SessionRowProps = {
    editionId: string;
    session: ListSession;
};

export const SessionRow = ({ editionId, session }: SessionRowProps): ReactNode => {
    const popupState = usePopupState({ variant: "popover", popupId: `session-${session.id}` });
    const [target, setTarget] = useState<SessionState | null>(null);
    const allowed = session.$meta.managerTransitions;

    return (
        <TableRow>
            {/* The cell gives its padding to the link, so the target is the
                width and height of the cell rather than the width of the title.
                A short title would otherwise leave a row almost entirely inert,
                and a one line one falls under the 24px a pointer target wants. */}
            <TableCell sx={{ p: 0 }}>
                <Link
                    to="/manage/$editionId/sessions/$sessionId"
                    params={{ editionId, sessionId: session.id }}
                    sx={{ display: "block", px: 2, py: 2 }}
                >
                    {session.title}
                </Link>
            </TableCell>
            <TableCell>
                <SessionStateChip
                    size="small"
                    state={session.state}
                    fullWidth
                    trigger={
                        allowed.length === 0
                            ? undefined
                            : {
                                  ...bindTrigger(popupState),
                                  "aria-expanded": popupState.isOpen,
                                  "aria-label": `Change state of ${session.title}, currently ${sessionStateLabels[session.state]}`,
                              }
                    }
                />

                {allowed.length > 0 && (
                    <Menu {...bindMenu(popupState)}>
                        {allowed.map((state) => (
                            <MenuItem
                                key={state}
                                onClick={() => {
                                    popupState.close();
                                    setTarget(state);
                                }}
                            >
                                <ListItemText>
                                    {transitionAction(session.state, state).label}
                                </ListItemText>
                            </MenuItem>
                        ))}
                    </Menu>
                )}
            </TableCell>
            <TableCell>{session.sessionType.name}</TableCell>
            <TableCell>{session.track?.name}</TableCell>

            {target !== null && (
                <TransitionDialog
                    editionId={editionId}
                    sessionId={session.id}
                    sessionTitle={session.title}
                    from={session.state}
                    target={target}
                    author="organizer"
                    onClose={() => {
                        setTarget(null);
                    }}
                />
            )}
        </TableRow>
    );
};
