import BarChartIcon from "@mui/icons-material/BarChart";
import CategoryIcon from "@mui/icons-material/Category";
import DynamicFormIcon from "@mui/icons-material/DynamicForm";
import EventIcon from "@mui/icons-material/Event";
import GroupIcon from "@mui/icons-material/Group";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import SettingsIcon from "@mui/icons-material/Settings";
import ViewDayIcon from "@mui/icons-material/ViewDay";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Toolbar,
    Typography,
} from "@mui/material";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import invariant from "tiny-invariant";
import iconDark from "#/assets/icon-dark.svg";
import iconLight from "#/assets/icon-light.svg";
import { ButtonLink, ListItemButtonLink } from "#/components/Link/index.js";
import { useLocale } from "#/components/LocaleProvider/index.js";
import { useDialogController } from "#/hooks/useDialogController.js";
import { useQueryOptionsFactory } from "#/queries";
import type { Edition } from "#/queries/edition.js";
import { fulfillsRole } from "#/utils/role.ts";

type DrawerContentProps = {
    edition: Edition;
};

export const DrawerContent = ({ edition }: DrawerContentProps): ReactNode => {
    const qof = useQueryOptionsFactory();
    const currentUser = useSuspenseQuery(qof.user.getCurrentUser()).data;
    const editions = useSuspenseQuery(qof.edition.list()).data;
    const { dateFormatter } = useLocale();
    const dialogController = useDialogController();
    invariant(currentUser.data);

    return (
        <div>
            <Toolbar>
                {/* Both are rendered so the scheme is resolved by CSS; picking
                    one here would flash, because the mode is undefined on the
                    first render. */}
                <Box
                    component="img"
                    src={iconLight}
                    alt="Eventail icon"
                    height={32}
                    sx={[
                        { display: "block", mr: 2 },
                        (theme) => theme.applyStyles("light", { display: "none" }),
                    ]}
                />
                <Box
                    component="img"
                    src={iconDark}
                    alt="Eventail icon"
                    height={32}
                    sx={[
                        { display: "none", mr: 2 },
                        (theme) => theme.applyStyles("light", { display: "block" }),
                    ]}
                />
                <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                    Eventail
                </Typography>
            </Toolbar>
            <Divider />
            <List disablePadding>
                <ListItemButton onClick={dialogController.open}>
                    <ListItemText
                        primary={edition.name}
                        secondary={dateFormatter.formatRange(edition.startDate, edition.endDate)}
                        slotProps={{
                            primary: {
                                sx: {
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                },
                            },
                        }}
                    />
                    <KeyboardArrowRightIcon />
                </ListItemButton>
                <Divider />
                <ListItemButtonLink
                    to="/manage/$editionId/sessions"
                    params={{ editionId: edition.id }}
                >
                    <ListItemIcon>
                        <EventIcon />
                    </ListItemIcon>
                    <ListItemText>Sessions</ListItemText>
                </ListItemButtonLink>
                <ListItemButtonLink
                    to="/manage/$editionId/hosts"
                    params={{ editionId: edition.id }}
                >
                    <ListItemIcon>
                        <GroupIcon />
                    </ListItemIcon>
                    <ListItemText>Hosts</ListItemText>
                </ListItemButtonLink>
                <ListItemButtonLink
                    to="/manage/$editionId/schedule"
                    params={{ editionId: edition.id }}
                >
                    <ListItemIcon>
                        <ViewDayIcon />
                    </ListItemIcon>
                    <ListItemText>Schedule</ListItemText>
                </ListItemButtonLink>
                {fulfillsRole(currentUser, "manager") && (
                    <>
                        <Divider />
                        <ListItemButtonLink
                            to="/manage/$editionId/submission-form"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <ListAltIcon />
                            </ListItemIcon>
                            <ListItemText>Submission form</ListItemText>
                        </ListItemButtonLink>
                        <ListItemButtonLink
                            to="/manage/$editionId/custom-fields"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <DynamicFormIcon />
                            </ListItemIcon>
                            <ListItemText>Custom fields</ListItemText>
                        </ListItemButtonLink>
                        <ListItemButtonLink
                            to="/manage/$editionId/session-types"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <CategoryIcon />
                            </ListItemIcon>
                            <ListItemText>Session types</ListItemText>
                        </ListItemButtonLink>
                        <ListItemButtonLink
                            to="/manage/$editionId/tracks"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <BarChartIcon />
                            </ListItemIcon>
                            <ListItemText>Tracks</ListItemText>
                        </ListItemButtonLink>
                        <ListItemButtonLink
                            to="/manage/$editionId/locations"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <LocationOnIcon />
                            </ListItemIcon>
                            <ListItemText>Locations</ListItemText>
                        </ListItemButtonLink>
                        <Divider />
                        <ListItemButtonLink
                            to="/manage/$editionId/settings"
                            params={{ editionId: edition.id }}
                        >
                            <ListItemIcon>
                                <SettingsIcon />
                            </ListItemIcon>
                            <ListItemText>Settings</ListItemText>
                        </ListItemButtonLink>
                    </>
                )}
            </List>

            {dialogController.mount && (
                <Dialog {...dialogController.dialogProps} maxWidth="xs" fullWidth>
                    <DialogTitle>Switch Edition</DialogTitle>
                    <DialogContent dividers sx={{ p: 0 }}>
                        <List disablePadding>
                            {editions.map((candidate) => (
                                <ListItemButtonLink
                                    key={candidate.id}
                                    to="/manage/$editionId"
                                    params={{ editionId: candidate.id }}
                                    onClick={dialogController.dialogProps.onClose}
                                    selected={candidate.id === edition.id}
                                >
                                    <ListItemText
                                        primary={candidate.name}
                                        secondary={dateFormatter.formatRange(
                                            candidate.startDate,
                                            candidate.endDate,
                                        )}
                                    />
                                </ListItemButtonLink>
                            ))}
                        </List>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={dialogController.dialogProps.onClose}>Cancel</Button>
                        {fulfillsRole(currentUser, "manager") && (
                            <ButtonLink to="/manage/create-edition">Create new edition</ButtonLink>
                        )}
                    </DialogActions>
                </Dialog>
            )}
        </div>
    );
};
