import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
    Box,
    Chip,
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Stack,
    TableCell,
    TableRow,
} from "@mui/material";
import { useConfirm } from "material-ui-confirm";
import { bindMenu, bindTrigger, usePopupState } from "material-ui-popup-state/hooks";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useState } from "react";
import { Link, MenuItemLink } from "#/components/Link/index.js";
import { ScopeInUseDialog } from "#/components/ScopeInUseDialog.js";
import { useDialogController } from "#/hooks/useDialogController.js";
import { useDeleteTrackMutation } from "#/mutations/track.ts";
import { type BlockingCustomField, scopeInUse } from "#/queries/custom-field.ts";
import type { Track } from "#/queries/track.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

type TrackRowProps = {
    editionId: string;
    track: Track;
};

export const TrackRow = ({ editionId, track }: TrackRowProps): ReactNode => {
    const popupState = usePopupState({ variant: "popover", popupId: `track-${track.id}` });
    const deleteMutation = useDeleteTrackMutation();
    const confirm = useConfirm();
    const blockedDialog = useDialogController();
    const [blocked, setBlocked] = useState<BlockingCustomField[] | null>(null);

    const handleDelete = async () => {
        popupState.close();

        const { confirmed } = await confirm({
            title: "Delete track",
            description: `Do you really want to delete the track "${track.name}"? Sessions on it keep existing without a track.`,
            confirmationText: "Delete",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { editionId, id: track.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Track has been deleted", { variant: "success" });
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

    return (
        <TableRow>
            <TableCell>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Box
                        sx={{
                            width: 16,
                            height: 16,
                            borderRadius: 0.5,
                            border: "1px solid",
                            borderColor: "divider",
                            backgroundColor: track.color,
                            flexShrink: 0,
                        }}
                    />
                    <Link
                        to="/manage/$editionId/tracks/edit/$trackId"
                        params={{ editionId, trackId: track.id }}
                    >
                        {track.name}
                    </Link>
                    {track.internal && <Chip size="small" label="Internal" />}
                </Stack>
            </TableCell>
            <TableCell>{track.description}</TableCell>
            <TableCell>{track.externalKey}</TableCell>
            <TableCell sx={{ py: 0, textAlign: "right" }}>
                <IconButton
                    size="small"
                    aria-label={`Actions for ${track.name}`}
                    {...bindTrigger(popupState)}
                >
                    <MoreVertIcon />
                </IconButton>
                <Menu {...bindMenu(popupState)}>
                    <MenuItemLink
                        to="/manage/$editionId/tracks/edit/$trackId"
                        params={{ editionId, trackId: track.id }}
                        onClick={() => {
                            popupState.close();
                        }}
                    >
                        <ListItemIcon>
                            <EditIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit track</ListItemText>
                    </MenuItemLink>
                    <Divider />
                    <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
                        <ListItemIcon>
                            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                        </ListItemIcon>
                        <ListItemText>Delete track</ListItemText>
                    </MenuItem>
                </Menu>
            </TableCell>

            {blockedDialog.mount && blocked && (
                <ScopeInUseDialog
                    editionId={editionId}
                    customFields={blocked}
                    subject="track"
                    dialogProps={blockedDialog.dialogProps}
                />
            )}
        </TableRow>
    );
};
