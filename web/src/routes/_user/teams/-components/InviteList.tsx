import DeleteIcon from "@mui/icons-material/Delete";
import { Divider, IconButton, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useConfirm } from "material-ui-confirm";
import { enqueueSnackbar } from "notistack";
import { Fragment, type ReactNode } from "react";
import { useDeleteInviteMutation } from "#/mutations/team.ts";
import type { Team } from "#/queries/team.ts";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

type InviteListProps = {
    team: Team;
};

export const InviteList = ({ team }: InviteListProps): ReactNode => {
    const deleteMutation = useDeleteInviteMutation();
    const confirm = useConfirm();

    const handleDelete = async (invite: Team["invites"][number]) => {
        const { confirmed } = await confirm({
            title: "Delete invite",
            description: `Do you really want to delete the invite for "${invite.emailAddress}"?`,
            confirmationText: "Delete invite",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteMutation.mutate(
            { teamId: team.id, inviteId: invite.id },
            {
                onSuccess: () => {
                    enqueueSnackbar("Invite has been deleted", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <div>
            <Typography variant="h6">Invites</Typography>

            <List>
                {team.invites.map((invite) => (
                    <Fragment key={invite.id}>
                        <Divider />
                        <ListItem
                            secondaryAction={
                                <IconButton
                                    edge="end"
                                    onClick={() => {
                                        handleDelete(invite);
                                    }}
                                    aria-label={`Delete the invite for ${invite.emailAddress}`}
                                >
                                    <DeleteIcon />
                                </IconButton>
                            }
                        >
                            <ListItemText>{invite.emailAddress}</ListItemText>
                        </ListItem>
                    </Fragment>
                ))}
                <Divider />
            </List>
        </div>
    );
};
