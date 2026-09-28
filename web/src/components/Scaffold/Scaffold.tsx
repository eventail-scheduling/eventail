import MenuIcon from "@mui/icons-material/Menu";
import {
    AppBar,
    Box,
    Drawer,
    IconButton,
    Toolbar,
    Typography,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import iconLight from "#/assets/icon-light.svg";
import { UserMenu } from "./UserMenu.js";

type ScaffoldProps = {
    children: ReactNode;
    /**
     * Puts navigation behind the hamburger at every width, not just narrow ones.
     *
     * For a surface that wants the whole width, where the drawer is something
     * you visit rather than something you read while working.
     */
    overlayNavigation?: boolean;
    /**
     * Gives the page the viewport's height instead of the document's.
     *
     * For a section that owns its own scrolling. `dvh` rather than `vh` because
     * a mobile browser's chrome collapses as you scroll, and `vh` is measured
     * against the taller state, so the bottom of the page sits under it.
     */
    fillViewport?: boolean;
    drawerContent?: ReactNode;
    drawerWidth?: number;
};

export const Scaffold = ({
    children,
    drawerContent,
    drawerWidth = 240,
    overlayNavigation = false,
    fillViewport = false,
}: ScaffoldProps): ReactNode => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const router = useRouter();
    const theme = useTheme();
    const compact = !useMediaQuery(theme.breakpoints.up("md"));

    // Following a link leaves `mobileOpen` set. On a phone the drawer then
    // stays open over the new page, and at md+ it reappears unasked the next
    // time the width drops or a section that overlays it is entered.
    useEffect(
        () =>
            router.subscribe("onResolved", () => {
                setMobileOpen(false);
                setIsClosing(false);
            }),
        [router],
    );

    const handleDrawerClose = () => {
        setIsClosing(true);
        setMobileOpen(false);
    };

    const handleDrawerTransitionEnd = () => {
        setIsClosing(false);
    };

    const handleDrawerToggle = () => {
        if (!isClosing) {
            setMobileOpen(!mobileOpen);
        }
    };

    return (
        <Box sx={{ display: "flex", height: fillViewport ? "100dvh" : undefined }}>
            <AppBar position="fixed">
                <Toolbar>
                    {drawerContent && (
                        <IconButton
                            edge="start"
                            color="inherit"
                            onClick={handleDrawerToggle}
                            aria-label="Open navigation"
                            sx={{ mr: 2, display: overlayNavigation ? "flex" : { md: "none" } }}
                        >
                            <MenuIcon />
                        </IconButton>
                    )}

                    <Box
                        component="img"
                        src={iconLight}
                        alt="Eventail icon"
                        height={32}
                        sx={{ display: "block", mr: 2 }}
                    />
                    <Typography
                        variant="h6"
                        component="div"
                        sx={{ display: drawerContent ? { xs: "none", md: "block" } : undefined }}
                    >
                        Eventail
                    </Typography>

                    <UserMenu />
                </Toolbar>
            </AppBar>
            {drawerContent && (
                <Box
                    component="nav"
                    sx={{
                        width: overlayNavigation ? 0 : { md: drawerWidth },
                        flexShrink: { md: 0 },
                    }}
                >
                    <Drawer
                        variant="temporary"
                        open={mobileOpen && (overlayNavigation || compact)}
                        onTransitionEnd={handleDrawerTransitionEnd}
                        onClose={handleDrawerClose}
                        sx={{
                            display: overlayNavigation ? "block" : { xs: "block", md: "none" },
                            "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth },
                        }}
                        slotProps={{
                            root: {
                                keepMounted: true,
                            },
                        }}
                    >
                        {drawerContent}
                    </Drawer>
                    <Drawer
                        variant="permanent"
                        sx={{
                            display: overlayNavigation ? "none" : { xs: "none", md: "block" },
                            "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth },
                        }}
                        open
                    >
                        {drawerContent}
                    </Drawer>
                </Box>
            )}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    // A flex item will not shrink below its content, so without
                    // this a wide child widens the page instead of scrolling.
                    minWidth: 0,
                    // Clipped rather than scrolled, which is what leaves the
                    // page without a scrollbar of its own: a section that fills
                    // the viewport owns its scrolling and nothing here should
                    // offer a second way to reach the same content.
                    ...(fillViewport && {
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                    }),
                    py: { xs: 2, sm: 4 },
                    width:
                        drawerContent && !overlayNavigation
                            ? { md: `calc(100% - ${drawerWidth}px)` }
                            : undefined,
                }}
            >
                <Toolbar />
                {children}
            </Box>
        </Box>
    );
};
