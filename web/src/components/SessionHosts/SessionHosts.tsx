import DeleteIcon from "@mui/icons-material/Delete";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import {
    Alert,
    Button,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Paper,
    Stack,
    Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useConfirm } from "material-ui-confirm";
import { enqueueSnackbar } from "notistack";
import { Fragment, type ReactNode } from "react";
import { useLocale } from "#/components/LocaleProvider/index.js";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import {
    useDeleteSessionHostInviteMutation,
    useRemoveSessionHostMutation,
} from "#/mutations/session-host.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";
import { InviteHostDialog } from "./InviteHostDialog.tsx";

type SessionHost = {
    id: string;
    displayName: string;
};

type SessionHostsProps = {
    editionId: string;
    sessionId: string;
    hosts: SessionHost[];

    /**
     * Whether pending invites are read at all.
     *
     * The API refuses them with 403 rather than an empty list unless the caller
     * `isInvolvedWith` the session.
     */
    canSeeInvites: boolean;

    /** A host may invite while the session is submitted or accepted, whatever the deadline. */
    canInvite: boolean;

    /**
     * Organizers only, as the API allows no one else.
     *
     * A host can add through an invite but never detach anyone, so the question
     * of removing yourself never arises. Same split as pretalx, whose speaker
     * pages offer invite and retract and no removal at all.
     */
    canRemoveHosts: boolean;

    /** Held back where the page is read-only for the caller, as manage is for a hosting viewer. */
    canRevokeInvites: boolean;
};

export const SessionHosts = ({
    editionId,
    sessionId,
    hosts,
    canSeeInvites,
    canInvite,
    canRemoveHosts,
    canRevokeInvites,
}: SessionHostsProps): ReactNode => {
    const { mediumDateFormatter } = useLocale();
    const qof = useQueryOptionsFactory();
    const confirm = useConfirm();
    const inviteDialog = useDialogController();
    const removeHostMutation = useRemoveSessionHostMutation();
    const deleteInviteMutation = useDeleteSessionHostInviteMutation();

    const invitesQuery = useQuery({
        ...qof.sessionHostInvite.list(editionId, sessionId),
        enabled: canSeeInvites,
    });
    const invites = invitesQuery.data ?? [];

    const handleRemoveHost = async (host: SessionHost) => {
        const { confirmed } = await confirm({
            title: "Remove host",
            description: `Do you really want to remove "${host.displayName}" from this session?`,
            confirmationText: "Remove host",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        removeHostMutation.mutate(
            { editionId, sessionId, hostId: host.id },
            {
                onSuccess: () => {
                    enqueueSnackbar(`"${host.displayName}" no longer hosts this session`, {
                        variant: "success",
                    });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    const handleRevokeInvite = async (inviteId: string, emailAddress: string) => {
        const { confirmed } = await confirm({
            title: "Revoke invite",
            description: `Do you really want to revoke the invite for "${emailAddress}"?`,
            confirmationText: "Revoke invite",
            confirmationButtonProps: { color: "error" },
        });

        if (!confirmed) {
            return;
        }

        deleteInviteMutation.mutate(
            { editionId, sessionId, inviteId },
            {
                onSuccess: () => {
                    enqueueSnackbar("Invite has been revoked", { variant: "success" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Paper sx={{ p: 3 }}>
            <Stack direction="row" sx={{ alignItems: "center", mb: 2 }}>
                <Typography variant="h6" sx={{ mr: "auto" }}>
                    Hosts
                </Typography>

                {canInvite && (
                    <Button
                        startIcon={<PersonAddIcon />}
                        onClick={() => {
                            inviteDialog.open();
                        }}
                    >
                        Invite host
                    </Button>
                )}
            </Stack>

            {invitesQuery.isError && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Pending invites could not be loaded, so any waiting on a reply are missing from
                    this list.
                </Alert>
            )}

            {hosts.length === 0 && invites.length === 0 && !invitesQuery.isError ? (
                <Typography variant="body2">Nobody hosts this session yet.</Typography>
            ) : (
                <List disablePadding>
                    {hosts.map((host) => (
                        <Fragment key={host.id}>
                            <Divider />
                            <ListItem
                                disableGutters
                                secondaryAction={
                                    canRemoveHosts && (
                                        <IconButton
                                            edge="end"
                                            aria-label={`Remove ${host.displayName} from this session`}
                                            onClick={() => {
                                                void handleRemoveHost(host);
                                            }}
                                        >
                                            <DeleteIcon />
                                        </IconButton>
                                    )
                                }
                            >
                                <ListItemText primary={host.displayName} />
                            </ListItem>
                        </Fragment>
                    ))}

                    {invites.map((invite) => (
                        <Fragment key={invite.id}>
                            <Divider />
                            <ListItem
                                disableGutters
                                secondaryAction={
                                    canRevokeInvites && (
                                        <IconButton
                                            edge="end"
                                            aria-label={`Revoke the invite for ${invite.emailAddress}`}
                                            onClick={() => {
                                                void handleRevokeInvite(
                                                    invite.id,
                                                    invite.emailAddress,
                                                );
                                            }}
                                        >
                                            <DeleteIcon />
                                        </IconButton>
                                    )
                                }
                            >
                                <ListItemText
                                    primary={invite.emailAddress}
                                    secondary={`Invited ${mediumDateFormatter.format(invite.createdAt)}, not accepted yet`}
                                />
                            </ListItem>
                        </Fragment>
                    ))}
                </List>
            )}

            {inviteDialog.mount && (
                <InviteHostDialog
                    dialogProps={inviteDialog.dialogProps}
                    editionId={editionId}
                    sessionId={sessionId}
                />
            )}
        </Paper>
    );
};
