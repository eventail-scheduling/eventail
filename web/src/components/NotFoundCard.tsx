import { Alert, AlertTitle, Button, Container } from "@mui/material";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** The answer to an address that names nothing, which the router shows in place of its page. */
export const NotFoundCard = (): ReactNode => {
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
                <AlertTitle>Not found</AlertTitle>
                There is nothing at this address. It may have been deleted, or the link may be
                mistyped.
            </Alert>
        </Container>
    );
};
