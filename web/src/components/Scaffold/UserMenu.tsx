import { useOidc } from "@axa-fr/react-oidc";
import BadgeIcon from "@mui/icons-material/Badge";
import BrightnessAutoIcon from "@mui/icons-material/BrightnessAuto";
import BuildIcon from "@mui/icons-material/Build";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import GroupsIcon from "@mui/icons-material/Groups";
import LanguageIcon from "@mui/icons-material/Language";
import LightModeIcon from "@mui/icons-material/LightMode";
import LogoutIcon from "@mui/icons-material/Logout";
import PersonIcon from "@mui/icons-material/Person";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import WorkHistoryIcon from "@mui/icons-material/WorkHistory";
import {
    Box,
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Typography,
    useColorScheme,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import { bindMenu, bindToggle, usePopupState } from "material-ui-popup-state/hooks";
import type { ReactNode } from "react";
import invariant from "tiny-invariant";
import { EditCurrentUserDialog } from "#/components/CurrentUser";
import { MenuItemLink } from "#/components/Link";
import { localeDisplayName, useLocale } from "#/components/LocaleProvider";
import { useDialogController } from "#/hooks/useDialogController.tsx";
import { useQueryOptionsFactory } from "#/queries";
import { PreferredLocaleDialog } from "./PreferredLocaleDialog.js";

type Appearance = {
    value: Parameters<ReturnType<typeof useColorScheme>["setMode"]>[0];
    label: string;
    icon: ReactNode;
};

const appearances: Appearance[] = [
    { value: "system", label: "Match system", icon: <BrightnessAutoIcon /> },
    { value: "light", label: "Light", icon: <LightModeIcon /> },
    { value: "dark", label: "Dark", icon: <DarkModeIcon /> },
];

export const UserMenu = (): ReactNode => {
    const { mode, setMode } = useColorScheme();
    const qof = useQueryOptionsFactory();
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const { preferredLocale, resolvedLocale } = useLocale();
    invariant(currentUser.data);

    const { logout } = useOidc();
    const popupState = usePopupState({ popupId: "user-menu", variant: "popover" });
    const profileDialogController = useDialogController();
    const preferredLocaleDialogController = useDialogController();

    const internalLinks: ReactNode[] = [];

    if (currentUser.meta.highestRole !== null) {
        internalLinks.push(
            <MenuItemLink
                to="/manage"
                key="manage"
                onClick={() => {
                    popupState.close();
                }}
            >
                <ListItemIcon>
                    <BuildIcon />
                </ListItemIcon>
                <ListItemText>Manage</ListItemText>
            </MenuItemLink>,
        );
    }

    if (currentUser.meta.highestRole === "admin") {
        internalLinks.push(
            <MenuItemLink
                to="/teams"
                key="teams"
                onClick={() => {
                    popupState.close();
                }}
            >
                <ListItemIcon>
                    <GroupsIcon />
                </ListItemIcon>
                <ListItemText>Teams</ListItemText>
            </MenuItemLink>,
            <MenuItemLink
                to="/erase-user"
                key="erase-user"
                onClick={() => {
                    popupState.close();
                }}
            >
                <ListItemIcon>
                    <PersonRemoveIcon />
                </ListItemIcon>
                <ListItemText>Erase user</ListItemText>
            </MenuItemLink>,
        );
    }

    if (currentUser.meta.superAdmin) {
        internalLinks.push(
            <MenuItemLink
                to="/jobs"
                key="jobs"
                onClick={() => {
                    popupState.close();
                }}
            >
                <ListItemIcon>
                    <WorkHistoryIcon />
                </ListItemIcon>
                <ListItemText>Background jobs</ListItemText>
            </MenuItemLink>,
        );
    }

    return (
        <>
            <IconButton
                {...bindToggle(popupState)}
                edge="end"
                color="inherit"
                aria-label="Open user menu"
                sx={{ ml: "auto" }}
            >
                <PersonIcon />
            </IconButton>
            <Menu {...bindMenu(popupState)}>
                <Box sx={{ p: 2, pt: 1, maxWidth: 390 }}>
                    <Typography noWrap>{currentUser.data.displayName}</Typography>
                    <Typography variant="body2" noWrap>
                        {currentUser.data.emailAddress}
                    </Typography>
                </Box>

                <Divider sx={{ mb: 1 }} />

                {internalLinks.length > 0 && [...internalLinks, <Divider key="divider" />]}

                {currentUser.meta.editableFields.length > 0 && (
                    <MenuItem
                        onClick={() => {
                            popupState.close();
                            profileDialogController.open();
                        }}
                    >
                        <ListItemIcon>
                            <BadgeIcon />
                        </ListItemIcon>
                        <ListItemText>Edit profile</ListItemText>
                    </MenuItem>
                )}
                <MenuItem
                    onClick={() => {
                        popupState.close();
                        void logout("/");
                    }}
                >
                    <ListItemIcon>
                        <LogoutIcon />
                    </ListItemIcon>
                    <ListItemText>Logout</ListItemText>
                </MenuItem>

                <Divider sx={{ mb: 1 }} />

                <MenuItem
                    onClick={() => {
                        popupState.close();
                        preferredLocaleDialogController.open();
                    }}
                >
                    <ListItemIcon>
                        <LanguageIcon />
                    </ListItemIcon>
                    <ListItemText
                        primary="Regional format"
                        secondary={
                            preferredLocale === null
                                ? "System default"
                                : localeDisplayName(preferredLocale, resolvedLocale)
                        }
                    />
                </MenuItem>

                <Divider sx={{ mb: 1 }} />

                <li role="none">
                    {/* biome-ignore lint/a11y/useSemanticElements: the suggested fieldset cannot hold the list items the menu renders */}
                    <ul role="group" aria-label="Appearance" style={{ padding: 0 }}>
                        {appearances.map(({ value, label, icon }) => (
                            <MenuItem
                                key={value}
                                role="menuitemradio"
                                aria-checked={(mode ?? "system") === value}
                                selected={(mode ?? "system") === value}
                                onClick={() => {
                                    popupState.close();
                                    setMode(value);
                                }}
                            >
                                <ListItemIcon>{icon}</ListItemIcon>
                                <ListItemText>{label}</ListItemText>
                            </MenuItem>
                        ))}
                    </ul>
                </li>
            </Menu>

            {profileDialogController.mount && (
                <EditCurrentUserDialog
                    dialogProps={profileDialogController.dialogProps}
                    user={currentUser.data}
                    editableFields={currentUser.meta.editableFields}
                />
            )}

            {preferredLocaleDialogController.mount && (
                <PreferredLocaleDialog dialogProps={preferredLocaleDialogController.dialogProps} />
            )}
        </>
    );
};
