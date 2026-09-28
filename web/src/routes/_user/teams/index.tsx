import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
    Alert,
    Button,
    Container,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Stack,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useConfirm } from "material-ui-confirm";
import { enqueueSnackbar } from "notistack";
import { Fragment, type ReactNode } from "react";
import { ListItemButtonLink } from "#/components/Link/index.js";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import { useDeleteTeamMutation } from "#/mutations/team.ts";
import { useQueryOptionsFactory } from "#/queries";
import type { ListTeam } from "#/queries/team.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { CreateTeamDialog } from "./-components/CreateTeamDialog.tsx";

const Root = (): ReactNode => {
    const qof = useQueryOptionsFactory();
    const teams = useSuspenseQuery(qof.team.list()).data;
    const createDialogController = useDialogController();
    const confirm = useConfirm();
    const deleteMutation = useDeleteTeamMutation();

    const handleDelete = async (team: ListTeam) => {
        const { confirmed } = await confirm({
            title: "Delete team",
            description: `Do you really want to delete the team "${team.name}"?`,
            confirmationText: "Delete team",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { id: team.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Team has been deleted", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Container>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h5">Teams</Typography>

                <Button
                    onClick={() => {
                        createDialogController.open();
                    }}
                    variant="contained"
                    startIcon={<AddIcon />}
                    sx={{ ml: "auto" }}
                >
                    Add team
                </Button>
            </Stack>

            {teams.length === 0 && <Alert severity="info">No teams have been created yet.</Alert>}

            {teams.length > 0 && (
                <List>
                    {teams.map((team) => (
                        <Fragment key={team.id}>
                            <Divider />
                            <ListItem
                                key={team.id}
                                disablePadding
                                secondaryAction={
                                    <IconButton
                                        edge="end"
                                        onClick={() => {
                                            handleDelete(team);
                                        }}
                                        aria-label={`Delete team "${team.name}"`}
                                    >
                                        <DeleteIcon />
                                    </IconButton>
                                }
                            >
                                <ListItemButtonLink
                                    to="/teams/edit/$teamId"
                                    params={{ teamId: team.id }}
                                >
                                    <ListItemText>{team.name}</ListItemText>
                                </ListItemButtonLink>
                            </ListItem>
                        </Fragment>
                    ))}
                    <Divider />
                </List>
            )}

            {createDialogController.mount && (
                <CreateTeamDialog dialogProps={createDialogController.dialogProps} />
            )}
        </Container>
    );
};

export const Route = createFileRoute("/_user/teams/")({
    component: Root,
    loader: async ({ context }) => {
        await context.queryClient.ensureQueryData(context.qof.team.list());
    },
});
