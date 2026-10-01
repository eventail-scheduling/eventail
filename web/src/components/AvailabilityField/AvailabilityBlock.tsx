import DeleteIcon from "@mui/icons-material/Delete";
import { Box, Typography, useTheme } from "@mui/material";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

/** How far past its own edge a block reaches for a resize gesture. */
const EDGE_GRAB = 8;

type AvailabilityBlockProps = {
    fromMinutes: number;
    toMinutes: number;
    minutesPerColumn: number;
    selected: boolean;
    disabled: boolean;
    formatRange: (fromMinutes: number, toMinutes: number) => string;
    onGrab: (event: ReactPointerEvent<HTMLElement>) => void;
    onGrabEdge: (edge: "start" | "end", event: ReactPointerEvent<HTMLElement>) => void;
};

export const AvailabilityBlock = ({
    fromMinutes,
    toMinutes,
    minutesPerColumn,
    selected,
    disabled,
    formatRange,
    onGrab,
    onGrabEdge,
}: AvailabilityBlockProps): ReactNode => {
    const theme = useTheme();

    return (
        <Box
            data-testid="availability-block"
            draggable={false}
            onPointerDown={onGrab}
            sx={{
                position: "absolute",
                insetInline: 0,
                top: `${(fromMinutes / minutesPerColumn) * 100}%`,
                height: `${((toMinutes - fromMinutes) / minutesPerColumn) * 100}%`,
                px: 0.5,
                boxSizing: "border-box",
                cursor: disabled ? "default" : "grab",
            }}
        >
            <Box
                sx={{
                    height: "100%",
                    overflow: "hidden",
                    borderRadius: 1,
                    border: 1,
                    borderColor: selected ? "error.main" : "primary.main",
                    backgroundColor: `rgba(${
                        selected
                            ? theme.vars.palette.error.mainChannel
                            : theme.vars.palette.primary.mainChannel
                    } / ${selected ? 0.36 : 0.28})`,
                    pl: 1,
                    pr: selected ? 3 : 1,
                    py: 0.25,
                }}
            >
                <Typography
                    variant="caption"
                    noWrap
                    component="div"
                    sx={{ color: "text.primary", userSelect: "none" }}
                >
                    {formatRange(fromMinutes, toMinutes)}
                </Typography>
            </Box>

            {selected && !disabled && (
                <DeleteIcon
                    sx={{
                        position: "absolute",
                        top: 2,
                        insetInlineEnd: 4,
                        fontSize: 16,
                        pointerEvents: "none",
                        color: "error.main",
                    }}
                />
            )}

            {!disabled &&
                (["start", "end"] as const).map((edge) => (
                    <Box
                        key={edge}
                        onPointerDown={(event) => {
                            onGrabEdge(edge, event);
                        }}
                        sx={{
                            position: "absolute",
                            insetInline: 0,
                            // Straddling the edge, so a block too short to hold
                            // two handles inside itself still has both.
                            ...(edge === "start"
                                ? { top: -EDGE_GRAB / 2 }
                                : { bottom: -EDGE_GRAB / 2 }),
                            height: EDGE_GRAB,
                            cursor: "ns-resize",
                        }}
                    />
                ))}
        </Box>
    );
};
