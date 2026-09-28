import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type FormEvent, type FormEventHandler, type ReactNode, useRef } from "react";
import type { ControlledDialogProps } from "#/hooks/useDialogController.tsx";
import { useUpdateCurrentUserMutation } from "#/mutations/user.ts";
import type { User, UserEditableFields } from "#/queries/user.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { CurrentUserForm, type CurrentUserTransformedValues } from "./index.ts";

type EditCurrentUserDialogProps = {
    dialogProps: ControlledDialogProps;
    user: User;
    editableFields: UserEditableFields;
};

export const EditCurrentUserDialog = ({
    dialogProps,
    user,
    editableFields,
}: EditCurrentUserDialogProps): ReactNode => {
    const updateCurrentUserMutation = useUpdateCurrentUserMutation();
    const onSubmitRef = useRef<FormEventHandler | undefined>(undefined);

    const handleSubmit = (data: CurrentUserTransformedValues) => {
        updateCurrentUserMutation.mutate(data, {
            onSuccess: () => {
                enqueueSnackbar("Your profile has been updated", { variant: "success" });
                dialogProps.onClose();
            },
            onError: defaultMutationErrorHandler,
        });
    };

    return (
        <Dialog
            {...dialogProps}
            slotProps={{
                paper: {
                    component: "form",
                    onSubmit: (event: FormEvent) => onSubmitRef.current?.(event),
                    noValidate: true,
                },
            }}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle>Edit profile</DialogTitle>
            <DialogContent dividers>
                <CurrentUserForm
                    user={user}
                    editableFields={editableFields}
                    onSubmit={handleSubmit}
                    onSubmitRef={onSubmitRef}
                />
            </DialogContent>
            <DialogActions>
                <Button type="submit" loading={updateCurrentUserMutation.isPending}>
                    Update
                </Button>
            </DialogActions>
        </Dialog>
    );
};
