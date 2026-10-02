import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    TableCell,
    TableRow,
} from "@mui/material";
import { useConfirm } from "material-ui-confirm";
import { bindMenu, bindTrigger, usePopupState } from "material-ui-popup-state/hooks";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { Link, MenuItemLink } from "#/components/Link/index.js";
import {
    DropIndicator,
    type SortableListKey,
    useSortableItem,
} from "#/components/SortableList/index.js";
import { useDeleteVenueMutation } from "#/mutations/venue.ts";
import type { Venue } from "#/queries/venue.ts";
import { defaultMutationErrorHandler, hasErrorCode } from "#/utils/api.ts";

type VenueRowProps = {
    editionId: string;
    venue: Venue;
    listKey: SortableListKey;
    index: number;
};

export const VenueRow = ({ editionId, venue, listKey, index }: VenueRowProps): ReactNode => {
    const { rowRef, handleRef, dragging, closestEdge } = useSortableItem<HTMLTableRowElement>({
        listKey,
        itemId: venue.id,
        index,
    });
    const popupState = usePopupState({ variant: "popover", popupId: `venue-${venue.id}` });
    const deleteMutation = useDeleteVenueMutation();
    const confirm = useConfirm();

    const handleDelete = async () => {
        popupState.close();

        const { confirmed } = await confirm({
            title: "Delete venue",
            description: `Do you really want to delete the venue "${venue.name}"?`,
            confirmationText: "Delete",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { editionId, id: venue.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Venue has been deleted", { variant: "success" });
                },
                onError: (error) => {
                    if (hasErrorCode(error, "entity_in_use")) {
                        enqueueSnackbar("Locations are still assigned to this venue.", {
                            variant: "error",
                        });
                        return;
                    }

                    defaultMutationErrorHandler(error);
                },
            },
        );
    };

    return (
        <TableRow ref={rowRef} sx={{ position: "relative", opacity: dragging ? 0.4 : 1 }}>
            <TableCell sx={{ width: 48, py: 0, pr: 0 }}>
                <IconButton
                    aria-hidden
                    size="small"
                    ref={handleRef}
                    tabIndex={-1}
                    sx={{ cursor: "grab" }}
                >
                    <DragIndicatorIcon />
                </IconButton>

                <DropIndicator edge={closestEdge} />
            </TableCell>
            <TableCell>
                <Link
                    to="/manage/$editionId/venues/edit/$venueId"
                    params={{ editionId, venueId: venue.id }}
                >
                    {venue.name}
                </Link>
            </TableCell>
            <TableCell sx={{ whiteSpace: "pre-line" }}>{venue.address}</TableCell>
            <TableCell>{venue.externalKey}</TableCell>
            <TableCell sx={{ py: 0, textAlign: "right" }}>
                <IconButton
                    size="small"
                    aria-label={`Actions for ${venue.name}`}
                    {...bindTrigger(popupState)}
                >
                    <MoreVertIcon />
                </IconButton>
                <Menu {...bindMenu(popupState)}>
                    <MenuItemLink
                        to="/manage/$editionId/venues/edit/$venueId"
                        params={{ editionId, venueId: venue.id }}
                        onClick={() => {
                            popupState.close();
                        }}
                    >
                        <ListItemIcon>
                            <EditIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit venue</ListItemText>
                    </MenuItemLink>
                    <Divider />
                    <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
                        <ListItemIcon>
                            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                        </ListItemIcon>
                        <ListItemText>Delete venue</ListItemText>
                    </MenuItem>
                </Menu>
            </TableCell>
        </TableRow>
    );
};
