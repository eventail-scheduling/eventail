import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
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
import type { ReactNode } from "react";
import { Link, MenuItemLink } from "#/components/Link/index.js";
import { useDeleteCustomFieldMutation } from "#/mutations/custom-field.ts";
import type { CustomField } from "#/queries/custom-field.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

const responseTypeLabels: Record<CustomField["options"]["type"], string> = {
    boolean: "Checkbox",
    single_line_text: "Single line text",
    multi_line_text: "Multi line text",
    single_choice: "Single choice",
    multiple_choice: "Multiple choice",
    number: "Number",
    file: "File upload",
    date: "Date",
    url: "URL",
};

const requirementLabels: Record<CustomField["requirement"], string> = {
    always_optional: "Optional",
    always_required: "Required",
    required_after_deadline: "Required after deadline",
};

type CustomFieldRowProps = {
    editionId: string;
    customField: CustomField;
};

export const CustomFieldRow = ({ editionId, customField }: CustomFieldRowProps): ReactNode => {
    const popupState = usePopupState({
        variant: "popover",
        popupId: `customField-${customField.id}`,
    });
    const deleteMutation = useDeleteCustomFieldMutation();
    const confirm = useConfirm();

    const handleDelete = async () => {
        popupState.close();

        const { confirmed } = await confirm({
            title: "Delete custom field",
            description: `Do you really want to delete "${customField.title}"? Every response to it goes with it.`,
            confirmationText: "Delete",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { editionId, id: customField.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Custom field has been deleted", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <TableRow>
            <TableCell>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Link
                        to="/manage/$editionId/custom-fields/edit/$customFieldId"
                        params={{ editionId, customFieldId: customField.id }}
                    >
                        {customField.title}
                    </Link>
                    {customField.confidential && <Chip size="small" label="Confidential" />}
                </Stack>
            </TableCell>
            <TableCell>
                {customField.target === "per_proposal" ? "Per proposal" : "Per person"}
            </TableCell>
            <TableCell>{responseTypeLabels[customField.options.type]}</TableCell>
            <TableCell>{requirementLabels[customField.requirement]}</TableCell>
            <TableCell sx={{ py: 0, textAlign: "right" }}>
                <IconButton
                    size="small"
                    aria-label={`Actions for ${customField.title}`}
                    {...bindTrigger(popupState)}
                >
                    <MoreVertIcon />
                </IconButton>
                <Menu {...bindMenu(popupState)}>
                    <MenuItemLink
                        to="/manage/$editionId/custom-fields/edit/$customFieldId"
                        params={{ editionId, customFieldId: customField.id }}
                        onClick={() => {
                            popupState.close();
                        }}
                    >
                        <ListItemIcon>
                            <EditIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Edit custom field</ListItemText>
                    </MenuItemLink>
                    <Divider />
                    <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
                        <ListItemIcon>
                            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                        </ListItemIcon>
                        <ListItemText>Delete custom field</ListItemText>
                    </MenuItem>
                </Menu>
            </TableCell>
        </TableRow>
    );
};
