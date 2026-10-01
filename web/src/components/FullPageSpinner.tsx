import { Box, CircularProgress } from "@mui/material";
import type { ReactNode } from "react";

export const FullPageSpinner = (): ReactNode => {
    return (
        <Box
            sx={{
                display: "flex",
                width: "100%",
                height: "100dvh",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <CircularProgress size={80} />
        </Box>
    );
};
