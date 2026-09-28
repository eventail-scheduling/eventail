import { Stack, Typography } from "@mui/material";
import { visuallyHidden } from "@mui/utils";
import type { ReactNode } from "react";

type ScheduleHeaderRowProps = {
    leading?: ReactNode;
    trailing?: ReactNode;
    picker: ReactNode;
};

/**
 * The row above the grid, laid out the same for the draft and a publication.
 *
 * The picker sits in this row rather than one of its own, last, and the row
 * ends flush, so it keeps the right edge across a switch between the two. The
 * controls before it come and go with the state of the draft, and a control
 * that moves is one to hunt for.
 */
export const ScheduleHeaderRow = ({
    leading,
    trailing,
    picker,
}: ScheduleHeaderRowProps): ReactNode => (
    // Ends flush even though the auto margin below already pushes right: a row
    // too wide for the screen overflows at its start instead, and the shell
    // clips rather than scrolls, so the picker is what stays reachable.
    <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "flex-end", mb: 2 }}
    >
        {/* Out of sight below `sm` rather than out of the document, which
            `display: none` would do: nothing else on the page names it, so a
            reader arriving here would have no heading at all. */}
        <Typography
            variant="h5"
            sx={(theme) => ({ [theme.breakpoints.down("sm")]: visuallyHidden })}
        >
            Schedule
        </Typography>

        {leading}
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", ml: "auto" }}>
            {trailing}
            {picker}
        </Stack>
    </Stack>
);
