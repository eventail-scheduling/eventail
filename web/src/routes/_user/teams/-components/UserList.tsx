import DeleteIcon from "@mui/icons-material/Delete";
import { Divider, IconButton, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useConfirm } from "material-ui-confirm";
import { enqueueSnackbar } from "notistack";
import { Fragment, type ReactNode } from "react";
import { useRemoveUserMutation } from "#/mutations/team.ts";
import type { Team } from "#/queries/team.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

type UserListProps = {
    team: Team;
};

export const UserList = ({ team }: UserListProps): ReactNode => {
    const removeMutation = useRemoveUserMutation();
    const confirm = useConfirm();

    const handleDelete = async (user: Team["users"][number]) => {
        const { confirmed } = await confirm({
            title: "Remove user",
            description: `Do you really want to remove the user "${user.displayName}" from the team?`,
            confirmationText: "Remove user",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        removeMutation.mutate(
            { teamId: team.id, userId: user.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("User has been removed", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <div>
            <Typography variant="h6">Users</Typography>

            <List>
                {team.users.map((user) => (
                    <Fragment key={user.id}>
                        <Divider />
                        <ListItem
                            secondaryAction={
                                <IconButton
                                    edge="end"
                                    onClick={() => {
                                        handleDelete(user);
                                    }}
                                    aria-label={`Remove ${user.displayName} from the team`}
                                >
                                    <DeleteIcon />
                                </IconButton>
                            }
                        >
                            <ListItemText>{user.displayName}</ListItemText>
                        </ListItem>
                    </Fragment>
                ))}
                <Divider />
            </List>
        </div>
    );
};
