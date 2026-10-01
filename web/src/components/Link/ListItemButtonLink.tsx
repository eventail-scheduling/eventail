import {
    ListItemButton as MuiListItemButton,
    type ListItemButtonProps as MuiListItemButtonProps,
} from "@mui/material";
import { createLink } from "@tanstack/react-router";
import React from "react";

const MuiListItemButtonLinkComponent = React.forwardRef<
    HTMLAnchorElement,
    MuiListItemButtonProps<"a">
>((props, ref) => <MuiListItemButton ref={ref} component="a" {...props} />);

export const ListItemButtonLink = createLink(MuiListItemButtonLinkComponent);
