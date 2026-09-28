import CheckIcon from "@mui/icons-material/Check";
import {
    Box,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Tooltip,
    Typography,
    useTheme,
} from "@mui/material";
import { type ReactNode, useId, useState } from "react";

export type Choice<TValue extends string | number> = {
    value: TValue;
    label: string;
    /** Shown under the label, for what the label alone does not say. */
    detail?: string;
    disabled?: boolean;
};

type ChoiceMenuProps<TValue extends string | number> = {
    icon: ReactNode;
    /** Names the control, since nothing else does once the value leaves it. */
    label: string;
    /**
     * A short standing-in for the value, shown beside the icon.
     *
     * Only worth giving where every value is short enough to leave the control
     * a fixed size, which is the whole reason this is not a select. Without it
     * the value is readable only through the tooltip, and a tooltip costs a
     * long press on touch.
     */
    display?: (choice: Choice<TValue>) => string;
    value: TValue;
    choices: readonly Choice<TValue>[];
    onChange: (value: TValue) => void;
};

/**
 * A fixed size control for a choice whose labels are not a fixed size.
 *
 * A select is as wide as its longest option, so a publication stamped with a
 * long date, or a translation, moves everything beside it. This is an icon and a
 * menu instead: the current value is a check inside the menu rather than the
 * control's own width. The tooltip carries it for anyone hovering.
 */
export const ChoiceMenu = <TValue extends string | number>({
    icon,
    label,
    display,
    value,
    choices,
    onChange,
}: ChoiceMenuProps<TValue>): ReactNode => {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const theme = useTheme();
    const menuId = useId();
    const current = choices.find((choice) => choice.value === value);

    return (
        <>
            <Tooltip title={current ? `${label}: ${current.label}` : label}>
                <IconButton
                    aria-label={current ? `${label}: ${current.label}` : label}
                    aria-haspopup="menu"
                    aria-controls={anchor ? menuId : undefined}
                    aria-expanded={anchor ? true : undefined}
                    onClick={(event) => {
                        setAnchor(event.currentTarget);
                    }}
                    sx={current && display ? { borderRadius: 2, gap: 0.5 } : undefined}
                >
                    {icon}

                    {current && display && (
                        // Every value drawn into one cell and all but the
                        // current one hidden, so the box is the width of the
                        // widest whatever is showing. Counting characters
                        // cannot do this: a digit and a letter are not the same
                        // width, and neither are two translations.
                        <Box component="span" sx={{ display: "grid" }}>
                            {choices.map((choice) => (
                                <Typography
                                    key={choice.value}
                                    variant="body2"
                                    component="span"
                                    sx={{
                                        gridArea: "1 / 1",
                                        visibility: choice.value === value ? "visible" : "hidden",
                                    }}
                                >
                                    {display(choice)}
                                </Typography>
                            ))}
                        </Box>
                    )}
                </IconButton>
            </Tooltip>

            <Menu
                id={menuId}
                anchorEl={anchor}
                open={anchor !== null}
                onClose={() => {
                    setAnchor(null);
                }}
                slotProps={{ list: { "aria-label": label, dense: true } }}
            >
                {choices.map((choice) => (
                    <MenuItem
                        key={choice.value}
                        // Material UI derives aria-checked from `selected` for
                        // this role alone; on a plain menuitem `selected` is
                        // presentational and the choice is announced to nobody.
                        role="menuitemradio"
                        aria-checked={choice.value === value}
                        selected={choice.value === value}
                        disabled={choice.disabled}
                        onClick={() => {
                            setAnchor(null);
                            onChange(choice.value);
                        }}
                    >
                        <ListItemIcon>
                            {choice.value === value && <CheckIcon fontSize="small" />}
                        </ListItemIcon>
                        <ListItemText
                            primary={choice.label}
                            secondary={choice.detail}
                            sx={{ maxWidth: theme.breakpoints.values.sm / 2 }}
                        />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
};
