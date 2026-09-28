import { useOidc } from "@axa-fr/react-oidc";
import { JsonApiError } from "@jsonapi-serde/client";
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Stack,
    type SxProps,
    type Theme,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { serializeError } from "serialize-error";
import { FullPageSpinner } from "#/components/FullPageSpinner.tsx";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import { getErrorMessage, hasErrorCode } from "#/utils/api.ts";

const monospaceSx: SxProps<Theme> = {
    m: 0,
    fontFamily: "monospace",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
};

type ErrorDetailsProps = {
    error: unknown;
};

const ErrorDetails = ({ error }: ErrorDetailsProps): ReactNode => {
    const { stack, ...summary } = serializeError(error);

    return (
        <>
            <Box component="pre" sx={monospaceSx}>
                {JSON.stringify({ path: window.location.pathname, ...summary }, undefined, 2)}
            </Box>

            {stack && (
                <>
                    <Divider sx={{ my: 2 }} />
                    <Box component="pre" sx={monospaceSx}>
                        {stack}
                    </Box>
                </>
            )}
        </>
    );
};

/**
 * The statuses that are answers rather than faults, and how to head each one.
 *
 * A session someone does not host answers 403 rather than 404, so "not found"
 * here means the thing is genuinely gone or was never there.
 */
const refusalTitles: Record<number, string> = {
    403: "You do not have access",
    404: "Not found",
};

type RefusalCardProps = {
    error: JsonApiError;
    title: string;
};

/**
 * The answer to a refusal, which no amount of trying again turns into a yes.
 *
 * So it carries neither the retry nor the stack the card below offers: the
 * decision was the server's and is not a fault here to report. The API's own
 * detail is shown because a refusal with a reason, a session past its deadline
 * or frozen, says more than the flat one every role check gives.
 */
const RefusalCard = ({ error, title }: RefusalCardProps): ReactNode => {
    const router = useRouter();

    return (
        <Container maxWidth="md" sx={{ my: 2 }}>
            <Alert
                severity="warning"
                action={
                    <Button
                        color="inherit"
                        size="small"
                        onClick={() => {
                            void router.navigate({ to: "/" });
                        }}
                    >
                        Go to start
                    </Button>
                }
            >
                <AlertTitle>{title}</AlertTitle>
                {getErrorMessage(error)}
            </Alert>
        </Container>
    );
};

/**
 * The answer to an account the sign-in provider describes without a detail the app is set to read.
 *
 * Every signed-in page reads the account first, so nothing in the app can mend it, and the start
 * page would fail the same way. Signing out, to come back once the provider sends it, is all that
 * is left.
 */
const MissingClaimCard = ({ error }: Pick<RefusalCardProps, "error">): ReactNode => {
    const { logout } = useOidc();

    return (
        <Container maxWidth="md" sx={{ my: 2 }}>
            <Alert
                severity="warning"
                action={
                    <Button
                        color="inherit"
                        size="small"
                        onClick={() => {
                            void logout("/");
                        }}
                    >
                        Sign out
                    </Button>
                }
            >
                <AlertTitle>Your account is missing details</AlertTitle>
                {getErrorMessage(error)}
            </Alert>
        </Container>
    );
};

/**
 * Paints what a route paints while it loads, since the redirect is on its way.
 *
 * A 401 is answered by signing in again, so nothing here is for the user to act
 * on.
 *
 * An expired session reaches this through onSessionLost as well, and a 401 on a
 * read through the query cache's handler, each of which calls loginAsync first
 * and wins, since loginAsync hands a second caller the in-flight promise and
 * drops its arguments. Every caller names the path, so whichever wins keeps it.
 */
const SignInRedirect = (): ReactNode => {
    const { login } = useOidc();

    useEffect(() => {
        void login(`${window.location.pathname}${window.location.search}`);
    }, [login]);

    return <FullPageSpinner />;
};

type UnexpectedErrorCardProps = {
    error: unknown;
    reset: () => void;
};

const UnexpectedErrorCard = ({ error, reset }: UnexpectedErrorCardProps): ReactNode => {
    const [retrying, setRetrying] = useState(false);
    const queryClient = useQueryClient();
    const router = useRouter();
    const detailsDialog = useDialogController();

    const handleRetry = () => {
        setRetrying(true);

        // All three are needed, for different failures: the query cache holds
        // the rejection a suspended read would throw again, the router holds
        // the loader result, and the boundary holds the caught error.
        void queryClient
            .resetQueries({ predicate: (query) => query.state.status === "error" })
            .then(() => router.invalidate())
            .finally(() => {
                reset();
                setRetrying(false);
            });
    };

    return (
        <Container maxWidth="md" sx={{ my: 2 }}>
            <Alert
                severity="error"
                action={
                    <Stack direction="row" spacing={1}>
                        <Button
                            color="inherit"
                            size="small"
                            onClick={() => {
                                detailsDialog.open();
                            }}
                        >
                            Details
                        </Button>
                        <Button
                            color="inherit"
                            size="small"
                            onClick={handleRetry}
                            loading={retrying}
                        >
                            Try again
                        </Button>
                    </Stack>
                }
            >
                <AlertTitle>Something went wrong</AlertTitle>
                An unexpected error occurred, please try again.
            </Alert>

            {detailsDialog.mount && (
                <Dialog {...detailsDialog.dialogProps} maxWidth="md" fullWidth scroll="paper">
                    <DialogTitle>Error details</DialogTitle>
                    <DialogContent dividers>
                        <ErrorDetails error={error} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={detailsDialog.dialogProps.onClose}>Close</Button>
                    </DialogActions>
                </Dialog>
            )}
        </Container>
    );
};

type ErrorCardProps = UnexpectedErrorCardProps;

export const ErrorCard = ({ error, reset }: ErrorCardProps): ReactNode => {
    if (error instanceof JsonApiError) {
        if (error.status === 401) {
            return <SignInRedirect />;
        }

        if (hasErrorCode(error, "missing_profile_claim")) {
            return <MissingClaimCard error={error} />;
        }

        const title = refusalTitles[error.status];

        if (title !== undefined) {
            return <RefusalCard error={error} title={title} />;
        }
    }

    return <UnexpectedErrorCard error={error} reset={reset} />;
};
