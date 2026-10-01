import { createTheme } from "@mui/material/styles";

/**
 * Carries the app's layout-affecting defaults, which a bare createTheme lacks.
 *
 * `useFlexGap` is the one that shows: without it a Stack spaces with margins and
 * zeroes its children's own, so a row that relies on `mr: auto` lays out one way
 * here and another in the browser. The rest of the app theme is deliberately
 * left out, since colors and variants would change what these tests measure.
 */
export const createTestTheme = () =>
    createTheme({
        cssVariables: true,
        components: {
            MuiStack: {
                defaultProps: {
                    useFlexGap: true,
                },
            },
        },
    });
