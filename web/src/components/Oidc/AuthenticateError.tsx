import { useOidc } from "@axa-fr/react-oidc";
import { Alert, Button, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export const callbackPath = "/authentication/callback";

/**
 * Shown when a sign-in failed, at its callback or before the provider was reached.
 *
 * Reloading the callback replays the same spent answer and fails the same way, so the way forward
 * is a fresh sign-in. From the callback the page the attempt began on is not known, and it starts
 * from the start page; anywhere else it returns to where it is.
 */
export const AuthenticateError = (): ReactNode => {
    const { login } = useOidc();

    return (
        <Container maxWidth="sm" sx={{ my: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                Could not sign you in
            </Typography>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
                <Alert severity="error">Something went wrong while signing in.</Alert>
                <Button
                    variant="contained"
                    onClick={() => {
                        const { pathname, search } = window.location;
                        void login(pathname === callbackPath ? "/" : `${pathname}${search}`);
                    }}
                >
                    Sign in again
                </Button>
            </Stack>
        </Container>
    );
};
