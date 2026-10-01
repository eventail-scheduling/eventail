declare module "@mui/material" {
    interface DialogPaperSlotPropsOverrides {
        noValidate: boolean;
    }
}

declare module "@mui/material/styles" {
    interface CssThemeVariables {
        enabled: true;
    }
}
