import { Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import type { ReactNode } from "react";
import { AcceptInvite } from "#/components/AcceptInvite.tsx";
import { Scaffold } from "#/components/Scaffold/index.js";
import { useAcceptTeamInviteMutation } from "#/mutations/invite.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler } from "#/utils/api.ts";

const Root = (): ReactNode => {
    const { code } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const navigate = useNavigate();
    const acceptMutation = useAcceptTeamInviteMutation();

    // Not a suspense query, for the reason on AcceptInvite's `error`.
    const { data: invite, error, isLoading } = useQuery(qof.invite.getTeamInvite(code));

    const handleAccept = () => {
        acceptMutation.mutate(
            { code },
            {
                onSuccess: async () => {
                    enqueueSnackbar("You have joined the team", { variant: "success" });
                    // Every team page is admin only, and a team can grant
                    // manager or viewer instead, so the team just joined is not
                    // somewhere its new member can necessarily go.
                    await navigate({ to: "/" });
                },
                onError: defaultMutationErrorHandler,
            },
        );
    };

    return (
        <Scaffold>
            <AcceptInvite
                title="Team invite"
                subject={
                    invite && (
                        <Typography>
                            You have been invited to join the team{" "}
                            <strong>{invite.teamName}</strong>.
                        </Typography>
                    )
                }
                expiresAt={invite?.expiresAt}
                error={error}
                isPending={isLoading || acceptMutation.isPending}
                onAccept={handleAccept}
            />
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/accept-team-invite/$code")({
    component: Root,
});
