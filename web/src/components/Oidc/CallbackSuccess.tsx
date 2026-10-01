import { Container, Typography } from "@mui/material";
import type { ReactNode } from "react";

export const CallbackSuccess = (): ReactNode => (
    <Container maxWidth="sm" sx={{ my: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
            Signed in
        </Typography>
        <Typography>Taking you back to where you were.</Typography>
    </Container>
);
