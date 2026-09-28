import { Link as MuiLink, type LinkProps as MuiLinkProps } from "@mui/material";
import { createLink } from "@tanstack/react-router";
import React from "react";

const MuiLinkComponent = React.forwardRef<HTMLAnchorElement, MuiLinkProps>((props, ref) => (
    <MuiLink ref={ref} {...props} />
));

export const Link = createLink(MuiLinkComponent);
