import { Button as MuiButton, type ButtonProps as MuiButtonProps } from "@mui/material";
import { createLink } from "@tanstack/react-router";
import React from "react";

const MuiButtonLinkComponent = React.forwardRef<HTMLAnchorElement, MuiButtonProps<"a">>(
    (props, ref) => <MuiButton ref={ref} component="a" {...props} />,
);

export const ButtonLink = createLink(MuiButtonLinkComponent);
