import { useOidc } from "@axa-fr/react-oidc";
import { Alert, type Breakpoint, Button, Container, Stack, Typography } from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import invariant from "tiny-invariant";
import { useLocale } from "#/components/LocaleProvider";
import { useQueryOptionsFactory } from "#/queries";
import { getErrorMessage, hasErrorCode } from "#/utils/api.ts";
import { rememberSignInResumePath } from "#/utils/sign-in-resume.ts";

type AcceptInviteProps = {
    title: string;
    /** What the invite grants, named so the user knows what they are accepting. */
    subject: ReactNode;
    expiresAt?: Temporal.Instant;
    /**
     * Shown in place of the invite, so a caller leaves out a failed refetch it can outlast.
     *
     * An invite preview's rejections are the page's own content rather than an
     * error boundary's, so a caller reads the invite with a query that does
     * not suspend.
     */
    error: unknown;
    /** Covers the preview request too: accepting before it settles would accept
     * an invite the user has not been shown. */
    isPending: boolean;
    onAccept: () => void;
    /** Stands in for the accept button when accepting takes more than pressing it. */
    action?: ReactNode;
    maxWidth?: Breakpoint;
};

export const AcceptInvite = ({
    title,
    subject,
    expiresAt,
    error,
    isPending,
    onAccept,
    action,
    maxWidth = "sm",
}: AcceptInviteProps): ReactNode => {
    const { longDateTimeFormatter } = useLocale();
    const { logout } = useOidc();
    const qof = useQueryOptionsFactory();
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    invariant(currentUser.data);

    // On both branches: after a refusal it explains the mismatch, and before
    // accepting it is the only thing on the page naming who is about to be
    // bound by it.
    const signedInAs = (
        <Typography variant="body2">{`Signed in as ${currentUser.data.emailAddress}.`}</Typography>
    );

    return (
        <Container maxWidth={maxWidth} sx={{ my: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {title}
            </Typography>

            {error ? (
                <Stack spacing={1}>
                    <Alert severity="error">{getErrorMessage(error)}</Alert>
                    {signedInAs}

                    {/* Only this refusal has an answer the user can act on.
                        An expired invite needs a new one, and offering to sign
                        in again would send them around for nothing. */}
                    {hasErrorCode(error, "invite_email_mismatch") && (
                        <div>
                            <Button
                                variant="contained"
                                sx={{ mt: 1 }}
                                onClick={() => {
                                    rememberSignInResumePath(
                                        `${window.location.pathname}${window.location.search}`,
                                    );
                                    void logout("/");
                                }}
                            >
                                Sign in as someone else
                            </Button>
                        </div>
                    )}
                </Stack>
            ) : (
                <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
                    {subject}

                    {expiresAt && (
                        <Typography variant="body2">
                            {`This invite expires on ${longDateTimeFormatter.format(expiresAt)}.`}
                        </Typography>
                    )}

                    {signedInAs}

                    {action ?? (
                        <Button variant="contained" loading={isPending} onClick={onAccept}>
                            Accept
                        </Button>
                    )}
                </Stack>
            )}
        </Container>
    );
};
