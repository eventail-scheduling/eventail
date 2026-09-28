import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { RhfTextField } from "mui-rhf-integration";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/mini";
import type { ControlledDialogProps } from "#/hooks/useDialogController.tsx";
import { useCreateSessionHostInviteMutation } from "#/mutations/session-host.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";

const schema = z.object({
    emailAddress: z.string().check(z.trim(), z.minLength(1), z.email()),
});

type InviteHostFieldValues = z.input<typeof schema>;
type InviteHostTransformedValues = z.output<typeof schema>;

type InviteHostDialogProps = {
    dialogProps: ControlledDialogProps;
    editionId: string;
    sessionId: string;
};

export const InviteHostDialog = ({
    dialogProps,
    editionId,
    sessionId,
}: InviteHostDialogProps): ReactNode => {
    const createInviteMutation = useCreateSessionHostInviteMutation();
    const form = useForm<InviteHostFieldValues, unknown, InviteHostTransformedValues>({
        resolver: formResolver(schema),
        defaultValues: { emailAddress: "" },
    });

    const handleSubmit = (values: InviteHostTransformedValues) => {
        createInviteMutation.mutate(
            { editionId, sessionId, emailAddress: values.emailAddress },
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
            <DialogTitle>Invite host</DialogTitle>
            <DialogContent dividers>
                <RhfTextField
                    control={form.control}
                    name="emailAddress"
                    label="Email address"
                    helperText="They join the session once they accept the invite"
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
