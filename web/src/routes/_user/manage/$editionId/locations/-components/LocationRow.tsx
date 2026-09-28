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
import { useDeleteLocationMutation } from "#/mutations/location.ts";
import type { Location } from "#/queries/location.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

type LocationRowProps = {
    editionId: string;
    location: Location;
    listKey: SortableListKey;
    index: number;
};

export const LocationRow = ({
    editionId,
    location,
    listKey,
    index,
}: LocationRowProps): ReactNode => {
    const { rowRef, handleRef, dragging, closestEdge } = useSortableItem<HTMLTableRowElement>({
        listKey,
        itemId: location.id,
        index,
    });
    const popupState = usePopupState({ variant: "popover", popupId: `location-${location.id}` });
    const deleteMutation = useDeleteLocationMutation();
    const confirm = useConfirm();

    const handleDelete = async () => {
        popupState.close();

        const { confirmed } = await confirm({
            title: "Delete location",
            description: `Do you really want to delete the location "${location.name}"?`,
            confirmationText: "Delete",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { editionId, id: location.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Location has been deleted", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
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
                    to="/manage/$editionId/locations/edit/$locationId"
                    params={{ editionId, locationId: location.id }}
                >
                    {location.name}
                </Link>
            </TableCell>
            <TableCell>{location.externalKey}</TableCell>
            <TableCell sx={{ py: 0, textAlign: "right" }}>
                <IconButton
                    size="small"
                    aria-label={`Actions for ${location.name}`}
                    {...bindTrigger(popupState)}
                >
                    <MoreVertIcon />
                </IconButton>
                <Menu {...bindMenu(popupState)}>
                    <MenuItemLink
                        to="/manage/$editionId/locations/edit/$locationId"
                        params={{ editionId, locationId: location.id }}
                        onClick={() => {
                            popupState.close();
                        }}
                    >
                        <ListItemIcon>
                            <EditIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit location</ListItemText>
                    </MenuItemLink>
                    <Divider />
                    <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
                        <ListItemIcon>
                            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                        </ListItemIcon>
                        <ListItemText>Delete location</ListItemText>
                    </MenuItem>
                </Menu>
            </TableCell>
        </TableRow>
    );
};
