import { Typography } from "@mui/material";
import type { ReactNode } from "react";

type UploadWaitHintProps = {
    uploading: boolean;
    action?: "save" | "create" | "submit" | "change steps";
};

/** Says why a button is held, which a disabled button alone does not. */
export const UploadWaitHint = ({ uploading, action = "save" }: UploadWaitHintProps): ReactNode => (
    // Rendered empty rather than not at all: a live region has to exist before
    // its text changes for screen readers to announce it.
    <Typography role="status" variant="body2" sx={{ color: "text.secondary" }}>
        {uploading ? `You can ${action} once the upload has finished.` : null}
    </Typography>
);
