import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { Box } from "@mui/material";
import type { ReactNode } from "react";

type DropIndicatorProps = {
    edge: Extract<Edge, "top" | "bottom"> | null;
};

export const DropIndicator = ({ edge }: DropIndicatorProps): ReactNode => {
    if (edge === null) {
        return null;
    }

    // The bar sits inside the row's own padding rather than in a gap between
    // rows, because a gap is a dead zone where the indicator blinks out. The
    // row has to establish the positioning context.
    return (
        <Box
            sx={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 2,
                bgcolor: "primary.main",
                ...(edge === "top" ? { top: -2 } : { bottom: 0 }),
            }}
        />
    );
};
