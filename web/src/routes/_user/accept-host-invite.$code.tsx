import { JsonApiError } from "@jsonapi-serde/client";
import { CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, Suspense } from "react";
import { AcceptInvite } from "#/components/AcceptInvite.tsx";
import { Scaffold } from "#/components/Scaffold/index.js";
import { useAcceptSessionHostInviteMutation } from "#/mutations/invite.ts";
import { useQueryOptionsFactory } from "#/queries";
import { defaultMutationErrorHandler, hasErrorCode } from "#/utils/api.ts";
import { describeProfileGaps } from "#/utils/profile-gaps.ts";
import { CompleteHostProfile } from "./-components/CompleteHostProfile.tsx";

/**
 * Tells a refusal of the invite itself from a failure the half-filled profile form can outlast.
 *
 * A 401 speaks of the token rather than the invite, and the next save signs in again.
 */
const refusesInvite = (error: unknown): boolean =>
    error instanceof JsonApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401;

const Root = (): ReactNode => {
    const { code } = Route.useParams();
    const qof = useQueryOptionsFactory();
    const navigate = useNavigate();
    const acceptMutation = useAcceptSessionHostInviteMutation();

    // Not a suspense query, for the reason on AcceptInvite's `error`.
    const { data: invite, error, isLoading } = useQuery(qof.invite.getSessionHostInvite(code));

    const handleAccept = () => {
        if (!invite) {
            return;
        }

        acceptMutation.mutate(
            { code, editionId: invite.edition.id, sessionId: invite.session.id },
            {
                onSuccess: async () => {
                    enqueueSnackbar("You are now a host of this session", { variant: "success" });
                    await navigate({
                        to: "/editions/$editionId/sessions/$sessionId",
                        params: { editionId: invite.edition.id, sessionId: invite.session.id },
                    });
                },
                onError: (error) => {
                    if (!hasErrorCode(error, "incomplete_profile")) {
                        defaultMutationErrorHandler(error);
                        return;
                    }

                    // The form showed every field the edition asks for, so a
                    // refusal means what it asks for changed while this page
                    // was open: a question added or unfrozen, or one that
                    // turned required. Unexplained, it looks like a button
                    // that does nothing.
                    const gaps = describeProfileGaps(error);

                    if (gaps === null) {
                        defaultMutationErrorHandler(error);
                    } else {
                        enqueueSnackbar(gaps, { variant: "error" });
                    }
                },
            },
        );
    };

    return (
        <Scaffold>
            <AcceptInvite
                title="Session host invite"
                subject={
                    invite && (
                        <Typography>
                            You have been invited to co-host <strong>{invite.session.title}</strong>{" "}
                            at {invite.edition.name}.
                        </Typography>
                    )
                }
                expiresAt={invite?.expiresAt}
                error={invite !== undefined && !refusesInvite(error) ? null : error}
                isPending={isLoading || acceptMutation.isPending}
                onAccept={handleAccept}
                maxWidth="md"
                action={
                    invite ? (
                        <Suspense fallback={<CircularProgress />}>
                            <CompleteHostProfile
                                editionId={invite.edition.id}
                                isAccepting={acceptMutation.isPending}
                                onSaved={handleAccept}
                            />
                        </Suspense>
                    ) : (
                        <CircularProgress />
                    )
                }
            />
        </Scaffold>
    );
};

export const Route = createFileRoute("/_user/accept-host-invite/$code")({
    component: Root,
});
