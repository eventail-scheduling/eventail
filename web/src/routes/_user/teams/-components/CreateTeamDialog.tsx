import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { ControlledDialogProps } from "#/hooks/useDialogController.tsx";
import { useCreateTeamMutation } from "#/mutations/team.ts";
import { defaultMutationErrorHandler } from "#/utils/api.js";
import { formResolver } from "#/utils/zod.js";
import {
    createTeamDefaultValues,
    type TeamFieldValues,
    TeamFormFields,
    type TeamTransformedValues,
    teamFormSchema,
} from "./TeamFormFields.tsx";

type CreateTeamDialogProps = {
    dialogProps: ControlledDialogProps;
};

export const CreateTeamDialog = ({ dialogProps }: CreateTeamDialogProps): ReactNode => {
    const createTeamMutation = useCreateTeamMutation();

    const form = useForm<TeamFieldValues, unknown, TeamTransformedValues>({
        resolver: formResolver(teamFormSchema),
        defaultValues: createTeamDefaultValues(null),
    });

    const handleSubmit = (values: TeamTransformedValues) => {
        createTeamMutation.mutate(values, {
            onSuccess: () => {
                enqueueSnackbar("Team has been created", { variant: "success" });
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
                    onSubmit: form.handleSubmit(handleSubmit),
                    noValidate: true,
                },
            }}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle>Create team</DialogTitle>
            <DialogContent dividers>
                <TeamFormFields control={form.control} />
            </DialogContent>
            <DialogActions>
                <Button type="submit" loading={createTeamMutation.isPending}>
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
};
