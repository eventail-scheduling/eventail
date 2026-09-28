import { useOidc } from "@axa-fr/react-oidc";
import { Button, Container, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export const LoggedOutElsewhere = (): ReactNode => {
    const { login } = useOidc();

    return (
        <Container maxWidth="sm" sx={{ my: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                Signed out
            </Typography>
            <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
                <Typography>You signed out of Eventail in another tab.</Typography>
                <Button
                    variant="contained"
                    onClick={() => {
                        void login(`${window.location.pathname}${window.location.search}`);
                    }}
                >
                    Sign in again
                </Button>
            </Stack>
        </Container>
    );
};
