import { MenuItem as MuiMenuItem, type MenuItemProps as MuiMenuItemProps } from "@mui/material";
import { createLink } from "@tanstack/react-router";
import React from "react";

const MuiMenuItemLinkComponent = React.forwardRef<HTMLAnchorElement, MuiMenuItemProps<"a">>(
    (props, ref) => <MuiMenuItem ref={ref} component="a" {...props} />,
);

export const MenuItemLink = createLink(MuiMenuItemLinkComponent);
