import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    List,
    ListItem,
    ListItemText,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "#/components/Link/index.js";
import type { ControlledDialogProps } from "#/hooks/useDialogController.js";
import type { BlockingCustomField } from "#/queries/custom-field.ts";

type ScopeInUseDialogProps = {
    editionId: string;
    customFields: BlockingCustomField[];
    subject: "track" | "session type";
    dialogProps: ControlledDialogProps;
};

export const ScopeInUseDialog = ({
    editionId,
    customFields,
    subject,
    dialogProps,
}: ScopeInUseDialogProps): ReactNode => {
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down("md"));

    return (
        <Dialog {...dialogProps} maxWidth="sm" fullWidth fullScreen={fullScreen}>
            <DialogTitle>Questions are limited to this {subject}</DialogTitle>
            <DialogContent dividers>
                <DialogContentText variant="body2">
                    {customFields.length === 1
                        ? `This question names no ${subject} but this one, so deleting the ${subject} would lift the limit and ask the question for every ${subject}. Rescope or delete the question first.`
                        : `These questions name no ${subject} but this one, so deleting the ${subject} would lift the limit and ask them for every ${subject}. Rescope or delete them first.`}
                </DialogContentText>

                <List dense>
                    {customFields.map((customField) => (
                        <ListItem key={customField.id} disableGutters>
                            <ListItemText
                                primary={
                                    <Link
                                        to="/manage/$editionId/custom-fields/edit/$customFieldId"
                                        params={{ editionId, customFieldId: customField.id }}
                                        onClick={dialogProps.onClose}
                                    >
                                        {customField.title}
                                    </Link>
                                }
                            />
                        </ListItem>
                    ))}
                </List>
            </DialogContent>
            <DialogActions>
                <Button onClick={dialogProps.onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};
