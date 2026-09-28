import {
    IconButton as MuiIconButton,
    type IconButtonProps as MuiIconButtonProps,
} from "@mui/material";
import { createLink } from "@tanstack/react-router";
import React from "react";

const MuiIconButtonLinkComponent = React.forwardRef<HTMLAnchorElement, MuiIconButtonProps<"a">>(
    (props, ref) => <MuiIconButton ref={ref} component="a" {...props} />,
);

export const IconButtonLink = createLink(MuiIconButtonLinkComponent);
