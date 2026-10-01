import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { Box, Chip, Stack } from "@mui/material";
import { type ReactNode, useMemo, useRef } from "react";
import {
    type ScheduleAxis,
    ScheduleGrid,
    type ScheduleGridHandle,
} from "#/components/ScheduleGrid/index.js";
import type { Location } from "#/queries/location.js";
import type { Slot } from "#/queries/schedule.js";
import { ScheduleHeaderRow } from "./ScheduleHeaderRow.tsx";

const noWarnings: ReadonlyMap<string, string> = new Map();

type PublicationViewProps = {
    axis: ScheduleAxis;
    slots: Slot[];
    locations: Location[];
    picker: ReactNode;
};

/**
 * A publication as it was announced, which is not a surface anything acts on.
 *
 * Read against the window the publication stamped rather than the edition's,
 * which is free to have moved since: the slots are instants, so an axis built
 * from today's dates would put them on the wrong rows or off the grid entirely.
 *
 * Room shading and speaker warnings are deliberately absent. Both would be read
 * from current data, so a publication from last month would be drawn against
 * today's opening hours and today's calendars, showing something that was never
 * true. Neither has a job on a view nothing is placed on.
 */
export const PublicationView = ({
    axis,
    slots,
    locations,
    picker,
}: PublicationViewProps): ReactNode => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const handleRef = useRef<ScheduleGridHandle | null>(null);

    /**
     * Stripped of availability, which is what actually keeps the shading away.
     *
     * An empty list is the grid's own reading of a room that named no hours, so
     * this says nothing about the room rather than saying something current
     * about a room as it was months ago.
     */
    const rooms = useMemo(
        () => locations.map((location) => ({ ...location, availabilities: [] })),
        [locations],
    );

    return (
        <Stack sx={{ flex: 1, minHeight: 0 }}>
            <ScheduleHeaderRow
                leading={
                    <Chip
                        icon={<LockOutlinedIcon />}
                        size="small"
                        variant="outlined"
                        label="Read only"
                    />
                }
                picker={picker}
            />

            {/* minHeight nil because a column main axis with visible overflow is
                the one case the flex minimum does not already collapse. Without it
                the grid grows to its content and the scroller's own scrollbar ends
                up below the viewport. */}
            <Box sx={{ minWidth: 0, minHeight: 0, flexGrow: 1, display: "flex" }}>
                <ScheduleGrid
                    axis={axis}
                    locations={rooms}
                    slots={slots}
                    step={60}
                    drag={null}
                    warnings={noWarnings}
                    unavailable={[]}
                    selectedSlotId={null}
                    scrollRef={scrollRef}
                    gridRef={gridRef}
                    handleRef={handleRef}
                />
            </Box>
        </Stack>
    );
};
