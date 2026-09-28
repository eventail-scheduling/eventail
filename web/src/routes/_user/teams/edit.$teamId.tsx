import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
    Alert,
    Button,
    Card,
    CardActions,
    CardContent,
    CardHeader,
    Container,
    Stack,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback } from "react";
import { useForm } from "react-hook-form";
import { IconButtonLink } from "#/components/Link/index.js";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import { useUpdateTeamMutation } from "#/mutations/team.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { formResolver } from "#/utils/zod.js";
import { AddTeamMemberDialog } from "./-components/AddTeamMemberDialog.tsx";
import { InviteList } from "./-components/InviteList.tsx";
import {
    createTeamDefaultValues,
    type TeamFieldValues,
    TeamFormFields,
    type TeamTransformedValues,
    teamFormSchema,
} from "./-components/TeamFormFields.tsx";
import { UserList } from "./-components/UserList.tsx";

const Root = (): ReactNode => {
    const qof = useQueryOptionsFactory();
    const params = Route.useParams();
    const team = useSuspenseQuery(qof.team.get(params.teamId)).data;
    const updateMutation = useUpdateTeamMutation();
    const addMemberDialogController = useDialogController();

    const form = useForm<TeamFieldValues, unknown, TeamTransformedValues>({
        resolver: formResolver(teamFormSchema),
        defaultValues: createTeamDefaultValues(team),
    });

    const handleUpdate = useCallback(
        (values: TeamTransformedValues) => {
            updateMutation.mutate(
                { id: team.id, ...values },
                {
                    onSuccess: () => {
                        enqueueSnackbar("Team has been updated", { variant: "success" });
                        form.reset(form.getValues());
                    },
                    onError: defaultMutationErrorHandler,
                },
            );
        },
        [updateMutation, team.id, form],
    );

    return (
        <Container>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}>
                <IconButtonLink to="/teams" edge="start" aria-label="Back to teams" sx={{ mr: 1 }}>
                    <ArrowBackIcon />
                </IconButtonLink>
                <Typography variant="h5">Team "{team.name}"</Typography>
            </Stack>

            <Card
                component="form"
                noValidate
                onSubmit={form.handleSubmit(handleUpdate)}
                sx={{ mb: 2 }}
            >
                <CardHeader title="Update team" />
                <CardContent>
                    <TeamFormFields control={form.control} />
                </CardContent>
                <CardActions>
                    <Button
                        type="submit"
                        loading={updateMutation.isPending}
                        disabled={!form.formState.isDirty}
                    >
                        Update
                    </Button>
                </CardActions>
            </Card>

            <Card>
                <CardHeader title="Members" />
                <CardContent>
                    {team.users.length === 0 && team.invites.length === 0 && (
                        <Alert severity="info">No members have been added yet.</Alert>
                    )}

                    <Stack spacing={2}>
                        {team.users.length > 0 && <UserList team={team} />}
                        {team.invites.length > 0 && <InviteList team={team} />}
                    </Stack>
                </CardContent>
                <CardActions>
                    <Button
                        type="button"
                        onClick={() => {
                            addMemberDialogController.open();
                        }}
                    >
                        Add member
                    </Button>
                </CardActions>
            </Card>

            {addMemberDialogController.mount && (
                <AddTeamMemberDialog
                    dialogProps={addMemberDialogController.dialogProps}
                    teamId={team.id}
                />
            )}
        </Container>
    );
};

export const Route = createFileRoute("/_user/teams/edit/$teamId")({
    component: Root,
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(context.qof.team.get(params.teamId));
    },
});
