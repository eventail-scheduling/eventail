import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import StarIcon from "@mui/icons-material/Star";
import {
    Chip,
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    TableCell,
    TableRow,
} from "@mui/material";
import { useIsMutating } from "@tanstack/react-query";
import { useConfirm } from "material-ui-confirm";
import { bindMenu, bindTrigger, usePopupState } from "material-ui-popup-state/hooks";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { Link, MenuItemLink } from "#/components/Link/index.js";
import { ScopeInUseDialog } from "#/components/ScopeInUseDialog.js";
import { useDialogController } from "#/hooks/useDialogController.js";
import {
    promoteSessionTypeMutationKey,
    useDeleteSessionTypeMutation,
    usePromoteSessionTypeToDefaultMutation,
} from "#/mutations/session-type.ts";
import { type BlockingCustomField, scopeInUse } from "#/queries/custom-field.ts";
import type { SessionType } from "#/queries/session-type.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formatDurationLabel } from "#/utils/duration.ts";

type SessionTypeRowProps = {
    editionId: string;
    sessionType: SessionType;
};

export const SessionTypeRow = ({ editionId, sessionType }: SessionTypeRowProps): ReactNode => {
    const popupState = usePopupState({
        variant: "popover",
        popupId: `session-type-${sessionType.id}`,
    });
    const deleteMutation = useDeleteSessionTypeMutation();
    const promoteMutation = usePromoteSessionTypeToDefaultMutation();
    const promotionsInFlight = useIsMutating({ mutationKey: promoteSessionTypeMutationKey });
    const confirm = useConfirm();
    const blockedDialog = useDialogController();
    const [blocked, setBlocked] = useState<BlockingCustomField[] | null>(null);

    const handleDelete = async () => {
        popupState.close();

        const { confirmed } = await confirm({
            title: "Delete session type",
            description: `Do you really want to delete the session type "${sessionType.name}"?`,
            confirmationText: "Delete",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { editionId, id: sessionType.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Session type has been deleted", { variant: "success" });
                },
                onError: (error) => {
                    const blockers = scopeInUse(error);

                    if (!blockers) {
                        defaultMutationErrorHandler(error);
                        return;
                    }

                    setBlocked(blockers);
                    blockedDialog.open();
                },
            },
        );
    };

    const handlePromote = () => {
        popupState.close();

        promoteMutation.mutate(
            { editionId, id: sessionType.id },
            {
                onSuccess: () => {
                    enqueueSnackbar(`"${sessionType.name}" is now the default`, {
                        variant: "success",
                    });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <TableRow>
            <TableCell>
                <Link
                    to="/manage/$editionId/session-types/edit/$sessionTypeId"
                    params={{ editionId, sessionTypeId: sessionType.id }}
                >
                    {sessionType.name}
                </Link>
                {sessionType.selectionDefault && (
                    <Chip size="small" color="primary" label="Default" sx={{ ml: 1 }} />
                )}
                {sessionType.internal && <Chip size="small" label="Internal" sx={{ ml: 1 }} />}
            </TableCell>
            <TableCell>{formatDurationLabel(sessionType.defaultDuration)}</TableCell>
            <TableCell>{sessionType.externalKey}</TableCell>
            <TableCell sx={{ py: 0, textAlign: "right" }}>
                <IconButton
                    size="small"
                    aria-label={`Actions for ${sessionType.name}`}
                    {...bindTrigger(popupState)}
                >
                    <MoreVertIcon />
                </IconButton>
                <Menu {...bindMenu(popupState)}>
                    <MenuItemLink
                        to="/manage/$editionId/session-types/edit/$sessionTypeId"
                        params={{ editionId, sessionTypeId: sessionType.id }}
                        onClick={() => {
                            popupState.close();
                        }}
                    >
                        <ListItemIcon>
                            <EditIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit session type</ListItemText>
                    </MenuItemLink>
                    {!sessionType.selectionDefault && (
                        <MenuItem onClick={handlePromote} disabled={promotionsInFlight > 0}>
                            <ListItemIcon>
                                <StarIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText>Make default</ListItemText>
                        </MenuItem>
                    )}
                    <Divider />
                    <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
                        <ListItemIcon>
                            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                        </ListItemIcon>
                        <ListItemText>Delete session type</ListItemText>
                    </MenuItem>
                </Menu>
            </TableCell>

            {blockedDialog.mount && blocked && (
                <ScopeInUseDialog
                    editionId={editionId}
                    customFields={blocked}
                    subject="session type"
                    dialogProps={blockedDialog.dialogProps}
                />
            )}
        </TableRow>
    );
};
