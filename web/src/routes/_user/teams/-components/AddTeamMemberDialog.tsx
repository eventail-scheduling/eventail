import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/mini";
import type { ControlledDialogProps } from "#/hooks/useDialogController.tsx";
import { useCreateInviteMutation } from "#/mutations/team.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";

const schema = z.object({
    emailAddress: z.string().check(z.trim(), z.minLength(1), z.email()),
});

export type AddTeamMemberFieldValues = z.input<typeof schema>;
export type AddTeamMemberTransformedValues = z.output<typeof schema>;

type AddTeamMemberDialogProps = {
    dialogProps: ControlledDialogProps;
    teamId: string;
};

export const AddTeamMemberDialog = ({
    dialogProps,
    teamId,
}: AddTeamMemberDialogProps): ReactNode => {
    const createInviteMutation = useCreateInviteMutation();
    const form = useForm<AddTeamMemberFieldValues, unknown, AddTeamMemberTransformedValues>({
        resolver: formResolver(schema),
        defaultValues: { emailAddress: "" },
    });

    const handleSubmit = (values: AddTeamMemberTransformedValues) => {
        createInviteMutation.mutate(
            { teamId, emailAddress: values.emailAddress },
            {
                onSuccess: () => {
                    enqueueSnackbar("Invite has been sent", { variant: "success" });
                    dialogProps.onClose();
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Dialog
            {...dialogProps}
            slotProps={{
                paper: {
                    component: "form",
                    onSubmit: form.handleSubmit(handleSubmit),
                    noValidate: true,
                },
            }}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle>Invite member</DialogTitle>
            <DialogContent dividers>
                <RhfTextField
                    control={form.control}
                    name="emailAddress"
                    label="Email address"
                    helperText="They join the team once they accept the invite"
                    type="email"
                    required
                    fullWidth
                    autoFocus
                />
            </DialogContent>
            <DialogActions>
                <Button type="submit" loading={createInviteMutation.isPending}>
                    Invite
                </Button>
            </DialogActions>
        </Dialog>
    );
};
