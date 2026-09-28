import CheckIcon from "@mui/icons-material/Check";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import {
    Button,
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    ListSubheader,
    Menu,
    MenuItem,
    Tooltip,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { bindMenu, bindTrigger, usePopupState } from "material-ui-popup-state/hooks";
import type { ReactNode } from "react";
import { ChoiceMenu } from "#/components/ChoiceMenu.js";
import { type MinuteStep, minuteSteps } from "#/components/ScheduleGrid/index.js";

type DraftActionsProps = {
    /** Why publishing is unavailable, or null where it is available. */
    publishBlockedBy: string | null;
    revertDisabled: boolean;
    step: MinuteStep;
    onPublish: () => void;
    onRevert: () => void;
    onStepChange: (step: MinuteStep) => void;
};

const stepLabel = (step: MinuteStep): string => `${step.toString()} min`;

/**
 * Publish, revert and the snap setting, as controls in the row or, below `sm`, behind one button.
 *
 * A clash chip and a publication's picker push the row past a narrow phone, and the shell clips
 * rather than scrolls.
 */
export const DraftActions = (props: DraftActionsProps): ReactNode => {
    const theme = useTheme();
    const compact = useMediaQuery(theme.breakpoints.down("sm"));

    return compact ? <DraftActionsMenu {...props} /> : <DraftActionControls {...props} />;
};

const DraftActionControls = ({
    publishBlockedBy,
    revertDisabled,
    step,
    onPublish,
    onRevert,
    onStepChange,
}: DraftActionsProps): ReactNode => (
    <>
        <Button size="small" color="error" disabled={revertDisabled} onClick={onRevert}>
            Revert
        </Button>

        <Tooltip title={publishBlockedBy ?? ""}>
            {/* Wrapped, because a disabled button fires no events and a
                tooltip on one would never say why it is disabled. */}
            <span>
                <Button
                    variant="contained"
                    size="small"
                    disabled={publishBlockedBy !== null}
                    onClick={onPublish}
                >
                    Publish
                </Button>
            </span>
        </Tooltip>

        <ChoiceMenu
            icon={<TimerOutlinedIcon />}
            label="Snap to"
            display={(choice) => `${choice.value.toString()}m`}
            value={step}
            choices={minuteSteps.map((option) => ({ value: option, label: stepLabel(option) }))}
            onChange={onStepChange}
        />
    </>
);

/** Gives the reason Publish is unavailable as item text, where the wide row uses a tooltip. */
const DraftActionsMenu = ({
    publishBlockedBy,
    revertDisabled,
    step,
    onPublish,
    onRevert,
    onStepChange,
}: DraftActionsProps): ReactNode => {
    const popupState = usePopupState({ variant: "popover", popupId: "draft-actions" });

    return (
        <>
            <IconButton
                aria-label="Schedule actions"
                {...bindTrigger(popupState)}
                aria-expanded={popupState.isOpen}
            >
                <MoreVertIcon />
            </IconButton>
            <Menu
                {...bindMenu(popupState)}
                slotProps={{ list: { "aria-label": "Schedule actions", dense: true } }}
            >
                <MenuItem
                    disabled={publishBlockedBy !== null}
                    onClick={() => {
                        popupState.close();
                        onPublish();
                    }}
                >
                    <ListItemText primary="Publish" secondary={publishBlockedBy} />
                </MenuItem>
                <MenuItem
                    disabled={revertDisabled}
                    onClick={() => {
                        popupState.close();
                        onRevert();
                    }}
                    sx={{ color: "error.main" }}
                >
                    <ListItemText primary="Revert" />
                </MenuItem>
                <Divider />
                <ListSubheader sx={{ bgcolor: "transparent" }}>Snap to</ListSubheader>
                {minuteSteps.map((option) => (
                    <MenuItem
                        key={option}
                        role="menuitemradio"
                        // The subheader is plain text inside the menu and names
                        // no item, so each radio carries the group's name itself.
                        aria-label={`Snap to ${stepLabel(option)}`}
                        aria-checked={option === step}
                        selected={option === step}
                        onClick={() => {
                            popupState.close();
                            onStepChange(option);
                        }}
                    >
                        <ListItemIcon>
                            {option === step && <CheckIcon fontSize="small" />}
                        </ListItemIcon>
                        <ListItemText primary={stepLabel(option)} />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};
